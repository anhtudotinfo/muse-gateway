'use client';

import { SettingsTab } from '@/components/tabs/SettingsTab';
import { ToolsTab } from '@/components/tabs/ToolsTab';
import { useApp } from '@/components/AppShell';

export default function SettingsPage() {
  const { bookmarkletHref, consoleScript, parsedEntries, copyText } = useApp();

  return (
    <>
      <section className="router-page-card">
        <SettingsTab />
      </section>
      <section className="router-page-card" style={{ marginTop: 16 }}>
        <ToolsTab
          bookmarkletHref={bookmarkletHref}
          consoleScript={consoleScript}
          parsedEntries={parsedEntries}
          extensionPath={'d:\\Workspace\\04_Tools-Agents\\muse\\extension'}
          onCopyText={copyText}
        />
      </section>
    </>
  );
}
