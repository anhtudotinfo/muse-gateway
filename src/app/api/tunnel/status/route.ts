import { NextResponse } from 'next/server';
import { tunnelManager } from '@/lib/tunnelManager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(tunnelManager.getStatus());
}
