import { NextRequest, NextResponse } from 'next/server';
import { licenseService } from '@/lib/license';

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
      return NextResponse.json({ ok: r.ok, reason: r.reason, ...r.view });
    }

    // Mint a signed key — vendor-side tool. days <= 0 or missing → forever;
    // bindHwid locks the key to this machine's fingerprint.
    if (body.action === 'generate') {
      const email = String(body.email || '').trim();
      if (!email) return NextResponse.json({ error: 'Thiếu email đăng ký' }, { status: 400 });
      const days = Number(body.days) > 0 ? Number(body.days) : 0;
      const key = licenseService.generate(email, days, !!body.bindHwid);
      return NextResponse.json({ success: true, key });
    }

    const licenseKey = String(body.licenseKey || '');
    if (!licenseKey.trim()) {
      return NextResponse.json({ error: 'License key trống' }, { status: 400 });
    }
    return NextResponse.json(licenseService.activate(licenseKey));
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Bad request' }, { status: 400 });
  }
}

export async function DELETE() {
  licenseService.remove();
  return NextResponse.json({ success: true });
}
