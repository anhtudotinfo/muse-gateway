'use client';

import { useMemo } from 'react';

export function useCookieParser(cookieInput: string) {
  const parsedMap = useMemo<Record<string, string>>(() => {
    if (!cookieInput || typeof cookieInput !== 'string') return {};
    const cleaned = cookieInput.replace(/^Cookie:\s*/i, '').trim();
    const map: Record<string, string> = {};
    const pairs = cleaned.split(';').map((s) => s.trim()).filter(Boolean);
    for (const p of pairs) {
      const idx = p.indexOf('=');
      if (idx !== -1) {
        const k = p.slice(0, idx).trim();
        const v = p.slice(idx + 1).trim();
        if (k) map[k] = v;
      }
    }
    return map;
  }, [cookieInput]);

  const parsedEntries = useMemo(() => Object.entries(parsedMap), [parsedMap]);
  const cookieCount = parsedEntries.length;

  const { bookmarkletHref, consoleScript } = useMemo(() => {
    if (parsedEntries.length === 0) {
      return {
        bookmarkletHref: '#',
        consoleScript: '// Dán cookie vào ô bên trái để tự động tạo mã...',
      };
    }

    const jsLines = parsedEntries.map(([k, v]) => {
      return `document.cookie = "${encodeURIComponent(k)}=${encodeURIComponent(v)}; domain=.muse.ai; path=/; max-age=31536000; SameSite=Lax; Secure";`;
    });

    const script = `(function(){
  if (!location.hostname.includes('muse.ai')) {
    alert('Vui lòng mở trang https://muse.ai trước khi nhấn Bookmarklet!');
    location.href = 'https://muse.ai';
    return;
  }
  ${jsLines.join('\n  ')}
  alert('Đã nạp ${parsedEntries.length} cookies của Muse thành công! Trang đang tải lại...');
  location.reload();
})();`;

    const bookmarkletHref = 'javascript:' + encodeURIComponent(script.replace(/\n\s*/g, ' '));
    return { bookmarkletHref, consoleScript: script };
  }, [parsedEntries]);

  return {
    parsedMap,
    parsedEntries,
    cookieCount,
    bookmarkletHref,
    consoleScript,
  };
}
