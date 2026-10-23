'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';

const ROLES_MAP = {
  'hatch_sess': 'Phiên đăng nhập chính của người dùng (Session Token)',
  'hatch_vml': 'Quyền truy cập Virtual Machine / Không gian làm việc Muse',
  'hatch_gw': 'Cổng định tuyến Gateway và xác thực WebSocket với VM',
  'hatch_native_auth_device': 'Định danh thiết bị phần cứng & kiểm soát bảo mật',
  'hatch_native_auth_temp': 'Token ủy quyền tạm thời của Meta AI / Hatch Agent',
  '__Host-hatch_one_tap': 'Bảo vệ xác thực One-Tap chống tấn công CSRF',
  'datr': 'Mã định danh trình duyệt đáng tin cậy của hạ tầng Meta',
  'theme': 'Cấu hình giao diện Chat và màu sắc cá nhân hóa',
  'dpr': 'Tỉ lệ mật độ điểm ảnh hiển thị giao diện (Device Pixel Ratio)',
  'wd': 'Độ phân giải màn hình cửa sổ trình duyệt (Window Dimensions)',
  'ps_l': 'Partitioned State Security Level của Meta',
  'ps_n': 'Partitioned State Nonce của Meta',
};

export default function MuseSessionApp() {
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

  // Toast notification
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

  // Load initial data (browsers & profiles)
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
    // Check browsers
    fetch('/api/browsers')
      .then((r) => r.json())
      .then((b) => setAvailableBrowsers(b))
      .catch((err) => console.warn(err));

    // Load profiles and populate default
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
        showToast('Đã dán cookie từ clipboard!', 'success');
      } else {
        showToast('Clipboard trống!', 'error');
      }
    } catch (err) {
      showToast('Vui lòng cấp quyền clipboard hoặc bấm Ctrl+V', 'error');
    }
  };

  const handleLoadSample = () => {
    if (profiles.length > 0) {
      setCookieInput(profiles[0].cookies);
      showToast(`Đã tải cookie từ: ${profiles[0].name}`, 'success');
    } else {
      showToast('Chưa có session mẫu nào', 'error');
    }
  };

  const handleClear = () => {
    setCookieInput('');
    setTestResult(null);
    showToast('Đã xóa dữ liệu cookie', 'info');
  };

  // Launch browser action
  const handleLaunchBrowser = async () => {
    const raw = cookieInput.trim();
    if (!raw) {
      showToast('Vui lòng dán cookie trước khi mở trình duyệt!', 'error');
      return;
    }

    setIsLaunching(true);
    setLaunchStatus('Đang khởi chạy trình duyệt & nạp cookie...');

    try {
      const res = await fetch('/api/launch-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: raw, browserType: selectedBrowser }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        showToast(`🚀 ${data.message}`, 'success');
        setLaunchStatus('Đã mở thành công! Muse đã sẵn sàng.');
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
        showToast('Session hoàn toàn hợp lệ và đang hoạt động!', 'success');
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
      showToast('Vui lòng nhập cookie trước khi lưu!', 'error');
      return;
    }
    setModalProfileName(`Tài khoản Muse ${profiles.length + 1}`);
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
        showToast(`Đã lưu hồ sơ "${name}" thành công!`, 'success');
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
    showToast(`Đã nạp hồ sơ: "${profile.name}"!`, 'success');
  };

  const handleCopyConsoleCode = () => {
    navigator.clipboard.writeText(consoleScript).then(() => {
      showToast('Đã sao chép mã DevTools Snippet vào clipboard!', 'success');
    });
  };

  const handleCopyExtensionPath = () => {
    const p = 'd:\\Workspace\\04_Tools-Agents\\muse\\extension';
    navigator.clipboard.writeText(p).then(() => {
      showToast('Đã sao chép đường dẫn thư mục extension!', 'success');
    });
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="logo-badge">
            <div className="logo-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 17L12 22L22 17" stroke="#3B82F6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M2 12L12 17L22 12" stroke="#EC4899" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="brand-text">
              <h1 className="brand-title">
                MUSE <span className="gradient-text">SESSION HUB</span>
                <span className="next-pill">NEXT.JS 16</span>
              </h1>
              <p className="brand-subtitle">Trình Quản Lý & Tự Động Đăng Nhập Muse Web 1-Click</p>
            </div>
          </div>
        </div>

        <div className="header-right">
          <div className="system-status-pill">
            <span className="status-dot"></span>
            <span className="status-label">Next.js App Sẵn Sàng</span>
          </div>

          <div className="browser-detected-badges">
            <span
              className={`browser-badge ${availableBrowsers.chrome ? 'active-browser' : ''}`}
              title={availableBrowsers.chrome || 'Không tìm thấy'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C8.21 0 4.83 1.76 2.61 4.5l3.96 6.86C7.14 7.63 9.38 5.4 12 5.4h9.39C19.23 2.16 15.86 0 12 0zm-8.83 6.64L.43 11.45C.15 12.28 0 13.12 0 14c0 6.63 5.37 12 12 12l3.96-6.86c-2.31 1.4-5.06 1.76-7.85.74-1.78-.65-3.23-1.87-4.14-3.37L3.17 6.64zm15.42 2.76c.78 1.4 1.11 3.03.92 4.6-.29 2.37-1.71 4.41-3.69 5.56L12 24c6.63 0 12-5.37 12-12 0-1.89-.44-3.68-1.22-5.26l-4.19 2.66zM12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z" />
              </svg>
              Chrome
            </span>
            <span
              className={`browser-badge ${availableBrowsers.edge ? 'active-browser' : ''}`}
              title={availableBrowsers.edge || 'Không tìm thấy'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M0 12.3c.1 4.2 2.8 7.9 6.8 9.3 4.2 1.5 9 .4 12.1-2.7 1.3-1.3 2.2-3 2.5-4.8.4-2.1-.2-4.3-1.5-6-1.5-1.9-3.7-3.1-6.1-3.3-2.3-.2-4.6.6-6.3 2.1-1.4 1.2-2.3 2.8-2.6 4.6-.2 1.4.1 2.9 1 4 1 1.1 2.5 1.7 4 1.6 1.3-.1 2.5-.7 3.3-1.7.9-1 1.2-2.4 1-3.7-.3-1.5-1.5-2.6-3-2.8-1.4-.2-2.8.5-3.4 1.8-.3.7-.4 1.4-.1 2.1.2.6.7 1.1 1.3 1.3.8.3 1.7.1 2.3-.5.4-.4.6-1 .5-1.6-.1-.5-.4-.9-.9-1-.5-.1-1.1.2-1.3.7-.1.2-.1.5 0 .7.1.3.4.4.7.4.2 0 .4-.1.5-.3.1-.2.1-.4 0-.6-.1-.2-.3-.3-.5-.3-.2 0-.3.1-.4.3 0 .1 0 .2.1.3.1.1.2.1.3.1" />
              </svg>
              Edge
            </span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="main-grid">
        {/* Left Panel: Input & Controls */}
        <section className="card glass-card">
          <div className="card-header">
            <div className="card-title-group">
              <div className="card-icon-badge glow-purple">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
              </div>
              <div>
                <h2 className="card-title">Dán Cookie Muse Web</h2>
                <p className="card-subtitle">Hỗ trợ chuỗi cookie nguyên bản chứa hatch_sess, hatch_vml, datr, v.v.</p>
              </div>
            </div>

            <div className="card-actions-mini">
              <button type="button" className="btn-ghost-sm" onClick={handlePasteClipboard} title="Dán từ Clipboard">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                </svg>
                Dán
              </button>
              <button type="button" className="btn-ghost-sm" onClick={handleLoadSample} title="Tải cookie mẫu">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Tải mẫu
              </button>
              <button type="button" className="btn-ghost-sm danger" onClick={handleClear} title="Xóa toàn bộ">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                Xóa
              </button>
            </div>
          </div>

          <div className="textarea-wrapper">
            <textarea
              className="cookie-textarea"
              value={cookieInput}
              onChange={(e) => setCookieInput(e.target.value)}
              placeholder="Dán chuỗi cookie của Muse vào đây...&#10;Ví dụ: dpr=1.25; datr=wWDbak...; hatch_sess=97573a9b...; hatch_vml=v1%3A...;"
              spellCheck="false"
            />
          </div>

          {/* Token Analysis & Badges */}
          <div className="token-bar">
            <div className="token-bar-header">
              <span className="token-label">Thành phần token nhận diện được:</span>
              <span className="token-count">{cookieCount} cookies</span>
            </div>
            <div className="badges-row">
              <span className={`token-pill ${parsedMap['hatch_sess'] ? 'found' : 'missing'}`}>hatch_sess</span>
              <span className={`token-pill ${parsedMap['hatch_vml'] ? 'found' : 'missing'}`}>hatch_vml</span>
              <span className={`token-pill ${parsedMap['hatch_gw'] ? 'found' : 'missing'}`}>hatch_gw</span>
              <span className={`token-pill ${parsedMap['hatch_native_auth_device'] ? 'found' : 'missing'}`}>
                hatch_native_device
              </span>
              <span className={`token-pill ${parsedMap['datr'] ? 'found' : 'missing'}`}>datr</span>
              <span className={`token-pill ${parsedMap['theme'] ? 'found' : 'missing'}`}>theme</span>
            </div>
          </div>

          {/* Action Grid */}
          <div className="action-grid">
            <div className="launch-group">
              <button
                type="button"
                className="btn-primary-glow btn-launch"
                onClick={handleLaunchBrowser}
                disabled={isLaunching}
              >
                <span className="btn-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </span>
                <span className="btn-text">
                  <strong>Mở Muse Web Ngay</strong>
                  <small>{launchStatus}</small>
                </span>
              </button>

              <div className="browser-selector">
                <button
                  type="button"
                  className={`btn-browser-opt ${selectedBrowser === 'chrome' ? 'active' : ''}`}
                  onClick={() => setSelectedBrowser('chrome')}
                >
                  Chrome
                </button>
                <button
                  type="button"
                  className={`btn-browser-opt ${selectedBrowser === 'edge' ? 'active' : ''}`}
                  onClick={() => setSelectedBrowser('edge')}
                >
                  Edge
                </button>
              </div>
            </div>

            <div className="secondary-actions-row">
              <button
                type="button"
                className="btn-secondary"
                onClick={handleTestSession}
                disabled={isTesting}
              >
                <span className={isTesting ? 'spinning' : ''}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                </span>
                {isTesting ? 'Đang Kiểm Tra...' : 'Kiểm Tra Trạng Thái VM'}
              </button>

              <button type="button" className="btn-secondary" onClick={handleOpenSaveModal}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
                Lưu Vào Hồ Sơ
              </button>
            </div>
          </div>

          {/* Test Result Box */}
          {testResult && (
            <div className={`test-result-box ${testResult.valid ? 'valid' : 'invalid'}`}>
              <div className="result-header">
                <div className="result-status-title">
                  <span
                    className="indicator-pulse"
                    style={{
                      background: testResult.valid ? '#10b981' : '#f43f5e',
                      boxShadow: testResult.valid ? '0 0 10px #10b981' : '0 0 10px #f43f5e',
                    }}
                  ></span>
                  <span>
                    {testResult.valid
                      ? `Session Đang Hoạt Động (Trạng Thái: ${testResult.data?.vm_state || 'RUNNING'})`
                      : 'Session Không Hợp Lệ Hoặc Hết Hạn'}
                  </span>
                </div>
                <button type="button" className="btn-icon-close" onClick={() => setTestResult(null)}>
                  &times;
                </button>
              </div>

              {testResult.valid && testResult.data ? (
                <div className="vm-stats-grid">
                  <div className="vm-stat-card">
                    <div className="stat-label">Trạng thái VM</div>
                    <div className="stat-val status-running">{testResult.data.vm_state || 'RUNNING'}</div>
                  </div>
                  <div className="vm-stat-card">
                    <div className="stat-label">Mã VM ID</div>
                    <div className="stat-val" title={testResult.data.vm_id}>
                      {(testResult.data.vm_id || '').slice(0, 14)}...
                    </div>
                  </div>
                  <div className="vm-stat-card">
                    <div className="stat-label">Gán Phiên</div>
                    <div className="stat-val">{testResult.data.status || 'assigned'}</div>
                  </div>
                  <div className="vm-stat-card">
                    <div className="stat-label">Endpoint WebSocket</div>
                    <div className="stat-val" title={testResult.data.endpoint_url}>
                      metaaivm.com
                    </div>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: '0.84rem', color: '#fda4af' }}>
                  {testResult.message || 'Không thể xác thực cookie với máy chủ muse.ai.'}
                </p>
              )}
            </div>
          )}
        </section>

        {/* Right Panel: Tabs */}
        <section className="card glass-card">
          <nav className="nav-tabs" role="tablist">
            <button
              type="button"
              className={`tab-btn ${activeTab === 'profiles' ? 'active' : ''}`}
              onClick={() => setActiveTab('profiles')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              Tài Khoản Lưu Trữ ({profiles.length})
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'bookmarklet' ? 'active' : ''}`}
              onClick={() => setActiveTab('bookmarklet')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Bookmarklet 1-Click
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'extension' ? 'active' : ''}`}
              onClick={() => setActiveTab('extension')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              Chrome Extension
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'inspector' ? 'active' : ''}`}
              onClick={() => setActiveTab('inspector')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              Chi Tiết Token
            </button>
          </nav>

          {/* Tab 1: Profiles */}
          {activeTab === 'profiles' && (
            <div className="tab-content active">
              <div className="tab-pane-header">
                <p className="tab-desc">Lưu và chuyển đổi giữa các tài khoản Muse khác nhau mà không cần đăng nhập lại.</p>
                <button type="button" className="btn-ghost-sm" onClick={loadProfiles}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="23 4 23 10 17 10" />
                    <polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  Làm mới
                </button>
              </div>

              <div className="profiles-list">
                {profiles.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dim)' }}>
                    Chưa có hồ sơ cookie nào được lưu.
                  </div>
                ) : (
                  profiles.map((p) => (
                    <div key={p.id} className="profile-card">
                      <div className="profile-meta">
                        <h4>
                          {p.name}
                          <span className="profile-tag">Muse Web</span>
                        </h4>
                        <div className="profile-date">
                          Cập nhật: {new Date(p.updatedAt).toLocaleString('vi-VN')}
                        </div>
                      </div>
                      <div className="profile-actions">
                        <button type="button" className="btn-profile-use" onClick={() => handleUseProfile(p)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                          Sử Dụng
                        </button>
                        <button
                          type="button"
                          className="btn-profile-del"
                          onClick={() => handleDeleteProfile(p.id, p.name)}
                          title="Xóa"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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

          {/* Tab 2: Bookmarklet */}
          {activeTab === 'bookmarklet' && (
            <div className="tab-content active">
              <div className="instruction-box">
                <div className="step-badge">Cách nhanh nhất trên trình duyệt của bạn</div>
                <h3 className="step-title">Dùng Bookmarklet trên trang Muse.ai</h3>
                <ol className="steps-list">
                  <li>
                    Kéo nút màu tím bên dưới lên <strong>Thanh Dấu Trang (Bookmark Bar)</strong> của trình duyệt (Nhấn{' '}
                    <code>Ctrl+Shift+B</code> để bật thanh bookmark).
                  </li>
                  <li>
                    Mở tab{' '}
                    <a href="https://muse.ai" target="_blank" rel="noopener noreferrer">
                      https://muse.ai
                    </a>{' '}
                    trong trình duyệt.
                  </li>
                  <li>Nhấn vào Bookmark vừa lưu &mdash; Cookies sẽ lập tức được nạp và Muse tự động làm mới vào tài khoản!</li>
                </ol>

                <div className="bookmarklet-drag-area">
                  <p className="drag-hint">⬇️ KÉO NÚT NÀY VÀO THANH BOOKMARK CỦA BẠN ⬇️</p>
                  <a href={bookmarkletHref} className="bookmarklet-btn" onClick={(e) => e.preventDefault()}>
                    ⚡ Đăng Nhập Muse (1-Click)
                  </a>
                </div>

                <div className="divider-text">HOẶC DÁN VÀO CONSOLE F12</div>

                <div className="code-copy-card">
                  <div className="code-card-header">
                    <span>Console DevTools Snippet (F12)</span>
                    <button type="button" className="btn-copy-code" onClick={handleCopyConsoleCode}>
                      Sao Chép Mã
                    </button>
                  </div>
                  <pre className="code-block">
                    <code>{consoleScript}</code>
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Extension */}
          {activeTab === 'extension' && (
            <div className="tab-content active">
              <div className="instruction-box">
                <div className="step-badge">Tiện Ích Trực Tiếp</div>
                <h3 className="step-title">Extension Muse Cookie Injector (Đã Tạo Sẵn)</h3>
                <p className="tab-desc">
                  Một tiện ích mở rộng đầy đủ đã được đóng gói sẵn trong thư mục dự án <code>./extension</code>. Bạn có thể cài vào Chrome/Edge chỉ trong 30 giây:
                </p>

                <ol className="steps-list">
                  <li>
                    Mở Chrome hoặc Edge, gõ vào thanh địa chỉ: <code>chrome://extensions</code> (hoặc{' '}
                    <code>edge://extensions</code>).
                  </li>
                  <li>
                    Gạt bật công tắc <strong>&quot;Chế độ dành cho nhà phát triển&quot; (Developer mode)</strong> ở góc trên bên phải.
                  </li>
                  <li>
                    Bấm nút <strong>&quot;Tải tiện ích đã giải nén&quot; (Load unpacked)</strong>.
                  </li>
                  <li>
                    Chọn thư mục: <code>d:\Workspace\04_Tools-Agents\muse\extension</code>.
                  </li>
                  <li>Xong! Bấm icon Muse trên thanh công cụ của Chrome, dán cookie và bấm <strong>&quot;Nạp & Mở Muse&quot;</strong>.</li>
                </ol>

                <div className="extension-status-card">
                  <div className="ext-icon">🧩</div>
                  <div className="ext-info">
                    <h4>Muse Cookie Switcher Extension</h4>
                    <p>Tương thích Chrome, Edge, Brave, Cốc Cốc, Opera.</p>
                  </div>
                  <button type="button" className="btn-secondary-sm" onClick={handleCopyExtensionPath}>
                    Copy Đường Dẫn Folder
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: Token Inspector */}
          {activeTab === 'inspector' && (
            <div className="tab-content active">
              <div className="instruction-box">
                <h3 className="step-title">Phân tích chi tiết các Token & Cookies</h3>
                <p className="tab-desc">Xem nội dung giải mã và phân tích các tham số xác thực của Meta Muse.</p>

                <div className="inspector-table-wrapper">
                  <table className="inspector-table">
                    <thead>
                      <tr>
                        <th>Tên Cookie</th>
                        <th>Ý nghĩa & Vai trò</th>
                        <th>Trạng thái / Giá trị</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedEntries.length === 0 ? (
                        <tr>
                          <td colSpan="3" style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '20px' }}>
                            Chưa có cookie nào được nhập.
                          </td>
                        </tr>
                      ) : (
                        parsedEntries.map(([key, val]) => (
                          <tr key={key}>
                            <td>
                              <span className="cookie-key-name">{key}</span>
                            </td>
                            <td>
                              <span className="cookie-role-badge">
                                {ROLES_MAP[key] || 'Cookie bổ trợ của phiên làm việc'}
                              </span>
                            </td>
                            <td>
                              <span className="cookie-val-preview" title={val}>
                                {val.length > 40 ? val.slice(0, 37) + '...' : val}
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
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>Muse Web Session Hub &bull; Next.js 16 App Router &bull; Google Chrome & Microsoft Edge Engine</p>
      </footer>

      {/* Save Modal */}
      {saveModalOpen && (
        <div className="modal-overlay" onClick={() => setSaveModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Lưu Hồ Sơ Session</h3>
              <button type="button" className="btn-icon-close" onClick={() => setSaveModalOpen(false)}>
                &times;
              </button>
            </div>
            <div className="modal-body">
              <label className="form-label">Tên tài khoản hoặc ghi chú:</label>
              <input
                type="text"
                className="form-input"
                value={modalProfileName}
                onChange={(e) => setModalProfileName(e.target.value)}
                placeholder="Ví dụ: Muse Pro Account 1..."
                autoFocus
              />
              <p className="form-hint">Hồ sơ sẽ được lưu an toàn trên máy tính của bạn.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn-ghost" onClick={() => setSaveModalOpen(false)}>
                Hủy
              </button>
              <button type="button" className="btn-primary" onClick={handleConfirmSave}>
                Lưu Hồ Sơ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <div className="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{t.type === 'success' ? '✅' : t.type === 'error' ? '⚠️' : 'ℹ️'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
