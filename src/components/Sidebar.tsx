'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { UpdateInfo } from '@/components/UpdateBanner';
import { LANGS, useT, type Lang } from '@/lib/i18n';

export type TabKey =
  | 'overview'
  | 'media'
  | 'accounts'
  | 'connect'
  | 'telegram'
  | 'activity';

const I = (paths: string) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d={paths} />
  </svg>
);

const ICONS: Record<TabKey, React.ReactNode> = {
  overview: I('M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V10'),

  accounts: I('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'),
  media: I('M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21'),
  connect: I('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'),
  telegram: I('M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z'),
  activity: I('M22 12h-4l-3 9L9 3l-3 9H2'),
};

const NAV: { key: TabKey; label: string; href: string }[] = [
  { key: 'overview', label: 'Overview', href: '/' },
  { key: 'media', label: 'Images & videos', href: '/media' },
  { key: 'accounts', label: 'Accounts', href: '/accounts' },
  { key: 'connect', label: 'Connect', href: '/connect' },
  { key: 'telegram', label: 'Telegram bot', href: '/telegram' },
  { key: 'activity', label: 'Activity', href: '/activity' },
];

const isActive = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

interface SidebarProps {
  profileCount: number;
  update?: UpdateInfo | null;
}

export function Sidebar({ profileCount, update }: SidebarProps) {
  const pathname = usePathname();
  const { lang, setLang, t } = useT();
  // Real address, so it's right behind a custom port or the tunnel.
  const [host, setHost] = useState('localhost:1412');
  const [license, setLicense] = useState<{ licensed: boolean; type: string } | null>(null);
  useEffect(() => {
    setHost(window.location.host);
    fetch('/api/license')
      .then((r) => r.json())
      .then((j) => setLicense({ licensed: !!j.licensed, type: String(j.type || '') }))
      .catch(() => {});
  }, [pathname]);
  return (
    <aside className="router-sidebar">
      <div className="router-brand">
        <img src="/muse-logo.svg" alt="Muse" className="router-logo" style={{ objectFit: 'contain' }} />
        <div className="router-brand-text">
          <div className="router-brand-name">Muse Pool</div>
          <div className="router-brand-ver">v1.0</div>
        </div>
      </div>

      <nav className="router-nav" aria-label={t('Điều hướng chính')}>
        {NAV.map((item) => (
          <React.Fragment key={item.key}>
            <Link
              href={item.href}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
              className={`router-nav-item ${isActive(pathname, item.href) ? 'active' : ''}`}
            >
              {ICONS[item.key]}
              <span>
                {t(item.label)}
                {item.key === 'accounts' && profileCount > 0 ? ` (${profileCount})` : ''}
              </span>
            </Link>
          </React.Fragment>
        ))}
      </nav>

      {license && (
        <Link
          href="/license"
          className={`sidebar-license ${license.licensed ? 'ok' : 'warn'} ${isActive(pathname, '/license') ? 'active' : ''}`}
          title={t('Bản quyền')}
        >
          <span className="sidebar-license-dot" />
          {license.licensed ? t('Bản quyền Pro') : license.type === 'expired' ? t('Bản quyền hết hạn') : t('Chưa kích hoạt bản quyền')}
        </Link>
      )}

      <div className="router-sidebar-footer">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            marginBottom: 9,
            padding: '5px 8px',
            border: '1px solid var(--border, #2a2a38)',
            borderRadius: 8,
            background: 'var(--surface-2, #1d1d28)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ opacity: 0.7, flexShrink: 0 }}>
            <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <select
            aria-label="Language"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'transparent',
              color: 'var(--text, #e6e6f0)',
              colorScheme: 'dark',
              border: 'none',
              outline: 'none',
              fontSize: 11.5,
              cursor: 'pointer',
            }}
          >
            {LANGS.map((l) => (
              <option key={l.id} value={l.id} style={{ background: '#1d1d28', color: '#e6e6f0' }}>{l.label}</option>
            ))}
          </select>
        </div>
        <span className="status-dot" />
        {host}{update?.current ? ` · v${update.current}` : ' · /v1 ready'}
        {update?.updateAvailable && update.latest && (
          <span
            title={`${t('Có bản mới')} v${update.latest} — npm i -g muse-gateway`}
            style={{
              marginLeft: 6,
              padding: '1px 7px',
              borderRadius: 999,
              fontSize: 10.5,
              fontWeight: 600,
              color: '#ff9f0a',
              background: 'rgba(255,159,10,0.14)',
              border: '1px solid rgba(255,159,10,0.35)',
              cursor: 'default',
            }}
          >
            ↑ v{update.latest}
          </span>
        )}
      </div>
    </aside>
  );
}
