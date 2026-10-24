'use client';

import { CombosTab } from '@/components/tabs/CombosTab';
import { useApp } from '@/components/AppShell';

export default function CombosPage() {
  const { copyText } = useApp();
  return (
    <section className="router-page-card">
      <CombosTab onCopyText={copyText} />
    </section>
  );
}
