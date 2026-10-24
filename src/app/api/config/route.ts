import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    cmdMode: process.env.MUSE_CMD_MODE || 'auto',
    baseUrl: 'http://localhost:3000/v1',
    model: 'muse-web',
    apiKeyHint: 'không bắt buộc auth (local) — điền gì cũng được',
  });
}
