'use client';

// Compact "⋯" overflow menu — folds secondary actions into one button so card
// headers don't sprawl. Closes on outside click / Escape / item select.
// The menu is portaled to <body> and positioned with fixed coordinates: the
// row/table cards clip absolute children (overflow:hidden), which used to cut
// the menu at the card edge. Flips upward when the bottom space runs out.
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface ActionItem {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const MENU_MAX_H = 320; // enough for the longest action list; used for flip-up
const MENU_W = 190;
const GAP = 6;

export function ActionsMenu({ items, title = 'Thao tác' }: { items: ActionItem[]; title?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Fixed coordinates go stale on scroll/resize — close instead of drifting.
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const spaceBelow = window.innerHeight - r.bottom;
      const up = spaceBelow < MENU_MAX_H && r.top > spaceBelow;
      setPos(
        up
          ? { bottom: window.innerHeight - r.top + GAP, right: window.innerWidth - r.right }
          : { top: r.bottom + GAP, right: window.innerWidth - r.right },
      );
    }
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="apple-tool-btn"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        style={{ padding: '6px 10px', fontSize: 15, lineHeight: 1 }}
      >
        ⋯
      </button>
      {open && pos && mounted &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: 'fixed',
              top: pos.top,
              bottom: pos.bottom,
              right: pos.right,
              minWidth: MENU_W,
              maxHeight: MENU_MAX_H,
              overflowY: 'auto',
              background: 'var(--apple-surface, #1c1c22)',
              border: '1px solid var(--apple-border-light, rgba(255,255,255,0.1))',
              borderRadius: 10,
              boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
              padding: 5,
              zIndex: 300,
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
          </div>,
          document.body,
        )}
    </>
  );
}
