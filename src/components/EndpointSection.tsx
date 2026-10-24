'use client';

// Endpoint & Key section — endpoint URLs/tunnel/tailscale + API keys.
// Was a standalone /endpoint page; merged into Overview.
import React from 'react';
import { useRouter } from 'next/navigation';
import { EndpointTab } from '@/components/tabs/EndpointTab';
import { useApp } from '@/components/AppShell';

export function EndpointSection() {
  const router = useRouter();
  const { copyText } = useApp();

  return (
    <div className="router-page-narrow" style={{ marginTop: 16 }}>
      <EndpointTab onCopyText={copyText} onOpenSettings={() => router.push('/settings')} />
    </div>
  );
}
