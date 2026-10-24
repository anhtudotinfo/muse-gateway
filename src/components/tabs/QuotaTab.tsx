'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from '@/components/AppShell';
import { maskName } from '@/lib/mask';
import type { PoolStateView } from '@/lib/musePool';

function fmtCooldown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

const KIND_LABEL: Record<string, string> = {
  auth: 'Cookie hết hạn / lỗi auth',
  quota: 'Hết lượt / rate limit',
  transient: 'Lỗi tạm thời',
};

interface AccountUsage {
  id: string;
  avgMs: number;
  requests: number;
  ok: number;
}

const STATUS_BADGE: Record<string, { text: string; bg: string; color: string }> = {
  busy: { text: 'Đang gửi', bg: 'rgba(103,232,249,0.15)', color: '#67e8f9' },
  queued: { text: 'Đang chờ', bg: 'rgba(251,191,36,0.15)', color: '#fbbf24' },
};

export function QuotaTab() {
  const { maskEmails } = useApp();
  const [state, setState] = useState<PoolStateView | null>(null);
  const [usageById, setUsageById] = useState<Record<string, AccountUsage>>({});

  const refresh = useCallback(async () => {
    try {
      const [poolRes, usageRes] = await Promise.all([fetch('/api/pool'), fetch('/api/usage')]);
      setState(await poolRes.json());
      const u = await usageRes.json();
      const map: Record<string, AccountUsage> = {};
      for (const a of u.accounts || []) map[a.id] = a;
      setUsageById(map);
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const patch = async (body: any) => {
    try {
      const res = await fetch('/api/pool', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setState(await res.json());
    } catch {}
  };

  const accounts = state?.accounts || [];
  const flagged = accounts.filter((a) => a.cooldownRemainingMs > 0 || a.failCount > 0);
  const healthy = accounts.filter((a) => a.cooldownRemainingMs <= 0 && a.failCount === 0);

  return (
    <div className="tab-surface">
      <div className="tab-top-caption">
        <span className="caption-text">Trạng thái quota/cooldown từng tài khoản — giống Quota Tracker của 9Router.</span>
        <button type="button" className="apple-tool-btn" onClick={refresh}>
          Làm mới
        </button>
      </div>

      <div className="apple-profiles-stack">
        {accounts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)' }}>
            Chưa có tài khoản nào.
          </div>
        )}

        {flagged.map((a) => (
          <div key={a.id} className="apple-list-item">
            <div className="item-left-block">
              <h4>
                <span className="tag-badge" style={{ background: 'var(--apple-purple-dim)', color: 'var(--apple-purple)', fontFamily: 'monospace' }}>{a.worker}</span>
                {maskName(a.name, maskEmails)}
                <span className="tag-badge" style={{ background: 'var(--apple-red-dim)', color: 'var(--apple-red)' }}>
                  {!a.enabled ? 'Tắt' : a.cooldownRemainingMs > 0 ? `cooldown ${fmtCooldown(a.cooldownRemainingMs)}` : `${a.failCount} lỗi`}
                </span>
              </h4>
              <div className="item-timestamp">
                {KIND_LABEL[a.cooldownReason] || '—'} · {a.totalRequests} requests tổng
                {usageById[a.id] && ` · TB ${(usageById[a.id].avgMs / 1000).toFixed(1)}s`}
              </div>
              {a.lastError && (
                <div className="item-timestamp" style={{ color: 'var(--apple-red)' }}>{a.lastError}</div>
              )}
            </div>
            <div className="item-right-actions">
              <button
                type="button"
                className="btn-item-use"
                onClick={() => patch({ accountId: a.id, resetCooldown: true })}
              >
                Reset
              </button>
              <button
                type="button"
                className={a.enabled ? 'btn-item-del' : 'btn-item-use'}
                onClick={() => patch({ accountId: a.id, enabled: !a.enabled })}
                title={a.enabled ? 'Tắt account' : 'Bật account'}
              >
                {a.enabled ? 'Tắt' : 'Bật'}
              </button>
            </div>
          </div>
        ))}

        {healthy.map((a) => (
          <div key={a.id} className="apple-list-item">
            <div className="item-left-block">
              <h4>
                <span className="tag-badge" style={{ background: 'var(--apple-purple-dim)', color: 'var(--apple-purple)', fontFamily: 'monospace' }}>{a.worker}</span>
                {maskName(a.name, maskEmails)}
                <span
                  className="tag-badge"
                  style={
                    STATUS_BADGE[a.status] && a.enabled
                      ? { background: STATUS_BADGE[a.status].bg, color: STATUS_BADGE[a.status].color }
                      : a.enabled
                        ? { background: 'var(--apple-green-dim)', color: 'var(--apple-green)' }
                        : { background: 'var(--apple-surface-hover, rgba(255,255,255,0.08))', color: 'var(--text-tertiary)' }
                  }
                >
                  {a.enabled ? (STATUS_BADGE[a.status]?.text || 'OK') : 'Tắt'}
                </span>
              </h4>
              <div className="item-timestamp">
                {a.totalRequests} requests
                {usageById[a.id] &&
                  ` · ${usageById[a.id].requests ? Math.round((usageById[a.id].ok / usageById[a.id].requests) * 100) : 0}% success · TB ${(usageById[a.id].avgMs / 1000).toFixed(1)}s`}
                {a.lastUsedAt > 0 && ` · dùng lần cuối ${new Date(a.lastUsedAt).toLocaleTimeString('vi-VN')}`}
              </div>
            </div>
            <div className="item-right-actions">
              <button
                type="button"
                className={a.enabled ? 'btn-item-del' : 'btn-item-use'}
                onClick={() => patch({ accountId: a.id, enabled: !a.enabled })}
                title={a.enabled ? 'Tắt account' : 'Bật account'}
              >
                {a.enabled ? 'Tắt' : 'Bật'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
