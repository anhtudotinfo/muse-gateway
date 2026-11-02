'use client';

import { PageTabs, usePageTab } from '@/components/PageTabs';
import { UsageTab } from '@/components/tabs/UsageTab';
import { ConsoleLogTab } from '@/components/tabs/ConsoleLogTab';

const TABS = ['stats', 'logs'] as const;

export function ActivityHub({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = usePageTab(TABS, initialTab);
  return (
    <>
      <PageTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'stats', label: 'Statistics' },
          { id: 'logs', label: 'Nhật ký' },
        ]}
      />
      {/* Each tab draws its own cards — no shared page-card wrapper. */}
      {tab === 'stats' ? <UsageTab /> : <ConsoleLogTab />}
    </>
  );
}
