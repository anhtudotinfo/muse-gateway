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

  return {
    parsedMap,
    parsedEntries,
    cookieCount,
  };
}
