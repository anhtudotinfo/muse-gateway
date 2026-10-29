// Build the externally-dialable origin for absolute links (media
// attachments, etc.). Three cases:
//
//   - via tunnel/proxy: X-Forwarded-Host/-Proto carry the PUBLIC URL the
//     client used (e.g. https://u-x.storetiki.online) — use them verbatim.
//   - via tunnel with a broken Host: cf-* markers prove the request came
//     through Cloudflare, so fall back to the provisioned publicUrl stored
//     in data/tunnel.json — the only address the remote client can dial.
//   - local: Host header is loopback — keep it, always http.
//
// Wildcard bind hosts ([::], 0.0.0.0) leak in when a client or proxy dials
// the bind address — they are not dialable and previously produced
// `https://[::]:1412/api/media/x.webp` (TLS to an unspecified address).
import { dataPath } from './dataDir';
import { readJsonFile } from './safeJson';

const WILDCARD = /^(\[?::\]?|0\.0\.0\.0)(:\d+)?$/;
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+|]:\d+)?$/i;
const HAS_PORT = /:\d+$|]:\d+$/;
const CF_HEADERS = ['cf-ray', 'cf-visitor', 'cf-connecting-ip', 'cdn-loop'];

function tunnelPublicUrl(): string | null {
  try {
    const t = readJsonFile<any>(dataPath('tunnel.json'), null);
    const u = t?.tunnel?.publicUrl || t?.tunnel?.tunnelUrl || null;
    return typeof u === 'string' && u.startsWith('https://') ? u.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

export function publicOrigin(req: Request): string {
  const u = new URL(req.url);
  const port = u.port || '1412';
  const raw = (
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    u.host
  ).trim();
  if (!raw || WILDCARD.test(raw)) {
    // Bind-addr leak — if the request demonstrably came through our
    // Cloudflare tunnel, the provisioned public hostname is the only
    // correct answer (remote clients can't dial localhost either).
    if (CF_HEADERS.some((h) => req.headers.has(h))) {
      const pub = tunnelPublicUrl();
      if (pub) return pub;
    }
    return `http://localhost:${port}`;
  }
  if (LOOPBACK.test(raw)) return `http://${raw}${HAS_PORT.test(raw) ? '' : `:${port}`}`;
  const proto = req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '') || 'http';
  return `${proto}://${raw}`;
}
