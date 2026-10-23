document.addEventListener('DOMContentLoaded', () => {
  const cookieText = document.getElementById('cookieText');
  const detectedCount = document.getElementById('detectedCount');
  const btnInjectAndOpen = document.getElementById('btnInjectAndOpen');
  const btnPaste = document.getElementById('btnPaste');
  const msgBox = document.getElementById('msgBox');

  // Load saved cookie
  chrome.storage.local.get(['lastMuseCookie'], (res) => {
    if (res.lastMuseCookie) {
      cookieText.value = res.lastMuseCookie;
      updateCount();
    }
  });

  function showMsg(text, type = 'success') {
    msgBox.textContent = text;
    msgBox.className = `msg ${type}`;
    msgBox.style.display = 'block';
  }

  function parseCookies(str) {
    if (!str) return {};
    const cleaned = str.replace(/^Cookie:\s*/i, '').trim();
    const map = {};
    const pairs = cleaned.split(';').map(p => p.trim()).filter(Boolean);
    for (const p of pairs) {
      const idx = p.indexOf('=');
      if (idx !== -1) {
        const k = p.slice(0, idx).trim();
        const v = p.slice(idx + 1).trim();
        if (k) map[k] = v;
      }
    }
    return map;
  }

  function updateCount() {
    const map = parseCookies(cookieText.value);
    const count = Object.keys(map).length;
    detectedCount.textContent = `${count} cookies`;
  }

  cookieText.addEventListener('input', updateCount);

  btnPaste.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        cookieText.value = text;
        updateCount();
        showMsg('Đã dán từ clipboard!', 'success');
      }
    } catch (e) {
      showMsg('Hãy nhấn Ctrl+V để dán', 'error');
    }
  });

  btnInjectAndOpen.addEventListener('click', async () => {
    const raw = cookieText.value.trim();
    if (!raw) {
      showMsg('Vui lòng nhập cookie!', 'error');
      return;
    }

    const map = parseCookies(raw);
    const entries = Object.entries(map);

    if (entries.length === 0) {
      showMsg('Không tìm thấy cookie hợp lệ nào!', 'error');
      return;
    }

    btnInjectAndOpen.disabled = true;
    btnInjectAndOpen.textContent = 'Đang nạp...';

    // Save for next time
    chrome.storage.local.set({ lastMuseCookie: raw });

    let successCount = 0;

    for (const [name, value] of entries) {
      try {
        if (name.startsWith('__Host-')) {
          await chrome.cookies.set({
            url: 'https://muse.ai',
            name,
            value,
            path: '/',
            secure: true,
          });
        } else {
          await chrome.cookies.set({
            url: 'https://muse.ai',
            domain: '.muse.ai',
            name,
            value,
            path: '/',
            secure: true,
            sameSite: 'lax',
          });

          if (name === 'datr') {
            await chrome.cookies.set({
              url: 'https://meta.com',
              domain: '.meta.com',
              name,
              value,
              path: '/',
              secure: true,
            });
          }
        }
        successCount++;
      } catch (err) {
        console.warn('Cookie set error for', name, err);
      }
    }

    showMsg(`Đã nạp thành công ${successCount}/${entries.length} cookies! Đang mở Muse...`, 'success');

    // Open or reload muse.ai
    chrome.tabs.query({ url: '*://*.muse.ai/*' }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.reload(tabs[0].id);
        chrome.tabs.update(tabs[0].id, { active: true });
      } else {
        chrome.tabs.create({ url: 'https://muse.ai/' });
      }

      setTimeout(() => {
        btnInjectAndOpen.disabled = false;
        btnInjectAndOpen.textContent = '🚀 Nạp Cookie & Mở Muse';
      }, 1500);
    });
  });
});
