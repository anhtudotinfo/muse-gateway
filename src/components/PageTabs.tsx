'use client';

// In-page tabs for the merged pages (Accounts, Activity, Settings). The
// active tab lives in ?tab= so old routes can redirect straight to it and
// a reload keeps the place; the first tab is the bare URL.
import React, { useCallback, useState } from 'react';
import { useT } from '@/lib/i18n';

export interface PageTab<T extends string> {
  id: T;
  label: string;
  badge?: string | number;
}

export function usePageTab<T extends string>(ids: readonly T[], initial?: string | null) {
  const [tab, setTab] = useState<T>(ids.includes(initial as T) ? (initial as T) : ids[0]);
  const select = useCallback(
    (next: T) => {
      setTab(next);
      const url = new URL(window.location.href);
      if (next === ids[0]) url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState(null, '', url);
    },
    [ids],
  );
  return [tab, select] as const;
}

export function PageTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: PageTab<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  const { t } = useT();
  return (
    <div className="page-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={`page-tab ${value === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {t(tab.label)}
          {tab.badge !== undefined && tab.badge !== '' && <span className="page-tab-badge">{tab.badge}</span>}
        </button>
      ))}
    </div>
  );
}
