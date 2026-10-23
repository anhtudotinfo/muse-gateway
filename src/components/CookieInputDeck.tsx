'use client';

import React from 'react';
import type { SessionTestResult } from '@/types';

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
  isTesting: boolean;
  onTestSession: () => void;
  testResult: SessionTestResult | null;
  onCloseTestResult: () => void;
  onPasteClipboard: () => void;
  onLoadSample: () => void;
  onClear: () => void;
  onOpenSaveModal: () => void;
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
  isTesting,
  onTestSession,
  testResult,
  onCloseTestResult,
  onPasteClipboard,
  onLoadSample,
  onClear,
  onOpenSaveModal,
}: CookieInputDeckProps) {
  return (
    <section className="apple-card">
      <div className="card-top-row">
        <div className="card-title-group">
          <h2 className="card-headline">Phiên Đăng Nhập Muse</h2>
          <p className="card-subhead">Dán chuỗi cookie để khởi chạy hoặc kiểm tra kết nối máy ảo</p>
        </div>
        <div className="card-actions-group">
          <button type="button" className="apple-tool-btn" onClick={onPasteClipboard} title="Dán từ Clipboard">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
            </svg>
            Dán
          </button>
          <button type="button" className="apple-tool-btn" onClick={onLoadSample} title="Nạp Cookie Mẫu">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Mẫu
          </button>
          <button type="button" className="apple-tool-btn danger" onClick={onClear} title="Xóa dữ liệu">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Xóa
          </button>
        </div>
      </div>

      {/* Frosted Textarea */}
      <div className="apple-input-container">
        <textarea
          className="apple-textarea"
          value={cookieInput}
          onChange={(e) => onCookieChange(e.target.value)}
          placeholder="Dán chuỗi cookie của Muse vào đây...&#10;Ví dụ: dpr=1.25; datr=wWDbak...; hatch_sess=97573a9b...; hatch_vml=v1%3A...;"
          spellCheck="false"
        />
      </div>

      {/* Token Identification Matrix */}
      <div className="apple-token-matrix">
        <div className="token-matrix-header">
          <span className="matrix-label">Trạng Thái Token</span>
          <span className="matrix-count">{cookieCount} cookies</span>
        </div>
        <div className="token-capsules">
          <span className={`token-capsule ${parsedMap['hatch_sess'] ? 'active' : 'inactive'}`}>hatch_sess</span>
          <span className={`token-capsule ${parsedMap['hatch_vml'] ? 'active' : 'inactive'}`}>hatch_vml</span>
          <span className={`token-capsule ${parsedMap['hatch_gw'] ? 'active' : 'inactive'}`}>hatch_gw</span>
          <span className={`token-capsule ${parsedMap['hatch_native_auth_device'] ? 'active' : 'inactive'}`}>
            hatch_device
          </span>
          <span className={`token-capsule ${parsedMap['datr'] ? 'active' : 'inactive'}`}>datr</span>
          <span className={`token-capsule ${parsedMap['theme'] ? 'active' : 'inactive'}`}>theme</span>
        </div>
      </div>

      {/* Launch & Control Deck */}
      <div className="apple-actions-stack">
        <div className="primary-launch-deck">
          <button
            type="button"
            className="btn-apple-primary"
            onClick={onLaunch}
            disabled={isLaunching}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <div className="launch-label">
              <strong>Mở Muse Web Ngay</strong>
              <small>{launchStatus}</small>
            </div>
          </button>

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
        </div>

        <div className="secondary-deck">
          <button
            type="button"
            className="btn-apple-secondary"
            onClick={onTestSession}
            disabled={isTesting}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            {isTesting ? 'Đang Kiểm Tra...' : 'Kiểm Tra Trạng Thái VM'}
          </button>

          <button type="button" className="btn-apple-secondary" onClick={onOpenSaveModal}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            Lưu Vào Hồ Sơ
          </button>
        </div>
      </div>

      {/* Test Result Sheet */}
      {testResult && (
        <div className={`apple-result-sheet ${testResult.valid ? 'valid' : 'invalid'}`}>
          <div className="result-sheet-header">
            <div className="result-title-badge">
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  backgroundColor: testResult.valid ? 'var(--apple-green)' : 'var(--apple-red)',
                }}
              ></span>
              <span>
                {testResult.valid
                  ? `Session Hợp Lệ (Trạng Thái: ${testResult.data?.vm_state || 'RUNNING'})`
                  : 'Session Không Hợp Lệ Hoặc Hết Hạn'}
              </span>
            </div>
            <button type="button" className="btn-sheet-close" onClick={onCloseTestResult}>
              &times;
            </button>
          </div>

          {testResult.valid && testResult.data ? (
            <div className="apple-stats-row">
              <div className="apple-stat-cell">
                <div className="stat-cell-title">Trạng thái VM</div>
                <div className="stat-cell-value running">{testResult.data.vm_state || 'RUNNING'}</div>
              </div>
              <div className="apple-stat-cell">
                <div className="stat-cell-title">Mã VM ID</div>
                <div className="stat-cell-value" title={testResult.data.vm_id}>
                  {(testResult.data.vm_id || '').slice(0, 14)}...
                </div>
              </div>
              <div className="apple-stat-cell">
                <div className="stat-cell-title">Phân bổ</div>
                <div className="stat-cell-value">{testResult.data.status || 'assigned'}</div>
              </div>
              <div className="apple-stat-cell">
                <div className="stat-cell-title">Endpoint WS</div>
                <div className="stat-cell-value" title={testResult.data.endpoint_url}>
                  metaaivm.com
                </div>
              </div>
            </div>
          ) : (
            <p style={{ fontSize: '0.8rem', color: '#ff8077', marginTop: 4 }}>
              {testResult.message || 'Không thể xác thực cookie với máy chủ muse.ai.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
