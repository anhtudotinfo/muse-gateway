import { NextResponse } from 'next/server';
import { tunnelManager } from '@/lib/tunnelManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const result = await tunnelManager.tailscaleDisable();
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to disable Tailscale' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Failed to disable Tailscale' }, { status: 500 });
  }
}
