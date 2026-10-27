import { NextRequest, NextResponse } from 'next/server';
import { deleteSessionProfile, getSavedSessions, normalizeProxy, saveSessionProfile, updateSessionProxy } from '@/lib/museService';
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

// Update a saved session — rename and/or set its egress proxy.
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const body = await req.json();
    const existing = getSavedSessions().find((s) => s.id === id);
    if (!existing) {
      return NextResponse.json({ error: 'Không tìm thấy session' }, { status: 404 });
    }
    if (body.proxy !== undefined) {
      const proxy = normalizeProxy(body.proxy); // throws on bad input
      const session = updateSessionProxy(id, proxy);
      return NextResponse.json({ success: true, session });
    }
    const session = saveSessionProfile({ id, name: String(body.name || '').trim() || existing.name, cookies: existing.cookies });
    return NextResponse.json({ success: true, session });
  } catch (err: any) {
    return NextResponse.json({ error: 'Lỗi cập nhật session: ' + err?.message }, { status: 500 });
  }
}
