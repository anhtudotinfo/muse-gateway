'use client';

import React from 'react';

interface BookmarkletTabProps {
  bookmarkletHref: string;
  consoleScript: string;
  onCopyConsoleCode: () => void;
}

export function BookmarkletTab({
  bookmarkletHref,
  consoleScript,
  onCopyConsoleCode,
}: BookmarkletTabProps) {
  return (
    <div className="tab-surface">
      <div className="apple-guide-box">
        <span className="guide-pill-indicator">Tiện Ích 1-Click</span>
        <h3 className="guide-heading">Sử Dụng Bookmarklet Cho Muse.ai</h3>
        <ol className="apple-step-list">
          <li>
            Kéo nút bên dưới lên <strong>Thanh Dấu Trang (Bookmark Bar)</strong> của trình duyệt (Nhấn{' '}
            <code>Ctrl+Shift+B</code> để bật thanh bookmark).
          </li>
          <li>
            Mở tab{' '}
            <a href="https://muse.ai" target="_blank" rel="noopener noreferrer">
              https://muse.ai
            </a>{' '}
            trong trình duyệt.
          </li>
          <li>Bấm vào Bookmark vừa lưu &mdash; Cookies sẽ được inject và trang tự reload vào tài khoản!</li>
        </ol>

        <div className="bookmarklet-drop-zone">
          <p className="drop-prompt">KÉO NÚT NÀY LÊN THANH BOOKMARK</p>
          <a href={bookmarkletHref} className="bookmarklet-pill-link" onClick={(e) => e.preventDefault()}>
            ⚡ Đăng Nhập Muse (1-Click)
          </a>
        </div>

        <div className="clean-code-shell">
          <div className="code-header-bar">
            <span>DevTools Console Snippet (F12)</span>
            <button type="button" className="apple-tool-btn" onClick={onCopyConsoleCode}>
              Sao Chép Mã
            </button>
          </div>
          <pre className="code-view-area">
            <code>{consoleScript}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
