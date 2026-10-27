'use client';

import React, { useEffect, useState } from 'react';
import { ActionsMenu } from '@/components/ActionsMenu';
import { CookieGuideModal } from '@/components/CookieGuideModal';

const GUIDE_SEEN_KEY = 'muse-cookie-guide-dismissed';

interface CookieInputDeckProps {
  cookieInput: string;
  onCookieChange: (value: string) => void;
  parsedMap: Record<string, string>;
  cookieCount: number;
  selectedBrowser: 'chrome' | 'edge';
  onBrowserChange: (browser: 'chrome' | 'edge') => void;
  isLaunching: boolean;
  launchStatus: string;
  onLaunch: () => void;
  onPasteClipboard: () => void;
  onLoadSample: () => void;
  onClear: () => void;
  /** Add every detected cookie block as saved accounts, then auto-test each. */
  onAddAccounts: (blocks: string[]) => void;
  isAdding: boolean;
  /** Open a real browser for the user to sign in — cookies are saved
   * automatically once login lands. Clicking again cancels. */
  onLoginCapture: () => void;
  isCapturing: boolean;
  captureStatus?: string;
}

const WATCH_TOKENS = ['hatch_sess', 'hatch_vml', 'hatch_gw', 'hatch_device', 'datr', 'theme'];

/** Split pasted input into cookie strings — one account per non-empty line,
 *  deduped by hatch_sess so the same cookie pasted twice counts once. */
export function splitCookieBlocks(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter((s) => {
      if (!s.includes('=')) return false;
      const m = s.match(/hatch_sess=([^;]+)/);
      const key = m ? m[1].trim() : s;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function CookieInputDeck({
  cookieInput,
  onCookieChange,
  parsedMap,
  cookieCount,
  selectedBrowser,
  onBrowserChange,
  isLaunching,
  launchStatus,
  onLaunch,
  onPasteClipboard,
  onLoadSample,
  onClear,
  onAddAccounts,
  isAdding,
  onLoginCapture,
  isCapturing,
  captureStatus,
}: CookieInputDeckProps) {
  const tokenKey = (t: string) => (t === 'hatch_device' ? 'hatch_native_auth_device' : t);
  const blocks = splitCookieBlocks(cookieInput);
  const hasInput = blocks.length > 0;
  const [guideOpen, setGuideOpen] = useState(false);

  // Auto-open the guide on first visit — dismissible per-session via Đóng,
  // permanently via "Đã hiểu — không hiện lại" (localStorage flag).
  useEffect(() => {
    try {
      if (!localStorage.getItem(GUIDE_SEEN_KEY)) setGuideOpen(true);
    } catch {}
  }, []);

  const dismissGuideForever = () => {
    try {
      localStorage.setItem(GUIDE_SEEN_KEY, '1');
    } catch {}
    setGuideOpen(false);
  };

  return (
    <section className="apple-card">
      <div className="ov-card-head">
        <div>
          <div className="ov-card-title">Thêm tài khoản</div>
          <div className="ov-card-desc">
            Dán chuỗi cookie Muse — <b>mỗi dòng = 1 tài khoản</b>. Sau khi thêm, hệ thống tự kiểm tra session còn sống không.
          </div>
        </div>
        <div className="card-actions-group">
          <button
            type="button"
            className="apple-tool-btn"
            onClick={() => setGuideOpen(true)}
            title="Hướng dẫn lấy cookie từng bước"
            style={{ padding: '6px 10px' }}
          >
            ?
          </button>
          <button type="button" className="apple-tool-btn" onClick={onPasteClipboard} title="Dán từ Clipboard">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
            Dán
          </button>
          <ActionsMenu
            items={[
              { label: 'Nạp cookie mẫu', onClick: onLoadSample },
              { label: 'Xóa dữ liệu', danger: true, onClick: onClear },
            ]}
          />
        </div>
      </div>

      <textarea
        className="apple-textarea"
        style={{ height: 110 }}
        value={cookieInput}
        onChange={(e) => onCookieChange(e.target.value)}
        placeholder="Dán chuỗi cookie của Muse vào đây — mỗi dòng là 1 tài khoản…&#10;Ví dụ: dpr=1.25; datr=wWDbak…; hatch_sess=97573a9b…"
        spellCheck="false"
      />

      {/* Inline token status strip */}
      <div className="acc-token-strip">
        <span className={`acc-cookie-count ${cookieCount > 0 ? 'ok' : ''}`}>
          {cookieCount} cookies
        </span>
        {blocks.length > 1 && (
          <span className="acc-cookie-count ok" style={{ background: 'var(--apple-purple-dim)', color: 'var(--apple-purple)' }}>
            {blocks.length} tài khoản
          </span>
        )}
        {WATCH_TOKENS.map((t) => (
          <span key={t} className={`token-capsule ${parsedMap[tokenKey(t)] ? 'active' : 'inactive'}`}>{t}</span>
        ))}
      </div>

      {/* Actions row — left: add accounts; right: browser tools */}
      <div className="acc-actions-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn-apple-primary"
          style={{ flex: 'none', padding: '9px 20px' }}
          onClick={() => onAddAccounts(blocks)}
          disabled={isAdding || !hasInput}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>
            {isAdding ? 'Đang thêm…' : `Thêm ${blocks.length > 1 ? `${blocks.length} ` : ''}tài khoản`}
          </span>
        </button>

        <button
          type="button"
          className="apple-tool-btn"
          style={{ padding: '9px 16px' }}
          onClick={onLoginCapture}
          title="Mở trình duyệt thật — bạn tự đăng nhập Muse, session tự lưu lại"
        >
          {isCapturing ? '✕ Hủy đăng nhập' : '🔐 Đăng nhập & lưu'}
        </button>

        <div style={{ flex: 1 }} />

        <span className="ov-card-desc" style={{ fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
          Trình duyệt:
        </span>
        <div className="apple-segmented-control" role="group" aria-label="Chọn trình duyệt">
          <button
            type="button"
            className={`segment-item ${selectedBrowser === 'chrome' ? 'selected' : ''}`}
            onClick={() => onBrowserChange('chrome')}
          >
            Chrome
          </button>
          <button
            type="button"
            className={`segment-item ${selectedBrowser === 'edge' ? 'selected' : ''}`}
            onClick={() => onBrowserChange('edge')}
          >
            Edge
          </button>
        </div>
        <button
          type="button"
          className="apple-tool-btn"
          style={{ padding: '9px 14px' }}
          onClick={onLaunch}
          disabled={isLaunching || !hasInput}
          title="Mở trình duyệt với cookie đang dán (không lưu)"
        >
          {isLaunching ? 'Đang mở…' : '▶ Mở'}
        </button>
      </div>

      {launchStatus && isLaunching && (
        <div className="ov-card-desc" style={{ marginTop: 8 }}>{launchStatus}</div>
      )}

      {isCapturing && (
        <div className="ov-card-desc" style={{ marginTop: 8 }}>
          {captureStatus || 'Trình duyệt đang mở — đăng nhập Muse trong cửa sổ đó, session sẽ tự lưu khi vào được trang chủ…'}
        </div>
      )}

      <CookieGuideModal
        isOpen={guideOpen}
        onClose={() => setGuideOpen(false)}
        onNeverShow={dismissGuideForever}
      />
    </section>
  );
}
