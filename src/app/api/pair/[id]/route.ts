import { NextRequest, NextResponse } from 'next/server';
import { pairingService } from '@/lib/pairing';
import { originRejected, pairCors, pairPreflight } from '../cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) {
  return pairPreflight(req);
}

/** Status for the approval page and the app's polling. The key is only in
 *  the reply for the caller holding the request's secret, and only once. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const rejected = originRejected(req);
  if (rejected) return rejected;
  const { id } = await params;
  const result = pairingService.collect(id, req.headers.get('x-pair-secret'));
  if (!result) return NextResponse.json({ error: 'Pairing request not found.' }, { status: 404, headers: pairCors(req) });
  const { req: pair, key } = result;
  const host = req.headers.get('host') || 'localhost:1412';
  return NextResponse.json(
    {
      status: key ? 'approved' : pair.status,
      app: pair.app,
      code: pair.code,
      origin: pair.origin,
      ...(key ? { base_url: `http://${host}/v1`, api_key: key } : {}),
    },
    { headers: pairCors(req) },
  );
}
