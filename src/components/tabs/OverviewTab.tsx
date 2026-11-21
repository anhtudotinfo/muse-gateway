'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Modal from '@/components/endpoint/ui/Modal';
import Button from '@/components/endpoint/ui/Button';
import { useT } from '@/lib/i18n';
import { useApp } from '@/components/AppShell';
import { HeaderSlot } from '@/components/HeaderSlot';
import { maskName } from '@/lib/mask';
import type { PoolAccountView } from '@/lib/musePool';
import { MediaPreview, isVideo, localMediaUrl, type DashboardTask } from '@/components/tabs/MediaTab';

interface OverviewData {
  strategy: string;
  accounts: { total: number; ready: number; busy: number; cooldown: number; disabled: number };
  requests: { total: number; today: number; successRate: number; avgMs: number };
  keys: { count: number; authRequired: boolean };
  days: { day: string; requests: number; ok: number; avgMs: number }[];
  recent?: { ts: number; accountName: string; ok: boolean; ms: number; promptPreview: string; error?: string; model?: string }[];
}

interface UsageTotals {
  requests: number;
  ok: number;
  failed: number;
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const STRATEGY_LABEL: Record<string, string> = {
  'round-robin': 'Xoay đều',
  fallback: 'Dự phòng theo thứ tự',
  fusion: 'Chạy song song',
};

const GUIDE_DISMISSED_KEY = 'muse_guide_dismissed';

export function OverviewTab() {
  const router = useRouter();
  const { t } = useT();
  const { copyText, maskEmails } = useApp();
  const [ov, setOv] = useState<OverviewData | null>(null);
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [media, setMedia] = useState<{ total: number; days: number[] } | null>(null);
  const [poolAccounts, setPoolAccounts] = useState<PoolAccountView[] | null>(null);
  const [recentTasks, setRecentTasks] = useState<DashboardTask[]>([]);
  const [origin, setOrigin] = useState('');
  const [showGuide, setShowGuide] = useState(false);
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
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [o, u, tk, pl] = await Promise.all([
        fetch('/api/overview').then((r) => r.json()),
        fetch('/api/usage?range=all').then((r) => r.json()),
        fetch('/api/tasks?limit=40', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
        fetch('/api/pool').then((r) => r.json()).catch(() => ({})),
      ]);
      setRecentTasks(Array.isArray(tk.tasks) ? tk.tasks : []);
      setPoolAccounts(Array.isArray(pl.accounts) ? pl.accounts : []);
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

  const allDays = ov?.days || [];
  const week = allDays.slice(-7);
  const yesterday = allDays[allDays.length - 2];
  const pct = (d?: { requests: number; ok: number }) => (d && d.requests ? Math.round((d.ok / d.requests) * 100) : null);
  const mediaToday = media?.days[media.days.length - 1] ?? 0;
  const running = recentTasks.filter((task) => task.status === 'running' || task.status === 'queued').length;
  const ready = !!ov && ov.accounts.ready > 0;
  const endpoint = origin ? `${origin}/v1` : '';
  const results = recentTasks.filter((task) => task.status === 'succeeded' && task.url).slice(0, 8);

  const GUIDE_STEPS: { icon: string; title: string; desc: string }[] = [
    {
      icon: 'person_add',
      title: t('Thêm tài khoản Muse'),
      desc: t('Vào trang {tab} — đăng nhập Muse bằng trình duyệt hoặc dán cookie của tài khoản đầu tiên.', { tab: t('Accounts') }),
    },
    {
      icon: 'vpn_key',
      title: t('Tạo API key & trỏ client'),
      desc: t('Vào trang {tab} — tạo key rồi trỏ client vào {url}.', { tab: t('Connect'), url: endpoint || 'http://localhost:1412/v1' }),
    },
    {
      icon: 'key',
      title: t('Nhận URL cố định (tuỳ chọn)'),
      desc: t('Vào tab {tab} — nhập license key để được cấp tunnel URL cố định riêng. Không có key vẫn dùng đủ mọi tính năng.', { tab: t('Bản quyền') }),
    },
  ];

  const yesterdayRate = pct(yesterday);
  const kpis = [
    {
      label: t('Request hôm nay'),
      value: ov ? fmtNum(ov.requests.today) : '',
      sub: totals ? t('Tổng {n} · {f} thất bại', { n: fmtNum(totals.requests), f: fmtNum(totals.failed) }) : '',
    },
    {
      label: t('Tỉ lệ thành công'),
      value: ov ? `${ov.requests.successRate}%` : '',
      sub: yesterdayRate !== null ? t('Hôm qua {n}%', { n: yesterdayRate }) : t('Tính trên mọi request'),
    },
    {
      label: t('Ảnh & video hôm nay'),
      value: media ? fmtNum(mediaToday) : '',
      sub: media ? t('Tổng {n} file', { n: fmtNum(media.total) }) : '',
    },
    {
      label: t('Đang chạy'),
      value: ov ? String(running) : '',
      sub: running ? t('{n} tác vụ đang chờ kết quả', { n: running }) : t('Không có tác vụ chờ'),
    },
  ];

  const maxDay = Math.max(1, ...week.map((d) => d.requests));
  const weekOk = week.reduce((s, d) => s + d.ok, 0);
  const weekReq = week.reduce((s, d) => s + d.requests, 0);
  const weekMs = week.reduce((s, d) => s + d.avgMs * d.requests, 0);

  const ago = (ts: number) => {
    const ms = now - ts;
    if (ms < 60_000) return t('vừa xong');
    if (ms < 3_600_000) return t('{n} phút', { n: Math.floor(ms / 60_000) });
    if (ms < 86_400_000) return t('{n} giờ', { n: Math.floor(ms / 3_600_000) });
    return t('{n} ngày', { n: Math.floor(ms / 86_400_000) });
  };

  const kindOf = (model?: string) =>
    !model ? '—' : /image/i.test(model) ? t('Ảnh') : /video/i.test(model) ? t('Video') : /chat/i.test(model) ? 'Chat' : model;

  const duration = (ms: number) => {
    const s = Math.round(ms / 1000);
    return s >= 60 ? t('{m} phút {s} giây', { m: Math.floor(s / 60), s: s % 60 }) : `${s}s`;
  };

  return (
    <div className="ov2">
      <HeaderSlot>
        <span className="ov2-updated" aria-live="polite">
          <span className="status-dot" />
          {updatedAt ? t('Cập nhật {s} giây trước', { s: Math.max(0, Math.round((now - updatedAt) / 1000)) }) : t('Đang tải…')}
        </span>
        <button type="button" className="icon-btn" onClick={refresh} aria-label={t('Làm mới')} title={t('Làm mới')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />
          </svg>
        </button>
        <button type="button" className="ov2-btn" onClick={() => setShowGuide(true)}>{t('Hướng dẫn')}</button>
      </HeaderSlot>

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

      {/* Gateway status strip — can the pool serve, and where to point tools */}
      <section className="ov2-strip" aria-label={t('Trạng thái gateway')}>
        <div className="ov2-strip-status">
          <span className={`ov2-strip-icon ${ov ? (ready ? 'ok' : 'bad') : ''}`} aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {ready ? <path d="M20 6L9 17l-5-5" /> : <path d="M12 8v5M12 16.5v.5" />}
            </svg>
          </span>
          <div>
            <div className="ov2-strip-title">
              {!ov ? t('Đang kiểm tra…') : ready ? t('Gateway sẵn sàng') : t('Gateway chưa sẵn sàng')}
            </div>
            <div className="ov2-muted">
              {ov
                ? t('{r}/{n} tài khoản nhận request · {s}', {
                    r: ov.accounts.ready,
                    n: ov.accounts.total,
                    s: t(STRATEGY_LABEL[ov.strategy] || ov.strategy),
                  })
                : ' '}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="ov2-endpoint"
          onClick={() => endpoint && copyText(endpoint, 'Endpoint')}
          aria-label={t('Sao chép endpoint')}
        >
          <code>{endpoint || '—'}</code>
          <span className="ov2-endpoint-copy">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <rect x="9" y="9" width="12" height="12" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
            {t('Sao chép')}
          </span>
        </button>
        <div className="ov2-strip-links">
          <Link href="/connect" className="ov2-btn">API key</Link>
          <Link href="/accounts?tab=pool" className="ov2-btn">{t('Quản lý pool')}</Link>
        </div>
      </section>

      {/* Today's numbers — one card, neutral context lines */}
      <section className="ov2-kpis" aria-label={t('Chỉ số hôm nay')}>
        {kpis.map((k) => (
          <div key={k.label} className="ov2-kpi">
            <span className="ov2-muted">{k.label}</span>
            {k.value ? <span className="ov2-kpi-value">{k.value}</span> : <span className="skeleton" style={{ height: 34, width: '45%' }} />}
            <span className="ov2-dim">{k.sub || ' '}</span>
          </div>
        ))}
      </section>

      <div className="ov2-row">
        <section className="ov2-results" aria-label={t('Kết quả mới')}>
          <div className="ov2-section-head">
            <h2>{t('Kết quả mới')}</h2>
            <Link href="/media" className="ov2-link">{t('Xem tất cả ảnh & video')} →</Link>
          </div>
          {!ov ? (
            <div className="ov2-gallery">
              {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton ov2-thumb" />)}
            </div>
          ) : results.length ? (
            <div className="ov2-gallery">
              {results.map((task) => (
                <a key={task.id} href={localMediaUrl(task.url!)} target="_blank" rel="noreferrer" className="ov2-tile" title={task.prompt}>
                  <span className="ov2-thumb">
                    <MediaPreview task={task} />
                    <span className="ov2-thumb-tag">
                      {isVideo(task) ? (task.duration_sec ? `${Math.round(task.duration_sec)}s` : t('Video')) : t('Ảnh')}
                    </span>
                  </span>
                  <span className="ov2-tile-caption">{task.prompt}</span>
                </a>
              ))}
            </div>
          ) : (
            <div className="ov2-empty">{t('Chưa có ảnh hoặc video nào.')}</div>
          )}
        </section>

        <div className="ov2-side">
        <section className="ov2-card ov2-chart" aria-label={t('Request 7 ngày')}>
          <div className="ov2-section-head">
            <h2>{t('Request 7 ngày')}</h2>
            {weekReq > 0 && <span className="ov2-dim">{t('{n}% thành công', { n: Math.round((weekOk / weekReq) * 100) })}</span>}
          </div>
          {!ov ? (
            <div className="skeleton" style={{ height: 170 }} />
          ) : (
            <div className="ov2-bars" role="img" aria-label={t('Biểu đồ cột số request 7 ngày qua')}>
              {week.map((d, i) => {
                const today = i === week.length - 1;
                return (
                  <div key={d.day} className="ov2-bar-col" title={`${d.day}: ${d.requests} request · ${pct(d) ?? 0}% ok`}>
                    <span className="ov2-bar-count">{d.requests}</span>
                    <span
                      className={`ov2-bar ${today ? 'today' : ''}`}
                      style={{ height: `${Math.max(4, Math.round((d.requests / maxDay) * 120))}px` }}
                    />
                    <span className="ov2-bar-day">{today ? t('Nay') : d.day.slice(3)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="ov2-chart-foot">
            <span className="ov2-muted">{t('Thời gian TB')}</span>
            <b>{weekReq ? duration(weekMs / weekReq) : '—'}</b>
          </div>
        </section>

        {/* Per-account health — which account is serving, busy or resting */}
        <section className="ov2-card ov2-accounts" aria-label={t('Tài khoản')}>
          <div className="ov2-section-head">
            <h2>{t('Tài khoản')}</h2>
            <Link href="/accounts" className="ov2-link">{t('Quản lý')} →</Link>
          </div>
          {!poolAccounts ? (
            <div className="skeleton" style={{ height: 72 }} />
          ) : poolAccounts.length ? (
            <ul className="ov2-acc-list">
              {poolAccounts.slice(0, 5).map((a) => {
                const state = !a.enabled
                  ? { cls: 'idle', label: t('Tắt') }
                  : a.cooldownRemainingMs > 0
                    ? { cls: 'bad', label: t('Cooldown {n} phút', { n: Math.ceil(a.cooldownRemainingMs / 60000) }) }
                    : a.status === 'busy'
                      ? { cls: 'busy', label: t('Đang gửi') }
                      : { cls: 'ok', label: t('Nhận request') };
                return (
                  <li key={a.id} className="ov2-acc-row">
                    <span className={`ov2-acc-dot ${state.cls}`} aria-hidden="true" />
                    <span className="ov2-acc-name">{maskName(a.name, maskEmails)}</span>
                    <span className={`ov2-acc-state ${state.cls}`}>{state.label}</span>
                    <span className="ov2-dim">{t('{n} request', { n: a.totalRequests })}</span>
                  </li>
                );
              })}
              {poolAccounts.length > 5 && (
                <li className="ov2-dim">{t('+{n} tài khoản khác', { n: poolAccounts.length - 5 })}</li>
              )}
            </ul>
          ) : (
            <div className="ov2-empty" style={{ padding: '16px 0' }}>
              <Link href="/accounts" className="ov2-link">{t('Thêm tài khoản Muse')} →</Link>
            </div>
          )}
        </section>
        </div>
      </div>

      {/* Recent requests as a table: one row, one request */}
      <section className="ov2-card ov2-activity" aria-label={t('Hoạt động gần đây')}>
        <div className="ov2-section-head ov2-pad">
          <h2>{t('Hoạt động gần đây')}</h2>
          <Link href="/activity?tab=logs" className="ov2-link">{t('Mở nhật ký')} →</Link>
        </div>
        <div className="ov2-table-scroll">
          <table className="ov2-table">
            <thead>
              <tr>
                <th>{t('Thời gian')}</th>
                <th>{t('Tài khoản')}</th>
                <th>{t('Loại')}</th>
                <th>Prompt</th>
                <th className="num">{t('Mất')}</th>
                <th className="num">{t('Trạng thái')}</th>
              </tr>
            </thead>
            <tbody>
              {(ov?.recent || []).map((r, i) => (
                <tr key={`${r.ts}-${i}`}>
                  <td className="ov2-dim">{ago(r.ts)}</td>
                  <td>{maskName(r.accountName, maskEmails)}</td>
                  <td><span className="ov2-chip">{kindOf(r.model)}</span></td>
                  <td className="ov2-prompt" title={r.error || r.promptPreview}>
                    {r.ok ? r.promptPreview || t('(prompt trống)') : r.error || r.promptPreview}
                  </td>
                  <td className="num ov2-dim">{(r.ms / 1000).toFixed(1)}s</td>
                  <td className={`num ov2-status ${r.ok ? 'ok' : 'bad'}`}>{r.ok ? t('Xong') : t('Lỗi')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ov && !(ov.recent || []).length && <div className="ov2-empty">{t('Chưa có request nào.')}</div>}
        </div>
      </section>
    </div>
  );
}
