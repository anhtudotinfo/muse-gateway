'use client';

import { OverviewTab } from '@/components/tabs/OverviewTab';
import { EndpointSection } from '@/components/EndpointSection';

export default function OverviewPage() {
  return (
    <>
      <section className="router-page-card">
        <OverviewTab />
      </section>
      <EndpointSection />
    </>
  );
}
