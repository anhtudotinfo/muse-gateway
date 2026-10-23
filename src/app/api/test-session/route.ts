import { NextRequest, NextResponse } from 'next/server';
import { testSessionOnline } from '@/lib/museService';

export async function POST(req: NextRequest) {
  try {
    const { cookies } = await req.json();
    if (!cookies) {
      return NextResponse.json({ error: 'Vui lòng cung cấp cookie để kiểm tra' }, { status: 400 });
    }

    const result = await testSessionOnline(cookies);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ valid: false, message: err?.message }, { status: 500 });
  }
}
