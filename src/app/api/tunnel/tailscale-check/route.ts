import { NextResponse } from 'next/server';
import { tunnelManager } from '@/lib/tunnelManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await tunnelManager.tailscaleCheck());
  } catch {
    return NextResponse.json({ installed: false, loggedIn: false, hasCachedPassword: false });
  }
}
