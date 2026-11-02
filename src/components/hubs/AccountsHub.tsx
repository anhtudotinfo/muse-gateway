'use client';

import { AccountsList } from '@/components/AccountsList';
import { PageTabs, usePageTab } from '@/components/PageTabs';
import { QuotaTab } from '@/components/tabs/QuotaTab';
import { CombosTab } from '@/components/tabs/CombosTab';
import { useApp } from '@/components/AppShell';

const TABS = ['accounts', 'pool', 'combos'] as const;

export function AccountsHub({ initialTab }: { initialTab?: string }) {
  const { profiles, copyText } = useApp();
  const [tab, setTab] = usePageTab(TABS, initialTab);
  return (
    <>
      <PageTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'accounts', label: 'Accounts', badge: profiles.length || '' },
          { id: 'pool', label: 'Quota & lanes' },
          { id: 'combos', label: 'Combos' },
        ]}
      />
      {tab === 'accounts' && <AccountsList />}
      {tab === 'pool' && (
        <section className="router-page-card">
          <QuotaTab />
        </section>
      )}
      {tab === 'combos' && (
        <section className="router-page-card">
          <CombosTab onCopyText={copyText} />
        </section>
      )}
    </>
  );
}
