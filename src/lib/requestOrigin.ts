// Build the externally-dialable origin for absolute links (media
// attachments, etc.). Three cases:
//
//   - via tunnel/proxy: X-Forwarded-Host/-Proto carry the PUBLIC URL the
//     client used (e.g. https://u-x.storetiki.online) — use them verbatim.
//   - local: Host header is the loopback address — keep it, always http.
//   - wildcard leak: Host fell back to the server's bind address
//     ([::], 0.0.0.0) when the client/proxy dialed it literally — those
//     are not dialable; substitute loopback + the request port.
//
// Without this, a request forwarded with `x-forwarded-proto: https` and
// no real host produced `https://[::]:1412/api/media/x.webp` — TLS to an
// unspecified address, guaranteed broken.
const WILDCARD = /^(\[?::\]?|0\.0\.0\.0)(:\d+)?$/;
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+|]:\d+)?$/i;
const HAS_PORT = /:\d+$|]:\d+$/;

export function publicOrigin(req: Request): string {
  const u = new URL(req.url);
  const port = u.port || '1412';
  const raw = (
    req.headers.get('x-forwarded-host') ||
    req.headers.get('host') ||
    u.host
  ).trim();
  if (!raw || WILDCARD.test(raw)) return `http://localhost:${port}`;
  if (LOOPBACK.test(raw)) return `http://${raw}${HAS_PORT.test(raw) ? '' : `:${port}`}`;
  const proto = req.headers.get('x-forwarded-proto') || u.protocol.replace(':', '') || 'http';
  return `${proto}://${raw}`;
}
