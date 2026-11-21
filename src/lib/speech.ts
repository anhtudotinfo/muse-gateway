// Text-to-speech through Muse's voice tool. Muse has no API for it: the
// gateway asks in plain text, naming the voice, language and speed the tool
// takes (--voice, --language, --speed 1–200 with 100 = normal), and the reply
// arrives as an audio card. Kept free of the browser so it can be tested.

/** Longest text /v1/audio/speech reads (OpenAI's cap; the request is held open). */
export const MAX_SPEECH_CHARS = 4096;

/** Longest text a speech task reads. Muse splits long text into ~1,200-char
 *  pieces itself and still returns one mp3 (tested: 6,316 chars → one 320 s file
 *  in under 3 minutes). 6,000 keeps a margin under what was tested. */
export const MAX_SPEECH_TASK_CHARS = 6000;

/** Muse's own default voice. */
export const DEFAULT_VOICE = 'Helio';

/** Default voice for Vietnamese text: female, mid-range, measured. Muse's
 *  catalogue has seven Vietnamese-accented voices; see npm/README.md. */
export const VIETNAMESE_VOICE = 'Glad Kite';

/** Male counterpart, for OpenAI's male voice names on Vietnamese text. */
const VIETNAMESE_MALE_VOICE = 'Kindhearted Jetty';

// OpenAI clients send their own voice names; Muse has none of them, so they
// map by register onto Muse's suggested American voices (Aria, Helio), or
// onto a Vietnamese voice of the same register when the text is Vietnamese.
const OPENAI_FEMALE = new Set(['alloy', 'coral', 'nova', 'sage', 'shimmer']);
const OPENAI_MALE = new Set(['ash', 'ballad', 'echo', 'fable', 'onyx', 'verse']);

const VIETNAMESE_LETTERS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

export interface SpeechOptions {
  /** Muse voice name ("Glad Kite"), or an OpenAI voice name mapped to one. */
  voice?: string | null;
  /** Locale such as "vi" or "en". Unset: "vi" for Vietnamese text, else Muse's default. */
  language?: string | null;
  /** OpenAI-style speed multiplier, 0.25–4 (1 = normal). */
  speed?: number | null;
}

/** Muse voice for a requested name: OpenAI names are mapped, anything else
 *  is passed through as a Muse voice; unset picks by language. */
export function museVoice(voice: string | null | undefined, language: string | null): string {
  const name = String(voice || '').trim();
  const vi = language === 'vi' || language?.startsWith('vi_') || language?.startsWith('vi-');
  const key = name.toLowerCase();
  if (OPENAI_FEMALE.has(key)) return vi ? VIETNAMESE_VOICE : 'Aria';
  if (OPENAI_MALE.has(key)) return vi ? VIETNAMESE_MALE_VOICE : 'Helio';
  if (name) return name;
  return vi ? VIETNAMESE_VOICE : DEFAULT_VOICE;
}

/** "vi" when the text is written in Vietnamese. */
export function detectLanguage(text: string): string | null {
  return VIETNAMESE_LETTERS.test(text) ? 'vi' : null;
}

/** OpenAI speed multiplier (1 = normal) → Muse's 1–200 scale (100 = normal). */
export function museSpeed(speed: number | null | undefined): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) return 100;
  return Math.min(200, Math.max(1, Math.round(speed * 100)));
}

/** The message that makes Muse read `text` aloud and post one mp3. */
export function buildSpeechPrompt(text: string, options: SpeechOptions = {}): string {
  const language = options.language?.trim() || detectLanguage(text);
  const settings = [
    `voice: ${museVoice(options.voice, language)}`,
    language ? `language: ${language}` : null,
    `speed: ${museSpeed(options.speed)}`,
    'format: mp3',
  ].filter(Boolean);
  return (
    `Dùng công cụ giọng nói (text-to-speech) đọc NGUYÊN VĂN đoạn văn bản giữa hai dấu """ thành MỘT file audio mp3, rồi gửi file đó vào chat. ` +
    `Thiết lập: ${settings.join(', ')}. ` +
    'Không thêm, bớt hay sửa chữ nào, không hỏi lại.\n\n' +
    `"""\n${text}\n"""`
  );
}

export type SpeechOptionsResult =
  | { ok: true; voice: string | null; language: string | null; speed: number | null }
  | { ok: false; message: string };

/** Why `text` can't be read aloud in one request, or null when it can. */
export function speechTextError(text: string, field = 'input', max = MAX_SPEECH_CHARS): string | null {
  if (!text.trim()) return `\`${field}\` is required.`;
  if (text.length > max) return `\`${field}\` is limited to ${max.toLocaleString('en-US')} characters for voice models.`;
  return null;
}

/** Validate the voice settings shared by /v1/audio/speech, /v1/tasks and MCP. */
export function parseSpeechOptions(body: Record<string, unknown>): SpeechOptionsResult {
  const voice = typeof body.voice === 'string' && body.voice.trim() ? body.voice.trim().slice(0, 80) : null;
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : null;
  if (language && !/^[a-z]{2}([_-][A-Za-z]{2})?$/.test(language)) {
    return { ok: false, message: '`language` must be a locale such as "vi", "en" or "pt_BR".' };
  }
  const speed = body.speed ?? null;
  if (speed !== null && (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.25 || speed > 4)) {
    return { ok: false, message: '`speed` must be a number from 0.25 to 4 (1 = normal).' };
  }
  return { ok: true, voice, language, speed: speed as number | null };
}

/** Voices worth knowing, from Muse's catalogue (exact names). Listed by the
 *  Telegram bot's /voices; npm/README.md has the same table. */
export const COMMON_VOICES: { name: string; gender: 'F' | 'M'; accent: string; character: string }[] = [
  { name: 'Glad Kite', gender: 'F', accent: 'Vietnamese', character: 'mid-range, measured' },
  { name: 'Breathless Rosette', gender: 'F', accent: 'Vietnamese', character: 'very high, light' },
  { name: 'Sparkling Whistle', gender: 'F', accent: 'Vietnamese', character: 'high, delighted' },
  { name: 'Kindhearted Jetty', gender: 'M', accent: 'Vietnamese', character: 'high, confident' },
  { name: 'Questioning Satchel', gender: 'M', accent: 'Vietnamese', character: 'mid-range, curious' },
  { name: 'Tenacious Mooring', gender: 'M', accent: 'Vietnamese', character: 'high, resolute' },
  { name: 'Zealous Harbor', gender: 'M', accent: 'Vietnamese', character: 'high, booming' },
  { name: 'Aria', gender: 'F', accent: 'American', character: 'friendly, warm' },
  { name: 'Dynamic Sparkler', gender: 'F', accent: 'American', character: 'confident, dynamic' },
  { name: 'Mellow Saxophone', gender: 'F', accent: 'American', character: 'smooth, friendly' },
  { name: 'Soothing Ribbon', gender: 'F', accent: 'British', character: 'soothing, polished' },
  { name: 'Helio', gender: 'M', accent: 'American', character: 'gentle, friendly' },
  { name: 'Warm Pebble', gender: 'M', accent: 'American', character: 'warm, professional' },
  { name: 'Bold Flag', gender: 'M', accent: 'American', character: 'heroic, bold' },
  { name: 'Boomy Mountain', gender: 'M', accent: 'British', character: 'deep, regal' },
];

export type VoiceCommand = { ok: true; text: string; voice: string | null; speed: number | null } | { ok: false; message: string };

/** The text after a chat command such as Telegram's /voice. Options go in
 *  square brackets before the text, so a sentence that happens to start
 *  with "Nam" or "2x" is never mistaken for one:
 *    [nam] / [nữ]        male / female voice, Vietnamese or English by the text
 *    [1.2x]              speed
 *    [Kindhearted Jetty] any Muse voice by name */
export function parseVoiceCommand(input: string): VoiceCommand {
  let rest = input.trim();
  let voice: string | null = null;
  let gender: 'F' | 'M' | null = null;
  let speed: number | null = null;
  for (let m = /^\[([^\]\n]{1,80})\]\s*/.exec(rest); m; m = /^\[([^\]\n]{1,80})\]\s*/.exec(rest)) {
    const option = m[1].trim();
    const rate = /^(\d+(?:[.,]\d+)?)\s*x$/i.exec(option);
    if (rate) {
      speed = Number(rate[1].replace(',', '.'));
      if (!(speed >= 0.25 && speed <= 4)) return { ok: false, message: 'Tốc độ từ 0.25x đến 4x, ví dụ [1.2x].' };
    } else if (/^(nam|male|m)$/i.test(option)) {
      gender = 'M';
    } else if (/^(nữ|nu|female|f)$/i.test(option)) {
      gender = 'F';
    } else {
      voice = option;
    }
    rest = rest.slice(m[0].length);
  }
  if (!voice && gender) {
    const vi = detectLanguage(rest) === 'vi';
    voice = gender === 'M' ? (vi ? VIETNAMESE_MALE_VOICE : 'Helio') : vi ? VIETNAMESE_VOICE : 'Aria';
  }
  return { ok: true, text: rest, voice, speed };
}

/** What a speech prompt reads aloud and in which voice — the inverse of
 *  buildSpeechPrompt, for showing a task as the user wrote it. */
export function speechOf(prompt: string): { text: string; voice: string | null } | null {
  const m = /"""\n([\s\S]*)\n"""\s*$/.exec(prompt || '');
  if (!m) return null;
  return { text: m[1], voice: /voice: ([^,\n]+)/.exec(prompt)?.[1]?.trim() || null };
}
