import { NextResponse } from 'next/server';
import { deleteSessionProfile } from '@/lib/museService';

export async function DELETE(req, { params }) {
  try {
    const { id } = await params;
    deleteSessionProfile(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: 'Lỗi xóa session: ' + err.message }, { status: 500 });
  }
}
