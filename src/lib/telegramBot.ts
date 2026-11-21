import fs from 'node:fs';
import path from 'node:path';
import { settingsService } from './settings';
import { taskService } from './tasks';
import { licenseGate } from './licenseGate';
import { MEDIA_DIR, markMediaServed } from './mediaStore';
import { parseTaskInput } from './taskInput';
import { COMMON_VOICES, MAX_SPEECH_TASK_CHARS, parseVoiceCommand, speechOf, speechTextError } from './speech';

// Built-in Telegram bot — the user-facing "chat with the gateway" surface.
// Long-polls the Bot API inside this process (no public webhook needed) and
// feeds prompts through the same task pool as /v1/tasks, so license gate,
// account rotation and media storage all behave identically.
//
// Config lives in settings.json (dashboard → Telegram bot), never in env —
// self-setup by the end user. ensure() reconciles the running loop with the
// saved config; it is called from instrumentation at boot, and from
// /api/telegram after every settings change.

const API_BASE = 'https://api.telegram.org';
const POLL_TIMEOUT_S = 25;
const TASK_POLL_MS = 3_000;
const TASK_TIMEOUT_MS = 15 * 60_000; // long videos stitch many ~10s segments
const MAX_UPLOAD_BYTES = 45 * 1024 * 1024; // Bot API caps uploads at ~50MB
const MAX_PHOTO_BYTES = 20 * 1024 * 1024; // getFile downloads cap at 20MB
const ERR_BACKOFF_MS = 5_000;
const CONFLICT_BACKOFF_MS = 15_000;
const OWNER = 'telegram';
const RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4'];
const MAX_DURATION = 60;
const MAX_COUNT = 4;
/** Ratio words a Vietnamese user naturally types instead of 9:16/16:9/1:1. */
const RATIO_WORDS: Record<string, string> = {
  'dọc': '9:16',
  'ngang': '16:9',
  'vuông': '1:1',
};
/** Bare-prompt intent — "/img" forgotten. Strips the keyword, keeps the rest
 *  as the prompt. Order matters: video words are checked first so
 *  "tạo video ảnh ..." still lands on video. Boundary uses a Unicode
 *  lookahead, not \b — \b treats accented letters (vẽ, ảnh…) as non-word. */
const VID_INTENT = /^(tạo\s+|tao\s+|quay\s+|làm\s+|lam\s+|dựng\s+|dung\s+)?(video|clip|phim|reel|reels|vid|quay|film)(?![\p{L}\p{N}])[\s:–—-]*/iu;
const IMG_INTENT = /^(tạo\s+|tao\s+|vẽ\s+|ve\s+|làm\s+|lam\s+|dựng\s+|dung\s+)?(ảnh|anh|hình( ảnh)?|hinh|image|img|photo|picture|poster|logo|sticker|thumbnail|banner|vẽ)(?![\p{L}\p{N}])[\s:–—-]*/iu;

export interface TgStatus {
  running: boolean;
  username: string | null;
  error: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const log = (...a: any[]) => console.log('[MuseTG]', ...a);
const warn = (...a: any[]) => console.warn('[MuseTG]', ...a);

/** Local file behind a /api/media/<name> URL this gateway issued. */
function localMediaFile(url: string): { file: string; name: string } | null {
  try {
    const match = new URL(url, 'http://local').pathname.match(/^\/api\/media\/([^/]+)$/);
    if (!match) return null;
    const name = decodeURIComponent(match[1]);
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return null;
    return { file: path.join(MEDIA_DIR, name), name };
  } catch {
    return null;
  }
}

export interface TgParsed {
  prompt: string;
  ratio: string;
  durationSec: number;
  count: number;
  /** User-facing validation problem — reply it, don't generate. */
  error: string | null;
}

/** Split `/vid 16:9 15s a cat` into overrides + prompt. Only leading tokens
 *  are flags — "a cat 4" keeps the 4 inside the prompt. `error` is set for
 *  flag-shaped input that cannot be honoured (bad ratio, duration over the
 *  60s cap, image count over 4, a duration passed to /img). */
function parseRequest(text: string, defaults: { ratio: string; durationSec: number }, kind: 'video' | 'image'): TgParsed | null {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  let ratio: string | null = null;
  let durationSec: number | null = null;
  let count: number | null = null;
  let error: string | null = null;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const low = t.toLowerCase();
    if (ratio === null && /^\d{1,2}:\d{1,2}$/.test(t)) {
      if (RATIOS.includes(t)) ratio = t;
      else error = `Tỉ lệ "${t}" không hỗ trợ — chọn một trong: ${RATIOS.join(', ')}.`;
      i++;
      continue;
    }
    if (ratio === null && RATIO_WORDS[low]) {
      ratio = RATIO_WORDS[low];
      i++;
      continue;
    }
    if (durationSec === null) {
      const dur = /^(\d{1,3})(s|sec|secs|giây|giay)?$/i.exec(t);
      if (dur && (dur[2] !== undefined || kind === 'video')) {
        const n = Number(dur[1]);
        if (kind === 'image') {
          error = `Ảnh không có thời lượng — dùng /vid ${dur[0]} <prompt> nếu muốn video.`;
        } else if (n < 1 || n > MAX_DURATION) {
          error = `Thời lượng tối đa ${MAX_DURATION}s (bạn gửi ${n}s).`;
        } else {
          durationSec = n;
        }
        i++;
        continue;
      }
    } else if (/^(giây|giay|sec|secs|s)$/i.test(t)) {
      i++; // "15 giây" — swallow the word after the number
      continue;
    }
    if (kind === 'image' && count === null) {
      const cnt = /^x?(\d{1,2})x?$/i.exec(t);
      if (cnt) {
        const n = Number(cnt[1]);
        if (n < 1 || n > MAX_COUNT) error = `Một lần tạo tối đa ${MAX_COUNT} ảnh (bạn gửi ${n}).`;
        else count = n;
        i++;
        continue;
      }
    }
    break; // first non-flag token — the rest is the prompt
  }
  const prompt = tokens.slice(i).join(' ').trim();
  if (!prompt) return null;
  return {
    prompt,
    ratio: ratio ?? defaults.ratio,
    durationSec: durationSec ?? defaults.durationSec,
    count: count ?? 1,
    error,
  };
}

class TelegramBotService {
  private abort: AbortController | null = null;
  private running = false;
  private token = '';
  private username: string | null = null;
  private error: string | null = null;
  private offset = 0;
  /** Token that fatally failed (401/404 on getMe). Kept so status polls
   *  don't relaunch the loop in a hot error cycle — an explicit settings
   *  save clears it. */
  private fatalToken: string | null = null;
  /** Chats with a generation already running — one job at a time per chat
   *  keeps a pasted wall of prompts from flooding the pool. */
  private inflight = new Set<number>();

  /** Bring the running loop in line with saved settings. Idempotent —
   *  safe to call from boot and status polls. `force` (a settings save)
   *  clears the fatal marker and restarts even for the same token. */
  ensure(force = false) {
    const s = settingsService.get();
    const token = s.telegramToken.trim();
    if (!s.telegramEnabled || !token) {
      this.stop();
      return;
    }
    if (this.running && this.token === token && !force) return;
    if (this.fatalToken === token && !force) return;
    if (force) this.fatalToken = null;
    this.start(token);
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
    this.running = false;
    this.username = null;
  }

  status(): TgStatus {
    return { running: this.running, username: this.username, error: this.error };
  }

  private start(token: string) {
    this.stop();
    this.token = token;
    this.offset = 0;
    this.error = null;
    const controller = new AbortController();
    this.abort = controller;
    this.running = true;
    void this.loop(controller.signal)
      .catch((err) => warn('poll loop crashed:', err?.message ?? err))
      .finally(() => {
        // Only unset when this loop is still the current one — a newer
        // start() must not be reported as stopped.
        if (this.abort === controller) {
          this.running = false;
          this.username = null;
        }
      });
  }

  private async api(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<any | null> {
    try {
      const res = await fetch(`${API_BASE}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      return await res.json().catch(() => null);
    } catch (err: any) {
      if (!signal?.aborted) warn(`${method} failed:`, err?.message ?? err);
      return null;
    }
  }

  private async loop(signal: AbortSignal) {
    // getMe first — a bad token fails fast; a network blip retries in-place.
    let me: any = null;
    while (!signal.aborted) {
      me = await this.api('getMe', {}, signal);
      if (signal.aborted) return;
      if (me?.ok) break;
      if (me && (me.error_code === 401 || me.error_code === 404)) {
        this.error = 'Token không hợp lệ hoặc đã bị thu hồi.';
        this.fatalToken = this.token;
        warn('getMe failed (fatal):', me.description);
        return;
      }
      this.error = 'Không kết nối được Telegram — đang thử lại…';
      warn('getMe failed:', me?.description ?? 'network');
      await sleep(ERR_BACKOFF_MS * 2);
    }
    if (signal.aborted || !me?.ok) return;
    this.error = null;
    this.username = me.result?.username ?? null;
    log(`bot @${this.username} đang poll`);

    // Register the "/" menu so typing / suggests commands in every client.
    // Non-fatal — a frozen older Bot API would only lose the hint list.
    void this.api('setMyCommands', {
      commands: [
        { command: 'vid', description: 'Tạo video — /vid [tỉ lệ] [Ns] <prompt>' },
        { command: 'img', description: 'Tạo ảnh — /img [số] [tỉ lệ] <prompt>' },
        { command: 'voice', description: 'Đọc văn bản thành giọng nói — /voice [nam|nữ] [1.2x] <văn bản>' },
        { command: 'voices', description: 'Danh sách giọng hay dùng' },
        { command: 'help', description: 'Hướng dẫn dùng bot' },
      ],
    }).then((r) => {
      if (r && !r.ok) warn('setMyCommands failed:', r.description);
    });

    // Drop queued updates so a restart doesn't replay stale prompts.
    const stale = await this.api('getUpdates', { offset: -1, timeout: 0 }, signal);
    if (stale?.ok && stale.result?.length) {
      this.offset = stale.result[stale.result.length - 1].update_id + 1;
    }

    while (!signal.aborted) {
      const res = await this.api('getUpdates', { offset: this.offset, timeout: POLL_TIMEOUT_S }, signal);
      if (signal.aborted) return;
      if (res === null) {
        this.error = 'Mất kết nối tới Telegram — đang thử lại…';
        await sleep(ERR_BACKOFF_MS);
        continue;
      }
      if (!res.ok) {
        if (res.error_code === 409) {
          this.error = 'Có tiến trình khác đang poll token này (conflict) — đang chờ giành lại…';
          await sleep(CONFLICT_BACKOFF_MS);
        } else if (res.error_code === 401) {
          this.error = 'Token không hợp lệ hoặc đã bị thu hồi.';
          return;
        } else {
          this.error = res.description || `Telegram error ${res.error_code}`;
          await sleep(ERR_BACKOFF_MS);
        }
        continue;
      }
      this.error = null;
      for (const update of res.result ?? []) {
        this.offset = Math.max(this.offset, update.update_id + 1);
        void this.handle(update).catch((err) => warn('handle failed:', err?.message ?? err));
      }
    }
  }

  private async handle(update: any) {
    const msg = update.message ?? update.edited_message;
    const text: string = (msg?.text ?? msg?.caption ?? '').trim();
    const chatId: number | undefined = msg?.chat?.id;
    if (chatId === undefined) return;

    const m = text.match(/^\/(vid|video|v|img|image|i|voices|voice|tts|start|help|commands)(@\w+)?\b/i);
    const mention = this.username ? new RegExp(`@${this.username}\\b`, 'i') : null;
    const mentioned = mention ? mention.test(text) : false;
    const replyToBot = !!this.username && msg?.reply_to_message?.from?.username === this.username;
    const isPrivate = msg?.chat?.type === 'private';
    // In groups stay quiet unless addressed — a bare prompt stream would
    // otherwise turn every chat line into a paid generation.
    if (!isPrivate && !m && !mentioned && !replyToBot) return;
    if (!text) {
      if (isPrivate && (msg?.photo || msg?.document)) {
        await this.reply(chatId, 'Nhận được ảnh — gửi lại kèm caption (vd: "/vid 15s làm video từ ảnh này") để dùng làm ảnh tham chiếu.');
      }
      return;
    }

    const s = settingsService.get();
    const allowed = new Set(
      s.telegramAllowedChats.split(',').map((x) => x.trim()).filter(Boolean),
    );
    if (allowed.size && !allowed.has(String(chatId))) {
      await this.reply(chatId, `Chat này chưa được phép dùng bot.\nChat ID của bạn: ${chatId}\nThêm ID này vào "Chats được phép" trong dashboard Muse Gateway để mở.`);
      return;
    }

    if (m && ['start', 'help', 'commands'].includes(m[1].toLowerCase())) {
      await this.reply(
        chatId,
        [
          `Muse bot @${this.username ?? ''} — tạo ảnh/video qua gateway.`,
          '',
          `/vid <prompt> — tạo video`,
          `/vid 16:9 15s <prompt> — video tỉ lệ + thời lượng`,
          `/img <prompt> — tạo ảnh`,
          `/img 3 4:3 <prompt> — 3 ảnh tỉ lệ 4:3`,
          `Tỉ lệ: ${RATIOS.join(', ')} (hoặc gõ "dọc"/"ngang"/"vuông"). Thời lượng ≤ ${MAX_DURATION}s, tối đa ${MAX_COUNT} ảnh/lần.`,
          `Gửi kèm 1 ảnh = ảnh tham chiếu. Prompt trần cũng hiểu: "tạo ảnh mèo" → ảnh, "quay mèo" → video.`,
          '',
          `/voice <văn bản> — đọc thành file mp3 (tiếng Việt tự chọn giọng Việt)`,
          `/voice [nam] [1.2x] <văn bản> — giọng nam, nhanh 1.2 lần`,
          `/voice [Kindhearted Jetty] <văn bản> — chọn giọng theo tên`,
          `Trả lời (reply) một tin nhắn bằng /voice để đọc tin đó. Tối đa ${MAX_SPEECH_TASK_CHARS.toLocaleString('en-US')} ký tự. /voices xem danh sách giọng.`,
          '',
          `Chat ID: ${chatId}`,
        ].join('\n'),
      );
      return;
    }

    if (m && m[1].toLowerCase() === 'voices') {
      const line = (v: (typeof COMMON_VOICES)[number]) => `• ${v.name} — ${v.gender === 'F' ? 'nữ' : 'nam'}, ${v.character}`;
      await this.reply(
        chatId,
        [
          'Giọng tiếng Việt:',
          ...COMMON_VOICES.filter((v) => v.accent === 'Vietnamese').map(line),
          '',
          'Giọng tiếng Anh:',
          ...COMMON_VOICES.filter((v) => v.accent !== 'Vietnamese').map((v) => `${line(v)} (${v.accent})`),
          '',
          'Muse có 1.219 giọng; gõ đúng tên trong ngoặc vuông: /voice [Glad Kite] Xin chào',
        ].join('\n'),
        msg?.message_id,
      );
      return;
    }

    if (m && ['voice', 'tts'].includes(m[1].toLowerCase())) {
      await this.speak(chatId, text.slice(m[0].length), msg);
      return;
    }

    let kind: 'video' | 'image';
    let body: string;
    if (m && ['img', 'image', 'i'].includes(m[1].toLowerCase())) {
      kind = 'image';
      body = text.slice(m[0].length);
    } else if (m && ['vid', 'video', 'v'].includes(m[1].toLowerCase())) {
      kind = 'video';
      body = text.slice(m[0].length);
    } else if (text.startsWith('/')) {
      await this.reply(chatId, 'Lệnh không biết. /vid cho video, /img cho ảnh, /voice cho giọng nói, /help xem hướng dẫn.');
      return;
    } else {
      // Bare prompt — sniff the intent word so "tạo ảnh mèo" really makes
      // an image instead of the video default.
      let work = text;
      if (mention) work = work.replace(mention, ' ');
      if (VID_INTENT.test(work)) {
        kind = 'video';
        body = work.replace(VID_INTENT, '');
      } else if (IMG_INTENT.test(work)) {
        kind = 'image';
        body = work.replace(IMG_INTENT, '');
      } else {
        kind = 'video';
        body = work;
      }
    }

    const replyTo: number | undefined = msg?.message_id;
    const req = parseRequest(body, { ratio: s.telegramRatio, durationSec: s.telegramDurationSec }, kind);
    if (!req) {
      await this.reply(chatId, `Thiếu prompt. Ví dụ: /${kind === 'image' ? 'img' : 'vid'} mèo chơi piano trên nóc nhà`, replyTo);
      return;
    }
    if (req.error) {
      await this.reply(chatId, req.error, replyTo);
      return;
    }

    // A photo or image document attached to the message is a reference for
    // the generation (image-to-video / img2img).
    let images: string[] = [];
    const ref = await this.fetchPhoto(msg);
    if (ref === 'too-big') {
      await this.reply(chatId, 'Ảnh đính kèm quá lớn (>20MB) — gửi ảnh nhỏ hơn hoặc bỏ ảnh.', replyTo);
      return;
    }
    if (ref) images = [ref];

    await this.generate(chatId, kind, req, images, replyTo);
  }

  /** Largest photo (or an image/* document) on the message as a data: URL. */
  private async fetchPhoto(msg: any): Promise<string | 'too-big' | null> {
    const photo = Array.isArray(msg?.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
    const doc = msg?.document?.mime_type?.startsWith('image/') ? msg.document : null;
    const fileId: string | undefined = photo?.file_id ?? doc?.file_id;
    if (!fileId) return null;
    const gf = await this.api('getFile', { file_id: fileId });
    const fp: string | undefined = gf?.result?.file_path;
    if (!fp) return null; // getFile failed — proceed without the reference
    const size: number = gf?.result?.file_size ?? 0;
    if (size > MAX_PHOTO_BYTES) return 'too-big';
    try {
      const res = await fetch(`${API_BASE}/file/bot${this.token}/${fp}`);
      if (!res.ok) return null;
      const mime: string = doc?.mime_type ?? 'image/jpeg';
      return `data:${mime};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    } catch {
      return null;
    }
  }

  /** /voice: read the text (or the replied-to message) aloud as an mp3. */
  private async speak(chatId: number, body: string, msg: any) {
    const replyTo: number | undefined = msg?.message_id;
    const command = parseVoiceCommand(body);
    if (command.ok === false) {
      await this.reply(chatId, command.message, replyTo);
      return;
    }
    const quoted: string = (msg?.reply_to_message?.text ?? msg?.reply_to_message?.caption ?? '').trim();
    const text = command.text || quoted;
    if (!text) {
      await this.reply(chatId, 'Thiếu văn bản. Ví dụ: /voice Xin chào các bạn — hoặc trả lời một tin nhắn bằng /voice để đọc tin đó.', replyTo);
      return;
    }
    const tooLong = speechTextError(text, 'văn bản', MAX_SPEECH_TASK_CHARS);
    if (tooLong) {
      await this.reply(chatId, `Văn bản dài ${text.length.toLocaleString('en-US')} ký tự — tối đa ${MAX_SPEECH_TASK_CHARS.toLocaleString('en-US')}. Chia nhỏ rồi gửi từng phần.`, replyTo);
      return;
    }
    await this.generate(
      chatId,
      'audio',
      { prompt: text, ratio: null, durationSec: null, count: 1, voice: command.voice, speed: command.speed },
      [],
      replyTo,
    );
  }

  private async generate(
    chatId: number,
    kind: 'video' | 'image' | 'audio',
    req: { prompt: string; ratio: string | null; durationSec: number | null; count: number; voice?: string | null; speed?: number | null },
    images: string[] = [],
    replyTo?: number,
  ) {
    if (this.inflight.has(chatId)) {
      await this.reply(chatId, 'Bạn đang có một task chạy — đợi xong rồi gửi tiếp nhé.', replyTo);
      return;
    }
    this.inflight.add(chatId);
    try {
      // Same gate as /v1/tasks: an unlicensed gateway must not serve
      // generation through any surface.
      if (licenseGate({})) {
        await this.reply(chatId, 'Gateway chưa kích hoạt license — nhập license key ở tab Bản quyền trên dashboard trước.', replyTo);
        return;
      }
      const parsed = parseTaskInput({
        model: kind === 'image' ? 'muse-image' : kind === 'audio' ? 'muse-voice' : 'muse-video',
        prompt: req.prompt,
        ratio: req.ratio ?? undefined,
        duration: kind === 'video' ? req.durationSec ?? undefined : undefined,
        count: kind === 'image' ? req.count : 1,
        voice: req.voice ?? undefined,
        speed: req.speed ?? undefined,
      });
      if (parsed.ok === false) {
        await this.reply(chatId, parsed.message, replyTo);
        return;
      }

      const task = taskService.create(parsed.input, images, {
        owner: OWNER,
        origin: '',
        ua: 'telegram-bot',
        allowPrivate: false,
        source: 'bot',
      });
      log(`task ${task.id} (${kind}) cho chat ${chatId}: ${req.prompt.slice(0, 80)}`);
      const voice = kind === 'audio' ? speechOf(task.prompt)?.voice : null;
      const what =
        kind === 'image'
          ? `${req.count > 1 ? `${req.count} ` : ''}ảnh${req.ratio ? ` ${req.ratio}` : ''}`
          : kind === 'audio'
            ? `giọng nói${voice ? ` (${voice})` : ''}`
            : `video${req.durationSec ? ` ${req.durationSec}s` : ''}${req.ratio ? ` ${req.ratio}` : ''}`;
      const wait = kind === 'audio' ? 'thường dưới 1 phút' : 'có thể mất vài phút';
      await this.reply(chatId, `Đang tạo ${what}${images.length ? ' kèm ảnh gốc' : ''} — ${task.id}, ${wait}…`, replyTo);

      const action = kind === 'image' ? 'upload_photo' : kind === 'audio' ? 'record_voice' : 'upload_video';
      const deadline = Date.now() + TASK_TIMEOUT_MS;
      let record = task;
      while (record.status === 'queued' || record.status === 'running') {
        if (Date.now() > deadline) {
          await this.reply(chatId, `Task ${task.id} quá giờ — kiểm tra trên dashboard (tab Media).`, replyTo);
          return;
        }
        // Chat action expires ~5s; refresh each poll so the user sees it working.
        void this.api('sendChatAction', { chat_id: chatId, action }).catch(() => {});
        await sleep(TASK_POLL_MS);
        record = taskService.find(task.id, 'open') ?? record;
      }

      if (record.status !== 'succeeded') {
        warn(`task ${task.id} ${record.status}: ${record.error}`);
        await this.reply(chatId, `Tạo thất bại: ${record.error || record.status}`, replyTo);
        return;
      }
      await this.sendResult(chatId, record, replyTo);
    } finally {
      this.inflight.delete(chatId);
    }
  }

  private async sendResult(
    chatId: number,
    task: { media: { url: string; kind: string; duration_sec?: number | null }[]; threadUrl: string | null; prompt: string },
    replyTo?: number,
  ) {
    // Speech: caption with what was read, not the instructions sent to Muse.
    const speech = speechOf(task.prompt);
    if (!task.media.length) {
      await this.reply(chatId, `Xong nhưng không có media. Thread: ${task.threadUrl ?? '(không có)'}`, replyTo);
      return;
    }
    // Several images ride one album instead of N loose messages.
    if (task.media.length > 1 && task.media.every((m) => m.kind === 'image')) {
      if (await this.uploadAlbum(chatId, task.media, task.prompt.slice(0, 900), replyTo)) return;
    }
    let sent = 0;
    for (const media of task.media) {
      const local = localMediaFile(media.url);
      if (local) {
        let size = 0;
        try {
          size = fs.statSync(local.file).size;
        } catch {}
        if (size > 0 && size <= MAX_UPLOAD_BYTES) {
          const ok =
            media.kind === 'audio'
              ? await this.upload(chatId, local.file, 'audio', (speech?.text ?? '').slice(0, 900), replyTo, {
                  title: (speech?.text ?? 'Muse voice').replace(/\s+/g, ' ').slice(0, 60),
                  performer: speech?.voice ?? 'Muse',
                  duration: media.duration_sec ? Math.round(media.duration_sec) : undefined,
                })
              : await this.upload(chatId, local.file, media.kind === 'image' ? 'photo' : 'video', task.prompt.slice(0, 900), replyTo);
          if (ok) {
            markMediaServed(local.name);
            sent++;
            continue;
          }
        }
      }
      // Fallback: remote URL or too-big/missing file → send the link.
      await this.reply(chatId, media.url, replyTo);
      sent++;
    }
    if (sent === 0) await this.reply(chatId, `Xong — xem kết quả ở thread: ${task.threadUrl ?? 'dashboard'}`, replyTo);
  }

  /** sendMediaGroup for an all-local image set; false → caller falls back
   *  to one-by-one sends. */
  private async uploadAlbum(chatId: number, media: { url: string }[], caption: string, replyTo?: number): Promise<boolean> {
    const locals = media.map((m) => localMediaFile(m.url));
    if (locals.some((l) => !l)) return false;
    const files = locals as { file: string; name: string }[];
    for (const f of files) {
      try {
        const size = fs.statSync(f.file).size;
        if (!size || size > MAX_UPLOAD_BYTES) return false;
      } catch {
        return false;
      }
    }
    try {
      const fd = new FormData();
      fd.append('chat_id', String(chatId));
      if (replyTo) fd.append('reply_to_message_id', String(replyTo));
      fd.append(
        'media',
        JSON.stringify(
          files.map((f, i) => ({
            type: 'photo',
            media: `attach://f${i}`,
            ...(i === 0 && caption ? { caption } : {}),
          })),
        ),
      );
      files.forEach((f, i) => fd.append(`f${i}`, new Blob([fs.readFileSync(f.file)]), f.name));
      const res = await fetch(`${API_BASE}/bot${this.token}/sendMediaGroup`, { method: 'POST', body: fd });
      const j: any = await res.json().catch(() => null);
      if (!j?.ok) {
        warn('sendMediaGroup failed:', j?.description ?? res.status);
        return false;
      }
      files.forEach((f) => markMediaServed(f.name));
      return true;
    } catch (err: any) {
      warn('uploadAlbum failed:', err?.message ?? err);
      return false;
    }
  }

  private async upload(
    chatId: number,
    file: string,
    kind: 'photo' | 'video' | 'audio',
    caption: string,
    replyTo?: number,
    audio?: { title: string; performer: string; duration?: number },
  ): Promise<boolean> {
    try {
      const fd = new FormData();
      fd.append('chat_id', String(chatId));
      if (replyTo) fd.append('reply_to_message_id', String(replyTo));
      fd.append(kind, new Blob([fs.readFileSync(file)]), path.basename(file));
      if (caption) fd.append('caption', caption);
      if (audio) {
        fd.append('title', audio.title);
        fd.append('performer', audio.performer);
        if (audio.duration) fd.append('duration', String(audio.duration));
      }
      const method = kind === 'photo' ? 'sendPhoto' : kind === 'audio' ? 'sendAudio' : 'sendVideo';
      const res = await fetch(`${API_BASE}/bot${this.token}/${method}`, {
        method: 'POST',
        body: fd,
      });
      const j: any = await res.json().catch(() => null);
      if (!j?.ok) {
        warn(`send${kind} failed:`, j?.description ?? res.status);
        return false;
      }
      return true;
    } catch (err: any) {
      warn('upload failed:', err?.message ?? err);
      return false;
    }
  }

  private async reply(chatId: number, text: string, replyTo?: number) {
    const res = await this.api('sendMessage', {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(replyTo ? { reply_to_message_id: replyTo } : {}),
    });
    if (res && !res.ok) warn(`sendMessage failed:`, res.description);
  }
}

const g = globalThis as unknown as { telegramBot?: TelegramBotService };
export const telegramBot = g.telegramBot ?? new TelegramBotService();
g.telegramBot = telegramBot;
