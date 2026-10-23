import { NextResponse } from 'next/server';
import { generateBookmarklet } from '@/lib/museService';

export async function POST(req) {
  try {
    const { cookies } = await req.json();
    if (!cookies) {
      return NextResponse.json({ error: 'Thiếu cookie' }, { status: 400 });
    }

    const result = generateBookmarklet(cookies);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
