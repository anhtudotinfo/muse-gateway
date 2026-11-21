'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { type BadgeVariant } from '@/components/endpoint/ui/Badge';
import { HeaderSlot } from '@/components/HeaderSlot';
import { useApp } from '@/components/AppShell';
import { useT } from '@/lib/i18n';
import { speechOf } from '@/lib/speech';

export interface DashboardTask {
  id: string;
  source: 'api' | 'chat' | 'mcp';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  model: string;
  /** What the model promised (combos included); absent from older gateways. */
  kind?: 'chat' | 'image' | 'video' | 'audio';
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
  /** Muse account that served it — "open in the account's browser". */
  account_id?: string | null;
  webhook_status: 'pending' | 'delivered' | 'failed' | null;
  /** Why Retry is unavailable; null when it works. Absent on older gateways. */
  retry_blocker?: string | null;
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

const KINDS = ['all', 'image', 'video', 'audio'] as const;
type Kind = (typeof KINDS)[number];

const KIND_LABEL: Record<Kind, string> = { all: 'Tất cả loại', image: 'Ảnh', video: 'Video', audio: 'Giọng nói' };

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

export function isAudio(task: Pick<DashboardTask, 'url' | 'model' | 'kind'>): boolean {
  if (task.url && /\.(mp3|wav|m4a|ogg)(\?|$)/i.test(task.url)) return true;
  return task.kind === 'audio';
}

export function isVideo(task: Pick<DashboardTask, 'url' | 'model' | 'kind'>): boolean {
  if (isAudio(task)) return false;
  if (task.url && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(task.url)) return true;
  if (task.url && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(task.url)) return false;
  return task.kind ? task.kind === 'video' : /video/i.test(task.model);
}

/** The prompt as the user wrote it: the text read aloud for speech tasks. */
export function displayPrompt(task: Pick<DashboardTask, 'prompt' | 'url' | 'model' | 'kind'>): string {
  return (isAudio(task) && speechOf(task.prompt)?.text) || task.prompt;
}

/** Bar heights (0–1) for a task's waveform: fixed per task, so each card
 *  looks different but never changes between renders. */
function waveHeights(seed: string, bars: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return Array.from({ length: bars }, (_, i) => {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const r = ((h >>> 0) % 1000) / 1000;
    const envelope = Math.sin((Math.PI * (i + 0.5)) / bars);
    return 0.16 + 0.84 * r * (0.4 + 0.6 * envelope);
  });
}

/** Cover for a speech file: waveform and voice name. Decorative; the
 *  player in the detail panel is what plays it. */
export function AudioArt({ task, playing = false, className = '' }: { task: DashboardTask; playing?: boolean; className?: string }) {
  const voice = speechOf(task.prompt)?.voice;
  return (
    <span className={`aud-art${playing ? ' playing' : ''} ${className}`}>
      <span className="aud-icon" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
        </svg>
      </span>
      <span className="aud-wave" aria-hidden="true">
        {waveHeights(task.id, 28).map((height, i) => (
          <i key={i} style={{ height: `${Math.round(height * 100)}%`, animationDelay: `${(i % 7) * 90}ms` }} />
        ))}
      </span>
      {voice && <span className="aud-voice">{voice}</span>}
    </span>
  );
}

function AudioPlayer({ task }: { task: DashboardTask }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="aud-player">
      <AudioArt task={task} playing={playing} />
      <audio
        src={localMediaUrl(task.url!)}
        className="aud-controls"
        controls
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
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
  if (isAudio(task)) {
    return controls ? <AudioPlayer task={task} /> : <AudioArt task={task} className={className} />;
  }
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
  if (kind === 'audio' || isAudio(task)) return isAudio(task) === (kind === 'audio');
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
  const [busy, setBusy] = useState<string | null>(null);
  // Selection mode: tiles toggle a checkbox instead of opening the detail.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
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

  const megabytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`);

  /** Bulk clean-up — 'failed' (failed + cancelled) or 'finished' (all done). */
  const removeMany = async (scope: 'failed' | 'finished', ids: string[]) => {
    const count = ids.length;
    const question =
      scope === 'failed'
        ? t('Xoá {n} mục lỗi và đã huỷ?', { n: count })
        : t('Xoá {n} mục đã xong, lỗi và đã huỷ? File ảnh/video trên máy cũng bị xoá — app nào còn dùng link sẽ không mở được nữa.', { n: count });
    if (!window.confirm(question)) return;
    setBusy(scope);
    try {
      // Exactly the items shown and confirmed — not whatever else the
      // gateway keeps beyond this page.
      const res = await fetch('/api/tasks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNotice(
          data.bytes
            ? t('Đã xoá {n} mục, giải phóng {size}.', { n: data.removed ?? 0, size: megabytes(data.bytes) })
            : t('Đã xoá {n} mục.', { n: data.removed ?? 0 }),
        );
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const removeOne = async (task: DashboardTask) => {
    const question = task.url
      ? t('Xoá mục này và file của nó trên máy?')
      : t('Xoá mục này?');
    if (!window.confirm(question)) return;
    setBusy(task.id);
    try {
      await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const retry = async (task: DashboardTask) => {
    setBusy(task.id);
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/retry`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.task?.id) {
        setFilter('all');
        setSelectedId(data.task.id);
        setNotice(t('Đã gửi lại — mục mới đang chạy.'));
      } else {
        setNotice(data.error || t('Không thử lại được.'));
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const togglePick = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  /** Stream a ZIP of these tasks' files; the browser saves it. */
  const download = (ids: string[]) => {
    if (!ids.length) return;
    const a = document.createElement('a');
    a.href = `/api/tasks/download?ids=${ids.map(encodeURIComponent).join(',')}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setNotice(t('Đang tải {n} file về dạng .zip…', { n: ids.length }));
  };

  /** Open a visible Chrome signed in as the account that ran this task, on
   *  its thread — to see what Muse actually did with the request. */
  const openInAccount = async (task: DashboardTask) => {
    if (!task.account_id) return;
    setBusy(`open:${task.id}`);
    try {
      const res = await fetch('/api/launch-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId: task.account_id, url: task.thread_url || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      setNotice(res.ok ? t('Đã mở trình duyệt của tài khoản tại thread này.') : data.error || t('Không mở được trình duyệt.'));
    } finally {
      setBusy(null);
    }
  };

  const isDone = (task: DashboardTask) =>
    task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled';
  const canRetry = (task: DashboardTask) =>
    (task.status === 'failed' || task.status === 'cancelled') && task.retry_blocker === null;

  // Newest first, whatever order the API hands back.
  const byKind = tasks.filter((task) => matchesKind(task, kind)).sort((a, b) => b.created_at - a.created_at);
  const visible = byKind.filter((task) => matches(task, filter));
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f, byKind.filter((task) => matches(task, f)).length]),
  ) as Record<Filter, number>;
  const failedIds = tasks.filter((task) => task.status === 'failed' || task.status === 'cancelled').map((task) => task.id);
  const finishedIds = tasks.filter(isDone).map((task) => task.id);
  const failedCount = failedIds.length;
  const finishedCount = finishedIds.length;
  // "Đã huỷ" only earns a chip once something was actually cancelled.
  const filters = FILTERS.filter((f) => f !== 'cancelled' || counts.cancelled > 0 || filter === 'cancelled');

  const selected = visible.find((task) => task.id === selectedId) ?? visible[0] ?? null;
  // What "Download" takes: the picked items, else everything shown that has a file.
  const withFiles = visible.filter((task) => !!task.url);
  const pickedIds = visible.filter((task) => picked.has(task.id)).map((task) => task.id);
  const pickedWithFiles = withFiles.filter((task) => picked.has(task.id)).map((task) => task.id);
  const pickedDone = visible.filter((task) => picked.has(task.id) && isDone(task)).map((task) => task.id);

  const canCancel = (task: DashboardTask) =>
    task.source !== 'chat' && (task.status === 'running' || task.status === 'queued');

  const sourceOf = (task: DashboardTask) =>
    `${task.source === 'chat' ? 'Chat' : task.source === 'mcp' ? 'MCP' : 'API'}${task.key_name ? ` · ${task.key_name}` : ''}`;

  const origin = (task: DashboardTask) =>
    `${task.source === 'chat' ? 'Chat' : task.source === 'mcp' ? 'MCP' : 'API'} · ${task.model} · ${t('key')} ${task.key_name}`;

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
    if (isAudio(task)) return task.duration_sec ? `${Math.round(task.duration_sec)}s` : task.url ? t('Giọng nói') : null;
    return task.url ? t('Ảnh') : null;
  };

  const placeholder = (task: DashboardTask) =>
    task.status === 'running' || task.status === 'queued'
      ? t('Đang tạo…')
      : task.status === 'failed'
        ? t('Failed')
        : task.status === 'cancelled'
          ? t('Cancelled')
          : isAudio(task) ? t('Giọng nói') : isVideo(task) ? t('Video') : t('Ảnh');

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
          {selecting ? (
            <>
              <span className="acc2-muted med-picked">{t('Đã chọn {n}', { n: pickedIds.length })}</span>
              <button
                type="button"
                className="acc2-btn small"
                onClick={() => setPicked(new Set(pickedIds.length === visible.length ? [] : visible.map((task) => task.id)))}
              >
                {pickedIds.length === visible.length && visible.length ? t('Bỏ chọn hết') : t('Chọn hết')}
              </button>
              <button
                type="button"
                className="acc2-btn small primary"
                disabled={!pickedWithFiles.length}
                onClick={() => download(pickedWithFiles)}
              >
                {t('Tải xuống')}{pickedWithFiles.length ? ` (${pickedWithFiles.length})` : ''}
              </button>
              <button
                type="button"
                className="acc2-btn small danger"
                disabled={!pickedDone.length || busy !== null}
                onClick={() => void removeMany('finished', pickedDone).then(stopSelecting)}
              >
                {t('Xoá đã chọn')}{pickedDone.length ? ` (${pickedDone.length})` : ''}
              </button>
              <button type="button" className="acc2-btn small" onClick={stopSelecting}>
                {t('Xong')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="acc2-btn small" disabled={!visible.length} onClick={() => setSelecting(true)}>
                {t('Chọn')}
              </button>
              <button
                type="button"
                className="acc2-btn small"
                disabled={!withFiles.length}
                title={t('Tải mọi file đang hiển thị về dạng .zip')}
                onClick={() => download(withFiles.map((task) => task.id))}
              >
                {t('Tải tất cả')}{withFiles.length ? ` (${withFiles.length})` : ''}
              </button>
            </>
          )}
          {!selecting && (
          <>
          <button
            type="button"
            className="acc2-btn small"
            disabled={!failedCount || busy !== null}
            onClick={() => void removeMany('failed', failedIds)}
            title={t('Xoá các mục lỗi và đã huỷ')}
          >
            {t('Xoá mục lỗi')}{failedCount ? ` (${failedCount})` : ''}
          </button>
          <button
            type="button"
            className="acc2-btn small danger"
            disabled={!finishedCount || busy !== null}
            onClick={() => void removeMany('finished', finishedIds)}
            title={t('Xoá mọi mục đã xong, kể cả file trên máy')}
          >
            {t('Xoá tất cả')}
          </button>
          </>
          )}
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
      {notice && (
        <p className="med-notice" role="status">
          {notice}{' '}
          <button type="button" className="ov2-link" onClick={() => setNotice(null)}>{t('Đóng')}</button>
        </p>
      )}

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
            {tasks.length === 0 ? t('Chưa có ảnh, video hay giọng nói nào') : t('Không có mục nào khớp bộ lọc')}
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
                  className={`med-tile${selecting && picked.has(task.id) ? ' picked' : ''}`}
                  aria-pressed={selecting ? picked.has(task.id) : isSelected}
                  onClick={() => (selecting ? togglePick(task.id) : setSelectedId(task.id))}
                >
                  <span className="med-thumb">
                    {selecting && (
                      <span className={`med-check${picked.has(task.id) ? ' on' : ''}`} aria-hidden="true">
                        {picked.has(task.id) ? '✓' : ''}
                      </span>
                    )}
                    {task.url ? (
                      <MediaPreview task={task} className="med-thumb-media" />
                    ) : (
                      <span className="med-thumb-empty">{placeholder(task)}</span>
                    )}
                    <span className={`med-badge ${status.tone}`}>{status.label}</span>
                    {tag && <span className="med-tag">{tag}</span>}
                  </span>
                  <span className="med-tile-title" title={displayPrompt(task)}>{displayPrompt(task) || '—'}</span>
                </button>
              );
            })}
          </div>

          {selected && (
            <aside className="med-detail" aria-label={t('Chi tiết')}>
              <div className={`med-detail-preview${isAudio(selected) && selected.url ? ' audio' : ''}`}>
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
                <p className="med-detail-prompt">{displayPrompt(selected) || '—'}</p>
                {selected.error && <p className="med-detail-error">{selected.error}</p>}
                <dl className="med-detail-meta">
                  <dt>{t('Model')}</dt>
                  <dd className="mono">{selected.model}</dd>
                  <dt>{t('Nguồn')}</dt>
                  <dd>{sourceOf(selected)}</dd>
                  {isAudio(selected) && speechOf(selected.prompt)?.voice && (
                    <>
                      <dt>{t('Giọng')}</dt>
                      <dd>{speechOf(selected.prompt)!.voice}</dd>
                    </>
                  )}
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
                {isDone(selected) && (
                  <div className="med-detail-actions">
                    {(selected.status === 'failed' || selected.status === 'cancelled') && (
                      <button
                        type="button"
                        className="acc2-btn primary"
                        disabled={!canRetry(selected) || busy !== null}
                        title={selected.retry_blocker ? t(selected.retry_blocker) : undefined}
                        onClick={() => void retry(selected)}
                      >
                        {t('Thử lại')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="acc2-btn danger"
                      disabled={busy !== null}
                      onClick={() => void removeOne(selected)}
                    >
                      {t('Xoá')}
                    </button>
                  </div>
                )}
                {(selected.status === 'failed' || selected.status === 'cancelled') && selected.retry_blocker && (
                  <p className="acc2-muted med-detail-note">{t(selected.retry_blocker)}</p>
                )}
                {selected.account_id && (
                  <button
                    type="button"
                    className="acc2-btn"
                    disabled={busy !== null}
                    title={t('Mở Chrome đã đăng nhập đúng tài khoản Muse xử lý tác vụ này, ngay tại thread của nó')}
                    onClick={() => void openInAccount(selected)}
                  >
                    {busy === `open:${selected.id}` ? t('Đang mở…') : t('Mở trong trình duyệt tài khoản')}
                  </button>
                )}
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
                      <div className="med-table-prompt" title={displayPrompt(task)}>{displayPrompt(task)}</div>
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
                    <td className="num med-row-actions">
                      {canCancel(task) && cancelButton(task)}
                      {canRetry(task) && (
                        <button type="button" className="acc2-btn small" disabled={busy !== null} onClick={() => void retry(task)}>
                          {t('Thử lại')}
                        </button>
                      )}
                      {isDone(task) && (
                        <button type="button" className="acc2-btn small danger" disabled={busy !== null} onClick={() => void removeOne(task)}>
                          {t('Xoá')}
                        </button>
                      )}
                    </td>
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
