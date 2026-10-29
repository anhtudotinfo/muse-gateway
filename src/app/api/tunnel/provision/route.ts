import { NextResponse } from 'next/server';
import { onlineServer } from '@/lib/licenseOnline';
import { dataPath } from '@/lib/dataDir';
import { readJsonFile } from '@/lib/safeJson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The worker may need to create the tunnel + DNS record on first call.
export const maxDuration = 30;

// POST — vendor-branded tunnel URL for this license. The worker verifies the
// key, ensures a named tunnel + DNS route exist under the vendor's domain
// (u-<keyId>.<TUNNEL_DOMAIN>), and returns the connector token. The gateway
// then runs `cloudflared tunnel run --token <token>` via /api/tunnel/enable.
export async function POST() {
  const lic = readJsonFile<{ licenseKey?: string }>(dataPath('license.json'), null);
  if (!lic?.licenseKey) {
    return NextResponse.json(
      { error: 'Chưa kích hoạt license — nhập key ở tab Bản quyền trước.' },
      { status: 400 }
    );
  }
  const base = onlineServer();
  if (!base) {
    return NextResponse.json({ error: 'License server không được cấu hình.' }, { status: 400 });
  }
  try {
    const res = await fetch(`${base}/tunnel/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: lic.licenseKey }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: body?.error || `license server trả ${res.status}` },
        { status: res.status === 403 ? 403 : 502 }
      );
    }
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json(
      { error: `Không gọi được license server: ${(err as Error)?.message || err}` },
      { status: 502 }
    );
  }
}
