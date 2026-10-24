'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';

interface LogLine {
  ts: number;
  level: 'log' | 'warn' | 'error';
  text: string;
}

const LEVEL_COLOR: Record<LogLine['level'], string> = {
  log: '#b3b0d4',
  warn: '#ffa657',
  error: '#ff7b72',
};

const FILTERS: { key: LogLine['level'] | 'all'; label: string }[] = [
  { key: 'all', label: 'Tất cả' },
  { key: 'log', label: 'Log' },
  { key: 'warn', label: 'Warn' },
  { key: 'error', label: 'Error' },
];

export function ConsoleLogTab() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState<'all' | LogLine['level']>('all');
  const [paused, setPaused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/logs');
      const data = await res.json();
      setLines(data.lines || []);
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      if (!paused) refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [refresh, paused]);

  useEffect(() => {
    const el = boxRef.current;
    if (el && stickBottom.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const clear = async () => {
    await fetch('/api/logs', { method: 'DELETE' });
    setLines([]);
  };

  const visible = filter === 'all' ? lines : lines.filter((l) => l.level === filter);

  return (
    <div className="tab-surface">
      <div className="tab-top-caption">
        <span className="caption-text">Log từ driver/pool — tự cập nhật mỗi 3s. Cuộn lên để tạm dừng theo dõi.</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="apple-segmented-control" role="group" aria-label="Lọc level">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`segment-item ${filter === f.key ? 'selected' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`apple-tool-btn ${paused ? '' : 'active'}`}
            onClick={() => setPaused((p) => !p)}
            title={paused ? 'Tiếp tục cập nhật' : 'Tạm dừng cập nhật'}
          >
            {paused ? '▶ Tiếp' : '⏸ Tạm dừng'}
          </button>
          <button type="button" className="apple-tool-btn" onClick={refresh}>
            Làm mới
          </button>
          <button type="button" className="apple-tool-btn danger" onClick={clear}>
            Xóa log
          </button>
        </div>
      </div>

      <div
        ref={boxRef}
        onScroll={onScroll}
        className="playground-terminal"
        style={{ maxHeight: 460, overflowY: 'auto', fontSize: 12, lineHeight: 1.6 }}
      >
        {visible.length === 0 ? (
          <div style={{ color: '#6e6a92', padding: 12 }}>
            {lines.length === 0
              ? 'Chưa có log — log [MuseDriver]/[MusePool]/[API] sẽ hiện ở đây khi có request.'
              : `Không có dòng level "${filter}".`}
          </div>
        ) : (
          visible.map((l, i) => (
            <div
              key={`${l.ts}-${i}`}
              style={{ color: LEVEL_COLOR[l.level], whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
            >
              <span style={{ color: '#6e6a92' }}>
                {new Date(l.ts).toLocaleTimeString('vi-VN')}{' '}
              </span>
              {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
