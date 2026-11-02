'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Card from '@/components/endpoint/ui/Card';
import Badge, { type BadgeVariant } from '@/components/endpoint/ui/Badge';
import Button from '@/components/endpoint/ui/Button';
import { useT } from '@/lib/i18n';

interface DashboardTask {
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

const STATUS: Record<DashboardTask['status'], { label: string; variant: BadgeVariant }> = {
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

export function TasksTab() {
  const { t } = useT();
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [cancelling, setCancelling] = useState<string | null>(null);

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

  const visible = tasks.filter((task) =>
    filter === 'all' ? true : filter === 'running' ? task.status === 'running' || task.status === 'queued' : task.status === filter,
  );
  const counts = Object.fromEntries(
    FILTERS.map((f) => [
      f,
      f === 'all'
        ? tasks.length
        : tasks.filter((task) => (f === 'running' ? task.status === 'running' || task.status === 'queued' : task.status === f)).length,
    ]),
  ) as Record<Filter, number>;

  return (
    <div className="ep9r flex flex-col gap-6">
      <Card
        title={t('Tasks')}
        subtitle={t('Image and video jobs from /v1/tasks and from chat requests such as SparkCut. Refreshes every 5 seconds.')}
        icon="task_alt"
        action={
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => void load()}>
            {t('Refresh')}
          </Button>
        }
      >
        <div className="flex flex-wrap gap-1 p-1 rounded-lg bg-surface-2 w-fit mb-4">
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

        {loadError && (
          <p className="text-sm text-red-400 mb-3">{t('Could not load tasks.')}</p>
        )}

        {!loaded ? (
          <p className="text-sm text-text-muted py-8 text-center">{t('Loading…')}</p>
        ) : visible.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-text-main">{t('No tasks yet')}</p>
            <p className="text-xs text-text-muted mt-1">
              {t('Generate an image or video from a connected tool, or call POST /v1/tasks. API Docs on the Overview page has ready-to-run examples.')}
            </p>
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
                        <div className="text-xs font-mono text-text-muted">
                          {task.source === 'chat' ? 'Chat' : 'API'} · {task.model} · {t('key')} {task.key_name}
                        </div>
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
                          <a href={task.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
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
                        {task.source !== 'chat' && (task.status === 'running' || task.status === 'queued') && (
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
