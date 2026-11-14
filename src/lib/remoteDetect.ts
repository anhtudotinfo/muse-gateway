// Shared remote-traffic detection — used by proxy.ts (middleware) and by
// /v1/* routes (which the middleware matcher intentionally skips so they can
// enforce their own API-key gate).
//
// Headers injected by the tunnel infra itself — a client passing through
// Cloudflare/Tailscale cannot suppress them, so they reliably mark traffic
// as remote even when the client spoofs `Host: localhost`. Generic
// X-Forwarded-*/Via headers are NOT trusted alone: local system proxies
// (WinINET, dev tools) add them to loopback requests too, which would lock
// out the user's own browser.
export const TUNNEL_HEADERS = [
  'cf-ray',
  'cf-connecting-ip',
  'cf-visitor',
  'cf-ipcountry',
  'cdn-loop',
  'tailscale-user-login',
  'tailscale-headers-info',
];

export function isLoopbackHost(host: string | null): boolean {
  const h = (host || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .split(':')[0];
  // '0.0.0.0'/'::' = the server's bind address leaking through, not a real
  // client host (standalone server.js defaults HOSTNAME=0.0.0.0) — count as
  // local so they don't falsely mark every request remote.
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h === '::' || h === '';
}

export function isRemoteHeaders(headers: Headers): boolean {
  for (const h of TUNNEL_HEADERS) if (headers.has(h)) return true;
  // A proxy records the host it was actually asked for — spoofing
  // `Host: localhost` through a tunnel still leaves the public hostname here.
  const xfh = headers.get('x-forwarded-host');
  if (xfh && !isLoopbackHost(xfh)) return true;
  // Direct access via LAN IP / any non-loopback hostname.
  return !isLoopbackHost(headers.get('host'));
}

/** A browser Origin that is really this machine: localhost (incl. Tauri's
 *  tauri://localhost and *.localhost) or a loopback IP. "null" (sandboxed
 *  iframes, file pages) and anything unparseable are NOT local — a web page
 *  can produce those, so they must not unlock keyless access. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}
