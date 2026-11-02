import { NextRequest, NextResponse } from 'next/server';
import { isPairOrigin } from '@/lib/pairing';

// CORS for the pairing endpoints only. A web app on another origin (dev
// server, Tauri webview, hosted build) calls these from the browser; Chrome's
// Private Network Access also needs the explicit allow-private-network reply
// before a public page may reach localhost.
export function pairCors(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!origin || !isPairOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Pair-Secret',
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin',
  };
}

export function pairPreflight(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: pairCors(req) });
}

export function originRejected(req: NextRequest) {
  return isPairOrigin(req.headers.get('origin'))
    ? null
    : NextResponse.json({ error: 'This app is not allowed to connect.' }, { status: 403 });
}
