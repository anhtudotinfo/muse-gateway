import { NextResponse } from 'next/server';
import { tunnelManager } from '@/lib/tunnelManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// cloudflared may need to be downloaded on first enable (~35MB)
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await tunnelManager.enableCloudflare({
      token: typeof body.token === 'string' ? body.token : undefined,
      publicUrl: typeof body.publicUrl === 'string' ? body.publicUrl : undefined,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to enable tunnel' }, { status: 500 });
  }
}
