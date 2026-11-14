import { NextRequest, NextResponse } from 'next/server';
import { getSavedSessions, launchBrowserWithCookies, museUrlOrNull } from '@/lib/museService';

/** Open a visible Chrome signed in as a Muse account. Either raw `cookies`
 *  (the account form), or `accountId` of a saved account — the dashboard's
 *  "check in the account's browser" passes that plus the task's thread `url`,
 *  so cookies never leave the server. Local only, like all /api/*. */
export async function POST(req: NextRequest) {
  try {
    const { cookies: rawCookies, browserType, accountId, url } = await req.json();
    let cookies: string | null = typeof rawCookies === 'string' && rawCookies ? rawCookies : null;
    let proxy: string | null = null;
    if (!cookies && typeof accountId === 'string' && accountId) {
      const account = getSavedSessions().find((s) => s.id === accountId);
      if (!account) {
        return NextResponse.json({ error: 'Không tìm thấy tài khoản này — có thể đã bị xoá khỏi gateway.' }, { status: 404 });
      }
      cookies = account.cookies;
      proxy = account.proxy ?? null;
    }
    if (!cookies) {
      return NextResponse.json({ error: 'Vui lòng cung cấp cookie để mở trình duyệt' }, { status: 400 });
    }
    if (url !== undefined && url !== null && !museUrlOrNull(url)) {
      return NextResponse.json({ error: 'Chỉ mở được địa chỉ muse.ai.' }, { status: 400 });
    }

    const info = await launchBrowserWithCookies(cookies, browserType || 'chrome', { url, proxy });

    return NextResponse.json({
      success: true,
      message: `Đã mở Muse thành công trên ${info.browser === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'}!`,
      browser: info.browser,
      totalCookiesInjected: info.totalCookiesInjected,
    });
  } catch (err: any) {
    console.error('Launch browser error:', err);
    return NextResponse.json({
      error: 'Lỗi khi khởi chạy trình duyệt: ' + err?.message,
    }, { status: 500 });
  }
}
