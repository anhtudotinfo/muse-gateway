'use client';

// Shared Connect-page row: name + state, the address as a copy button,
// on/off action. Used by EndpointTab (endpoints) and TelegramSection (bot).
import React from 'react';
import { useT } from '@/lib/i18n';

export type RowTone = 'ok' | 'warn' | 'bad' | 'muted';

export interface RowView {
  state: string;
  tone: RowTone;
  busy?: boolean;
  /** Copyable address; when missing the placeholder is shown instead. */
  url?: string;
  placeholder: string;
  action: React.ReactNode;
  /** Error / progress line under the row. */
  note?: React.ReactNode;
}

export function ConnectRow({ name, view, copyId, copied, onCopy }: {
  name: string;
  view: RowView;
  copyId: string;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const { t } = useT();
  return (
    <div className="con-ep">
      <div className="con-ep-grid">
        <div className="con-ep-name">
          <div className="con-ep-title">{name}</div>
          <div className={`con-ep-state ${view.tone}`}>
            {view.busy && <span className="con-spin" aria-hidden="true" />}
            {view.state}
          </div>
        </div>
        {view.url ? (
          <button
            type="button"
            className="con-url"
            onClick={() => onCopy(view.url!, copyId)}
            aria-label={t('Sao chép địa chỉ {url}', { url: view.url })}
          >
            <code>{view.url}</code>
            <span className="con-url-copy">{copied === copyId ? t('Đã sao chép') : t('Sao chép')}</span>
          </button>
        ) : (
          <div className="con-url empty"><span>{view.placeholder}</span></div>
        )}
        <div className="con-ep-action">{view.action}</div>
      </div>
      {view.note}
    </div>
  );
}
