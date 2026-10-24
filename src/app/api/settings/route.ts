import { NextResponse } from 'next/server';
import { settingsService } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(settingsService.get());
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(settingsService.patch(body));
}
