import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

// Remote-access guard.
//
// The tunnel feature (Cloudflare quick tunnel / Tailscale funnel) puts this
// whole server on the public internet. Without a guard, anyone with the
// tunnel URL could open the dashboard and call the management /api/* routes
// (session cookies, license, tunnel control). This proxy treats a request as
// REMOTE when it arrives through a forwarding proxy (cf-ray, x-forwarded-*,
// via, ...) or targets a non-loopback Host, and only lets remote callers
// reach the OpenAI-compatible surface — /v1/* has its own API-key gate.
// Dashboard pages and management /api/* return 403 unless the user opted in
// via "Allow dashboard access via tunnel" (settings.tunnelDashboardAccess).
//
// Runs in the Node.js runtime, so reading the settings file per remote
// request is fine (local requests never touch disk).

// Headers injected by the tunnel infra itself — a client passing through
// Cloudflare/Tailscale cannot suppress them, so they reliably mark traffic
// as remote even when the client spoofs `Host: localhost`. Generic
// X-Forwarded-*/Via headers are NOT trusted alone: local system proxies
// (WinINET, dev tools) add them to loopback requests too, which would lock
// out the user's own browser.
const TUNNEL_HEADERS = [
  'cf-ray',
  'cf-connecting-ip',
  'cf-visitor',
  'cf-ipcountry',
  'cdn-loop',
  'tailscale-user-login',
  'tailscale-headers-info',
];

function isLoopbackHost(host: string | null): boolean {
  const h = (host || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .split(':')[0];
  // '0.0.0.0'/'::' = the server's bind address leaking through, not a real
  // client host (standalone server.js defaults HOSTNAME=0.0.0.0) — count as
  // local so they don't falsely mark every request remote.
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h === '::' || h === '';
}

function isRemote(request: NextRequest): boolean {
  for (const h of TUNNEL_HEADERS) if (request.headers.has(h)) return true;
  // A proxy records the host it was actually asked for — spoofing
  // `Host: localhost` through a tunnel still leaves the public hostname here.
  const xfh = request.headers.get('x-forwarded-host');
  if (xfh && !isLoopbackHost(xfh)) return true;
  // Direct access via LAN IP / any non-loopback hostname. Prefer the real
  // Host header — in standalone mode nextUrl.hostname can be the bind address
  // (0.0.0.0), not the client-requested host. Spoofed Host is still caught by
  // the tunnel-injected headers above.
  const host = request.headers.get('host') || request.nextUrl?.hostname;
  return !isLoopbackHost(host);
}

function remoteDashboardAllowed(): boolean {
  try {
    const dir = process.env.MUSE_DATA_DIR || process.cwd();
    const raw = JSON.parse(
      fs.readFileSync(path.join(dir, 'data', 'settings.json'), 'utf8')
    ) as { tunnelDashboardAccess?: boolean };
    return raw?.tunnelDashboardAccess === true;
  } catch {
    return false;
  }
}

const BLOCKED_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Muse Gateway</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#0b0b10;color:#e6e6f0}
.c{max-width:420px;text-align:center;padding:24px}.t{font-size:20px;font-weight:600;margin-bottom:10px}.d{color:#9a9aad;font-size:14px;line-height:1.6}
code{background:#1d1d28;padding:2px 6px;border-radius:4px}</style></head>
<body><div class="c"><div class="t">🔒 Chỉ truy cập được từ localhost</div>
<div class="d">Dashboard & management API bị chặn khi truy cập qua tunnel/mạng ngoài.<br><br>
Để mở: vào dashboard trên <code>localhost</code> → tab <b>Endpoint</b> → bật <b>Allow dashboard access via tunnel</b>.
API công khai vẫn hoạt động tại <code>/v1/*</code> (yêu cầu API key).</div></div></body></html>`;

export function proxy(request: NextRequest) {
  if (!isRemote(request) || remoteDashboardAllowed()) {
    return NextResponse.next();
  }
  if ((request.headers.get('accept') || '').includes('text/html')) {
    return new NextResponse(BLOCKED_HTML, {
      status: 403,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  return NextResponse.json(
    {
      error: 'remote_blocked',
      message:
        'Dashboard & management API chỉ truy cập được từ localhost. Bật "Allow dashboard access via tunnel" trong tab Endpoint nếu cần truy cập xa.',
    },
    { status: 403 }
  );
}

// Proxy runs only on protected paths — /v1/* (key-gated), /api/health,
// /api/media/* (media delivery to remote clients), _next assets and any
// file-like path stay reachable so tunneled clients still work.
export const config = {
  matcher: ['/((?!v1/|api/health|api/media/|_next/|.*\\.[^/]+$).*)'],
};
