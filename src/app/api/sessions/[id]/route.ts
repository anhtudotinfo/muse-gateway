import { NextRequest, NextResponse } from 'next/server';
import { deleteSessionProfile, getSavedSessions, saveSessionProfile } from '@/lib/museService';
import { musePool } from '@/lib/musePool';

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    deleteSessionProfile(id);
    // Keep combos consistent — drop the deleted account from every membership.
    musePool.removeAccountFromCombos(id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: 'Lỗi xóa session: ' + err?.message }, { status: 500 });
  }
}

// Rename a saved session (keeps cookies + test state).
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const { name } = await req.json();
    const existing = getSavedSessions().find((s) => s.id === id);
    if (!existing) {
      return NextResponse.json({ error: 'Không tìm thấy session' }, { status: 404 });
    }
    const session = saveSessionProfile({ id, name: String(name || '').trim() || existing.name, cookies: existing.cookies });
    return NextResponse.json({ success: true, session });
  } catch (err: any) {
    return NextResponse.json({ error: 'Lỗi đổi tên: ' + err?.message }, { status: 500 });
  }
}
