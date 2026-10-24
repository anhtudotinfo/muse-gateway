import { NextResponse } from 'next/server';
import { tunnelManager } from '@/lib/tunnelManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// cloudflared may need to be downloaded on first enable (~35MB)
export const maxDuration = 120;

export async function POST() {
  try {
    const result = await tunnelManager.enableCloudflare();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to enable tunnel' }, { status: 500 });
  }
}
