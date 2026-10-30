import { NextRequest, NextResponse } from 'next/server';
import { musePool } from '@/lib/musePool';
import { museDriver } from '@/lib/museDriver';

export async function GET() {
  return NextResponse.json(musePool.getState());
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === 'keepAliveAll') {
      const results = await musePool.keepAliveAll();
      return NextResponse.json({ results, state: musePool.getState() });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Bad request' }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.strategy === 'fallback' || body.strategy === 'round-robin') {
      musePool.setStrategy(body.strategy);
    }
    if (typeof body.accountId === 'string') {
      if (typeof body.enabled === 'boolean') {
        musePool.setEnabled(body.accountId, body.enabled);
      }
      if (body.resetCooldown) {
        musePool.resetAccount(body.accountId);
      }
      if (typeof body.closeLane === 'number') {
        // Lane-level control — kill an idle page (tab) under this account;
        // busy lanes are refused by the driver so replies aren't lost.
        const err = await museDriver.closeLane(body.accountId, body.closeLane);
        if (err) return NextResponse.json({ error: err }, { status: 400 });
      }
    }
    return NextResponse.json(musePool.getState());
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Bad request' }, { status: 400 });
  }
}
