'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Modal from '@/components/endpoint/ui/Modal';
import Button from '@/components/endpoint/ui/Button';
import { useT } from '@/lib/i18n';
import { useApp } from '@/components/AppShell';
import { maskName } from '@/lib/mask';
import { MediaPreview, isVideo, localMediaUrl, type DashboardTask } from '@/components/tabs/MediaTab';

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

/** Today vs yesterday as a signed percentage; null when there's no base. */
function delta(today: number, yesterday: number): number | null {
  if (!yesterday) return null;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

const STRATEGY_LABEL: Record<string, string> = {
  'round-robin': 'Xoay đều',
  fallback: 'Dự phòng theo thứ tự',
  fusion: 'Chạy song song',
};

const RANGES = [7, 14] as const;
const GUIDE_DISMISSED_KEY = 'muse_guide_dismissed';
const RANGE_KEY = 'muse_overview_range';

export function OverviewTab() {
  const router = useRouter();
  const { t } = useT();
  const { copyText, maskEmails } = useApp();
  const [ov, setOv] = useState<OverviewData | null>(null);
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [media, setMedia] = useState<{ total: number; days: number[] } | null>(null);
  const [recentTasks, setRecentTasks] = useState<DashboardTask[]>([]);
  const [origin, setOrigin] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [range, setRange] = useState<(typeof RANGES)[number]>(7);
  const [updatedAt, setUpdatedAt] = useState(0);
  const [now, setNow] = useState(Date.now());

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

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      if (localStorage.getItem(RANGE_KEY) === '14') setRange(14);
    } catch {}
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const changeRange = (next: (typeof RANGES)[number]) => {
    setRange(next);
    try { localStorage.setItem(RANGE_KEY, String(next)); } catch {}
  };

  const refresh = useCallback(async () => {
    try {
      const [o, u, tk] = await Promise.all([
        fetch('/api/overview').then((r) => r.json()),
        fetch('/api/usage?range=all').then((r) => r.json()),
        fetch('/api/tasks?limit=24', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      ]);
      setRecentTasks(Array.isArray(tk.tasks) ? tk.tasks : []);
      setOv(o);
      setTotals(u.totals || null);
      setMedia({
        total: u.mediaFiles || 0,
        days: Array.isArray(u.mediaDays) ? u.mediaDays.map((d: { count: number }) => d.count) : [],
      });
      setUpdatedAt(Date.now());
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const rate = ov?.requests.successRate ?? 100;
  const allDays = ov?.days || [];
  const days = allDays.slice(-range);
  const today = allDays[allDays.length - 1];
  const yesterday = allDays[allDays.length - 2];
  const pct = (d?: { requests: number; ok: number }) => (d && d.requests ? Math.round((d.ok / d.requests) * 100) : 0);
  const mediaToday = media?.days[media.days.length - 1] ?? 0;
  const mediaYesterday = media?.days[media.days.length - 2] ?? 0;

  const GUIDE_STEPS: { icon: string; title: string; desc: string }[] = [
    {
      icon: 'person_add',
      title: t('Thêm tài khoản Muse'),
      desc: t('Vào trang {tab} — đăng nhập Muse bằng trình duyệt hoặc dán cookie của tài khoản đầu tiên.', { tab: t('Accounts') }),
    },
    {
      icon: 'key',
      title: t('Kích hoạt license'),
      desc: t('Vào tab {tab} — nhập license key để mở Gateway API {api} và cấp tunnel URL riêng.', { tab: t('Bản quyền'), api: '/v1/*' }),
    },
    {
      icon: 'vpn_key',
      title: t('Tạo API key & trỏ client'),
      desc: t('Vào trang {tab} — tạo key rồi trỏ client vào {url}.', { tab: t('Connect'), url: `${origin || 'http://localhost:1412'}/v1` }),
    },
  ];

  // Every tile has the same shape: value, today-vs-yesterday, one context line.
  const tiles: { label: string; value: string; color: string; change: number | null; changeUnit?: string; sub: string }[] = [
    {
      label: t('Tổng request'),
      value: totals ? fmtNum(totals.requests) : '',
      color: 'var(--text-primary)',
      change: delta(today?.requests ?? 0, yesterday?.requests ?? 0),
      sub: `${ov?.requests.today ?? 0} ${t('hôm nay')} · ${fmtNum(totals?.failed ?? 0)} ${t('thất bại')}`,
    },
    {
      label: t('Tỉ lệ thành công'),
      value: ov ? `${rate}%` : '',
      color: rate >= 90 ? '#4ade80' : rate >= 70 ? '#fbbf24' : '#f87171',
      change: today?.requests && yesterday?.requests ? pct(today) - pct(yesterday) : null,
      changeUnit: ` ${t('điểm')}`,
      sub: ov?.requests.avgMs ? `${t('Latency TB')} ${(ov.requests.avgMs / 1000).toFixed(1)}s` : t('Chưa có request'),
    },
    {
      label: t('Media đã tạo'),
      value: media ? fmtNum(media.total) : '',
      color: 'var(--text-primary)',
      change: delta(mediaToday, mediaYesterday),
      sub: `${mediaToday} ${t('hôm nay')}`,
    },
    {
      label: t('Tài khoản sẵn sàng'),
      value: ov ? `${ov.accounts.ready}/${ov.accounts.total}` : '',
      color: ov && ov.accounts.total > 0 && ov.accounts.ready === 0 ? '#f87171' : 'var(--text-primary)',
      change: null,
      sub: ov ? `${ov.accounts.busy} ${t('đang gửi')} · ${ov.accounts.cooldown} cooldown · ${ov.accounts.disabled} ${t('tắt')}` : '',
    },
  ];

  const endpoint = origin ? `${origin}/v1` : '';
  const running = recentTasks.filter((task) => task.status === 'running' || task.status === 'queued').length;

  // One feed: each pool request, with the file it produced when there is one.
  // A request and its task finish together, so match on finish time plus
  // prompt, and give each file to one row only.
  const used = new Set<string>();
  const feed = (ov?.recent || []).map((r) => {
    const task = r.ok
      ? recentTasks.find(
          (tk) =>
            tk.url &&
            !used.has(tk.id) &&
            tk.finished_at !== null &&
            Math.abs(tk.finished_at * 1000 - r.ts) < 15_000 &&
            tk.prompt.startsWith(r.promptPreview.slice(0, 40)),
        )
      : undefined;
    if (task) used.add(task.id);
    return { ...r, task };
  });

  const ago = (ts: number) => {
    const ms = now - ts;
    if (ms < 60_000) return t('vừa xong');
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${t('trước')}`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ${t('trước')}`;
    return `${Math.floor(ms / 86_400_000)}d ${t('trước')}`;
  };

  return (
    <div className="tab-surface">
      <div className="ov-toolbar">
        <span className="ov-updated" aria-live="polite">
          <span className="status-dot" />
          {updatedAt ? t('Cập nhật {s} giây trước', { s: Math.max(0, Math.round((now - updatedAt) / 1000)) }) : t('Đang tải…')}
        </span>
        <div className="ov-toolbar-actions">
          <button type="button" className="apple-tool-btn" onClick={() => setShowGuide(true)}>{t('Hướng dẫn')}</button>
          <button type="button" className="apple-tool-btn" onClick={refresh}>{t('Làm mới')}</button>
        </div>
      </div>

      <Modal
        isOpen={showGuide}
        onClose={dismissGuide}
        title={t('Bắt đầu với Muse Gateway')}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={dismissGuide}>{t('Để sau')}</Button>
            <Button onClick={() => { dismissGuide(); router.push('/accounts'); }}>{t('Bắt đầu ngay')}</Button>
          </>
        }
      >
        <p className="text-text-muted" style={{ marginTop: 0 }}>
          {t('3 bước để gateway sẵn sàng nhận request — làm lần lượt từ trên xuống.')}
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

      <div className="ov-tiles ov-tiles-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="ov-tile">
            <div className="ov-tile-label">{tile.label}</div>
            {tile.value ? (
              <div className="ov-tile-row">
                <span className="ov-tile-value" style={{ color: tile.color }}>{tile.value}</span>
                {tile.change !== null && (
                  <span
                    className={`ov-delta ${tile.change > 0 ? 'up' : tile.change < 0 ? 'down' : ''}`}
                    title={t('So với hôm qua')}
                  >
                    {tile.change > 0 ? '▲' : tile.change < 0 ? '▼' : '•'} {Math.abs(tile.change)}
                    {tile.changeUnit ?? '%'}
                  </span>
                )}
              </div>
            ) : (
              <div className="skeleton" style={{ height: 26, width: '55%', margin: '2px 0' }} />
            )}
            <div className="ov-tile-sub">{tile.sub || ' '}</div>
          </div>
        ))}
      </div>

      <div className="ov-grid-main">
        {/* Request volume (area) + success rate (dashed line) */}
        <div className="ov-card">
          <div className="ov-card-head">
            <div>
              <div className="ov-card-title">{t('Request theo ngày')}</div>
              <div className="ov-card-desc">
                <span style={{ color: '#fb7185' }}>●</span> {t('request/ngày')} ·{' '}
                <span style={{ color: '#4ade80' }}>●</span> {t('tỷ lệ thành công')}
              </div>
            </div>
            <div className="apple-segmented-control" role="group" aria-label={t('Khoảng thời gian')}>
              {RANGES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={`segment-item ${range === r ? 'selected' : ''}`}
                  aria-pressed={range === r}
                  onClick={() => changeRange(r)}
                >
                  {t('{n} ngày', { n: r })}
                </button>
              ))}
            </div>
          </div>
          {!ov ? (
            <div className="skeleton" style={{ flex: 1, minHeight: 130 }} />
          ) : days.some((d) => d.requests) ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <svg width="100%" height="130" viewBox="0 0 560 130" preserveAspectRatio="none" role="img" aria-label={t('Biểu đồ request theo ngày')}>
                {(() => {
                  const w = 560, h = 130, pad = 6;
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
                          <circle cx={rx(i)} cy={ry(d.requests)} r={2.6} fill="#fb7185" />
                          <title>{`${d.day}: ${d.requests} request · ${pct(d)}% ok · ${(d.avgMs / 1000).toFixed(1)}s`}</title>
                        </g>
                      ))}
                    </>
                  );
                })()}
              </svg>
              <div className="ov-axis">
                {days.map((d, i) => (
                  <span key={d.day} style={{ visibility: range === 7 || i % 2 === 0 ? 'visible' : 'hidden' }}>{d.day.slice(3)}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="ov-empty">{t('Chưa có request trong {n} ngày qua.', { n: range })}</div>
          )}
        </div>

        {/* Gateway status — where to point tools, and whether the pool can serve */}
        <div className="ov-card">
          <div className="ov-card-head">
            <div>
              <div className="ov-card-title">{t('Gateway')}</div>
              <div className="ov-card-desc">{t('Trỏ tool OpenAI-compatible vào endpoint này.')}</div>
            </div>
            {ov && (
              <span className={`ov-status-chip ${ov.accounts.ready > 0 ? 'done' : 'failed'}`}>
                {ov.accounts.ready > 0 ? t('Sẵn sàng') : t('Chưa sẵn sàng')}
              </span>
            )}
          </div>
          <button
            type="button"
            className="ov-endpoint"
            onClick={() => endpoint && copyText(endpoint, 'Endpoint')}
            aria-label={t('Sao chép endpoint')}
          >
            <code>{endpoint || '—'}</code>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">content_copy</span>
          </button>
          <dl className="ov-kv">
            <dt>{t('Tài khoản')}</dt>
            <dd>{ov ? `${ov.accounts.ready} ${t('sẵn sàng')} · ${ov.accounts.busy} ${t('đang gửi')}` : '—'}</dd>
            <dt>{t('Chiến lược')}</dt>
            <dd>{ov ? t(STRATEGY_LABEL[ov.strategy] || ov.strategy) : '—'}</dd>
            <dt>API keys</dt>
            <dd>{ov ? `${ov.keys.count} · ${ov.keys.authRequired ? t('bắt buộc key') : t('không cần key')}` : '—'}</dd>
          </dl>
          <div className="ov-card-actions">
            <button type="button" className="apple-tool-btn" onClick={() => router.push('/connect')}>{t('Kết nối & API key')}</button>
            <button type="button" className="apple-tool-btn" onClick={() => router.push('/accounts?tab=pool')}>{t('Quản lý pool')}</button>
          </div>
        </div>
      </div>

      {/* Recent activity — requests and the files they made, in one list */}
      <div className="ov-card">
        <div className="ov-card-head">
          <div>
            <div className="ov-card-title">{t('Hoạt động gần đây')}</div>
            <div className="ov-card-desc">
              {running > 0 ? t('{n} tác vụ đang chạy', { n: running }) : t('Request mới nhất qua pool.')}
            </div>
          </div>
          <div className="ov-toolbar-actions">
            <Link href="/media" className="apple-tool-btn">{t('Ảnh & video')}</Link>
            <Link href="/activity" className="apple-tool-btn">{t('Xem tất cả')}</Link>
          </div>
        </div>
        {!ov ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 44 }} />)}
          </div>
        ) : feed.length ? (
          <ul className="ov-feed">
            {feed.map((r, i) => (
              <li key={`${r.ts}-${i}`} className="ov-feed-row">
                {r.task ? (
                  <a href={localMediaUrl(r.task.url!)} target="_blank" rel="noreferrer" className="ov-feed-thumb" aria-label={t('Mở file')}>
                    <MediaPreview task={r.task} />
                    {isVideo(r.task) && r.task.duration_sec ? <span className="ov-media-dur">{Math.round(r.task.duration_sec)}s</span> : null}
                  </a>
                ) : (
                  <span className={`ov-feed-icon ${r.ok ? 'ok' : 'fail'}`} aria-hidden="true">
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{r.ok ? 'chat' : 'error'}</span>
                  </span>
                )}
                <div className="ov-feed-body">
                  <div className="ov-feed-top">
                    <span className="ov-feed-account">{maskName(r.accountName, maskEmails)}</span>
                    <span className="ov-feed-meta">{(r.ms / 1000).toFixed(1)}s · {ago(r.ts)}</span>
                  </div>
                  <div className={`ov-feed-text ${r.ok ? '' : 'fail'}`} title={r.error || r.promptPreview}>
                    {r.ok ? r.promptPreview || t('(prompt trống)') : `${t('Lỗi')}: ${r.error || r.promptPreview || t('thất bại')}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="ov-empty">{t('Chưa có request nào.')}</div>
        )}
      </div>
    </div>
  );
}
