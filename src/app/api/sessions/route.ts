import { NextRequest, NextResponse } from 'next/server';
import { findSessionByCookies, getSavedSessions, saveSessionProfile } from '@/lib/museService';

export async function GET() {
  const sessions = getSavedSessions();
  return NextResponse.json(sessions);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.cookies) {
      return NextResponse.json({ error: 'Thiếu cookie' }, { status: 400 });
    }

    // Same account already saved (same hatch_sess / same cookie string)? Refresh the
    // existing entry's cookies instead of creating a duplicate card.
    const existing = findSessionByCookies(body.cookies);
    if (existing && existing.id !== body.id) {
      const session = saveSessionProfile({ id: existing.id, name: existing.name, cookies: body.cookies });
      return NextResponse.json({ success: true, session, deduped: true });
    }

    const session = saveSessionProfile(body);
    return NextResponse.json({ success: true, session });
  } catch (err: any) {
    return NextResponse.json({ error: 'Lỗi khi lưu: ' + err?.message }, { status: 500 });
  }
}
