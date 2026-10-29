'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Modal from '@/components/endpoint/ui/Modal';
import Button from '@/components/endpoint/ui/Button';

interface OverviewData {
  strategy: string;
  accounts: { total: number; ready: number; busy: number; cooldown: number; disabled: number };
  requests: { total: number; today: number; successRate: number; avgMs: number };
  keys: { count: number; authRequired: boolean };
  days: { day: string; requests: number; ok: number; avgMs: number }[];
  recent?: { ts: number; accountName: string; ok: boolean; ms: number; promptPreview: string; error?: string }[];
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

/** Tiny inline SVG sparkline — no deps, auto-scales, draws an area fill
 *  under the polyline. `values` is a per-day series; flat/zero data renders
 *  a baseline so the tile never looks broken. */
function Sparkline({ values, color, height = 26 }: { values: number[]; color: string; height?: number }) {
  const w = 96;
  const h = height;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`);
  const line = pts.join(' ');
  const area = `0,${h} ${line} ${w},${h}`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block', marginTop: 4 }}>
      <polygon points={area} fill={color} opacity={0.15} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const GUIDE_DISMISSED_KEY = 'muse_guide_dismissed';

const GUIDE_STEPS: { icon: string; title: string; desc: React.ReactNode }[] = [
  {
    icon: 'person_add',
    title: 'Thêm tài khoản Muse',
    desc: (
      <>
        Vào tab <b>Accounts</b> — dán cookies tài khoản đầu tiên bằng bookmarklet hoặc browser extension.
      </>
    ),
  },
  {
    icon: 'key',
    title: 'Kích hoạt license',
    desc: (
      <>
        Vào tab <b>Bản quyền</b> — nhập license key để mở Gateway API <code>/v1/*</code> và cấp tunnel URL riêng.
      </>
    ),
  },
  {
    icon: 'vpn_key',
    title: 'Tạo API key & trỏ client',
    desc: (
      <>
        Mục <b>API Keys</b> trên trang Overview — tạo key rồi trỏ client vào{' '}
        <code>http://localhost:1412/v1</code>.
      </>
    ),
  },
];

export function OverviewTab() {
  const router = useRouter();
  const [ov, setOv] = useState<OverviewData | null>(null);
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [media, setMedia] = useState<{ total: number; days: number[] } | null>(null);
  const [switching, setSwitching] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const dismissGuide = useCallback(() => {
    try { localStorage.setItem(GUIDE_DISMISSED_KEY, '1'); } catch {}
    setShowGuide(false);
  }, []);

  // First-run: auto-open the welcome guide once, until an account exists.
  useEffect(() => {
    if (!ov || ov.accounts.total !== 0) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem(GUIDE_DISMISSED_KEY) === '1'; } catch {}
    if (!dismissed) setShowGuide(true);
  }, [ov]);

  const refresh = useCallback(async () => {
    try {
      const [o, u] = await Promise.all([
        fetch('/api/overview').then((r) => r.json()),
        fetch('/api/usage?range=all').then((r) => r.json()),
      ]);
      setOv(o);
      setTotals(u.totals || null);
      setMedia({
        total: u.mediaFiles || 0,
        days: Array.isArray(u.mediaDays) ? u.mediaDays.map((d: { count: number }) => d.count) : [],
      });
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
  const days = ov?.days || [];
  const spark = (f: (d: (typeof days)[number]) => number) => days.map(f);

  const tiles: { label: string; value: string; color: string; sub: string; spark?: number[] }[] = [
    { label: 'Tổng request', value: totals ? fmtNum(totals.requests) : '—', color: '#fb7185', sub: `${ov?.requests.today ?? 0} hôm nay`, spark: spark((d) => d.requests) },
    { label: 'Thành công', value: totals ? fmtNum(totals.ok) : '—', color: '#4ade80', sub: 'request ok', spark: spark((d) => d.ok) },
    { label: 'Thất bại', value: totals ? fmtNum(totals.failed) : '—', color: '#f87171', sub: totals?.requests ? `${Math.round(((totals.failed || 0) / totals.requests) * 100)}% tổng` : '0% tổng', spark: spark((d) => d.requests - d.ok) },
    { label: 'Media đã tạo', value: media ? fmtNum(media.total) : '—', color: '#a78bfa', sub: 'file trong kho media', spark: media?.days },
    { label: 'Tỷ lệ thành công', value: ov ? `${rate}%` : '—', color: '#fbbf24', sub: `${totals?.ok ?? 0}/${totals?.requests ?? 0} request`, spark: spark((d) => (d.requests ? Math.round((d.ok / d.requests) * 100) : 0)) },
    { label: 'Latency TB', value: ov?.requests.avgMs ? `${(ov.requests.avgMs / 1000).toFixed(1)}s` : '—', color: '#67e8f9', sub: 'mỗi request', spark: spark((d) => d.avgMs) },
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
        <button type="button" className="apple-tool-btn" onClick={() => setShowGuide(true)}>Hướng dẫn</button>
        <button type="button" className="apple-tool-btn" onClick={refresh}>Làm mới</button>
      </div>

      <Modal
        isOpen={showGuide}
        onClose={dismissGuide}
        title="Bắt đầu với Muse Gateway"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={dismissGuide}>Để sau</Button>
            <Button onClick={() => { dismissGuide(); router.push('/accounts'); }}>Bắt đầu ngay</Button>
          </>
        }
      >
        <p className="text-text-muted" style={{ marginTop: 0 }}>
          3 bước để gateway sẵn sàng nhận request — làm lần lượt từ trên xuống.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          {GUIDE_STEPS.map((s, i) => (
            <div key={s.icon} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span
                style={{
                  width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(10,132,255,0.12)', color: '#0a84ff',
                  fontSize: 12, fontWeight: 700,
                }}
              >
                {i + 1}
              </span>
              <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.title}</div>
                <div style={{ color: 'var(--text-secondary)' }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      <div className="ov-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="ov-tile">
            <div className="ov-tile-label">{t.label}</div>
            <div className="ov-tile-value" style={{ color: t.color }}>{t.value}</div>
            {t.spark && <Sparkline values={t.spark} color={t.color} />}
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
          {/* Content fills the stretched card height — centers instead of
              leaving dead space at the bottom. */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
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
            <div className="ov-sys-meta" style={{ marginTop: 0 }}>
              <span><b style={{ color: 'var(--apple-green)' }}>{ov?.accounts.ready ?? 0}</b> sẵn sàng</span>
              <span><b style={{ color: '#fb7185' }}>{ov?.accounts.busy ?? 0}</b> busy</span>
              <span><b style={{ color: 'var(--apple-red)' }}>{ov?.accounts.cooldown ?? 0}</b> cooldown</span>
              <span><b style={{ color: 'var(--text-tertiary)' }}>{ov?.accounts.disabled ?? 0}</b> tắt</span>
            </div>
          </div>
        </div>

        {/* 14-day requests chart — request volume (area) + success rate (line) */}
        <div className="ov-card">
          <div className="ov-card-head">
            <div>
              <div className="ov-card-title">Requests 14 ngày</div>
              <div className="ov-card-desc">
                <span style={{ color: '#fb7185' }}>●</span> request/ngày ·{' '}
                <span style={{ color: '#4ade80' }}>●</span> tỷ lệ thành công
              </div>
            </div>
          </div>
          {days.length ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <svg width="100%" height="110" viewBox="0 0 560 110" preserveAspectRatio="none">
                {(() => {
                  const w = 560, h = 110, pad = 6;
                  const maxR = Math.max(1, ...days.map((d) => d.requests));
                  const step = days.length > 1 ? (w - pad * 2) / (days.length - 1) : w;
                  const rx = (i: number) => pad + i * step;
                  const ry = (v: number) => h - 8 - (v / maxR) * (h - 20);
                  const reqPts = days.map((d, i) => `${rx(i).toFixed(1)},${ry(d.requests).toFixed(1)}`).join(' ');
                  const okPts = days
                    .map((d, i) => `${rx(i).toFixed(1)},${(h - 8 - (d.requests ? d.ok / d.requests : 0) * (h - 20)).toFixed(1)}`)
                    .join(' ');
                  return (
                    <>
                      <polygon points={`${pad},${h - 8} ${reqPts} ${w - pad},${h - 8}`} fill="#fb7185" opacity={0.12} />
                      <polyline points={reqPts} fill="none" stroke="#fb7185" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                      <polyline points={okPts} fill="none" stroke="#4ade80" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" />
                      {days.map((d, i) => (
                        <g key={d.day}>
                          <circle cx={rx(i)} cy={ry(d.requests)} r={2.4} fill="#fb7185" />
                          <title>{`${d.day}: ${d.requests} requests · ${d.requests ? Math.round((d.ok / d.requests) * 100) : 0}% ok · avg ${(d.avgMs / 1000).toFixed(1)}s`}</title>
                        </g>
                      ))}
                    </>
                  );
                })()}
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--text-quaternary)', padding: '0 4px' }}>
                {days.map((d, i) => (
                  <span key={d.day} style={{ visibility: i % 2 === 0 ? 'visible' : 'hidden' }}>{d.day.slice(3)}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="ov-empty">Chưa có dữ liệu.</div>
          )}
        </div>

        {/* Recent activity feed */}
        <div className="ov-card">
          <div className="ov-card-head">
            <div>
              <div className="ov-card-title">Hoạt động gần đây</div>
              <div className="ov-card-desc">Request mới nhất qua pool.</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4, flex: 1, justifyContent: 'center' }}>
            {(ov?.recent || []).length ? (
              ov!.recent!.slice(0, 4).map((r, i) => {
                const ago = Date.now() - r.ts;
                const agoText = ago < 60_000 ? 'vừa xong' : ago < 3600_000 ? `${Math.floor(ago / 60_000)}p trước` : ago < 86400_000 ? `${Math.floor(ago / 3600_000)}h trước` : `${Math.floor(ago / 86400_000)}d trước`;
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.72rem', minWidth: 0 }}>
                    <span
                      title={r.ok ? 'Thành công' : r.error || 'Thất bại'}
                      style={{
                        width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                        background: r.ok ? '#4ade80' : '#f87171',
                        boxShadow: `0 0 6px ${r.ok ? '#4ade80' : '#f87171'}66`,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {r.accountName}
                        </span>
                        <span style={{ color: 'var(--text-quaternary)', flexShrink: 0 }}>
                          {(r.ms / 1000).toFixed(1)}s · {agoText}
                        </span>
                      </div>
                      <div style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.error || r.promptPreview}>
                        {r.ok ? (r.promptPreview || '(prompt trống)') : `✕ ${r.error || r.promptPreview || 'thất bại'}`}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="ov-empty" style={{ alignSelf: 'center' }}>Chưa có request nào.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
