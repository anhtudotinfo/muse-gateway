'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { UpdateInfo } from '@/components/UpdateBanner';
import { LANGS, useT, type Lang } from '@/lib/i18n';

export type TabKey =
  | 'overview'
  | 'accounts'
  | 'combos'
  | 'usage'
  | 'quota'
  | 'console'
  | 'settings'
  | 'license';

const I = (paths: string) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d={paths} />
  </svg>
);

const ICONS: Record<TabKey, React.ReactNode> = {
  overview: I('M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V10'),

  accounts: I('M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'),
  combos: I('M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3M9 9h6v6H9z'),
  usage: I('M18 20V10M12 20V4M6 20v-6'),
  quota: I('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'),
  console: I('M4 17l6-6-6-6M12 19h8'),
  settings: I('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'),
  license: I('M9 12l2 2 4-4M7.8 3.8L12 2l4.2 1.8M12 22c-4 0-7-3.6-7-8V6.5L12 4l7 2.5V14c0 4.4-3 8-7 8z'),
};

const NAV: { key: TabKey; label: string; href: string; section?: string }[] = [
  { key: 'overview', label: 'Overview', href: '/' },
  { key: 'accounts', label: 'Accounts', href: '/accounts' },
  { key: 'combos', label: 'Combos', href: '/combos' },
  { key: 'usage', label: 'Usage', href: '/usage' },
  { key: 'quota', label: 'Quota', href: '/quota' },
  { key: 'console', label: 'Console Log', href: '/console', section: 'System' },
  { key: 'license', label: 'Bản quyền', href: '/license' },
];

interface SidebarProps {
  profileCount: number;
  update?: UpdateInfo | null;
}

export function Sidebar({ profileCount, update }: SidebarProps) {
  const pathname = usePathname();
  const { lang, setLang, t } = useT();
  return (
    <aside className="router-sidebar">
      <div className="router-brand">
        <img src="/muse-logo.svg" alt="Muse" className="router-logo" style={{ objectFit: 'contain' }} />
        <div className="router-brand-text">
          <div className="router-brand-name">Muse Pool</div>
          <div className="router-brand-ver">v1.0</div>
        </div>
        <select
          aria-label="Language"
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          style={{
            marginLeft: 'auto',
            background: 'var(--surface-2, #1d1d28)',
            color: 'var(--text-muted, #9a9aad)',
            border: '1px solid var(--border, #2a2a38)',
            borderRadius: 7,
            fontSize: 11,
            padding: '3px 6px',
            cursor: 'pointer',
            maxWidth: 78,
          }}
        >
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
      </div>

      <nav className="router-nav" role="tablist">
        {NAV.map((item) => (
          <React.Fragment key={item.key}>
            {item.section && <div className="router-section-label">{t(item.section)}</div>}
            <Link
              href={item.href}
              role="tab"
              className={`router-nav-item ${pathname === item.href ? 'active' : ''}`}
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

      <div className="router-sidebar-footer">
        <span className="status-dot" />
        localhost:1412{update?.current ? ` · v${update.current}` : ' · /v1 ready'}
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
