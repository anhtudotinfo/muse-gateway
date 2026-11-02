'use client';

// Connect page — endpoint URLs/tunnel/tailscale + API keys.
import React from 'react';
import { EndpointTab } from '@/components/tabs/EndpointTab';
import { useApp } from '@/components/AppShell';

export function EndpointSection() {
  const { copyText } = useApp();

  return (
    <div className="router-page-narrow">
      <EndpointTab onCopyText={copyText} />
    </div>
  );
}
