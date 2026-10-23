'use client';

import React from 'react';
import type { BrowserDetection } from '@/types';

interface AppleNavbarProps {
  availableBrowsers: BrowserDetection;
}

export function AppleNavbar({ availableBrowsers }: AppleNavbarProps) {
  return (
    <header className="apple-nav">
      <div className="nav-glass-shell">
        <div className="brand-monogram">
          <div className="apple-symbol-badge">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2997ff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div className="brand-headings">
            <span className="brand-name">Muse Session</span>
            <span className="brand-tag">Studio Pro</span>
          </div>
        </div>

        <div className="nav-status-controls">
          <div className="system-status-indicator">
            <span className="pulse-dot"></span>
            <span>Next.js TS Ready</span>
          </div>

          <div className="browser-chips-group">
            <span
              className={`apple-chip ${availableBrowsers.chrome ? 'available' : ''}`}
              title={availableBrowsers.chrome || 'Chưa cài đặt'}
            >
              Chrome
            </span>
            <span
              className={`apple-chip ${availableBrowsers.edge ? 'available' : ''}`}
              title={availableBrowsers.edge || 'Chưa cài đặt'}
            >
              Edge
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
