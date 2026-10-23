// Muse Session Hub Client Logic
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const cookieInput = document.getElementById('cookieInput');
  const btnPasteClipboard = document.getElementById('btnPasteClipboard');
  const btnLoadSample = document.getElementById('btnLoadSample');
  const btnClearCookie = document.getElementById('btnClearCookie');
  const cookieCount = document.getElementById('cookieCount');
  
  // Badges
  const badgeSess = document.getElementById('badgeSess');
  const badgeVml = document.getElementById('badgeVml');
  const badgeGw = document.getElementById('badgeGw');
  const badgeDevice = document.getElementById('badgeDevice');
  const badgeDatr = document.getElementById('badgeDatr');
  const badgeTheme = document.getElementById('badgeTheme');

  // Actions
  const btnLaunchBrowser = document.getElementById('btnLaunchBrowser');
  const launchSubtitle = document.getElementById('launchSubtitle');
  const optChrome = document.getElementById('optChrome');
  const optEdge = document.getElementById('optEdge');
  const btnTestSession = document.getElementById('btnTestSession');
  const testSpin = document.getElementById('testSpin');
  const btnSaveSession = document.getElementById('btnSaveSession');
  
  // Test result box
  const testResultBox = document.getElementById('testResultBox');
  const resultStatusTitle = document.getElementById('resultStatusTitle');
  const resultBody = document.getElementById('resultBody');
  const btnCloseTestResult = document.getElementById('btnCloseTestResult');

  // Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const profilesList = document.getElementById('profilesList');
  const profileCount = document.getElementById('profileCount');
  const btnRefreshProfiles = document.getElementById('btnRefreshProfiles');

  // Bookmarklet
  const draggableBookmarklet = document.getElementById('draggableBookmarklet');
  const consoleCodeBlock = document.getElementById('consoleCodeBlock');
  const btnCopyConsoleCode = document.getElementById('btnCopyConsoleCode');

  // Extension
  const btnCopyExtPath = document.getElementById('btnCopyExtPath');

  // Inspector
  const inspectorTableBody = document.getElementById('inspectorTableBody');

  // Modal
  const saveModal = document.getElementById('saveModal');
  const modalProfileName = document.getElementById('modalProfileName');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnCancelModal = document.getElementById('btnCancelModal');
  const btnConfirmSave = document.getElementById('btnConfirmSave');

  // Browser state
  let selectedBrowser = 'chrome';
  let sampleCookie = '';

  // Toast Notification
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Parse Cookie Client-side
  function parseCookies(str) {
    if (!str || typeof str !== 'string') return {};
    const cleaned = str.replace(/^Cookie:\s*/i, '').trim();
    const map = {};
    const items = cleaned.split(';').map(s => s.trim()).filter(Boolean);
    for (const item of items) {
      const idx = item.indexOf('=');
      if (idx !== -1) {
        const k = item.slice(0, idx).trim();
        const v = item.slice(idx + 1).trim();
        if (k) map[k] = v;
      }
    }
    return map;
  }

  // Update UI based on cookies
  function updateCookieAnalysis() {
    const raw = cookieInput.value.trim();
    const map = parseCookies(raw);
    const keys = Object.keys(map);

    cookieCount.textContent = `${keys.length} cookies`;

    // Badges update
    function toggleBadge(el, found) {
      if (!el) return;
      if (found) {
        el.className = 'token-pill found';
      } else {
        el.className = 'token-pill missing';
      }
    }

    toggleBadge(badgeSess, !!map['hatch_sess']);
    toggleBadge(badgeVml, !!map['hatch_vml']);
    toggleBadge(badgeGw, !!map['hatch_gw']);
    toggleBadge(badgeDevice, !!map['hatch_native_auth_device']);
    toggleBadge(badgeDatr, !!map['datr']);
    toggleBadge(badgeTheme, !!map['theme']);

    // Update Bookmarklet & Console Code
    updateBookmarkletCode(raw, map);

    // Update Token Inspector
    updateInspector(map);
  }

  function updateBookmarkletCode(raw, map) {
    const entries = Object.entries(map);
    if (entries.length === 0) {
      draggableBookmarklet.setAttribute('href', '#');
      consoleCodeBlock.innerHTML = `<code>// Dán cookie vào ô bên trái để tự động tạo mã...</code>`;
      return;
    }

    const jsLines = entries.map(([k, v]) => {
      return `document.cookie = "${encodeURIComponent(k)}=${encodeURIComponent(v)}; domain=.muse.ai; path=/; max-age=31536000; SameSite=Lax; Secure";`;
    });

    const script = `(function(){
  if (!location.hostname.includes('muse.ai')) {
    alert('Vui lòng mở trang https://muse.ai trước khi nhấn Bookmarklet!');
    location.href = 'https://muse.ai';
    return;
  }
  ${jsLines.join('\n  ')}
  alert('Đã nạp ${entries.length} cookies của Muse thành công! Trang đang tải lại...');
  location.reload();
})();`;

    const bookmarkletUrl = 'javascript:' + encodeURIComponent(script.replace(/\n\s*/g, ' '));
    draggableBookmarklet.setAttribute('href', bookmarkletUrl);

    consoleCodeBlock.innerHTML = `<code>${escapeHtml(script)}</code>`;
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function updateInspector(map) {
    const roles = {
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

    inspectorTableBody.innerHTML = '';
    const entries = Object.entries(map);

    if (entries.length === 0) {
      inspectorTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color: var(--text-dim); padding: 20px;">Chưa có cookie nào được nhập.</td></tr>`;
      return;
    }

    for (const [key, val] of entries) {
      const tr = document.createElement('tr');
      const roleDesc = roles[key] || 'Cookie bổ trợ của phiên làm việc';
      const preview = val.length > 50 ? val.slice(0, 47) + '...' : val;

      tr.innerHTML = `
        <td><span class="cookie-key-name">${escapeHtml(key)}</span></td>
        <td><span class="cookie-role-badge">${escapeHtml(roleDesc)}</span></td>
        <td><span class="cookie-val-preview" title="${escapeHtml(val)}">${escapeHtml(preview)}</span></td>
      `;
      inspectorTableBody.appendChild(tr);
    }
  }

  // Event: Input change
  cookieInput.addEventListener('input', updateCookieAnalysis);

  // Paste from clipboard
  btnPasteClipboard.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        cookieInput.value = text;
        updateCookieAnalysis();
        showToast('Đã dán cookie từ clipboard!', 'success');
      } else {
        showToast('Clipboard trống!', 'error');
      }
    } catch (err) {
      showToast('Vui lòng cấp quyền clipboard hoặc bấm Ctrl+V', 'error');
    }
  });

  // Load sample cookie from sessions
  btnLoadSample.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/sessions');
      const sessions = await res.json();
      if (sessions && sessions.length > 0) {
        cookieInput.value = sessions[0].cookies;
        updateCookieAnalysis();
        showToast(`Đã tải cookie từ: ${sessions[0].name}`, 'success');
      } else {
        showToast('Chưa có session mẫu nào', 'error');
      }
    } catch (e) {
      showToast('Lỗi khi tải session mẫu', 'error');
    }
  });

  // Clear
  btnClearCookie.addEventListener('click', () => {
    cookieInput.value = '';
    updateCookieAnalysis();
    testResultBox.classList.add('hidden');
    showToast('Đã xóa dữ liệu cookie', 'info');
  });

  // Browser selection
  optChrome.addEventListener('click', () => {
    selectedBrowser = 'chrome';
    optChrome.classList.add('active');
    optEdge.classList.remove('active');
    launchSubtitle.textContent = 'Tự động nạp Cookie vào Google Chrome';
  });

  optEdge.addEventListener('click', () => {
    selectedBrowser = 'edge';
    optEdge.classList.add('active');
    optChrome.classList.remove('active');
    launchSubtitle.textContent = 'Tự động nạp Cookie vào Microsoft Edge';
  });

  // Launch Browser
  btnLaunchBrowser.addEventListener('click', async () => {
    const raw = cookieInput.value.trim();
    if (!raw) {
      showToast('Vui lòng dán cookie trước khi khởi chạy trình duyệt!', 'error');
      cookieInput.focus();
      return;
    }

    const originalText = launchSubtitle.textContent;
    launchSubtitle.textContent = 'Đang khởi chạy trình duyệt & nạp cookie...';
    btnLaunchBrowser.disabled = true;

    try {
      const res = await fetch('/api/launch-browser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: raw, browserType: selectedBrowser })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        showToast(`🚀 ${data.message}`, 'success');
        launchSubtitle.textContent = 'Đã mở thành công! Muse đã sẵn sàng.';
      } else {
        showToast(data.error || 'Lỗi khởi chạy trình duyệt', 'error');
        launchSubtitle.textContent = originalText;
      }
    } catch (err) {
      showToast('Lỗi kết nối tới máy chủ khởi chạy: ' + err.message, 'error');
      launchSubtitle.textContent = originalText;
    } finally {
      setTimeout(() => {
        btnLaunchBrowser.disabled = false;
        launchSubtitle.textContent = `Tự động nạp Cookie vào ${selectedBrowser === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'}`;
      }, 3000);
    }
  });

  // Test Session Online
  btnTestSession.addEventListener('click', async () => {
    const raw = cookieInput.value.trim();
    if (!raw) {
      showToast('Vui lòng dán cookie để kiểm tra', 'error');
      return;
    }

    testSpin.classList.add('spinning');
    btnTestSession.disabled = true;

    try {
      const res = await fetch('/api/test-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookies: raw })
      });

      const result = await res.json();
      testResultBox.classList.remove('hidden');

      if (result.valid && result.data) {
        testResultBox.className = 'test-result-box valid';
        resultStatusTitle.innerHTML = `<span class="indicator-pulse" style="background:#10b981;box-shadow:0 0 10px #10b981"></span> <span class="result-text">Session Đang Hoạt Động (Trạng Thái: ${result.data.vm_state || 'RUNNING'})</span>`;

        resultBody.innerHTML = `
          <div class="vm-stats-grid">
            <div class="vm-stat-card">
              <div class="stat-label">Trạng thái VM</div>
              <div class="stat-val status-running">${result.data.vm_state || 'RUNNING'}</div>
            </div>
            <div class="vm-stat-card">
              <div class="stat-label">Mã VM ID</div>
              <div class="stat-val" title="${result.data.vm_id}">${(result.data.vm_id || '').slice(0, 14)}...</div>
            </div>
            <div class="vm-stat-card">
              <div class="stat-label">Gán Phiên</div>
              <div class="stat-val">${result.data.status || 'assigned'}</div>
            </div>
            <div class="vm-stat-card">
              <div class="stat-label">Endpoint WebSocket</div>
              <div class="stat-val" title="${result.data.endpoint_url}">metaaivm.com</div>
            </div>
          </div>
        `;
        showToast('Session hoàn toàn hợp lệ và đang hoạt động!', 'success');
      } else {
        testResultBox.className = 'test-result-box invalid';
        resultStatusTitle.innerHTML = `<span class="indicator-pulse" style="background:#f43f5e;box-shadow:0 0 10px #f43f5e"></span> <span class="result-text">Session Không Hợp Lệ Hoặc Hết Hạn</span>`;
        resultBody.innerHTML = `<p style="font-size:0.84rem;color:#fda4af;">${result.message || 'Không thể xác thực cookie với máy chủ muse.ai.'}</p>`;
        showToast(result.message || 'Session không hợp lệ', 'error');
      }
    } catch (e) {
      showToast('Lỗi gửi yêu cầu kiểm tra: ' + e.message, 'error');
    } finally {
      testSpin.classList.remove('spinning');
      btnTestSession.disabled = false;
    }
  });

  btnCloseTestResult.addEventListener('click', () => {
    testResultBox.classList.add('hidden');
  });

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-tab');
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(target);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // Load profiles
  async function loadProfiles() {
    try {
      const res = await fetch('/api/sessions');
      const sessions = await res.json();
      profileCount.textContent = sessions.length;
      profilesList.innerHTML = '';

      if (sessions.length === 0) {
        profilesList.innerHTML = `<div class="empty-state">Chưa có hồ sơ cookie nào được lưu. Hãy bấm "Lưu Vào Hồ Sơ" ở bên trái.</div>`;
        return;
      }

      sessions.forEach(sess => {
        const card = document.createElement('div');
        card.className = 'profile-card';
        const dateStr = new Date(sess.updatedAt).toLocaleString('vi-VN');

        card.innerHTML = `
          <div class="profile-meta">
            <h4>
              ${escapeHtml(sess.name)}
              <span class="profile-tag">Muse Web</span>
            </h4>
            <div class="profile-date">Cập nhật: ${dateStr}</div>
          </div>
          <div class="profile-actions">
            <button type="button" class="btn-profile-use" data-id="${sess.id}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Sử Dụng
            </button>
            <button type="button" class="btn-profile-del" data-id="${sess.id}" title="Xóa">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        `;

        // Event for Use button
        card.querySelector('.btn-profile-use').addEventListener('click', () => {
          cookieInput.value = sess.cookies;
          updateCookieAnalysis();
          showToast(`Đã nạp hồ sơ: "${sess.name}" vào bảng điều khiển!`, 'success');
        });

        // Event for Delete button
        card.querySelector('.btn-profile-del').addEventListener('click', async () => {
          if (confirm(`Bạn có chắc muốn xóa hồ sơ "${sess.name}" không?`)) {
            await fetch(`/api/sessions/${sess.id}`, { method: 'DELETE' });
            showToast('Đã xóa hồ sơ', 'info');
            loadProfiles();
          }
        });

        profilesList.appendChild(card);
      });
    } catch (e) {
      console.error('Error loading profiles:', e);
    }
  }

  btnRefreshProfiles.addEventListener('click', loadProfiles);

  // Save Modal
  btnSaveSession.addEventListener('click', () => {
    const raw = cookieInput.value.trim();
    if (!raw) {
      showToast('Vui lòng nhập cookie trước khi lưu!', 'error');
      return;
    }
    modalProfileName.value = 'Tài khoản Muse ' + (parseInt(profileCount.textContent, 10) + 1);
    saveModal.classList.remove('hidden');
    modalProfileName.focus();
  });

  btnCloseModal.addEventListener('click', () => saveModal.classList.add('hidden'));
  btnCancelModal.addEventListener('click', () => saveModal.classList.add('hidden'));

  btnConfirmSave.addEventListener('click', async () => {
    const name = modalProfileName.value.trim();
    const raw = cookieInput.value.trim();
    if (!name) {
      showToast('Vui lòng nhập tên tài khoản', 'error');
      return;
    }

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cookies: raw })
      });
      if (res.ok) {
        showToast(`Đã lưu hồ sơ "${name}" thành công!`, 'success');
        saveModal.classList.add('hidden');
        loadProfiles();
      } else {
        showToast('Lỗi khi lưu hồ sơ', 'error');
      }
    } catch (e) {
      showToast('Lỗi mạng khi lưu: ' + e.message, 'error');
    }
  });

  // Copy Console code
  btnCopyConsoleCode.addEventListener('click', () => {
    const code = consoleCodeBlock.innerText;
    navigator.clipboard.writeText(code).then(() => {
      showToast('Đã sao chép mã DevTools Snippet vào clipboard!', 'success');
    }).catch(() => {
      showToast('Không thể copy tự động, vui lòng chọn và bấm Ctrl+C', 'error');
    });
  });

  // Copy Extension folder path
  btnCopyExtPath.addEventListener('click', () => {
    const pathText = document.getElementById('extensionFolderPath').innerText;
    navigator.clipboard.writeText(pathText).then(() => {
      showToast('Đã copy đường dẫn thư mục extension!', 'success');
    });
  });

  // Detect browsers on system
  async function checkSystemBrowsers() {
    try {
      const res = await fetch('/api/browsers');
      const data = await res.json();
      const chromeBadge = document.getElementById('chromeBadge');
      const edgeBadge = document.getElementById('edgeBadge');

      if (data.chrome) {
        chromeBadge.classList.add('active-browser');
      } else {
        chromeBadge.style.opacity = '0.4';
      }

      if (data.edge) {
        edgeBadge.classList.add('active-browser');
      } else {
        edgeBadge.style.opacity = '0.4';
      }
    } catch (e) {
      console.warn('Browser detection skipped:', e);
    }
  }

  // Initial load
  checkSystemBrowsers();
  loadProfiles().then(() => {
    // If input is empty, prefill with first profile if available
    fetch('/api/sessions').then(r => r.json()).then(sessions => {
      if (sessions && sessions.length > 0 && !cookieInput.value) {
        cookieInput.value = sessions[0].cookies;
        updateCookieAnalysis();
      }
    });
  });
});
