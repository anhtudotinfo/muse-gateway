import { NextRequest, NextResponse } from 'next/server';
import { deleteSessionProfile } from '@/lib/museService';

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    deleteSessionProfile(id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: 'Lỗi xóa session: ' + err?.message }, { status: 500 });
  }
}
