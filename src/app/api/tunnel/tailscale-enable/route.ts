import { NextResponse } from 'next/server';
import { tunnelManager } from '@/lib/tunnelManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST() {
  try {
    const result = await tunnelManager.tailscaleEnable();
    return NextResponse.json(result, { status: result.success || result.needsLogin || result.funnelNotEnabled ? 200 : 500 });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Failed to enable Tailscale' }, { status: 500 });
  }
}
