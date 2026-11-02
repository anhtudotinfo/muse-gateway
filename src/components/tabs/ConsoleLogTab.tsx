'use client';

// Nhật ký tab — driver/pool log lines from /api/logs, polled every 3s.
// Level filter + client-side search; auto-scroll follows new lines until the
// user scrolls up, and resumes once they scroll back to the bottom.

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useT } from '@/lib/i18n';

interface LogLine {
  ts: number;
  level: 'log' | 'warn' | 'error';
  text: string;
}

type Filter = 'all' | LogLine['level'];

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'log', label: 'Log' },
  { key: 'warn', label: 'Cảnh báo' },
  { key: 'error', label: 'Lỗi' },
];

// "[MusePool] route → …" → source "MusePool", message "route → …".
function splitSource(text: string): { source: string; message: string } {
  const m = /^\[([^\]]+)\]\s*/.exec(text);
  return m ? { source: m[1], message: text.slice(m[0].length) } : { source: '', message: text };
}

export function ConsoleLogTab() {
  const { t } = useT();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [paused, setPaused] = useState(false);
  const [following, setFollowing] = useState(true);
  const boxRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      setLines(data.lines || []);
    } catch {
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (!paused) refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [refresh, paused]);

  useEffect(() => {
    const el = boxRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines, filter, query]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setFollowing(stickBottom.current);
  };

  const jumpToLatest = () => {
    const el = boxRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickBottom.current = true;
    setFollowing(true);
  };

  const clear = async () => {
    if (!confirm(t('Xoá toàn bộ log hiện có?'))) return;
    await fetch('/api/logs', { method: 'DELETE' });
    setLines([]);
  };

  // Search first, so the level counts match what each filter will show.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? lines.filter((l) => l.text.toLowerCase().includes(q)) : lines;
  }, [lines, query]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: searched.length, log: 0, warn: 0, error: 0 };
    for (const l of searched) c[l.level]++;
    return c;
  }, [searched]);

  const visible = filter === 'all' ? searched : searched.filter((l) => l.level === filter);

  return (
    <div className="act">
      <div className="act-toolbar">
        <div className="acc2-segment small act-level" role="group" aria-label={t('Mức log')}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={filter === f.key ? 'active' : ''}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {t(f.label)}
              <span className="act-count">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <label className="act-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <span className="sr-only">{t('Tìm trong log')}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Tìm trong log (tài khoản, thread, lỗi…)')}
          />
        </label>
        <button
          type="button"
          className="acc2-btn"
          aria-pressed={paused}
          onClick={() => setPaused((p) => !p)}
          title={paused ? t('Tiếp tục cập nhật') : t('Tạm dừng cập nhật')}
        >
          {paused ? t('Tiếp tục') : t('Tạm dừng')}
        </button>
        <button type="button" className="acc2-btn act-danger" onClick={clear} disabled={lines.length === 0}>
          {t('Xoá log')}
        </button>
      </div>

      <section className="act-console" aria-label={t('Log')}>
        <div className="act-console-bar">
          <span className="act-live" aria-live="polite">
            <span className={`act-live-dot ${paused ? 'paused' : ''}`} />
            {paused ? t('Đã tạm dừng cập nhật') : t('Đang theo dõi · cập nhật mỗi 3 giây')}
          </span>
          {following ? (
            <span>{t('Cuộn lên để tạm dừng')}</span>
          ) : (
            <button type="button" className="act-jump" onClick={jumpToLatest}>
              {t('Về dòng mới nhất')} ↓
            </button>
          )}
        </div>

        <div ref={boxRef} onScroll={onScroll} className="act-lines">
          {visible.length === 0 ? (
            <div className="act-console-empty">
              {!loaded
                ? t('Đang tải…')
                : lines.length === 0
                  ? t('Chưa có log — log [MuseDriver]/[MusePool]/[API] sẽ hiện ở đây khi có request.')
                  : t('Không có dòng nào khớp bộ lọc.')}
            </div>
          ) : (
            visible.map((l, i) => {
              const { source, message } = splitSource(l.text);
              return (
                <div key={`${l.ts}-${i}`} className={`act-line ${l.level}`}>
                  <span className="act-line-time">{new Date(l.ts).toLocaleTimeString('vi-VN', { hour12: false })}</span>
                  <span className="act-line-level">{l.level}</span>
                  <span className="act-line-src" title={source}>{source ? `[${source}]` : ''}</span>
                  <span className="act-line-text">{message}</span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
