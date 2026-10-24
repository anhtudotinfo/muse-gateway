import { NextRequest, NextResponse } from 'next/server';
import { getSavedSessions, testSessionOnline, updateSessionTest } from '@/lib/museService';

// Liveness check for a SAVED session — loads cookies by id, pings muse.ai,
// and persists the result (lastTested/lastStatus) onto the profile so the
// account card can show a LIVE/DEAD badge.
export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();
    const session = getSavedSessions().find((s) => s.id === id);
    if (!session) {
      return NextResponse.json({ error: 'Không tìm thấy session' }, { status: 404 });
    }

    const result = await testSessionOnline(session.cookies);
    updateSessionTest(session.id, !!result.valid);
    return NextResponse.json({
      id: session.id,
      valid: !!result.valid,
      message: result.message,
      vm_state: result.data?.vm_state,
      lastTested: new Date().toISOString(),
      lastStatus: result.valid ? 'valid' : 'invalid',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Bad request' }, { status: 400 });
  }
}
