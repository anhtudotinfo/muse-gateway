import { NextResponse } from 'next/server';
import { getLogs, clearLogs } from '@/lib/logBuffer';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ lines: getLogs() });
}

export async function DELETE() {
  clearLogs();
  return NextResponse.json({ success: true });
}
