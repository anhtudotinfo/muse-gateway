// What a request is for. The model name is the contract: muse-chat answers in
// text, muse-image returns images, muse-video returns a video, muse-voice
// reads text aloud and returns an mp3. A combo carries
// its own kind, so its name can be anything. Nothing here reads the prompt to
// guess — the kind is decided by the model alone.

import { buildSpeechPrompt } from './speech';

export type ModelKind = 'chat' | 'image' | 'video' | 'audio';

export const MODEL_KINDS: readonly ModelKind[] = ['chat', 'image', 'video', 'audio'];

export function isModelKind(value: unknown): value is ModelKind {
  return typeof value === 'string' && (MODEL_KINDS as readonly string[]).includes(value);
}

/** Kind of a built-in model name. Unknown names (and the gpt-4o / claude
 *  aliases kept for client compatibility) are chat. */
export function baseKind(model: string | null | undefined): ModelKind {
  const m = String(model || '').toLowerCase();
  if (m.startsWith('muse-video')) return 'video';
  if (m.startsWith('muse-image')) return 'image';
  if (m.startsWith('muse-voice') || m.startsWith('muse-tts') || m === 'tts-1' || m === 'tts-1-hd' || m.startsWith('gpt-4o-mini-tts')) {
    return 'audio';
  }
  return 'chat';
}

// Muse decides what to make from the message text, so an image or video
// request has to say so. Word-ish boundaries that also work for Vietnamese.
const word = (alts: string) => new RegExp(`(^|[^\\p{L}])(${alts})(?=$|[^\\p{L}])`, 'iu');
const IMAGE_WORDS = word('ảnh|hình|hình ảnh|image|images|photo|picture|poster|illustration|artwork|logo|thumbnail|banner|sticker|wallpaper');
const VIDEO_WORDS = word('video|clip|phim|animation|footage|reel|reels');
const VOICE_WORDS = word('giọng|giọng nói|giọng đọc|đọc|voice|speech|tts|text-to-speech|narrate|narration|audio|mp3');

/** Make sure an image/video request asks Muse for that output — a bare
 *  "a cat on the grass" sent as muse-image would otherwise come back as a
 *  text reply. Prompts that already name the output are left untouched. */
export function withMediaIntent(prompt: string, kind: ModelKind): string {
  if (kind === 'image' && !IMAGE_WORDS.test(prompt)) return `Tạo ảnh: ${prompt}`;
  if (kind === 'video' && !VIDEO_WORDS.test(prompt)) return `Tạo video: ${prompt}`;
  // A chat message sent to muse-voice is the text to read, unless it already
  // asks for a voice in its own words ("đọc bằng giọng Hubert: …").
  if (kind === 'audio' && !VOICE_WORDS.test(prompt)) return buildSpeechPrompt(prompt);
  return prompt;
}

const RATIOS: [string, number][] = [
  ['1:1', 1],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
];

/** OpenAI image `size` ("1024x1792") → the nearest aspect ratio Muse
 *  understands ("9:16"). Null for "auto" or anything unparseable. */
export function ratioFromSize(size: unknown): string | null {
  const m = /^(\d{2,5})x(\d{2,5})$/.exec(String(size || '').trim());
  if (!m) return null;
  const r = Number(m[1]) / Number(m[2]);
  let best = RATIOS[0];
  for (const candidate of RATIOS) {
    if (Math.abs(Math.log(candidate[1] / r)) < Math.abs(Math.log(best[1] / r))) best = candidate;
  }
  return best[0];
}
