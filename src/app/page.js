'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';

const ROLES_MAP = {
  'hatch_sess': 'Phiên đăng nhập chính (Session Token)',
  'hatch_vml': 'Quyền truy cập Virtual Machine (VM Lease)',
  'hatch_gw': 'Cổng định tuyến WebSocket tới hạ tầng VM',
  'hatch_native_auth_device': 'Định danh phần cứng thiết bị an toàn',
  'hatch_native_auth_temp': 'Token xác thực tạm thời Meta AI',
  '__Host-hatch_one_tap': 'Bảo vệ xác thực One-Tap chống CSRF',
  'datr': 'Mã định danh trình duyệt đáng tin cậy Meta',
  'theme': 'Cấu hình giao diện Chat cá nhân hóa',
  'dpr': 'Mật độ điểm ảnh màn hình (Device Pixel Ratio)',
  'wd': 'Kích thước cửa sổ trình duyệt (Window Dimensions)',
  'ps_l': 'Partitioned State Security Level của Meta',
  'ps_n': 'Partitioned State Nonce của Meta',
};

export default function MuseAppleApp() {
  const [cookieInput, setCookieInput] = useState('');
  const [selectedBrowser, setSelectedBrowser] = useState('chrome');
  const [availableBrowsers, setAvailableBrowsers] = useState({ chrome: null, edge: null });
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState('Tự động nạp Cookie vào Chrome/Edge');

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const [activeTab, setActiveTab] = useState('profiles');
  const [profiles, setProfiles] = useState([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [modalProfileName, setModalProfileName] = useState('');

  const [toasts, setToasts] = useState([]);

  // Toast notification (Apple Dynamic Island Style)
  const showToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  // Parse cookies from input
  const parsedMap = useMemo(() => {
    if (!cookieInput || typeof cookieInput !== 'string') return {};
    const cleaned = cookieInput.replace(/^Cookie:\s*/i, '').trim();
    const map = {};
    const pairs = cleaned.split(';').map((s) => s.trim()).filter(Boolean);
    for (const p of pairs) {
      const idx = p.indexOf('=');
      if (idx !== -1) {
        const k = p.slice(0, idx).trim();
        const v = p.slice(idx + 1).trim();
        if (k) map[k] = v;
      }
    }
    return map;
  }, [cookieInput]);

  const parsedEntries = useMemo(() => Object.entries(parsedMap), [parsedMap]);
  const cookieCount = parsedEntries.length;

  // Generate Bookmarklet & Console Code
  const { bookmarkletHref, consoleScript } = useMemo(() => {
    if (parsedEntries.length === 0) {
      return {
        bookmarkletHref: '#',
        consoleScript: '// Dán cookie vào ô bên trái để tự động tạo mã...',
      };
    }

    const jsLines = parsedEntries.map(([k, v]) => {
      return `document.cookie = "${encodeURIComponent(k)}=${encodeURIComponent(v)}; domain=.muse.ai; path=/; max-age=31536000; SameSite=Lax; Secure";`;
    });

    const script = `(function(){
  if (!location.hostname.includes('muse.ai')) {
    alert('Vui lòng mở trang https://muse.ai trước khi nhấn Bookmarklet!');
    location.href = 'https://muse.ai';
    return;
  }
  ${jsLines.join('\n  ')}
  alert('Đã nạp ${parsedEntries.length} cookies của Muse thành công! Trang đang tải lại...');
  location.reload();
})();`;

    const bookmarkletHref = 'javascript:' + encodeURIComponent(script.replace(/\n\s*/g, ' '));
    return { bookmarkletHref, consoleScript: script };
  }, [parsedEntries]);

  // Load profiles from backend
  const loadProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setProfiles(Array.isArray(data) ? data : []);
      return data;
    } catch (e) {
      console.error(e);
      return [];
    }
  }, []);

  useEffect(() => {
    fetch('/api/browsers')
      .then((r) => r.json())
      .then((b) => setAvailableBrowsers(b))
      .catch((err) => console.warn(err));

    loadProfiles().then((list) => {
      if (list && list.length > 0 && !cookieInput) {
        setCookieInput(list[0].cookies);
      }
    });
  }, [loadProfiles]);

  // Actions
  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setCookieInput(text);
        showToast('Đã dán từ clipboard', 'success');
      } else {
        showToast('Clipboard trống', 'error');
      }
    } catch (err) {
      showToast('Vui lòng cấp quyền clipboard hoặc bấm Ctrl+V', 'error');
    }
  };

  const handleLoadSample = () => {
    if (profiles.length > 0) {
      setCookieInput(profiles[0].cookies);
      showToast(`Đã nạp: ${profiles[0].name}`, 'success');
    } else {
      showToast('Chưa có session mẫu', 'error');
    }
  };

  const handleClear = () => {
    setCookieInput('');
    setTestResult(null);
    showToast('Đã xóa dữ liệu', 'info');
  };

  // Launch browser action
  const handleLaunchBrowser = async () => {
    const raw = cookieInput.trim();
    if (!raw) {
      showToast('Vui lòng dán cookie trước khi mở trình duyệt', 'error');
      return;
    }

    setIsLaunching(true);
    setLaunchStatus('Đang mở trình duyệt & nạp session...');

    try {
      const res = await fetch('/api/launch-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: raw, browserType: selectedBrowser }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        showToast(`Đã mở thành công trên ${selectedBrowser === 'chrome' ? 'Chrome' : 'Edge'}`, 'success');
        setLaunchStatus('Đã mở thành công. Muse sẵn sàng.');
      } else {
        showToast(data.error || 'Lỗi khởi chạy trình duyệt', 'error');
        setLaunchStatus('Tự động nạp Cookie vào Chrome/Edge');
      }
    } catch (err) {
      showToast('Lỗi kết nối tới máy chủ khởi chạy: ' + err.message, 'error');
      setLaunchStatus('Tự động nạp Cookie vào Chrome/Edge');
    } finally {
      setTimeout(() => {
        setIsLaunching(false);
        setLaunchStatus(`Tự động nạp Cookie vào ${selectedBrowser === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'}`);
      }, 3000);
    }
  };

  // Test session online
  const handleTestSession = async () => {
    const raw = cookieInput.trim();
    if (!raw) {
      showToast('Vui lòng dán cookie để kiểm tra', 'error');
      return;
    }

    setIsTesting(true);

    try {
      const res = await fetch('/api/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: raw }),
      });

      const result = await res.json();
      setTestResult(result);

      if (result.valid) {
        showToast('Session hợp lệ. Máy ảo đang RUNNING', 'success');
      } else {
        showToast(result.message || 'Session không hợp lệ hoặc đã hết hạn', 'error');
      }
    } catch (e) {
      showToast('Lỗi kiểm tra session: ' + e.message, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  // Profile save
  const handleOpenSaveModal = () => {
    if (!cookieInput.trim()) {
      showToast('Vui lòng nhập cookie trước khi lưu', 'error');
      return;
    }
    setModalProfileName(`Tài khoản ${profiles.length + 1}`);
    setSaveModalOpen(true);
  };

  const handleConfirmSave = async () => {
    const name = modalProfileName.trim();
    const raw = cookieInput.trim();
    if (!name) {
      showToast('Vui lòng nhập tên tài khoản', 'error');
      return;
    }

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cookies: raw }),
      });

      if (res.ok) {
        showToast(`Đã lưu "${name}"`, 'success');
        setSaveModalOpen(false);
        loadProfiles();
      } else {
        showToast('Lỗi khi lưu hồ sơ', 'error');
      }
    } catch (e) {
      showToast('Lỗi mạng khi lưu: ' + e.message, 'error');
    }
  };

  const handleDeleteProfile = async (id, name) => {
    if (confirm(`Bạn có chắc muốn xóa hồ sơ "${name}" không?`)) {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      showToast('Đã xóa hồ sơ', 'info');
      loadProfiles();
    }
  };

  const handleUseProfile = (profile) => {
    setCookieInput(profile.cookies);
    showToast(`Đã nạp hồ sơ: "${profile.name}"`, 'success');
  };

  const handleCopyConsoleCode = () => {
    navigator.clipboard.writeText(consoleScript).then(() => {
      showToast('Đã sao chép mã DevTools Snippet', 'success');
    });
  };

  const handleCopyExtensionPath = () => {
    const p = 'd:\\Workspace\\04_Tools-Agents\\muse\\extension';
    navigator.clipboard.writeText(p).then(() => {
      showToast('Đã sao chép đường dẫn extension', 'success');
    });
  };

  const handleCopyText = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`Đã sao chép ${label}`, 'success');
    });
  };

  // API Desktop Gateway Playground State & Handler
  const [apiPrompt, setApiPrompt] = useState('Xin chào! Hãy giới thiệu bạn là ai và hỗ trợ được những gì?');
  const [apiResponse, setApiResponse] = useState('');
  const [isTestingApi, setIsTestingApi] = useState(false);
  const [apiModel, setApiModel] = useState('muse-chat');
  const [apiStream, setApiStream] = useState(true);

  const handleRunApiTest = async () => {
    if (!apiPrompt.trim()) {
      showToast('Vui lòng nhập câu hỏi thử nghiệm', 'error');
      return;
    }

    setIsTestingApi(true);
    setApiResponse('');

    try {
      const response = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk-muse-session',
        },
        body: JSON.stringify({
          model: apiModel,
          messages: [{ role: 'user', content: apiPrompt }],
          stream: apiStream,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP ${response.status}`);
      }

      if (apiStream && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let fullText = '';
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const dataStr = trimmed.slice(6);
              if (dataStr === '[DONE]') {
                break;
              }
              try {
                const parsed = JSON.parse(dataStr);
                const delta = parsed.choices?.[0]?.delta?.content || '';
                fullText += delta;
                setApiResponse(fullText);
              } catch (e) {
                // ignore chunk parse error
              }
            }
          }
        }
        showToast('API hoàn thành câu trả lời', 'success');
      } else {
        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content || JSON.stringify(data);
        setApiResponse(reply);
        showToast('Nhận phản hồi từ API thành công', 'success');
      }
    } catch (err) {
      showToast('Lỗi gọi API: ' + err.message, 'error');
      setApiResponse(`[Lỗi API]: ${err.message}`);
    } finally {
      setIsTestingApi(false);
    }
  };

  return (
    <>
      {/* Background Atmosphere */}
      <div className="apple-atmospheric">
        <div className="ambient-spot-1"></div>
        <div className="ambient-spot-2"></div>
      </div>

      {/* Apple Dynamic Island Floating Toast */}
      <div className="apple-toast-stage">
        {toasts.map((t) => (
          <div key={t.id} className="apple-island-toast">
            <span className={`toast-badge-dot ${t.type}`}></span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Top Glass Navigation Bar (macOS Style) */}
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
              <span>Next.js Ready</span>
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

      {/* Main Workspace Container */}
      <main className="apple-workspace-container">
        <div className="apple-grid">
          {/* Left Column: Cookie Workspace */}
          <section className="apple-card">
            <div className="card-top-bar">
              <div className="title-lockup">
                <h2>Phiên Đăng Nhập Muse</h2>
                <p>Dán chuỗi cookie để khởi chạy hoặc kiểm tra kết nối máy ảo.</p>
              </div>

              <div className="apple-toolbar-actions">
                <button type="button" className="apple-tool-btn" onClick={handlePasteClipboard} title="Dán từ Clipboard">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                  </svg>
                  Dán
                </button>
                <button type="button" className="apple-tool-btn" onClick={handleLoadSample} title="Tải cookie mẫu">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Mẫu
                </button>
                <button type="button" className="apple-tool-btn danger" onClick={handleClear} title="Xóa toàn bộ">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Xóa
                </button>
              </div>
            </div>

            {/* Inset Text Editor */}
            <div className="cookie-field-shell">
              <textarea
                className="apple-textarea"
                value={cookieInput}
                onChange={(e) => setCookieInput(e.target.value)}
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
                  onClick={handleLaunchBrowser}
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
                    onClick={() => setSelectedBrowser('chrome')}
                  >
                    Chrome
                  </button>
                  <button
                    type="button"
                    className={`segment-item ${selectedBrowser === 'edge' ? 'selected' : ''}`}
                    onClick={() => setSelectedBrowser('edge')}
                  >
                    Edge
                  </button>
                </div>
              </div>

              <div className="secondary-deck">
                <button
                  type="button"
                  className="btn-apple-secondary"
                  onClick={handleTestSession}
                  disabled={isTesting}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  {isTesting ? 'Đang Kiểm Tra...' : 'Kiểm Tra Trạng Thái VM'}
                </button>

                <button type="button" className="btn-apple-secondary" onClick={handleOpenSaveModal}>
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
                  <button type="button" className="btn-sheet-close" onClick={() => setTestResult(null)}>
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

          {/* Right Column: Apple Segmented Hub */}
          <section className="apple-card">
            {/* Apple Segmented Bar */}
            <nav className="apple-tab-bar" role="tablist">
              <button
                type="button"
                className={`tab-pill-btn ${activeTab === 'profiles' ? 'active' : ''}`}
                onClick={() => setActiveTab('profiles')}
              >
                Hồ Sơ ({profiles.length})
              </button>
              <button
                type="button"
                className={`tab-pill-btn ${activeTab === 'api' ? 'active' : ''}`}
                onClick={() => setActiveTab('api')}
              >
                API Desktop ⚡
              </button>
              <button
                type="button"
                className={`tab-pill-btn ${activeTab === 'bookmarklet' ? 'active' : ''}`}
                onClick={() => setActiveTab('bookmarklet')}
              >
                Bookmarklet
              </button>
              <button
                type="button"
                className={`tab-pill-btn ${activeTab === 'extension' ? 'active' : ''}`}
                onClick={() => setActiveTab('extension')}
              >
                Extension
              </button>
              <button
                type="button"
                className={`tab-pill-btn ${activeTab === 'inspector' ? 'active' : ''}`}
                onClick={() => setActiveTab('inspector')}
              >
                Chi Tiết Token
              </button>
            </nav>

            {/* Tab 1: Profiles */}
            {activeTab === 'profiles' && (
              <div className="tab-surface">
                <div className="tab-top-caption">
                  <span className="caption-text">Chuyển đổi giữa các tài khoản đã lưu nhanh chóng.</span>
                  <button type="button" className="apple-tool-btn" onClick={loadProfiles}>
                    Làm mới
                  </button>
                </div>

                <div className="apple-profiles-stack">
                  {profiles.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--text-tertiary)' }}>
                      Chưa có hồ sơ cookie nào được lưu.
                    </div>
                  ) : (
                    profiles.map((p) => (
                      <div key={p.id} className="apple-list-item">
                        <div className="item-left-block">
                          <h4>
                            {p.name}
                            <span className="tag-badge">Muse</span>
                          </h4>
                          <div className="item-timestamp">
                            {new Date(p.updatedAt).toLocaleString('vi-VN')}
                          </div>
                        </div>
                        <div className="item-right-actions">
                          <button type="button" className="btn-item-use" onClick={() => handleUseProfile(p)}>
                            Sử Dụng
                          </button>
                          <button
                            type="button"
                            className="btn-item-del"
                            onClick={() => handleDeleteProfile(p.id, p.name)}
                            title="Xóa"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Tab: API Desktop Gateway (OpenAI Compatible) */}
            {activeTab === 'api' && (
              <div className="tab-surface">
                <div className="apple-guide-box">
                  <span className="guide-pill-indicator">OPENAI COMPATIBLE GATEWAY</span>
                  <h3 className="guide-heading">Kết Nối API Cho Phần Mềm Desktop</h3>
                  <p className="caption-text" style={{ marginBottom: 16 }}>
                    Hệ thống cung cấp chuẩn kết nối chuẩn 100% <strong>OpenAI Chat Completions API</strong>. Bạn có thể kết nối trực tiếp với <strong>Cherry Studio</strong>, <strong>Chatbox</strong>, <strong>NextChat</strong>, <strong>Cursor IDE</strong>, hoặc gọi qua Python/cURL.
                  </p>

                  {/* Main API Parameters Card */}
                  <div className="api-config-board">
                    <div className="api-param-row">
                      <div className="param-label-group">
                        <span className="param-tag">Base URL</span>
                        <code className="param-value">http://localhost:3000/v1</code>
                      </div>
                      <button
                        type="button"
                        className="btn-copy-chip"
                        onClick={() => handleCopyText('http://localhost:3000/v1', 'Base URL')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Copy URL
                      </button>
                    </div>

                    <div className="api-param-row">
                      <div className="param-label-group">
                        <span className="param-tag">API Key</span>
                        <code className="param-value">sk-muse-session</code>
                      </div>
                      <button
                        type="button"
                        className="btn-copy-chip"
                        onClick={() => handleCopyText('sk-muse-session', 'API Key')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Copy Key
                      </button>
                    </div>

                    <div className="api-param-row">
                      <div className="param-label-group">
                        <span className="param-tag">Model</span>
                        <code className="param-value">muse-chat</code>
                      </div>
                      <button
                        type="button"
                        className="btn-copy-chip"
                        onClick={() => handleCopyText('muse-chat', 'Model ID')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        Copy Model
                      </button>
                    </div>
                  </div>

                  {/* Desktop Apps Instructions Grid */}
                  <h4 style={{ fontSize: '0.86rem', fontWeight: 600, color: '#ffffff', margin: '18px 0 10px' }}>
                    Hướng Dẫn Cài Đặt Trên Các Ứng Dụng Desktop
                  </h4>

                  <div className="client-app-grid">
                    <div className="client-app-card">
                      <div className="app-card-title">
                        <span>🍒</span> Cherry Studio
                      </div>
                      <p className="app-card-desc">
                        1. Mở Cài đặt &rarr; <strong>Nhà cung cấp mô hình</strong>.<br />
                        2. Chọn hoặc Thêm mới <strong>OpenAI</strong>.<br />
                        3. API Base URL: <code>http://localhost:3000/v1</code><br />
                        4. API Key: <code>sk-muse-session</code><br />
                        5. Model ID: Nhập <code>muse-chat</code>
                      </p>
                    </div>

                    <div className="client-app-card">
                      <div className="app-card-title">
                        <span>💬</span> Chatbox AI
                      </div>
                      <p className="app-card-desc">
                        1. Mở Cài đặt &rarr; Chọn <strong>OpenAI API</strong>.<br />
                        2. API Host: <code>http://localhost:3000</code><br />
                        3. API Key: <code>sk-muse-session</code><br />
                        4. Model: Chọn hoặc gõ <code>muse-chat</code>.<br />
                        5. Bấm Lưu và bắt đầu chat!
                      </p>
                    </div>

                    <div className="client-app-card">
                      <div className="app-card-title">
                        <span>🧭</span> Cursor / Continue
                      </div>
                      <p className="app-card-desc">
                        Trong cấu hình config: Thêm custom OpenAI endpoint với <code>apiBase: &quot;http://localhost:3000/v1&quot;</code>, model <code>muse-chat</code>, apiKey <code>sk-muse-session</code>.
                      </p>
                    </div>

                    <div className="client-app-card">
                      <div className="app-card-title">
                        <span>🌐</span> LobeChat / NextChat
                      </div>
                      <p className="app-card-desc">
                        1. Cài đặt &rarr; OpenAI.<br />
                        2. Proxy URL: <code>http://localhost:3000/v1</code><br />
                        3. API Key: <code>sk-muse-session</code><br />
                        4. Model: <code>muse-chat</code>
                      </p>
                    </div>
                  </div>

                  {/* Live API Playground */}
                  <h4 style={{ fontSize: '0.86rem', fontWeight: 600, color: '#ffffff', margin: '20px 0 10px' }}>
                    Thử Nghiệm Trực Tiếp API (Live Playground)
                  </h4>

                  <div className="api-playground-box">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>Model:</label>
                        <select
                          value={apiModel}
                          onChange={(e) => setApiModel(e.target.value)}
                          style={{
                            background: 'rgba(0,0,0,0.4)',
                            border: '1px solid var(--apple-border)',
                            borderRadius: 'var(--radius-pill)',
                            color: '#ffffff',
                            padding: '3px 10px',
                            fontSize: '0.76rem',
                            outline: 'none',
                          }}
                        >
                          <option value="muse-chat">muse-chat (Mặc định)</option>
                          <option value="gpt-4o">gpt-4o (Alias)</option>
                          <option value="claude-3-5-sonnet">claude-3-5-sonnet (Alias)</option>
                          <option value="deepseek-chat">deepseek-chat (Alias)</option>
                        </select>
                      </div>

                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={apiStream}
                          onChange={(e) => setApiStream(e.target.checked)}
                          style={{ accentColor: 'var(--apple-blue-vibrant)' }}
                        />
                        Stream Response (SSE)
                      </label>
                    </div>

                    <div className="playground-input-row">
                      <input
                        type="text"
                        className="playground-input"
                        value={apiPrompt}
                        onChange={(e) => setApiPrompt(e.target.value)}
                        placeholder="Nhập prompt thử nghiệm..."
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !isTestingApi) {
                            handleRunApiTest();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn-apple-primary"
                        style={{ padding: '8px 16px', flex: 'none', borderRadius: 'var(--radius-md)', fontSize: '0.8rem' }}
                        onClick={handleRunApiTest}
                        disabled={isTestingApi}
                      >
                        {isTestingApi ? 'Đang Xử Lý...' : 'Gửi Thử Nghiệm'}
                      </button>
                    </div>

                    {apiResponse && (
                      <div className="playground-terminal">
                        {apiResponse}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: Bookmarklet */}
            {activeTab === 'bookmarklet' && (
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
                      <button type="button" className="apple-tool-btn" onClick={handleCopyConsoleCode}>
                        Sao Chép Mã
                      </button>
                    </div>
                    <pre className="code-view-area">
                      <code>{consoleScript}</code>
                    </pre>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: Extension */}
            {activeTab === 'extension' && (
              <div className="tab-surface">
                <div className="apple-guide-box">
                  <span className="guide-pill-indicator">Chrome Extension</span>
                  <h3 className="guide-heading">Cài Đặt Tiện Ích Mở Rộng Sẵn Có</h3>
                  <p className="caption-text" style={{ marginBottom: 16 }}>
                    Dự án đã đóng gói sẵn extension chuẩn Manifest V3 tại thư mục <code>./extension</code>.
                  </p>

                  <ol className="apple-step-list">
                    <li>
                      Mở trình duyệt Chrome/Edge, vào: <code>chrome://extensions</code>
                    </li>
                    <li>
                      Gạt bật <strong>&quot;Developer mode&quot; (Chế độ cho nhà phát triển)</strong> ở góc trên bên phải.
                    </li>
                    <li>
                      Bấm nút <strong>&quot;Load unpacked&quot; (Tải tiện ích đã giải nén)</strong>.
                    </li>
                    <li>
                      Chọn thư mục: <code>d:\Workspace\04_Tools-Agents\muse\extension</code>
                    </li>
                    <li>Xong! Bạn có thể dán cookie và mở Muse trực tiếp trên thanh công cụ.</li>
                  </ol>

                  <div className="apple-banner-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div className="banner-icon">🧩</div>
                      <div className="banner-copy">
                        <h4>Muse Cookie Switcher Extension</h4>
                        <p>Tương thích Chrome, Edge, Brave, Cốc Cốc.</p>
                      </div>
                    </div>
                    <button type="button" className="apple-tool-btn" onClick={handleCopyExtensionPath}>
                      Copy Đường Dẫn
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 4: Token Inspector */}
            {activeTab === 'inspector' && (
              <div className="tab-surface">
                <div className="apple-guide-box">
                  <h3 className="guide-heading">Phân Tích Thông Số Token</h3>
                  <p className="caption-text" style={{ marginBottom: 12 }}>
                    Chi tiết các tham số bảo mật của hệ thống Meta Muse.
                  </p>

                  <div className="apple-table-shell">
                    <table className="apple-table">
                      <thead>
                        <tr>
                          <th>Tên Cookie</th>
                          <th>Ý Nghĩa & Chức Năng</th>
                          <th>Giá Trị</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedEntries.length === 0 ? (
                          <tr>
                            <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '24px' }}>
                              Chưa có cookie nào được nhập.
                            </td>
                          </tr>
                        ) : (
                          parsedEntries.map(([key, val]) => (
                            <tr key={key}>
                              <td>
                                <span className="table-token-name">{key}</span>
                              </td>
                              <td>
                                <span className="table-token-role">
                                  {ROLES_MAP[key] || 'Cookie bổ trợ của phiên'}
                                </span>
                              </td>
                              <td>
                                <span className="table-token-val" title={val}>
                                  {val.length > 36 ? val.slice(0, 33) + '...' : val}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Apple Clean Footer */}
        <footer className="apple-footer">
          <p>Designed with Apple Human Interface Guidelines &bull; Next.js 16 App Router &bull; Google Chrome & Microsoft Edge</p>
        </footer>
      </main>

      {/* Apple Sheet Modal for Saving Profile */}
      {saveModalOpen && (
        <div className="apple-modal-overlay" onClick={() => setSaveModalOpen(false)}>
          <div className="apple-sheet-window" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-header">
              <h3>Lưu Hồ Sơ Session</h3>
              <button type="button" className="btn-sheet-close" onClick={() => setSaveModalOpen(false)}>
                &times;
              </button>
            </div>
            <div>
              <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                Tên tài khoản hoặc ghi chú:
              </label>
              <input
                type="text"
                className="apple-input-field"
                value={modalProfileName}
                onChange={(e) => setModalProfileName(e.target.value)}
                placeholder="Ví dụ: Muse Pro Account..."
                autoFocus
              />
              <p style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>
                Hồ sơ sẽ được lưu an toàn trên máy tính của bạn.
              </p>
            </div>
            <div className="sheet-footer">
              <button type="button" className="apple-tool-btn" onClick={() => setSaveModalOpen(false)}>
                Hủy
              </button>
              <button
                type="button"
                className="btn-apple-primary"
                style={{ padding: '8px 18px', flex: 'none', borderRadius: 'var(--radius-pill)' }}
                onClick={handleConfirmSave}
              >
                Lưu
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
