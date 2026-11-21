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
import type { Profile, BrowserDetection } from '@/types';
import { useToast } from '@/hooks/useToast';
import { Sidebar } from '@/components/Sidebar';
import { UpdateBanner, type UpdateInfo } from '@/components/UpdateBanner';
import { AppleToastStage } from '@/components/AppleToastStage';
import { LangProvider, useT } from '@/lib/i18n';

interface AppContextValue {
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  copyText: (text: string, label: string) => void;
  cookieInput: string;
  setCookieInput: (v: string) => void;
  profiles: Profile[];
  reloadProfiles: () => Promise<Profile[]>;
  selectedBrowser: 'chrome' | 'edge';
  setSelectedBrowser: (b: 'chrome' | 'edge') => void;
  availableBrowsers: BrowserDetection;
  launchBrowser: (cookies: string) => Promise<{ ok: boolean; error?: string }>;
  deleteProfile: (id: string) => Promise<boolean>;
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
  '/': { title: 'Overview', subtitle: 'Tình trạng gateway, kết quả mới và hoạt động gần đây' },
  '/media': { title: 'Media', subtitle: 'Ảnh, video và giọng nói tạo qua gateway' },
  '/accounts': { title: 'Accounts', subtitle: 'Phiên đăng nhập Muse, hạn mức và cách pool chia request' },
  '/connect': { title: 'Connect', subtitle: 'Endpoint, API key và cấu hình cho tool của bạn' },
  '/activity': { title: 'Activity', subtitle: 'Thống kê request và log realtime từ driver & pool' },
  '/license': { title: 'Bản quyền', subtitle: 'License & đăng ký máy — key gắn với HWID' },
};

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <LangProvider>
      <AppShellInner>{children}</AppShellInner>
    </LangProvider>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { t } = useT();
  const { toasts, showToast } = useToast();

  const [cookieInput, setCookieInput] = useState<string>('');
  const [selectedBrowser, setSelectedBrowser] = useState<'chrome' | 'edge'>('chrome');
  const [availableBrowsers, setAvailableBrowsers] = useState<BrowserDetection>({ chrome: null, edge: null });
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [maskEmails, setMaskEmailsState] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  const setMaskEmails = useCallback((v: boolean) => {
    setMaskEmailsState(v);
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maskEmails: v }),
    }).catch(() => {});
  }, []);


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

    fetch('/api/update')
      .then((r) => r.json())
      .then((u) => setUpdate(u))
      .catch(() => {});

    void reloadProfiles();
  }, [reloadProfiles]);

  const copyText = useCallback(
    (text: string, label: string) => {
      navigator.clipboard.writeText(text).then(() => {
        showToast(`${t('Đã sao chép')} ${label}`, 'success');
      });
    },
    [showToast, t]
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
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
        if (!res.ok) return false;
      } catch {
        return false;
      }
      await reloadProfiles();
      return true;
    },
    [reloadProfiles]
  );

  const ctx = useMemo<AppContextValue>(
    () => ({
      showToast,
      copyText,
      cookieInput,
      setCookieInput,
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
        <Sidebar profileCount={profiles.length} update={update} />
        <main className="router-main">
          <header className="page-header" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <h1>{t(meta.title)}</h1>
              <p>{t(meta.subtitle)}</p>
            </div>
            <div className="page-header-actions">
            {/* Pages render their own header controls here (see usePageHeaderSlot). */}
            <div id="page-header-slot" className="page-header-actions" />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setMaskEmails(!maskEmails)}
              aria-pressed={maskEmails}
              aria-label={t('Che email/tên tài khoản khỏi mọi màn hình')}
              title={maskEmails ? t('Ẩn email: Bật') : t('Ẩn email: Tắt')}
              style={{ flexShrink: 0 }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                {maskEmails ? (
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24M1 1l22 22" />
                ) : (
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                )}
              </svg>
            </button>
            </div>
          </header>
          <UpdateBanner info={update} />
          {children}
        </main>
      </div>
    </AppContext.Provider>
  );
}
