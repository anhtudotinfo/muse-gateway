'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from '@/components/AppShell';
import { maskName } from '@/lib/mask';
import type { PoolAccountView, PoolStateView } from '@/lib/musePool';

function fmtCooldown(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)} giờ ${Math.floor((s % 3600) / 60)} phút`;
  if (s >= 60) return `${Math.ceil(s / 60)} phút`;
  return `${s} giây`;
}

function fmtAvg(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

const KIND_LABEL: Record<string, string> = {
  auth: 'Cookie hết hạn / lỗi auth',
  quota: 'Hết lượt',
  transient: 'Lỗi tạm thời',
};

interface AccountUsage {
  id: string;
  avgMs: number;
  requests: number;
  ok: number;
}

const STRATEGIES = [
  { key: 'round-robin', title: 'Xoay đều', desc: 'Lần lượt từng tài khoản, chia tải đều nhau.' },
  { key: 'fallback', title: 'Dự phòng theo thứ tự', desc: 'Luôn dùng tài khoản đầu, lỗi mới chuyển sang tài khoản sau.' },
  { key: 'fusion', title: 'Chạy song song', desc: 'Gửi cùng lúc tới mọi tài khoản, lấy kết quả về trước. Tốn lượt.' },
] as const;

const LANE_MIN = 1;
const LANE_MAX = 6;

/** Status column: what the pool will do with this account right now. */
function accountState(a: PoolAccountView): { text: string; tone: string } {
  if (!a.enabled) return { text: 'Đã tắt', tone: 'idle' };
  if (a.cooldownRemainingMs > 0) return { text: `Cooldown ${fmtCooldown(a.cooldownRemainingMs)}`, tone: 'bad' };
  if (a.status === 'busy') return { text: 'Đang gửi', tone: 'busy' };
  if (a.status === 'queued') return { text: 'Đang chờ lane', tone: 'warn' };
  if (a.failCount > 0) return { text: `${a.failCount} lỗi gần đây`, tone: 'warn' };
  return { text: 'Nhận request', tone: 'ok' };
}

/** Sub-line under the account name: why it is cooling / last error / last use. */
function accountNote(a: PoolAccountView): { text: string; bad: boolean } {
  if (a.cooldownRemainingMs > 0) {
    const kind = KIND_LABEL[a.cooldownReason] || 'Đang nghỉ';
    return { text: `${kind} — thử lại sau ${fmtCooldown(a.cooldownRemainingMs)}`, bad: true };
  }
  if (a.failCount > 0 && a.lastError) return { text: a.lastError, bad: true };
  if (a.lastUsedAt > 0) {
    const t = new Date(a.lastUsedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    return { text: `Dùng lần cuối ${t}`, bad: false };
  }
  return { text: 'Chưa dùng', bad: false };
}

/** Per-account lane chips — one per page: busy lanes show the Muse thread
 *  they're driving, idle lanes offer a close (×) control. */
function LaneChips({
  lanes,
  onClose,
}: {
  lanes: PoolAccountView['lanes'];
  onClose: (index: number) => void;
}) {
  if (!lanes || (!lanes.lanes.length && !lanes.creating)) {
    return <span className="acc2-muted">Chưa mở luồng</span>;
  }
  return (
    <div className="pool-lanes">
      {lanes.lanes.map((l) => (
        <span
          key={l.index}
          className={`pool-lane ${l.busy ? 'busy' : ''}`}
          title={l.threadUrl || (l.busy ? 'Đang tạo thread mới' : 'Luồng rảnh — chưa lái thread nào')}
        >
          L{l.index} {l.busy ? 'đang chạy' : 'rảnh'}
          {!l.busy && (
            <button
              type="button"
              className="pool-lane-close"
              aria-label={`Đóng luồng L${l.index} — giải phóng tab`}
              title="Đóng luồng — giải phóng tab"
              onClick={() => onClose(l.index)}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {lanes.creating > 0 && <span className="pool-lane opening">+{lanes.creating} đang mở</span>}
    </div>
  );
}

export function QuotaTab() {
  const { maskEmails } = useApp();
  const [state, setState] = useState<PoolStateView | null>(null);
  const [usageById, setUsageById] = useState<Record<string, AccountUsage>>({});
  const [laneCap, setLaneCap] = useState(3);
  const [laneMode, setLaneMode] = useState<'auto' | 'manual'>('auto');

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
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => {
        if (typeof s.lanesPerAccount === 'number') setLaneCap(s.lanesPerAccount);
        if (s.lanesMode === 'auto' || s.lanesMode === 'manual') setLaneMode(s.lanesMode);
      })
      .catch(() => {});
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
      const json = await res.json();
      if (res.ok) setState(json);
    } catch {}
  };

  const saveLaneCap = async (n: number) => {
    const next = Math.min(LANE_MAX, Math.max(LANE_MIN, n));
    if (next === laneCap) return;
    setLaneCap(next);
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lanesPerAccount: next }),
      });
    } catch {}
  };

  const saveLaneMode = async (mode: 'auto' | 'manual') => {
    if (mode === laneMode) return;
    setLaneMode(mode);
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lanesMode: mode }),
      });
      refresh();
    } catch {}
  };

  const accounts = state?.accounts || [];
  // Accounts needing attention first, then the healthy ones.
  const flagged = accounts.filter((a) => a.cooldownRemainingMs > 0 || a.failCount > 0);
  const healthy = accounts.filter((a) => a.cooldownRemainingMs <= 0 && a.failCount === 0);
  const rows = [...flagged, ...healthy];
  const enabledCount = accounts.filter((a) => a.enabled).length;

  return (
    <div className="pool-page">
      <section aria-label="Cài đặt pool" className="pool-settings">
        <div className="ov2-card pool-card">
          <div>
            <h2 className="pool-h2">Cách chia request</h2>
            <p className="pool-lead">Áp dụng cho mọi request không gọi tên combo.</p>
          </div>
          <div role="radiogroup" aria-label="Cách chia request" className="pool-strategies">
            {STRATEGIES.map((s) => {
              const on = state?.strategy === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className={`pool-strategy ${on ? 'active' : ''}`}
                  disabled={!state}
                  onClick={() => !on && patch({ strategy: s.key })}
                >
                  <span className="pool-strategy-title">{s.title}</span>
                  <span className="pool-strategy-desc">{s.desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="ov2-card pool-card">
          <div>
            <h2 className="pool-h2">Luồng mỗi tài khoản</h2>
            <p className="pool-lead">Số tác vụ một tài khoản chạy cùng lúc.</p>
          </div>
          <div role="radiogroup" aria-label="Chế độ luồng" className="pool-strategies pool-lane-modes">
            {([
              { key: 'auto', title: 'Tự động', desc: 'Gateway tự chọn số luồng cho từng tài khoản.' },
              { key: 'manual', title: 'Thủ công', desc: 'Cố định một số luồng cho mọi tài khoản.' },
            ] as const).map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={laneMode === m.key}
                className={`pool-strategy ${laneMode === m.key ? 'active' : ''}`}
                onClick={() => saveLaneMode(m.key)}
              >
                <span className="pool-strategy-title">{m.title}</span>
                <span className="pool-strategy-desc">{m.desc}</span>
              </button>
            ))}
          </div>
          {laneMode === 'manual' ? (
            <>
              <div className="pool-stepper">
                <button
                  type="button"
                  className="pool-step-btn"
                  aria-label="Giảm số luồng"
                  disabled={laneCap <= LANE_MIN}
                  onClick={() => saveLaneCap(laneCap - 1)}
                >
                  −
                </button>
                <span className="pool-step-value" aria-live="polite">{laneCap}</span>
                <button
                  type="button"
                  className="pool-step-btn"
                  aria-label="Tăng số luồng"
                  disabled={laneCap >= LANE_MAX}
                  onClick={() => saveLaneCap(laneCap + 1)}
                >
                  +
                </button>
              </div>
              <span className="acc2-muted pool-hint">
                {state
                  ? `Pool chạy tối đa ${laneCap * enabledCount} tác vụ song song với ${enabledCount} tài khoản đang bật.`
                  : `Tối đa ${LANE_MIN}–${LANE_MAX} luồng mỗi tài khoản.`}
              </span>
            </>
          ) : (
            <span className="acc2-muted pool-hint">
              Bắt đầu 2 luồng mỗi tài khoản, tự thêm khi tác vụ chạy ổn và đang có hàng chờ (tối đa 4), tự bớt khi gặp lỗi
              trình duyệt hoặc Muse giới hạn. Hiện tại:{' '}
              {accounts.filter((a) => a.enabled).length
                ? accounts
                    .filter((a) => a.enabled)
                    .map((a) => `${maskName(a.name, maskEmails)} ${a.lanes?.cap ?? 2} luồng`)
                    .join(', ')
                : 'chưa có tài khoản nào bật'}
              .
            </span>
          )}
        </div>
      </section>

      <section aria-label="Trạng thái từng tài khoản" className="acc2-card">
        <div className="pool-card-head">
          <h2 className="pool-h2">Trạng thái từng tài khoản</h2>
          <div className="pool-head-right">
            <span className="acc2-muted">Tự cập nhật mỗi 5 giây</span>
            <button type="button" className="acc2-icon-btn" aria-label="Làm mới" title="Làm mới" onClick={refresh}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
              </svg>
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          state ? (
            <div className="acc2-empty">Chưa có tài khoản nào.</div>
          ) : (
            <div className="pool-loading" aria-busy="true">
              <div className="skeleton pool-skel" />
              <div className="skeleton pool-skel" />
              <span className="acc2-muted">Đang tải…</span>
            </div>
          )
        ) : (
          <div className="acc2-scroll">
            <table className="acc2-table pool-table">
              <thead>
                <tr>
                  <th>Tài khoản</th>
                  <th>Trạng thái</th>
                  <th>Luồng</th>
                  <th className="num">Thành công</th>
                  <th className="num">TB</th>
                  <th className="num">Request</th>
                  <th><span className="pool-sr">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const st = accountState(a);
                  const note = accountNote(a);
                  const u = usageById[a.id];
                  const needsReset = a.cooldownRemainingMs > 0 || a.failCount > 0;
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="acc2-who">
                          <span className="pool-worker">{a.worker}</span>
                          <div className="acc2-who-text">
                            <div className="acc2-name">{maskName(a.name, maskEmails)}</div>
                            <div className={`pool-note ${note.bad ? 'bad' : ''}`} title={note.text}>{note.text}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={`pool-state ${st.tone}`}>{st.text}</span>
                      </td>
                      <td className="pool-lanes-cell">
                        <LaneChips lanes={a.lanes} onClose={(i) => patch({ accountId: a.id, closeLane: i })} />
                      </td>
                      <td className="num">{u && u.requests ? `${Math.round((u.ok / u.requests) * 100)}%` : '—'}</td>
                      <td className="num pool-dim">{u && u.avgMs ? fmtAvg(u.avgMs) : '—'}</td>
                      <td className="num">{a.totalRequests}</td>
                      <td>
                        <div className="acc2-actions">
                          {needsReset && (
                            <button
                              type="button"
                              className="acc2-btn small"
                              onClick={() => patch({ accountId: a.id, resetCooldown: true })}
                            >
                              Xoá cooldown
                            </button>
                          )}
                          <button
                            type="button"
                            className="acc2-btn small"
                            title={a.enabled ? 'Tạm tắt tài khoản khỏi pool' : 'Bật lại tài khoản trong pool'}
                            onClick={() => patch({ accountId: a.id, enabled: !a.enabled })}
                          >
                            {a.enabled ? 'Tạm tắt' : 'Bật lại'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
