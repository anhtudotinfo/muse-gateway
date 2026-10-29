'use client';

// Slim update banner shown at the top of every dashboard page when a newer
// release exists on npmjs.com. Dismissal is remembered per version in
// localStorage so it doesn't nag about the same release twice.
import React, { useEffect, useState } from 'react';
import { useApp } from '@/components/AppShell';

export interface UpdateInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  channel: 'npm' | 'exe' | 'dev';
}

const DISMISS_KEY = 'muse-update-dismissed';

export function UpdateBanner({ info }: { info: UpdateInfo | null }) {
  const { copyText, showToast } = useApp();
  const [dismissed, setDismissed] = useState(true); // hidden until fetch decides
  const [applying, setApplying] = useState<'idle' | 'running' | 'done'>('idle');

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === info?.latest);
    } catch {
      setDismissed(false);
    }
  }, [info?.latest]);

  if (!info?.updateAvailable || !info.latest || dismissed) return null;

  const applyUpdate = async () => {
    setApplying('running');
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        setApplying('done');
        showToast(j.message || `Đang cài v${info.latest}`, 'success');
      } else {
        setApplying('idle');
        showToast(j.error || j.message || 'Cập nhật thất bại', 'error');
      }
    } catch (e: any) {
      setApplying('idle');
      showToast(e?.message || 'Cập nhật thất bại', 'error');
    }
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, info.latest!);
    } catch {}
    setDismissed(true);
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        marginBottom: 14,
        padding: '9px 12px',
        borderRadius: 10,
        fontSize: 12.5,
        lineHeight: 1.5,
        color: 'var(--apple-blue, #0a84ff)',
        background: 'rgba(10,132,255,0.10)',
        border: '1px solid rgba(10,132,255,0.30)',
      }}
    >
      <span style={{ fontSize: 15 }}>⬆</span>
      <span style={{ flex: 1, minWidth: 220 }}>
        {applying === 'done' ? (
          <>
            Đang cài <b>v{info.latest}</b> — <b>khởi động lại</b> muse-gateway sau ~30 giây để dùng bản mới.
          </>
        ) : (
          <>
            Có bản mới <b>v{info.latest}</b> (đang chạy v{info.current}). Chạy{' '}
            <code style={{ fontFamily: 'monospace' }}>npm i -g muse-gateway</code> để cập nhật, hoặc chọn{' '}
            <b>Update</b> trong menu <code>muse-gateway</code>.
            {info.channel === 'exe' && ' (bản .exe cần Node.js ≥ 20.9)'}
          </>
        )}
      </span>
      {info.channel === 'npm' && applying === 'idle' && (
        <button
          type="button"
          className="apple-tool-btn"
          style={{ padding: '3px 10px', fontSize: 11.5, flexShrink: 0 }}
          onClick={applyUpdate}
        >
          Cập nhật ngay
        </button>
      )}
      {applying === 'running' && (
        <span style={{ fontSize: 11.5, flexShrink: 0, opacity: 0.8 }}>Đang cài…</span>
      )}
      <button
        type="button"
        className="apple-tool-btn"
        style={{ padding: '3px 10px', fontSize: 11.5, flexShrink: 0 }}
        onClick={() => copyText('npm i -g muse-gateway', 'lệnh cập nhật')}
      >
        Sao chép lệnh
      </button>
      <button
        type="button"
        onClick={dismiss}
        title="Bỏ qua bản này"
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: 15,
          padding: '0 4px',
          opacity: 0.7,
          flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
