'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { type BadgeVariant } from '@/components/endpoint/ui/Badge';
import { HeaderSlot } from '@/components/HeaderSlot';
import { useApp } from '@/components/AppShell';
import { useT } from '@/lib/i18n';

export interface DashboardTask {
  id: string;
  source: 'api' | 'chat';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  model: string;
  /** What the model promised (combos included); absent from older gateways. */
  kind?: 'chat' | 'image' | 'video';
  prompt: string;
  key_name: string;
  created_at: number;
  finished_at: number | null;
  requested_duration_sec: number | null;
  url: string | null;
  duration_sec: number | null;
  partial: boolean;
  error: string | null;
  thread_url: string | null;
  webhook_status: 'pending' | 'delivered' | 'failed' | null;
}

const POLL_MS = 5000;
const VIEW_KEY = 'muse_media_view';

// Kept for other pages that still render the shared Badge.
export const STATUS: Record<DashboardTask['status'], { label: string; variant: BadgeVariant }> = {
  queued: { label: 'Queued', variant: 'default' },
  running: { label: 'Running', variant: 'info' },
  succeeded: { label: 'Succeeded', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

/** Status as this page shows it: label key + acc2-pill tone. */
const PILL: Record<DashboardTask['status'], { label: string; tone: string }> = {
  queued: { label: 'Queued', tone: 'pending' },
  running: { label: 'Running', tone: 'pending' },
  succeeded: { label: 'Xong', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: '' },
};

const WEBHOOK: Record<NonNullable<DashboardTask['webhook_status']>, { label: string; tone: string }> = {
  pending: { label: 'Pending', tone: 'pending' },
  delivered: { label: 'Delivered', tone: 'ok' },
  failed: { label: 'Not delivered', tone: 'bad' },
};

const FILTERS = ['all', 'running', 'succeeded', 'failed', 'cancelled'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  running: 'Running',
  succeeded: 'Xong',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const KINDS = ['all', 'image', 'video'] as const;
type Kind = (typeof KINDS)[number];

const KIND_LABEL: Record<Kind, string> = { all: 'Tất cả loại', image: 'Ảnh', video: 'Video' };

function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatLength(task: DashboardTask): string {
  const actual = task.duration_sec ? `${Math.round(task.duration_sec)}s` : '—';
  return task.requested_duration_sec ? `${actual} / ${task.requested_duration_sec}s` : actual;
}

export function isVideo(task: Pick<DashboardTask, 'url' | 'model' | 'kind'>): boolean {
  if (task.url && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(task.url)) return true;
  if (task.url && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(task.url)) return false;
  return task.kind ? task.kind === 'video' : /video/i.test(task.model);
}

/** Files the gateway stores itself are served from /api/media on every
 *  origin. A task made through the tunnel records the tunnel address, so
 *  the dashboard loads those locally instead of round-tripping out. */
export function localMediaUrl(url: string): string {
  try {
    const u = new URL(url, 'http://local');
    return u.pathname.startsWith('/api/media/') ? `${u.pathname}${u.search}` : url;
  } catch {
    return url;
  }
}

/** Thumbnail for a finished task — the file itself, muted, so the grid
 *  shows what was made without opening anything. `controls` turns a video
 *  into a normal player (detail panel) instead of hover-to-play. */
export function MediaPreview({
  task,
  className = '',
  controls = false,
}: {
  task: DashboardTask;
  className?: string;
  controls?: boolean;
}) {
  if (!task.url) return null;
  if (!isVideo(task)) {
    return <img src={localMediaUrl(task.url)} alt={task.prompt} className={className} loading="lazy" />;
  }
  return controls ? (
    <video src={localMediaUrl(task.url)} className={className} controls playsInline preload="metadata" />
  ) : (
    <video
      src={localMediaUrl(task.url)}
      className={className}
      muted
      playsInline
      preload="metadata"
      onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
      onMouseLeave={(e) => e.currentTarget.pause()}
    />
  );
}

function matches(task: DashboardTask, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'running') return task.status === 'running' || task.status === 'queued';
  return task.status === filter;
}

function matchesKind(task: DashboardTask, kind: Kind): boolean {
  if (kind === 'all') return true;
  return isVideo(task) === (kind === 'video');
}

export function MediaTab() {
  const { t } = useT();
  const { copyText } = useApp();
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [kind, setKind] = useState<Kind>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === 'list') setView('list');
    } catch {}
  }, []);

  const changeView = (next: 'grid' | 'list') => {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch {}
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks?limit=200', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoaded(true);
      setNow(Date.now() / 1000);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const cancel = async (task: DashboardTask) => {
    if (
      !window.confirm(
        t('Stop waiting for this task? A render already inside Muse keeps running there and may use your quota.'),
      )
    ) {
      return;
    }
    setCancelling(task.id);
    try {
      await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
      await load();
    } finally {
      setCancelling(null);
    }
  };

  // Newest first, whatever order the API hands back.
  const byKind = tasks.filter((task) => matchesKind(task, kind)).sort((a, b) => b.created_at - a.created_at);
  const visible = byKind.filter((task) => matches(task, filter));
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f, byKind.filter((task) => matches(task, f)).length]),
  ) as Record<Filter, number>;
  // "Đã huỷ" only earns a chip once something was actually cancelled.
  const filters = FILTERS.filter((f) => f !== 'cancelled' || counts.cancelled > 0 || filter === 'cancelled');

  const selected = visible.find((task) => task.id === selectedId) ?? visible[0] ?? null;

  const canCancel = (task: DashboardTask) =>
    task.source !== 'chat' && (task.status === 'running' || task.status === 'queued');

  const sourceOf = (task: DashboardTask) =>
    `${task.source === 'chat' ? 'Chat' : 'API'}${task.key_name ? ` · ${task.key_name}` : ''}`;

  const origin = (task: DashboardTask) =>
    `${task.source === 'chat' ? 'Chat' : 'API'} · ${task.model} · ${t('key')} ${task.key_name}`;

  const ago = (seconds: number) => {
    const s = Math.max(0, now - seconds);
    if (s < 60) return t('vừa xong');
    if (s < 3600) return t('{n} phút trước', { n: Math.floor(s / 60) });
    if (s < 86400) return t('{n} giờ trước', { n: Math.floor(s / 3600) });
    return t('{n} ngày trước', { n: Math.floor(s / 86400) });
  };

  /** Status shown on a tile: a finished-but-short video is flagged instead of "Xong". */
  const tileStatus = (task: DashboardTask) =>
    task.status === 'succeeded' && task.partial
      ? { label: t('Ngắn hơn yêu cầu'), tone: 'warn' }
      : { label: t(PILL[task.status].label), tone: PILL[task.status].tone };

  const tileTag = (task: DashboardTask) => {
    if (task.status === 'running' || task.status === 'queued') return '…';
    if (isVideo(task)) return task.duration_sec ? `${Math.round(task.duration_sec)}s` : null;
    return task.url ? t('Ảnh') : null;
  };

  const placeholder = (task: DashboardTask) =>
    task.status === 'running' || task.status === 'queued'
      ? t('Đang tạo…')
      : task.status === 'failed'
        ? t('Failed')
        : task.status === 'cancelled'
          ? t('Cancelled')
          : isVideo(task) ? t('Video') : t('Ảnh');

  const copyLink = (task: DashboardTask) => {
    if (!task.url) return;
    copyText(new URL(task.url, window.location.origin).href, t('link file'));
  };

  const cancelButton = (task: DashboardTask, small = true) => (
    <button
      type="button"
      className={`acc2-btn${small ? ' small' : ''}`}
      disabled={cancelling === task.id}
      onClick={() => void cancel(task)}
    >
      {t('Cancel')}
    </button>
  );

  return (
    <div className="med">
      <HeaderSlot>
        <div className="med-header">
          <button type="button" className="acc2-icon-btn" aria-label={t('Refresh')} title={t('Refresh')} onClick={() => void load()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
            </svg>
          </button>
          <div className="acc2-segment small" role="group" aria-label={t('Chế độ xem')}>
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={view === v ? 'active' : ''}
                aria-pressed={view === v}
                onClick={() => changeView(v)}
              >
                {v === 'grid' ? t('Lưới') : t('Danh sách')}
              </button>
            ))}
          </div>
        </div>
      </HeaderSlot>

      <div className="med-toolbar">
        <div className="med-chips" role="group" aria-label={t('Status')}>
          {filters.map((f) => (
            <button key={f} type="button" className="med-chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {t(FILTER_LABEL[f])} <span className="med-chip-count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="med-chips" role="group" aria-label={t('Loại')}>
          {KINDS.map((k) => (
            <button key={k} type="button" className="med-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {t(KIND_LABEL[k])}
            </button>
          ))}
        </div>
      </div>

      {loadError && <p className="med-error" role="alert">{t('Could not load tasks.')}</p>}

      {!loaded ? (
        <div className="med-grid" aria-busy="true" aria-label={t('Loading…')}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="med-tile">
              <span className="med-thumb skeleton" />
              <span className="skeleton med-skel-line" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="acc2-card acc2-empty">
          <div className="acc2-empty-title">
            {tasks.length === 0 ? t('Chưa có ảnh hay video nào') : t('Không có mục nào khớp bộ lọc')}
          </div>
          {tasks.length === 0 && (
            <p>{t('Tạo ảnh hoặc video từ tool đã kết nối, hoặc gọi POST /v1/tasks. Trang Kết nối có sẵn ví dụ chạy được.')}</p>
          )}
        </div>
      ) : view === 'grid' ? (
        <div className="med-layout">
          <div className="med-grid">
            {visible.map((task) => {
              const status = tileStatus(task);
              const tag = tileTag(task);
              const isSelected = selected?.id === task.id;
              return (
                <button
                  key={task.id}
                  type="button"
                  className="med-tile"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedId(task.id)}
                >
                  <span className="med-thumb">
                    {task.url ? (
                      <MediaPreview task={task} className="med-thumb-media" />
                    ) : (
                      <span className="med-thumb-empty">{placeholder(task)}</span>
                    )}
                    <span className={`med-badge ${status.tone}`}>{status.label}</span>
                    {tag && <span className="med-tag">{tag}</span>}
                  </span>
                  <span className="med-tile-title" title={task.prompt}>{task.prompt || '—'}</span>
                </button>
              );
            })}
          </div>

          {selected && (
            <aside className="med-detail" aria-label={t('Chi tiết')}>
              <div className="med-detail-preview">
                {selected.url ? (
                  <MediaPreview key={selected.id} task={selected} className="med-detail-media" controls />
                ) : (
                  <span className="med-thumb-empty">{placeholder(selected)}</span>
                )}
              </div>
              <div className="med-detail-body">
                <div className="med-detail-status">
                  <span className={`acc2-pill ${tileStatus(selected).tone}`}>
                    {(selected.status === 'running' || selected.status === 'queued') && <span className="acc2-dot" />}
                    {tileStatus(selected).label}
                  </span>
                  <span className="acc2-muted" title={formatTime(selected.created_at)}>{ago(selected.created_at)}</span>
                </div>
                <p className="med-detail-prompt">{selected.prompt || '—'}</p>
                {selected.error && <p className="med-detail-error">{selected.error}</p>}
                <dl className="med-detail-meta">
                  <dt>{t('Model')}</dt>
                  <dd className="mono">{selected.model}</dd>
                  <dt>{t('Nguồn')}</dt>
                  <dd>{sourceOf(selected)}</dd>
                  <dt>{t('Length')}</dt>
                  <dd>{formatLength(selected)}</dd>
                  {selected.webhook_status && (
                    <>
                      <dt>{t('Webhook')}</dt>
                      <dd>
                        <span className={`acc2-pill ${WEBHOOK[selected.webhook_status].tone}`}>
                          {t(WEBHOOK[selected.webhook_status].label)}
                        </span>
                      </dd>
                    </>
                  )}
                </dl>
                {selected.url && (
                  <div className="med-detail-actions">
                    <a className="acc2-btn primary" href={localMediaUrl(selected.url)} target="_blank" rel="noreferrer">
                      {t('Open file')}
                    </a>
                    <button type="button" className="acc2-btn" onClick={() => copyLink(selected)}>
                      {t('Sao chép link')}
                    </button>
                  </div>
                )}
                {canCancel(selected) && cancelButton(selected, false)}
                {selected.thread_url && (
                  <a className="ov2-link" href={selected.thread_url} target="_blank" rel="noreferrer">
                    {t('Mở thread trên Muse')} →
                  </a>
                )}
              </div>
            </aside>
          )}
        </div>
      ) : (
        <div className="acc2-card acc2-scroll">
          <table className="acc2-table med-table">
            <thead>
              <tr>
                <th>{t('Created')}</th>
                <th>{t('Task')}</th>
                <th>{t('Status')}</th>
                <th>{t('Length')}</th>
                <th>{t('Result')}</th>
                <th>Webhook</th>
                <th><span className="sr-only">{t('Cancel')}</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((task) => {
                const status = PILL[task.status];
                const webhook = task.webhook_status ? WEBHOOK[task.webhook_status] : null;
                return (
                  <tr key={task.id}>
                    <td className="acc2-muted num">{formatTime(task.created_at)}</td>
                    <td className="med-table-task">
                      <div className="med-table-origin">{origin(task)}</div>
                      <div className="med-table-prompt" title={task.prompt}>{task.prompt}</div>
                      {task.error && <div className="med-table-error" title={task.error}>{task.error}</div>}
                    </td>
                    <td>
                      <span className={`acc2-pill ${status.tone}`}>
                        {task.status === 'running' && <span className="acc2-dot" />}
                        {t(status.label)}
                      </span>
                    </td>
                    <td className="num">
                      {formatLength(task)}
                      {task.partial && (
                        <div><span className="acc2-pill warn">{t('Ngắn hơn yêu cầu')}</span></div>
                      )}
                    </td>
                    <td>
                      {task.url ? (
                        <a className="ov2-link" href={localMediaUrl(task.url)} target="_blank" rel="noreferrer">
                          {t('Open file')}
                        </a>
                      ) : (
                        <span className="acc2-muted">—</span>
                      )}
                      {task.thread_url && (
                        <div>
                          <a className="acc2-muted" href={task.thread_url} target="_blank" rel="noreferrer">
                            {t('Muse thread')}
                          </a>
                        </div>
                      )}
                    </td>
                    <td>
                      {webhook ? (
                        <span className={`acc2-pill ${webhook.tone}`}>{t(webhook.label)}</span>
                      ) : (
                        <span className="acc2-muted">—</span>
                      )}
                    </td>
                    <td className="num">{canCancel(task) && cancelButton(task)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
