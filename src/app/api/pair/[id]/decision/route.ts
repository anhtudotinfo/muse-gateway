import { NextRequest, NextResponse } from 'next/server';
import { pairingService } from '@/lib/pairing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The user's Allow / Deny, from the gateway's own approval page only. The
 *  app asking to pair runs on another origin, so it can't approve itself:
 *  a browser call from it carries a foreign Origin and isn't same-origin. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  const site = req.headers.get('sec-fetch-site');
  let sameOrigin = !origin;
  try {
    sameOrigin = sameOrigin || new URL(origin as string).host === host;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin || (site && site !== 'same-origin' && site !== 'none')) {
    return NextResponse.json({ error: 'Approve from the Muse Gateway page.' }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const pair = pairingService.decide(id, body.approve === true);
  if (!pair) return NextResponse.json({ error: 'Pairing request not found.' }, { status: 404 });
  return NextResponse.json({ status: pair.status, app: pair.app });
}
