import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lightweight liveness probe — the Endpoint page pings this to report
// endpoint health (also usable through the tunnel URL). CORS * is required:
// the browser pings the tunnel origin cross-origin via clientPingUrl().
export async function GET() {
  return NextResponse.json(
    { ok: true, service: 'muse', ts: Date.now() },
    { headers: { 'Access-Control-Allow-Origin': '*' } }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
