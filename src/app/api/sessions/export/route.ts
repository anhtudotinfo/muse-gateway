import { NextResponse } from 'next/server';
import { getSavedSessions } from '@/lib/museService';

// Full export of saved sessions — includes cookies (credentials), same
// secrecy level as data/sessions.json on disk. Local tool: no auth gate
// beyond the dashboard's own.
export async function GET() {
  const sessions = getSavedSessions().map(({ id, name, cookies, createdAt, updatedAt }) => ({
    id,
    name,
    cookies,
    createdAt,
    updatedAt,
  }));
  return NextResponse.json({ version: 1, exportedAt: new Date().toISOString(), sessions });
}
