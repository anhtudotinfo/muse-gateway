'use client';

import React, { useState } from 'react';
import { BookmarkletTab } from './BookmarkletTab';
import { ExtensionTab } from './ExtensionTab';
import { TokenInspectorTab } from './TokenInspectorTab';

interface ToolsTabProps {
  bookmarkletHref: string;
  consoleScript: string;
  parsedEntries: any[];
  extensionPath: string;
  onCopyText: (text: string, label: string) => void;
}

const CODEX_TOML = `[model_providers.muse]
name = "Muse Pool"
base_url = "http://localhost:1412/v1"
wire_api = "responses"

model_provider = "muse"
model = "muse-web"`;

type ToolKey = 'bookmarklet' | 'extension' | 'inspector' | 'client-config';

const TOOLS: { key: ToolKey; label: string }[] = [
  { key: 'bookmarklet', label: 'Bookmarklet' },
  { key: 'extension', label: 'Extension' },
  { key: 'inspector', label: 'Token Inspector' },
  { key: 'client-config', label: 'Client Config' },
];

export function ToolsTab({ bookmarkletHref, consoleScript, parsedEntries, extensionPath, onCopyText }: ToolsTabProps) {
  const [tool, setTool] = useState<ToolKey>('bookmarklet');

  return (
    <div className="tab-surface">
      <div className="tab-top-caption">
        <span className="caption-text">Công cụ phụ — lấy cookie & cấu hình client.</span>
        <div className="apple-segmented-control" role="group" aria-label="Công cụ">
          {TOOLS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`segment-btn ${tool === t.key ? 'active' : ''}`}
              onClick={() => setTool(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tool === 'bookmarklet' && (
        <BookmarkletTab
          bookmarkletHref={bookmarkletHref}
          consoleScript={consoleScript}
          onCopyConsoleCode={() => onCopyText(consoleScript, 'Mã DevTools Console')}
        />
      )}

      {tool === 'extension' && (
        <ExtensionTab onCopyExtensionPath={() => onCopyText(extensionPath, 'Đường dẫn Extension')} />
      )}

      {tool === 'inspector' && <TokenInspectorTab parsedEntries={parsedEntries} />}

      {tool === 'client-config' && (
        <>
          <div className="tab-top-caption" style={{ marginTop: 4 }}>
            <span className="caption-text">Codex Desktop (~/.codex/config.toml):</span>
            <button type="button" className="apple-tool-btn" onClick={() => onCopyText(CODEX_TOML, 'Codex config')}>
              Copy config
            </button>
          </div>
          <div className="playground-terminal" style={{ maxHeight: 220 }}>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{CODEX_TOML}</pre>
          </div>
        </>
      )}
    </div>
  );
}
