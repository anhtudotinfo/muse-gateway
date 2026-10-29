import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { isLoopbackHost, isRemoteHeaders } from '@/lib/remoteDetect';
import { settingsService } from '@/lib/settings';

// Remote-access guard.
//
// The tunnel feature (Cloudflare quick tunnel / Tailscale funnel) puts this
// whole server on the public internet. Without a guard, anyone with the
// tunnel URL could open the dashboard and call the management /api/* routes
// (session cookies, license, tunnel control). This proxy treats a request as
// REMOTE when it arrives through a forwarding proxy (cf-ray, x-forwarded-*,
// via, ...) or targets a non-loopback Host, and only lets remote callers
// reach the OpenAI-compatible surface — /v1/* has its own API-key gate.
//
// Dashboard pages and management /api/* return 403 for remote traffic unless
// the user opted in via "Allow dashboard access via tunnel"
// (settings.tunnelDashboardAccess). Even then, remote callers must first
// unlock once through the access link <publicUrl>/?dgk=<settings.dashboardToken>
// which sets an HttpOnly cookie — there is no password login, so the token
// IS the credential. Keep it secret like an API key.
//
// A second check guards LOCAL requests against drive-by CSRF: a malicious
// website can fire no-cors POSTs at localhost:1412, but browsers always tag
// those with `sec-fetch-site: cross-site` (and an evil Origin). Mutating
// /api/* calls carrying either marker are rejected; plain curl/Postman
// (no such headers) and same-origin dashboard fetches pass.
//
// Runs in the Node.js runtime, so reading the settings file per remote
// request is fine (local requests never touch disk).

function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// Remote dashboard access: enabled flag + the unlock token. When enabled but
// no token exists yet (settings written by an older build), mint one lazily
// so the unlock link always exists — without it the toggle would be a
// no-auth wide-open switch.
function dashboardAccess(): { allowed: boolean; token: string | null } {
  try {
    const s = settingsService.get() as { tunnelDashboardAccess?: boolean; dashboardToken?: string };
    if (s.tunnelDashboardAccess !== true) return { allowed: false, token: null };
    return { allowed: true, token: s.dashboardToken || settingsService.ensureDashboardToken() };
  } catch {
    return { allowed: false, token: null };
  }
}

const BLOCKED_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Muse Gateway</title>
<style>body{font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#0b0b10;color:#e6e6f0}
.c{max-width:420px;text-align:center;padding:24px}.t{font-size:20px;font-weight:600;margin-bottom:10px}.d{color:#9a9aad;font-size:14px;line-height:1.6}
code{background:#1d1d28;padding:2px 6px;border-radius:4px}</style></head>
<body><div class="c"><div class="t">🔒 Chỉ truy cập được từ localhost</div>
<div class="d">Dashboard & management API bị chặn khi truy cập qua tunnel/mạng ngoài.<br><br>
Để mở: vào dashboard trên <code>localhost</code> → tab <b>Endpoint</b> → bật <b>Allow dashboard access via tunnel</b> rồi dùng link mở khóa được cấp.
API công khai vẫn hoạt động tại <code>/v1/*</code> (yêu cầu API key).</div></div></body></html>`;

function blocked(request: NextRequest) {
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
        'Dashboard & management API chỉ truy cập được từ localhost. Bật "Allow dashboard access via tunnel" trong tab Endpoint rồi mở bằng link mở khóa.',
    },
    { status: 403 }
  );
}

export function proxy(request: NextRequest) {
  // ── Drive-by CSRF guard (applies to local requests too) ──────────────
  // Browsers always stamp cross-site POSTs with sec-fetch-site: cross-site
  // and the attacker Origin. Rejecting those markers on mutating methods
  // kills localhost CSRF without affecting curl/scripts (no headers) or the
  // same-origin dashboard (sec-fetch-site: same-origin / no Origin).
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (request.headers.get('sec-fetch-site') === 'cross-site') {
      return NextResponse.json({ error: 'forbidden_origin', message: 'Cross-site requests are not allowed.' }, { status: 403 });
    }
    const origin = request.headers.get('origin');
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = '';
      }
      if (!isLoopbackHost(originHost)) {
        return NextResponse.json({ error: 'forbidden_origin', message: 'Cross-site requests are not allowed.' }, { status: 403 });
      }
    }
  }

  const remote = isRemoteHeaders(request.headers) ||
    !isLoopbackHost(request.headers.get('host') || request.nextUrl?.hostname);
  if (!remote) return NextResponse.next();

  // ── Remote traffic: dashboard access only via unlock token ───────────
  const { allowed, token } = dashboardAccess();
  if (allowed && token) {
    const cookie = request.cookies.get('muse_dgk')?.value || '';
    if (cookie && safeEq(cookie, token)) return NextResponse.next();

    const dgk = request.nextUrl.searchParams.get('dgk') || '';
    if (dgk && safeEq(dgk, token)) {
      // Unlock link — strip the token from the URL, persist it in an
      // HttpOnly cookie so navigation keeps working.
      const url = request.nextUrl.clone();
      url.searchParams.delete('dgk');
      const res = NextResponse.redirect(url);
      res.cookies.set('muse_dgk', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
      return res;
    }
  }
  return blocked(request);
}

// Proxy runs only on protected paths — /v1/* (key-gated), /api/health,
// /api/media/* (media delivery to remote clients), _next assets and any
// file-like path stay reachable so tunneled clients still work.
export const config = {
  matcher: ['/((?!v1/|api/health|api/media/|_next/|.*\\.[^/]+$).*)'],
};
