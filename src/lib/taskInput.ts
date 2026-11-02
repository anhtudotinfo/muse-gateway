import crypto from 'node:crypto';

// Request contract of POST /v1/tasks. Kept free of the Muse pool so it can
// be exercised without a browser.

const MAX_PROMPT_CHARS = 20_000;
const MAX_IMAGES = 16;
const MAX_DURATION_SEC = 60;
/** Muse's single-render length — longer asks must spell out the stitching. */
const SEGMENT_SEC = 10;
const RATIOS = new Set(['9:16', '16:9', '1:1', '4:3', '3:4']);

export interface TaskInput {
  model: string;
  prompt: string;
  images: string[];
  durationSec: number | null;
  ratio: string | null;
  newChat: boolean;
  thread: string | null;
  account: string | null;
  idempotencyKey: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
}

export type TaskInputResult = { ok: true; input: TaskInput } | { ok: false; message: string };

const optionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function parseTaskInput(body: any): TaskInputResult {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Body must be a JSON object.' };
  const prompt = optionalString(body.prompt);
  if (!prompt) return { ok: false, message: '`prompt` is required.' };
  if (prompt.length > MAX_PROMPT_CHARS) {
    return { ok: false, message: `\`prompt\` is limited to ${MAX_PROMPT_CHARS} characters.` };
  }
  const images = body.images ?? [];
  if (!Array.isArray(images) || images.some((image) => typeof image !== 'string' || !image)) {
    return { ok: false, message: '`images` must be an array of URLs or data: URLs.' };
  }
  if (images.length > MAX_IMAGES) {
    return { ok: false, message: `\`images\` is limited to ${MAX_IMAGES} items.` };
  }
  const duration = body.duration ?? body.duration_sec ?? null;
  if (
    duration !== null &&
    (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SEC)
  ) {
    return { ok: false, message: `\`duration\` must be a number of seconds from 1 to ${MAX_DURATION_SEC}.` };
  }
  const ratio = optionalString(body.ratio);
  if (ratio && !RATIOS.has(ratio)) {
    return { ok: false, message: `\`ratio\` must be one of ${[...RATIOS].join(', ')}.` };
  }
  return {
    ok: true,
    input: {
      model: optionalString(body.model) ?? 'muse-video',
      prompt,
      images,
      durationSec: duration === null ? null : Math.round(duration),
      ratio,
      newChat: body.new_chat !== false,
      thread: optionalString(body.thread),
      account: optionalString(body.account),
      idempotencyKey: optionalString(body.idempotency_key),
      webhookUrl: optionalString(body.webhook_url),
      webhookSecret: optionalString(body.webhook_secret),
    },
  };
}

/** Muse has no API fields for length or shape — they travel in the text. */
export function buildTaskPrompt({ model, prompt, durationSec, ratio }: TaskInput): string {
  const shape = ratio ? ` tỷ lệ khung hình ${ratio}` : '';
  if (/^muse-image/i.test(model)) {
    return ratio ? `Tạo ảnh${shape}: ${prompt}` : prompt;
  }
  if (!/^muse-video/i.test(model) || (!durationSec && !ratio)) return prompt;
  const length = durationSec ? ` ${durationSec} giây` : '';
  const stitch =
    durationSec && durationSec > SEGMENT_SEC
      ? ` Video gồm các đoạn ~10 giây tạo nối tiếp liền mạch, ghép lại thành MỘT video duy nhất dài đủ ${durationSec} giây — không được trả về chỉ 10 giây.`
      : '';
  return `Tạo video${length}${shape}: ${prompt}${stitch}`;
}

/** Value of X-Muse-Signature: HMAC-SHA256 of the raw request body. */
export function signWebhook(body: string, secret: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}
