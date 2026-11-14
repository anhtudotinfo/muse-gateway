import fs from 'node:fs';
import path from 'node:path';
import { settingsService } from './settings';
import { taskService } from './tasks';
import { licenseGate } from './licenseGate';
import { MEDIA_DIR, markMediaServed } from './mediaStore';
import { parseTaskInput } from './taskInput';

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
const ERR_BACKOFF_MS = 5_000;
const CONFLICT_BACKOFF_MS = 15_000;
const OWNER = 'telegram';
const RATIOS = ['9:16', '16:9', '1:1', '4:3', '3:4'];

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

/** Split `/vid 16:9 15s a cat` into overrides + prompt. Returns null when
 *  nothing but flags was typed (the prompt is required). */
function parseRequest(text: string, defaults: { ratio: string; durationSec: number }, kind: 'video' | 'image') {
  const tokens = text.trim().split(/\s+/);
  let ratio: string | null = null;
  let durationSec: number | null = null;
  let count: number | null = null;
  const rest: string[] = [];
  for (const token of tokens) {
    if (/^\d{1,2}:\d{1,2}$/.test(token) && !ratio) {
      ratio = token;
    } else if (/^\d{1,3}s$/i.test(token) && kind === 'video' && durationSec === null) {
      durationSec = Number(token.slice(0, -1));
    } else if (/^\d$/.test(token) && kind === 'image' && count === null) {
      count = Number(token);
    } else {
      rest.push(token);
    }
  }
  const prompt = rest.join(' ').trim();
  if (!prompt) return null;
  return {
    prompt,
    ratio: ratio ?? defaults.ratio,
    durationSec: durationSec ?? defaults.durationSec,
    count: count ?? 1,
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
    if (!text || chatId === undefined) return;

    const s = settingsService.get();
    const allowed = new Set(
      s.telegramAllowedChats.split(',').map((x) => x.trim()).filter(Boolean),
    );
    if (allowed.size && !allowed.has(String(chatId))) {
      await this.reply(chatId, `Chat này chưa được phép dùng bot.\nChat ID của bạn: ${chatId}\nThêm ID này vào "Chats được phép" trong dashboard Muse Gateway để mở.`);
      return;
    }

    const m = text.match(/^\/(vid|video|img|image|start|help)(@\w+)?\b/i);
    if (m && ['start', 'help'].includes(m[1].toLowerCase())) {
      await this.reply(
        chatId,
        [
          `Muse bot @${this.username ?? ''} — tạo ảnh/video qua gateway.`,
          '',
          `/vid <prompt> — tạo video`,
          `/img <prompt> — tạo ảnh`,
          `/vid 16:9 15s <prompt> — đổi tỉ lệ / thời lượng`,
          `/img 3 4:3 <prompt> — tạo 3 ảnh`,
          `Gõ prompt trần (không dấu /) — mặc định tạo video`,
          '',
          `Chat ID: ${chatId}`,
        ].join('\n'),
      );
      return;
    }

    let kind: 'video' | 'image';
    let body: string;
    if (m && ['img', 'image'].includes(m[1].toLowerCase())) {
      kind = 'image';
      body = text.slice(m[0].length);
    } else if (m && ['vid', 'video'].includes(m[1].toLowerCase())) {
      kind = 'video';
      body = text.slice(m[0].length);
    } else if (text.startsWith('/')) {
      await this.reply(chatId, 'Lệnh không biết. /vid cho video, /img cho ảnh, /help xem hướng dẫn.');
      return;
    } else {
      kind = 'video';
      body = text;
    }

    const req = parseRequest(body, { ratio: s.telegramRatio, durationSec: s.telegramDurationSec }, kind);
    if (!req) {
      await this.reply(chatId, `Thiếu prompt. Ví dụ: /${kind === 'image' ? 'img' : 'vid'} mèo chơi piano trên nóc nhà`);
      return;
    }
    if (req.ratio && !RATIOS.includes(req.ratio)) {
      await this.reply(chatId, `Tỉ lệ "${req.ratio}" không hỗ trợ — chọn một trong: ${RATIOS.join(', ')}.`);
      return;
    }
    await this.generate(chatId, kind, req);
  }

  private async generate(
    chatId: number,
    kind: 'video' | 'image',
    req: { prompt: string; ratio: string | null; durationSec: number | null; count: number },
  ) {
    if (this.inflight.has(chatId)) {
      await this.reply(chatId, 'Bạn đang có một task chạy — đợi xong rồi gửi tiếp nhé.');
      return;
    }
    this.inflight.add(chatId);
    try {
      // Same gate as /v1/tasks: an unlicensed gateway must not serve
      // generation through any surface.
      if (licenseGate({})) {
        await this.reply(chatId, 'Gateway chưa kích hoạt license — nhập license key ở tab Bản quyền trên dashboard trước.');
        return;
      }
      const parsed = parseTaskInput({
        model: kind === 'image' ? 'muse-image' : 'muse-video',
        prompt: req.prompt,
        ratio: req.ratio ?? undefined,
        duration: kind === 'video' ? req.durationSec ?? undefined : undefined,
        count: kind === 'image' ? req.count : 1,
      });
      if (parsed.ok === false) {
        await this.reply(chatId, parsed.message);
        return;
      }

      const task = taskService.create(parsed.input, [], {
        owner: OWNER,
        origin: '',
        ua: 'telegram-bot',
        allowPrivate: false,
        source: 'bot',
      });
      log(`task ${task.id} (${kind}) cho chat ${chatId}: ${req.prompt.slice(0, 80)}`);
      await this.reply(chatId, `Đã nhận — ${task.id} đang chạy, video có thể mất vài phút…`);
      void this.api('sendChatAction', { chat_id: chatId, action: 'upload_video' }).catch(() => {});

      const deadline = Date.now() + TASK_TIMEOUT_MS;
      let record = task;
      while (record.status === 'queued' || record.status === 'running') {
        if (Date.now() > deadline) {
          await this.reply(chatId, `Task ${task.id} quá giờ — kiểm tra trên dashboard (tab Media).`);
          return;
        }
        await sleep(TASK_POLL_MS);
        record = taskService.find(task.id, 'open') ?? record;
      }

      if (record.status !== 'succeeded') {
        warn(`task ${task.id} ${record.status}: ${record.error}`);
        await this.reply(chatId, `Tạo thất bại: ${record.error || record.status}`);
        return;
      }
      await this.sendResult(chatId, record);
    } finally {
      this.inflight.delete(chatId);
    }
  }

  private async sendResult(chatId: number, task: { media: { url: string; kind: string }[]; threadUrl: string | null; prompt: string }) {
    if (!task.media.length) {
      await this.reply(chatId, `Xong nhưng không có media. Thread: ${task.threadUrl ?? '(không có)'}`);
      return;
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
          const ok = await this.upload(chatId, local.file, media.kind === 'image' ? 'photo' : 'video', task.prompt.slice(0, 900));
          if (ok) {
            markMediaServed(local.name);
            sent++;
            continue;
          }
        }
      }
      // Fallback: remote URL or too-big/missing file → send the link.
      await this.reply(chatId, media.url);
      sent++;
    }
    if (sent === 0) await this.reply(chatId, `Xong — xem kết quả ở thread: ${task.threadUrl ?? 'dashboard'}`);
  }

  private async upload(chatId: number, file: string, kind: 'photo' | 'video', caption: string): Promise<boolean> {
    try {
      const fd = new FormData();
      fd.append('chat_id', String(chatId));
      fd.append(kind, new Blob([fs.readFileSync(file)]), path.basename(file));
      if (caption) fd.append('caption', caption);
      const res = await fetch(`${API_BASE}/bot${this.token}/${kind === 'photo' ? 'sendPhoto' : 'sendVideo'}`, {
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

  private async reply(chatId: number, text: string) {
    const res = await this.api('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
    if (res && !res.ok) warn(`sendMessage failed:`, res.description);
  }
}

const g = globalThis as unknown as { telegramBot?: TelegramBotService };
export const telegramBot = g.telegramBot ?? new TelegramBotService();
g.telegramBot = telegramBot;
