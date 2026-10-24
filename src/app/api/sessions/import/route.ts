import { NextRequest, NextResponse } from 'next/server';
import { findSessionByCookies, getSavedSessions, saveSessionProfile } from '@/lib/museService';

// Merge an exported sessions array into the store. Entries with an id that
// already exists get a fresh id (never overwrite an existing session);
// entries missing cookies are skipped.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const list = Array.isArray(body) ? body : body?.sessions;
    if (!Array.isArray(list)) {
      return NextResponse.json({ error: 'Payload phải là mảng sessions' }, { status: 400 });
    }

    const existing = new Set(getSavedSessions().map((s) => s.id));
    let imported = 0;
    let skipped = 0;
    for (const item of list) {
      const name = String(item?.name || '').trim();
      const cookies = String(item?.cookies || '').trim();
      if (!cookies) {
        skipped++;
        continue;
      }
      // Same account already present (same hatch_sess)? Skip — don't create a dup card.
      if (findSessionByCookies(cookies)) {
        skipped++;
        continue;
      }
      const id = item?.id && !existing.has(String(item.id)) ? String(item.id) : undefined;
      saveSessionProfile({ id, name: name || `Imported ${imported + 1}`, cookies });
      if (id) existing.add(id);
      imported++;
    }
    return NextResponse.json({ success: true, imported, skipped, sessions: getSavedSessions() });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Bad request' }, { status: 400 });
  }
}
