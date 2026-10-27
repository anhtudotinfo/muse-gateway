import { NextRequest, NextResponse } from 'next/server';
import { licenseService } from '@/lib/license';
import { activateOnline, onlineEnabled, refreshOnline } from '@/lib/licenseOnline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(licenseService.getView());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    if (body.action === 'verify') {
      const r = licenseService.verify();
      const online = onlineEnabled() ? await refreshOnline() : null;
      return NextResponse.json({ ok: r.ok, reason: r.reason, ...r.view, onlineOk: online?.ok, onlineReason: online?.reason });
    }

    const licenseKey = String(body.licenseKey || '');
    if (!licenseKey.trim()) {
      return NextResponse.json({ error: 'License key trống' }, { status: 400 });
    }
    const view = licenseService.activate(licenseKey);
    // Online activation (fail-closed): the license server binds HWID and
    // returns a signed verdict. If it can't be reached or denies the key,
    // roll back the local license — the gateway is online-only anyway.
    if (onlineEnabled()) {
      const r = await activateOnline(licenseKey);
      if (!r.ok) {
        licenseService.remove();
        const msg =
          r.reason === 'license_revoked'
            ? 'Key đã bị thu hồi.'
            : r.reason === 'license_expired'
              ? 'Key đã hết hạn.'
              : r.reason === 'hwid_not_bound' || r.reason === 'hwid_mismatch'
                ? 'Key đã kích hoạt trên máy khác — liên hệ vendor để chuyển máy.'
                : `Không kết nối được license server — cần internet để kích hoạt. (${r.reason})`;
        return NextResponse.json({ error: msg, onlineReason: r.reason }, { status: 400 });
      }
      return NextResponse.json({ ...view, onlineOk: r.ok, onlineReason: r.reason });
    }
    return NextResponse.json(view);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Bad request' }, { status: 400 });
  }
}

export async function DELETE() {
  licenseService.remove();
  return NextResponse.json({ success: true });
}
