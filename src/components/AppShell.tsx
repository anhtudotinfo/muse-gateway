'use client';

// Shared dashboard shell — wraps every tab route. Owns the sidebar, page
// header, toast stage, and the cross-page state that used to live in the
// monolithic page.tsx (cookie session input, profiles, browser choice).
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { usePathname } from 'next/navigation';
import type { Profile, BrowserDetection, CookieMap } from '@/types';
import { useToast } from '@/hooks/useToast';
import { useCookieParser } from '@/hooks/useCookieParser';
import { Sidebar } from '@/components/Sidebar';
import { AppleToastStage } from '@/components/AppleToastStage';

interface AppContextValue {
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  copyText: (text: string, label: string) => void;
  cookieInput: string;
  setCookieInput: (v: string) => void;
  parsedMap: CookieMap;
  parsedEntries: [string, string][];
  cookieCount: number;
  bookmarkletHref: string;
  consoleScript: string;
  profiles: Profile[];
  reloadProfiles: () => Promise<Profile[]>;
  selectedBrowser: 'chrome' | 'edge';
  setSelectedBrowser: (b: 'chrome' | 'edge') => void;
  availableBrowsers: BrowserDetection;
  launchBrowser: (cookies: string) => Promise<{ ok: boolean; error?: string }>;
  deleteProfile: (id: string) => Promise<void>;
  maskEmails: boolean;
  setMaskEmails: (v: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppShell>');
  return ctx;
}

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Overview', subtitle: 'Tổng quan pool + endpoint & API keys — trỏ client OpenAI-compatible vào đây' },
  '/accounts': { title: 'Accounts', subtitle: 'Quản lý phiên đăng nhập Muse — lưu nhiều tài khoản' },
  '/combos': { title: 'Combos', subtitle: 'Gom account theo model — fallback / round-robin / fusion' },
  '/usage': { title: 'Usage', subtitle: 'Thống kê request đi qua pool' },
  '/quota': { title: 'Quota Tracker', subtitle: 'Trạng thái quota & cooldown từng tài khoản' },
  '/console': { title: 'Console Log', subtitle: 'Log realtime từ driver & pool' },
  '/settings': { title: 'Settings', subtitle: 'Cấu hình runtime & dữ liệu · Công cụ (bookmarklet, extension, token inspector, client config)' },
  '/license': { title: 'Bản quyền', subtitle: 'License & đăng ký máy — key gắn với HWID' },
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { toasts, showToast } = useToast();

  const [cookieInput, setCookieInput] = useState<string>('');
  const [selectedBrowser, setSelectedBrowser] = useState<'chrome' | 'edge'>('chrome');
  const [availableBrowsers, setAvailableBrowsers] = useState<BrowserDetection>({ chrome: null, edge: null });
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [maskEmails, setMaskEmailsState] = useState(false);

  const setMaskEmails = useCallback((v: boolean) => {
    setMaskEmailsState(v);
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maskEmails: v }),
    }).catch(() => {});
  }, []);

  const { parsedMap, parsedEntries, cookieCount, bookmarkletHref, consoleScript } =
    useCookieParser(cookieInput);

  const reloadProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setProfiles(list);
      return list as Profile[];
    } catch (e) {
      console.error(e);
      return [] as Profile[];
    }
  }, []);

  useEffect(() => {
    fetch('/api/browsers')
      .then((r) => r.json())
      .then((b) => setAvailableBrowsers(b))
      .catch((err) => console.warn(err));

    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => setMaskEmailsState(!!s.maskEmails))
      .catch(() => {});

    reloadProfiles().then((list) => {
      if (list && list.length > 0) setCookieInput((v) => v || list[0].cookies);
    });
  }, [reloadProfiles]);

  const copyText = useCallback(
    (text: string, label: string) => {
      navigator.clipboard.writeText(text).then(() => {
        showToast(`Đã sao chép ${label}`, 'success');
      });
    },
    [showToast]
  );

  const launchBrowser = useCallback(
    async (cookies: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch('/api/launch-browser', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookies, browserType: selectedBrowser }),
        });
        const data = await res.json();
        if (res.ok && data.success) return { ok: true };
        return { ok: false, error: data.error || 'Lỗi khởi chạy trình duyệt' };
      } catch (err: any) {
        return { ok: false, error: err?.message || 'Lỗi kết nối tới máy chủ khởi chạy' };
      }
    },
    [selectedBrowser]
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      reloadProfiles();
    },
    [reloadProfiles]
  );

  const ctx = useMemo<AppContextValue>(
    () => ({
      showToast,
      copyText,
      cookieInput,
      setCookieInput,
      parsedMap,
      parsedEntries,
      cookieCount,
      bookmarkletHref,
      consoleScript,
      profiles,
      reloadProfiles,
      selectedBrowser,
      setSelectedBrowser,
      availableBrowsers,
      launchBrowser,
      deleteProfile,
      maskEmails,
      setMaskEmails,
    }),
    [
      showToast,
      copyText,
      cookieInput,
      parsedMap,
      parsedEntries,
      cookieCount,
      bookmarkletHref,
      consoleScript,
      profiles,
      reloadProfiles,
      selectedBrowser,
      availableBrowsers,
      launchBrowser,
      deleteProfile,
      maskEmails,
      setMaskEmails,
    ]
  );

  const meta = PAGE_META[pathname] || PAGE_META['/'];

  return (
    <AppContext.Provider value={ctx}>
      <AppleToastStage toasts={toasts} />
      <div className="router-shell">
        <Sidebar profileCount={profiles.length} />
        <main className="router-main">
          <header className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h1>{meta.title}</h1>
              <p>{meta.subtitle}</p>
            </div>
            <button
              type="button"
              className="apple-tool-btn"
              onClick={() => setMaskEmails(!maskEmails)}
              title="Che email/tên tài khoản khỏi mọi màn hình"
              style={{ flexShrink: 0 }}
            >
              {maskEmails ? '◐ Ẩn email: Bật' : '○ Ẩn email: Tắt'}
            </button>
          </header>
          {children}
        </main>
      </div>
    </AppContext.Provider>
  );
}
