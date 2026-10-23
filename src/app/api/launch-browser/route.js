import { NextResponse } from 'next/server';
import { launchBrowserWithCookies } from '@/lib/museService';

export async function POST(req) {
  try {
    const { cookies, browserType } = await req.json();
    if (!cookies) {
      return NextResponse.json({ error: 'Vui lòng cung cấp cookie để mở trình duyệt' }, { status: 400 });
    }

    const info = await launchBrowserWithCookies(cookies, browserType || 'chrome');

    return NextResponse.json({
      success: true,
      message: `Đã mở Muse thành công trên ${info.browser === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'}!`,
      browser: info.browser,
      totalCookiesInjected: info.totalCookiesInjected,
    });
  } catch (err) {
    console.error('Launch browser error:', err);
    return NextResponse.json({
      error: 'Lỗi khi khởi chạy trình duyệt: ' + err.message,
    }, { status: 500 });
  }
}
