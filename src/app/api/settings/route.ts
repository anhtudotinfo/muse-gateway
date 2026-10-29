import { NextResponse } from 'next/server';
import { settingsService } from '@/lib/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(settingsService.get());
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const updated = settingsService.patch(body);
  // Enabling remote dashboard access must always have an unlock token —
  // mint it here so the UI can show the access link immediately.
  if (updated.tunnelDashboardAccess) settingsService.ensureDashboardToken();
  return NextResponse.json(settingsService.get());
}
