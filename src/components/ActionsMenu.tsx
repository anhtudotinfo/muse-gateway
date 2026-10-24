'use client';

// Compact "⋯" overflow menu — folds secondary actions into one button so card
// headers don't sprawl. Closes on outside click / Escape / item select.
import React, { useEffect, useRef, useState } from 'react';

export interface ActionItem {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function ActionsMenu({ items, title = 'Thao tác' }: { items: ActionItem[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="apple-tool-btn"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ padding: '6px 10px', fontSize: 15, lineHeight: 1 }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            minWidth: 190,
            background: 'var(--apple-surface, #1c1c22)',
            border: '1px solid var(--apple-border-light, rgba(255,255,255,0.1))',
            borderRadius: 10,
            boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
            padding: 5,
            zIndex: 60,
          }}
        >
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 10px',
                border: 'none',
                borderRadius: 7,
                background: 'transparent',
                color: it.danger ? 'var(--apple-red, #f87171)' : 'var(--text-primary, #e6e6f0)',
                fontSize: 13,
                fontFamily: 'inherit',
                textAlign: 'left',
                cursor: it.disabled ? 'not-allowed' : 'pointer',
                opacity: it.disabled ? 0.45 : 1,
              }}
              onMouseEnter={(e) => {
                if (!it.disabled) e.currentTarget.style.background = 'var(--apple-surface-hover, rgba(255,255,255,0.07))';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
