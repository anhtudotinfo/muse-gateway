import { NextRequest, NextResponse } from 'next/server';
import { parseCookieString } from '@/lib/museService';

export async function POST(req: NextRequest) {
  try {
    const { cookies } = await req.json();
    if (!cookies) {
      return NextResponse.json({ error: 'Không có dữ liệu cookie' }, { status: 400 });
    }

    const map = parseCookieString(cookies);
    const keys = Object.keys(map);
    const keyTokens = {
      hatch_sess: map['hatch_sess'] ? map['hatch_sess'].slice(0, 36) + '...' : null,
      hatch_vml: map['hatch_vml'] ? 'Có sẵn (' + map['hatch_vml'].length + ' ký tự)' : null,
      hatch_gw: map['hatch_gw'] ? 'Có sẵn (' + map['hatch_gw'].length + ' ký tự)' : null,
      hatch_native_auth_device: map['hatch_native_auth_device'] ? 'Có sẵn' : null,
      hatch_native_auth_temp: map['hatch_native_auth_temp'] ? 'Có sẵn' : null,
      datr: map['datr'] || null,
      theme: map['theme'] ? 'Đã cấu hình' : null,
    };

    const hasEssential = !!(map['hatch_sess'] && map['hatch_vml']);

    return NextResponse.json({
      success: true,
      totalCookies: keys.length,
      keys,
      hasEssential,
      keyTokens,
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Lỗi parse cookie: ' + err?.message }, { status: 500 });
  }
}
