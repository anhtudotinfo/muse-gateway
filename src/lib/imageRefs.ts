import dns from 'node:dns/promises';
import net from 'node:net';

// Reference images and webhook targets are URLs chosen by the API caller, and
// a tunnel exposes the gateway to the internet — so nothing here may be
// steered at the host's own network unless the caller is local too.

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 20_000;

export class ImageRefError extends Error {}

/** Image values in an OpenAI-style content array, in order. */
export function collectImageRefs(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const refs: string[] = [];
  for (const part of content) {
    const ref =
      typeof part?.image_url === 'object' ? part.image_url?.url : part?.image_url;
    if (typeof ref === 'string' && ref) refs.push(ref);
  }
  return refs;
}

export function isBlockedAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
}

/** Throws unless `url` is http(s) and, for remote callers, a public host. */
export async function assertDialableUrl(url: string, allowPrivate: boolean): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ImageRefError(`Invalid URL: ${url.slice(0, 120)}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ImageRefError(`Only http(s) URLs are allowed: ${url.slice(0, 120)}`);
  }
  if (allowPrivate) return parsed;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host)
    ? [host]
    : (await dns.lookup(host, { all: true }).catch(() => [])).map((entry) => entry.address);
  if (addresses.length === 0) {
    throw new ImageRefError(`Cannot resolve host: ${host}`);
  }
  if (addresses.some(isBlockedAddress)) {
    throw new ImageRefError(`Private network addresses are not allowed: ${host}`);
  }
  return parsed;
}

async function readCapped(res: Response): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_IMAGE_BYTES) throw new ImageRefError('Image is larger than 20MB.');
  const reader = res.body?.getReader();
  if (!reader) throw new ImageRefError('Image response had no body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ImageRefError('Image is larger than 20MB.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Redirects are followed by hand so each hop gets the same host check. */
async function fetchImage(url: string, allowPrivate: boolean): Promise<string> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertDialableUrl(target, allowPrivate);
    const res = await fetch(target, { redirect: 'manual', signal });
    const next = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && next) {
      target = new URL(next, target).toString();
      continue;
    }
    if (!res.ok) throw new ImageRefError(`Image download failed (HTTP ${res.status}): ${url.slice(0, 120)}`);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!type.startsWith('image/')) {
      throw new ImageRefError(`URL is not an image (${type || 'unknown type'}): ${url.slice(0, 120)}`);
    }
    return `data:${type};base64,${(await readCapped(res)).toString('base64')}`;
  }
  throw new ImageRefError(`Too many redirects: ${url.slice(0, 120)}`);
}

/**
 * Normalizes image refs to the data: URLs the driver attaches. A ref that
 * can't be loaded rejects the request: silently dropping it would run a paid
 * generation without the reference the caller asked for.
 */
export async function loadImageRefs(refs: string[], allowPrivate: boolean): Promise<string[]> {
  return Promise.all(
    refs.map(async (ref) => {
      if (ref.startsWith('data:image/')) return ref;
      if (ref.startsWith('data:')) throw new ImageRefError('Only image data: URLs are allowed.');
      try {
        return await fetchImage(ref, allowPrivate);
      } catch (error) {
        if (error instanceof ImageRefError) throw error;
        throw new ImageRefError(`Could not download image: ${ref.slice(0, 120)}`);
      }
    }),
  );
}
