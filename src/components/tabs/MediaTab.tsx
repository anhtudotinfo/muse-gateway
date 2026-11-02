'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Card from '@/components/endpoint/ui/Card';
import Badge, { type BadgeVariant } from '@/components/endpoint/ui/Badge';
import Button from '@/components/endpoint/ui/Button';
import { useT } from '@/lib/i18n';

export interface DashboardTask {
  id: string;
  source: 'api' | 'chat';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  model: string;
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

export const STATUS: Record<DashboardTask['status'], { label: string; variant: BadgeVariant }> = {
  queued: { label: 'Queued', variant: 'default' },
  running: { label: 'Running', variant: 'info' },
  succeeded: { label: 'Succeeded', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

const WEBHOOK: Record<NonNullable<DashboardTask['webhook_status']>, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pending', variant: 'warning' },
  delivered: { label: 'Delivered', variant: 'success' },
  failed: { label: 'Not delivered', variant: 'error' },
};

const FILTERS = ['all', 'running', 'succeeded', 'failed', 'cancelled'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

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

export function isVideo(task: Pick<DashboardTask, 'url' | 'model'>): boolean {
  if (task.url && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(task.url)) return true;
  if (task.url && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(task.url)) return false;
  return /video/i.test(task.model);
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
 *  shows what was made without opening anything. */
export function MediaPreview({ task, className = '' }: { task: DashboardTask; className?: string }) {
  if (!task.url) return null;
  return isVideo(task) ? (
    <video
      src={localMediaUrl(task.url)}
      className={className}
      muted
      playsInline
      preload="metadata"
      onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})}
      onMouseLeave={(e) => e.currentTarget.pause()}
    />
  ) : (
    <img src={localMediaUrl(task.url)} alt={task.prompt} className={className} loading="lazy" />
  );
}

function matches(task: DashboardTask, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'running') return task.status === 'running' || task.status === 'queued';
  return task.status === filter;
}

export function MediaTab() {
  const { t } = useT();
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [cancelling, setCancelling] = useState<string | null>(null);

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

  const visible = tasks.filter((task) => matches(task, filter));
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f, tasks.filter((task) => matches(task, f)).length]),
  ) as Record<Filter, number>;

  const canCancel = (task: DashboardTask) =>
    task.source !== 'chat' && (task.status === 'running' || task.status === 'queued');

  const origin = (task: DashboardTask) =>
    `${task.source === 'chat' ? 'Chat' : 'API'} · ${task.model} · ${t('key')} ${task.key_name}`;

  return (
    <div className="ep9r flex flex-col gap-6">
      <Card
        title={t('Images & videos')}
        subtitle={t('Image and video jobs from /v1/tasks and from chat requests such as SparkCut. Refreshes every 5 seconds.')}
        icon="photo_library"
        action={
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => void load()}>
            {t('Refresh')}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-surface-2 w-fit">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  filter === f ? 'bg-surface text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'
                }`}
              >
                {t(FILTER_LABEL[f])} <span className="opacity-60 tabular-nums">{counts[f]}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-1 p-1 rounded-lg bg-surface-2" role="group" aria-label={t('View')}>
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => changeView(v)}
                aria-pressed={view === v}
                title={v === 'grid' ? t('Grid') : t('List')}
                className={`px-2 py-1 rounded-md transition-colors ${
                  view === v ? 'bg-surface text-text-main shadow-sm' : 'text-text-muted hover:text-text-main'
                }`}
              >
                <span className="material-symbols-outlined text-[18px] leading-none">
                  {v === 'grid' ? 'grid_view' : 'view_list'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {loadError && (
          <p className="text-sm text-red-400 mb-3">{t('Could not load tasks.')}</p>
        )}

        {!loaded ? (
          <p className="text-sm text-text-muted py-8 text-center">{t('Loading…')}</p>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-text-main">
              {tasks.length === 0 ? t('Nothing made yet') : t('Nothing matches this filter')}
            </p>
            {tasks.length === 0 && (
              <p className="text-xs text-text-muted mt-1">
                {t('Generate an image or video from a connected tool, or call POST /v1/tasks. The Connect page has ready-to-run examples.')}
              </p>
            )}
          </div>
        ) : view === 'grid' ? (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
            {visible.map((task) => {
              const status = STATUS[task.status];
              return (
                <div key={task.id} className="rounded-xl border border-border-subtle bg-surface-2 overflow-hidden flex flex-col">
                  <div className="relative aspect-video overflow-hidden bg-black/40 flex items-center justify-center">
                    {task.url ? (
                      <a href={localMediaUrl(task.url)} target="_blank" rel="noreferrer" className="absolute inset-0">
                        <MediaPreview task={task} className="w-full h-full object-cover" />
                      </a>
                    ) : (
                      <span className="material-symbols-outlined text-[32px] text-text-muted">
                        {task.status === 'running' || task.status === 'queued'
                          ? 'hourglass_top'
                          : task.status === 'failed'
                            ? 'error'
                            : isVideo(task) ? 'movie' : 'image'}
                      </span>
                    )}
                    <div className="absolute top-2 left-2 flex gap-1">
                      <Badge variant={status.variant} size="sm" dot={task.status === 'running'}>
                        {t(status.label)}
                      </Badge>
                      {task.partial && <Badge variant="warning" size="sm">{t('Short')}</Badge>}
                    </div>
                    {isVideo(task) && (task.duration_sec || task.requested_duration_sec) && (
                      <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 text-[11px] text-white tabular-nums">
                        {formatLength(task)}
                      </span>
                    )}
                  </div>
                  <div className="p-3 flex flex-col gap-1 flex-1 min-w-0">
                    <div className="text-xs text-text-main line-clamp-2" title={task.prompt}>
                      {task.prompt}
                    </div>
                    {task.error && (
                      <div className="text-xs text-red-400 line-clamp-2" title={task.error}>
                        {task.error}
                      </div>
                    )}
                    <div className="mt-auto pt-2 flex items-center justify-between gap-2 text-[11px] text-text-muted">
                      <span className="truncate font-mono" title={origin(task)}>
                        {formatTime(task.created_at)} · {task.source === 'chat' ? 'Chat' : 'API'}
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        {task.thread_url && (
                          <a href={task.thread_url} target="_blank" rel="noreferrer" className="hover:underline">
                            {t('Muse thread')}
                          </a>
                        )}
                        {canCancel(task) && (
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={cancelling === task.id}
                            onClick={() => void cancel(task)}
                          >
                            {t('Cancel')}
                          </Button>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-muted border-b border-border-subtle">
                  <th className="py-2 pr-3 font-medium">{t('Created')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Task')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Status')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Length')}</th>
                  <th className="py-2 pr-3 font-medium">{t('Result')}</th>
                  <th className="py-2 pr-3 font-medium">Webhook</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((task) => {
                  const status = STATUS[task.status];
                  const webhook = task.webhook_status ? WEBHOOK[task.webhook_status] : null;
                  return (
                    <tr key={task.id} className="border-b border-border-subtle align-top">
                      <td className="py-2.5 pr-3 text-xs text-text-muted whitespace-nowrap tabular-nums">
                        {formatTime(task.created_at)}
                      </td>
                      <td className="py-2.5 pr-3 max-w-[340px]">
                        <div className="text-xs font-mono text-text-muted">{origin(task)}</div>
                        <div className="text-xs text-text-main truncate" title={task.prompt}>
                          {task.prompt}
                        </div>
                        {task.error && (
                          <div className="text-xs text-red-400 mt-1 line-clamp-2" title={task.error}>
                            {task.error}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <Badge variant={status.variant} size="sm" dot={task.status === 'running'}>
                          {t(status.label)}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-xs tabular-nums">
                        {formatLength(task)}
                        {task.partial && (
                          <div>
                            <Badge variant="warning" size="sm">{t('Short')}</Badge>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap text-xs">
                        {task.url ? (
                          <a href={localMediaUrl(task.url)} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            {t('Open file')}
                          </a>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                        {task.thread_url && (
                          <div>
                            <a href={task.thread_url} target="_blank" rel="noreferrer" className="text-text-muted hover:underline">
                              {t('Muse thread')}
                            </a>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        {webhook ? (
                          <Badge variant={webhook.variant} size="sm">{t(webhook.label)}</Badge>
                        ) : (
                          <span className="text-xs text-text-muted">—</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {canCancel(task) && (
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={cancelling === task.id}
                            onClick={() => void cancel(task)}
                          >
                            {t('Cancel')}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
