'use client';

import React, { useState } from 'react';
import Modal from '@/components/endpoint/ui/Modal';
import { CookieGuideModal } from '@/components/CookieGuideModal';

const GUIDE_SEEN_KEY = 'muse-cookie-guide-dismissed';

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

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  cookieInput: string;
  onCookieChange: (value: string) => void;
  onAddAccounts: (blocks: string[]) => void;
  isAdding: boolean;
  selectedBrowser: 'chrome' | 'edge';
  onBrowserChange: (browser: 'chrome' | 'edge') => void;
  /** Opens a real browser to sign in; calling it again cancels. */
  onLoginCapture: () => void;
  isCapturing: boolean;
  captureStatus?: string;
}

export function AddAccountModal({
  isOpen,
  onClose,
  cookieInput,
  onCookieChange,
  onAddAccounts,
  isAdding,
  selectedBrowser,
  onBrowserChange,
  onLoginCapture,
  isCapturing,
  captureStatus,
}: AddAccountModalProps) {
  const [method, setMethod] = useState<'browser' | 'cookie'>('browser');
  const [guideOpen, setGuideOpen] = useState(false);
  const blocks = splitCookieBlocks(cookieInput);
  const valid = blocks.filter((b) => /hatch_sess=/.test(b)).length;
  const missing = blocks.length - valid;

  const footer =
    method === 'browser' ? (
      <>
        <button type="button" className="acc2-btn" onClick={onClose}>Huỷ</button>
        <button type="button" className={`acc2-btn ${isCapturing ? '' : 'primary'}`} onClick={onLoginCapture}>
          {isCapturing ? 'Huỷ đăng nhập' : 'Mở trình duyệt để đăng nhập'}
        </button>
      </>
    ) : (
      <>
        <button type="button" className="acc2-btn" onClick={onClose}>Huỷ</button>
        <button
          type="button"
          className="acc2-btn primary"
          disabled={!blocks.length || isAdding}
          onClick={() => onAddAccounts(blocks)}
        >
          {isAdding ? 'Đang thêm…' : blocks.length ? `Thêm ${blocks.length} tài khoản` : 'Thêm tài khoản'}
        </button>
      </>
    );

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Thêm tài khoản Muse" size="lg" footer={footer}>
        <div className="acc2-modal">
          <p className="acc2-modal-lead">Tài khoản mới được kiểm tra session rồi vào pool ngay.</p>

          <div className="acc2-segment" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={method === 'browser'}
              className={method === 'browser' ? 'active' : ''}
              onClick={() => setMethod('browser')}
            >
              Đăng nhập bằng trình duyệt
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === 'cookie'}
              className={method === 'cookie' ? 'active' : ''}
              onClick={() => setMethod('cookie')}
            >
              Dán cookie
            </button>
          </div>

          {method === 'browser' ? (
            <div className="acc2-modal-body">
              <ol className="acc2-steps">
                <li>Một cửa sổ trình duyệt riêng mở trang Muse.</li>
                <li>Bạn đăng nhập như bình thường.</li>
                <li>Vào được trang chủ là session tự lưu, cửa sổ tự đóng.</li>
              </ol>
              <div className="acc2-row-between">
                <span className="acc2-muted">Trình duyệt</span>
                <div className="acc2-segment small" role="group" aria-label="Trình duyệt">
                  {(['chrome', 'edge'] as const).map((b) => (
                    <button
                      key={b}
                      type="button"
                      aria-pressed={selectedBrowser === b}
                      className={selectedBrowser === b ? 'active' : ''}
                      disabled={isCapturing}
                      onClick={() => onBrowserChange(b)}
                    >
                      {b === 'chrome' ? 'Chrome' : 'Edge'}
                    </button>
                  ))}
                </div>
              </div>
              {isCapturing && (
                <div className="acc2-notice" role="status">
                  <span className="acc2-spinner" aria-hidden="true" />
                  {captureStatus || 'Trình duyệt đang mở — đăng nhập Muse trong cửa sổ đó.'}
                </div>
              )}
            </div>
          ) : (
            <div className="acc2-modal-body">
              <label htmlFor="acc2-cookie" className="acc2-muted">Chuỗi cookie Muse — mỗi dòng một tài khoản</label>
              <textarea
                id="acc2-cookie"
                className="acc2-textarea"
                rows={5}
                spellCheck={false}
                placeholder="hatch_sess=…; hatch_gw=…; datr=…"
                value={cookieInput}
                onChange={(e) => onCookieChange(e.target.value)}
              />
              <div className="acc2-row-between">
                <span className="acc2-muted">
                  {!blocks.length ? (
                    'Chưa có cookie nào.'
                  ) : (
                    <>
                      <span className="acc2-pill ok"><span className="acc2-dot" />{valid} tài khoản hợp lệ</span>
                      {missing > 0 && <span className="acc2-pill warn">{missing} dòng thiếu hatch_sess</span>}
                    </>
                  )}
                </span>
                <button type="button" className="acc2-link" onClick={() => setGuideOpen(true)}>Cách lấy cookie</button>
              </div>
            </div>
          )}
        </div>
      </Modal>
      <CookieGuideModal
        isOpen={guideOpen}
        onClose={() => setGuideOpen(false)}
        onNeverShow={() => {
          try { localStorage.setItem(GUIDE_SEEN_KEY, '1'); } catch {}
          setGuideOpen(false);
        }}
      />
    </>
  );
}
