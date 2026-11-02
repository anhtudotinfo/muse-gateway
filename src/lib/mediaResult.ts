// Which clip in a Muse reply is the deliverable. Muse builds long videos from
// ~10s segments and shows each one as it lands, so "a video exists" does not
// mean the job is done — only its length can tell a segment from the result.

export type MediaKind = 'video' | 'image' | 'audio' | 'file';

/** A media element found in a Muse reply — may be a blob: URL (page-local). */
export interface MediaItem {
  src: string;
  name?: string;
  kind?: MediaKind;
  /** Length read from the <video> element; absent until it has loaded. */
  durationSec?: number;
}

/** Structured media entry returned to API clients. */
export interface MediaInfo {
  url: string;
  kind: MediaKind;
  duration_sec: number | null;
}

/** One Muse render covers about this much; longer means stitched segments. */
const SEGMENT_SEC = 10;
/** Below this share of the requested length, a clip is one segment. */
const MIN_LENGTH_RATIO = 0.8;
const MAX_REQUESTED_SEC = 600;

/**
 * Length a video job asked for. An explicit value wins; otherwise it is read
 * from the prompt, preferring a number that follows the word "video" so a
 * phrase like "giữ 3 giây" later in the script can't be mistaken for it.
 * Null means "no long video expected", which keeps the normal wait.
 */
export function requestedVideoSeconds(prompt: string, explicit?: number | null): number | null {
  const unit = '(giây|gi[aâ]y|s(?![\\p{L}])|secs?|seconds?|phút|ph[uú]t|mins?|minutes?)';
  const match =
    prompt.match(new RegExp(`video\\D{0,24}?(\\d{1,3})\\s*${unit}`, 'iu')) ??
    prompt.match(new RegExp(`(\\d{1,3})\\s*${unit}`, 'iu'));
  const parsed = match ? Number(match[1]) * (/^(ph|min)/i.test(match[2]) ? 60 : 1) : null;
  const seconds = explicit && explicit > 0 ? explicit : parsed;
  if (!seconds || seconds <= SEGMENT_SEC) return null;
  return Math.min(seconds, MAX_REQUESTED_SEC);
}

export function longestVideoSeconds(items: MediaItem[]): number {
  return items.reduce(
    (longest, item) => (item.kind === 'video' ? Math.max(longest, item.durationSec ?? 0) : longest),
    0,
  );
}

/** An unknown length isn't short — the driver stays busy until it loads. */
export function isShortVideo(seconds: number, requested: number | null): boolean {
  return !!requested && seconds > 0 && seconds < requested * MIN_LENGTH_RATIO;
}

/**
 * The deliverable(s): on a long video job, only the longest clip — the other
 * entries are the segments it was stitched from. Everything else (images,
 * several takes of a short clip) is returned as Muse gave it.
 */
export function selectFinalMedia(items: MediaItem[], requested: number | null): MediaItem[] {
  if (!requested) return items;
  const videos = items.filter((item) => item.kind === 'video' && item.durationSec);
  if (videos.length === 0) return items;
  const longest = videos.reduce((best, item) =>
    (item.durationSec as number) >= (best.durationSec as number) ? item : best,
  );
  return [longest];
}

const KIND_BY_EXTENSION: [RegExp, MediaKind][] = [
  [/\.(mp4|webm|mov|mkv|m3u8)(\?|#|$)/i, 'video'],
  [/\.(png|jpe?g|webp|gif)(\?|#|$)/i, 'image'],
  [/\.(mp3|wav)(\?|#|$)/i, 'audio'],
];

export function mediaKindOf(url: string, known?: MediaKind): MediaKind {
  if (known) return known;
  return KIND_BY_EXTENSION.find(([pattern]) => pattern.test(url))?.[1] ?? 'file';
}

/** Local /api/media/* paths resolve against the origin the client dialed. */
export function withOrigin(url: string, origin: string): string {
  return url.startsWith('http') ? url : origin + url;
}
