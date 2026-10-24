'use client';

import React, { useEffect, useState, useCallback } from 'react';

interface OverviewData {
  strategy: string;
  accounts: { total: number; ready: number; busy: number; cooldown: number; disabled: number };
  requests: { total: number; today: number; successRate: number; avgMs: number };
  keys: { count: number; authRequired: boolean };
  days: { day: string; requests: number }[];
}

interface UsageTotals {
  requests: number;
  ok: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function OverviewTab() {
  const [ov, setOv] = useState<OverviewData | null>(null);
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [switching, setSwitching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [o, u] = await Promise.all([
        fetch('/api/overview').then((r) => r.json()),
        fetch('/api/usage?range=all').then((r) => r.json()),
      ]);
      setOv(o);
      setTotals(u.totals || null);
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const setStrategy = useCallback(async (strategy: 'fallback' | 'round-robin') => {
    if (strategy === ov?.strategy) return;
    setSwitching(true);
    try {
      await fetch('/api/pool', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy }),
      });
      await refresh();
    } catch {} finally {
      setSwitching(false);
    }
  }, [ov?.strategy, refresh]);

  const rate = ov?.requests.successRate ?? 100;
  const max = Math.max(1, ...(ov?.days || []).map((d) => d.requests));

  const tiles = [
    { label: 'Tổng request', value: totals ? fmtNum(totals.requests) : '—', color: '#fb7185', sub: `${ov?.requests.today ?? 0} hôm nay` },
    { label: 'Thành công', value: totals ? fmtNum(totals.ok) : '—', color: '#4ade80', sub: 'request ok' },
    { label: 'Thất bại', value: totals ? fmtNum(totals.failed) : '—', color: '#f87171', sub: totals?.requests ? `${Math.round(((totals.failed || 0) / totals.requests) * 100)}% tổng` : '0% tổng' },
    { label: 'Đang chạy', value: ov ? String(ov.accounts.busy) : '—', color: '#fb7185', sub: 'account busy' },
    { label: 'Tỷ lệ thành công', value: ov ? `${rate}%` : '—', color: '#fbbf24', sub: `${totals?.ok ?? 0}/${totals?.requests ?? 0} request` },
    { label: 'Latency TB', value: ov?.requests.avgMs ? `${(ov.requests.avgMs / 1000).toFixed(1)}s` : '—', color: '#67e8f9', sub: 'mỗi request' },
    { label: 'Tổng account', value: ov ? String(ov.accounts.total) : '—', color: '#fb7185', sub: `strategy ${ov?.strategy || '—'}` },
    { label: 'Khả dụng', value: ov ? String(ov.accounts.ready) : '—', color: '#4ade80', sub: 'sẵn sàng nhận request' },
    { label: 'Lỗi / Hết hạn', value: ov ? String(ov.accounts.cooldown) : '—', color: '#f87171', sub: 'cooldown / error' },
    { label: 'Đã tắt', value: ov ? String(ov.accounts.disabled) : '—', color: '#fbbf24', sub: 'disabled' },
    { label: 'API keys', value: ov ? String(ov.keys.count) : '—', color: '#e6e6f0', sub: ov?.keys.authRequired ? 'auth bắt buộc' : 'đang mở' },
    { label: 'Tổng token', value: totals ? fmtNum((totals.inputTokens || 0) + (totals.outputTokens || 0)) : '—', color: '#f472b6', sub: `${fmtNum(totals?.inputTokens || 0)} in · ${fmtNum(totals?.outputTokens || 0)} out` },
  ];

  return (
    <div className="tab-surface">
      <div className="tab-top-caption">
        <span className="caption-text">Tổng quan hệ thống — tự cập nhật mỗi 5s.</span>
        <button type="button" className="apple-tool-btn" onClick={refresh}>Làm mới</button>
      </div>

      <div className="ov-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="ov-tile">
            <div className="ov-tile-label">{t.label}</div>
            <div className="ov-tile-value" style={{ color: t.color }}>{t.value}</div>
            <div className="ov-tile-sub">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="ov-sys-grid">
        {/* Pool strategy card */}
        <div className="ov-card">
          <div className="ov-card-head">
            <div>
              <div className="ov-card-title">Pool Strategy</div>
              <div className="ov-card-desc">Cách pool chọn account cho mỗi request.</div>
            </div>
          </div>
          <div className="apple-segmented-control" style={{ alignSelf: 'stretch' }}>
            <button
              type="button"
              className={`segment-item ${ov?.strategy === 'round-robin' ? 'selected' : ''}`}
              style={{ flex: 1 }}
              disabled={switching}
              onClick={() => setStrategy('round-robin')}
            >
              Round-robin
            </button>
            <button
              type="button"
              className={`segment-item ${ov?.strategy === 'fallback' ? 'selected' : ''}`}
              style={{ flex: 1 }}
              disabled={switching}
              onClick={() => setStrategy('fallback')}
            >
              Fallback
            </button>
          </div>
          <div className="ov-sys-meta">
            <span><b style={{ color: 'var(--apple-green)' }}>{ov?.accounts.ready ?? 0}</b> sẵn sàng</span>
            <span><b style={{ color: '#fb7185' }}>{ov?.accounts.busy ?? 0}</b> busy</span>
            <span><b style={{ color: 'var(--apple-red)' }}>{ov?.accounts.cooldown ?? 0}</b> cooldown</span>
            <span><b style={{ color: 'var(--text-tertiary)' }}>{ov?.accounts.disabled ?? 0}</b> tắt</span>
          </div>
        </div>

        {/* 14-day requests mini chart */}
        <div className="ov-card">
          <div className="ov-card-head">
            <div>
              <div className="ov-card-title">Requests 14 ngày</div>
              <div className="ov-card-desc">Số request mỗi ngày đi qua pool.</div>
            </div>
          </div>
          <div className="bar-chart" style={{ height: 120 }}>
            {(ov?.days || []).map((d) => (
              <div key={d.day} className="bar-chart-col" title={`${d.day}: ${d.requests} requests`}>
                <div
                  className={`bar-chart-bar ${d.requests === 0 ? 'empty' : ''}`}
                  style={{ height: `${Math.max(3, (d.requests / max) * 88)}px` }}
                />
                <div className="bar-chart-label">{d.day.slice(3)}</div>
              </div>
            ))}
            {!ov?.days.length && <div className="ov-empty" style={{ width: '100%' }}>Chưa có dữ liệu.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
