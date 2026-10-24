'use client';

import React, { useEffect, useState } from 'react';

interface ConfigData {
  cmdMode: string;
  baseUrl: string;
  model: string;
  apiKeyHint: string;
}

const CMD_MODES: { key: string; label: string; desc: string }[] = [
  { key: 'auto', label: 'Auto', desc: 'Chạy mọi lệnh Muse đề xuất (kể cả ghi/xoá)' },
  { key: 'readonly', label: 'Read-only', desc: 'Chỉ chạy lệnh đọc (ls, cat, git status, tokei…)' },
  { key: 'off', label: 'Off', desc: 'Tắt agent loop — Muse chỉ trả lời text' },
];

export function SettingsTab() {
  const [cfg, setCfg] = useState<ConfigData | null>(null);

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then(setCfg).catch(() => {});
  }, []);

  return (
    <div className="tab-surface">
      <div className="tab-top-caption">
        <span className="caption-text">Cấu hình runtime — đọc từ biến môi trường server.</span>
      </div>

      <div className="api-params-stack">
        <div className="api-param-row">
          <div className="param-meta">
            <span className="param-tag">MODEL</span>
            <span className="param-value">{cfg?.model || 'muse-web'}</span>
          </div>
        </div>
        <div className="api-param-row">
          <div className="param-meta">
            <span className="param-tag">BASE URL</span>
            <span className="param-value">{cfg?.baseUrl || 'http://localhost:3000/v1'}</span>
          </div>
        </div>
        <div className="api-param-row">
          <div className="param-meta">
            <span className="param-tag">AUTH</span>
            <span className="param-value">{cfg?.apiKeyHint || '—'}</span>
          </div>
        </div>
      </div>

      <div className="tab-top-caption" style={{ marginTop: 18 }}>
        <span className="caption-text">
          Agent command mode — <code>MUSE_CMD_MODE</code> (hiện tại: <strong>{cfg?.cmdMode || 'auto'}</strong>, đổi bằng env rồi restart server)
        </span>
      </div>
      <div className="client-app-grid">
        {CMD_MODES.map((m) => (
          <div
            key={m.key}
            className="client-app-card"
            style={
              cfg?.cmdMode === m.key
                ? { borderColor: 'var(--apple-blue)', boxShadow: '0 0 0 1px var(--apple-blue)' }
                : undefined
            }
          >
            <div className="app-card-title">
              {m.label}
              {cfg?.cmdMode === m.key && (
                <span className="tag-badge" style={{ marginLeft: 8 }}>đang dùng</span>
              )}
            </div>
            <div className="app-card-desc">{m.desc}</div>
          </div>
        ))}
      </div>

      <div className="tab-top-caption" style={{ marginTop: 18 }}>
        <span className="caption-text">Dữ liệu</span>
      </div>
      <div className="api-params-stack">
        <div className="api-param-row">
          <div className="param-meta">
            <span className="param-tag">PROFILES</span>
            <span className="param-value">data\sessions.json</span>
          </div>
        </div>
        <div className="api-param-row">
          <div className="param-meta">
            <span className="param-tag">POOL</span>
            <span className="param-value">data\pool.json</span>
          </div>
        </div>
      </div>
    </div>
  );
}
