import { NextResponse } from 'next/server';
import { getSavedSessions, saveSessionProfile } from '@/lib/museService';

export async function GET() {
  const sessions = getSavedSessions();
  return NextResponse.json(sessions);
}

export async function POST(req) {
  try {
    const body = await req.json();
    if (!body.cookies) {
      return NextResponse.json({ error: 'Thiếu cookie' }, { status: 400 });
    }

    const session = saveSessionProfile(body);
    return NextResponse.json({ success: true, session });
  } catch (err) {
    return NextResponse.json({ error: 'Lỗi khi lưu: ' + err.message }, { status: 500 });
  }
}
