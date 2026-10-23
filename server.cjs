const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const puppeteer = require('puppeteer-core');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const USER_DATA_DIR = path.join(__dirname, '.browser-profile');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data folder exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(SESSIONS_FILE)) {
  fs.writeFileSync(SESSIONS_FILE, '[]', 'utf8');
}

// Find Chrome/Edge executables on Windows
function getBrowserExecutable(preferred = 'chrome') {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const chromePaths = [
    path.join(programFiles, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(programFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
  ];

  const edgePaths = [
    path.join(programFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(programFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(localAppData, 'Microsoft\\Edge\\Application\\msedge.exe'),
  ];

  if (preferred === 'edge') {
    for (const p of edgePaths) {
      if (fs.existsSync(p)) return { type: 'edge', path: p };
    }
  }

  // Default to chrome if available, otherwise edge
  for (const p of chromePaths) {
    if (fs.existsSync(p)) return { type: 'chrome', path: p };
  }

  for (const p of edgePaths) {
    if (fs.existsSync(p)) return { type: 'edge', path: p };
  }

  return null;
}

// Parse cookie string into map and array
function parseCookieString(rawCookie) {
  if (!rawCookie || typeof rawCookie !== 'string') return {};
  const cleaned = rawCookie.replace(/^Cookie:\s*/i, '').trim();
  const pairs = cleaned.split(';').map(p => p.trim()).filter(Boolean);
  const cookieMap = {};

  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx !== -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key) {
        cookieMap[key] = val;
      }
    }
  }
  return cookieMap;
}

// Format cookie map into Puppeteer-compatible cookie objects
function formatCookiesForPuppeteer(cookieMap) {
  const cookies = [];
  const domain = '.muse.ai';

  for (const [name, value] of Object.entries(cookieMap)) {
    if (!name || value === undefined) continue;

    // Handle __Host- prefix which rejects explicit domain attribute
    if (name.startsWith('__Host-')) {
      cookies.push({
        name,
        value,
        url: 'https://muse.ai',
        path: '/',
        secure: true,
      });
    } else {
      cookies.push({
        name,
        value,
        domain,
        path: '/',
        secure: true,
        sameSite: 'Lax',
      });

      // Special handling for datr: also mirror to .meta.com
      if (name === 'datr') {
        cookies.push({
          name,
          value,
          domain: '.meta.com',
          path: '/',
          secure: true,
        });
      }
    }
  }
  return cookies;
}

// Test session against https://muse.ai/api/session
function testSessionOnline(cookieHeader) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'muse.ai',
      path: '/api/session',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Cookie': cookieHeader,
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://muse.ai/',
      },
      timeout: 10000,
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const data = JSON.parse(body);
            resolve({
              valid: true,
              statusCode: res.statusCode,
              data: {
                status: data.status,
                vm_id: data.vm_id,
                vm_state: data.vm_state,
                endpoint_url: data.endpoint_url,
                vm_name: data.vm_name,
                vms: data.vms || [],
              },
              raw: data,
            });
          } else {
            resolve({
              valid: false,
              statusCode: res.statusCode,
              message: `HTTP ${res.statusCode}: Session không hợp lệ hoặc đã hết hạn.`,
              raw: body.slice(0, 500),
            });
          }
        } catch (e) {
          resolve({
            valid: res.statusCode === 200,
            statusCode: res.statusCode,
            message: 'Phản hồi không phải JSON hợp lệ',
            raw: body.slice(0, 500),
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        valid: false,
        statusCode: 0,
        message: 'Lỗi kết nối tới muse.ai: ' + err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        valid: false,
        statusCode: 408,
        message: 'Hết thời gian chờ phản hồi từ muse.ai (Timeout 10s)',
      });
    });

    req.end();
  });
}

// ----------------- API ROUTES ----------------- //

// Check available browsers on host system
app.get('/api/browsers', (req, res) => {
  const chrome = getBrowserExecutable('chrome');
  const edge = getBrowserExecutable('edge');
  res.json({
    chrome: chrome && chrome.type === 'chrome' ? chrome.path : null,
    edge: edge && edge.type === 'edge' ? edge.path : null,
  });
});

// Parse cookie string
app.post('/api/parse', (req, res) => {
  const { cookies } = req.body;
  if (!cookies) {
    return res.status(400).json({ error: 'Không có dữ liệu cookie' });
  }

  const map = parseCookieString(cookies);
  const keys = Object.keys(map);
  const keyTokens = {
    hatch_sess: map['hatch_sess'] ? map['hatch_sess'].slice(0, 36) + '...' : null,
    hatch_vml: map['hatch_vml'] ? 'Có sẵn (' + map['hatch_vml'].length + ' ký tự)' : null,
    hatch_gw: map['hatch_gw'] ? 'Có sẵn (' + map['hatch_gw'].length + ' ký tự)' : null,
    hatch_native_auth_device: map['hatch_native_auth_device'] ? 'Có sẵn' : null,
    hatch_native_auth_temp: map['hatch_native_auth_temp'] ? 'Có sẵn' : null,
    datr: map['datr'] || null,
    theme: map['theme'] ? 'Đã cấu hình' : null,
  };

  const hasEssential = !!(map['hatch_sess'] && map['hatch_vml']);

  res.json({
    success: true,
    totalCookies: keys.length,
    keys,
    hasEssential,
    keyTokens,
  });
});

// Test session online
app.post('/api/test-session', async (req, res) => {
  const { cookies } = req.body;
  if (!cookies) {
    return res.status(400).json({ error: 'Vui lòng cung cấp cookie để kiểm tra' });
  }

  const result = await testSessionOnline(cookies);
  res.json(result);
});

// Launch Browser with injected cookies
app.post('/api/launch-browser', async (req, res) => {
  const { cookies, browserType } = req.body;
  if (!cookies) {
    return res.status(400).json({ error: 'Vui lòng cung cấp cookie để mở trình duyệt' });
  }

  const browserInfo = getBrowserExecutable(browserType || 'chrome');
  if (!browserInfo) {
    return res.status(500).json({
      error: 'Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy tính của bạn.',
    });
  }

  const cookieMap = parseCookieString(cookies);
  const puppeteerCookies = formatCookiesForPuppeteer(cookieMap);

  try {
    // Launch Chrome / Edge
    const browser = await puppeteer.launch({
      executablePath: browserInfo.path,
      headless: false,
      defaultViewport: null,
      userDataDir: USER_DATA_DIR,
      args: [
        '--start-maximized',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-name=Muse_Web_Session',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();

    // Set all cookies in browser
    await page.setCookie(...puppeteerCookies);

    // Navigate to Muse
    await page.goto('https://muse.ai/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Detach Puppeteer connection so browser remains fully active for user
    browser.disconnect();

    res.json({
      success: true,
      message: `Đã mở Muse thành công trên ${browserInfo.type === 'chrome' ? 'Google Chrome' : 'Microsoft Edge'}!`,
      browser: browserInfo.type,
      totalCookiesInjected: puppeteerCookies.length,
    });
  } catch (err) {
    console.error('Launch browser error:', err);
    res.status(500).json({
      error: 'Lỗi khi khởi chạy trình duyệt: ' + err.message,
    });
  }
});

// List saved sessions
app.get('/api/sessions', (req, res) => {
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    const sessions = JSON.parse(raw);
    res.json(sessions);
  } catch (e) {
    res.json([]);
  }
});

// Save or update session
app.post('/api/sessions', (req, res) => {
  const { id, name, cookies } = req.body;
  if (!cookies) {
    return res.status(400).json({ error: 'Thiếu cookie' });
  }

  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    let sessions = JSON.parse(raw);

    const sessionId = id || 'session_' + Date.now();
    const sessionName = name || 'Session ' + (sessions.length + 1);

    const existingIdx = sessions.findIndex(s => s.id === sessionId);
    const now = new Date().toISOString();

    const sessionObj = {
      id: sessionId,
      name: sessionName,
      cookies,
      updatedAt: now,
      createdAt: existingIdx >= 0 ? sessions[existingIdx].createdAt : now,
    };

    if (existingIdx >= 0) {
      sessions[existingIdx] = sessionObj;
    } else {
      sessions.unshift(sessionObj);
    }

    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    res.json({ success: true, session: sessionObj });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi khi lưu session: ' + e.message });
  }
});

// Delete session
app.delete('/api/sessions/:id', (req, res) => {
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf8');
    let sessions = JSON.parse(raw);
    sessions = sessions.filter(s => s.id !== req.params.id);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi xóa session: ' + e.message });
  }
});

// Generate Bookmarklet & In-Console JS
app.post('/api/bookmarklet', (req, res) => {
  const { cookies } = req.body;
  if (!cookies) return res.status(400).json({ error: 'Thiếu cookie' });

  const cookieMap = parseCookieString(cookies);
  const cookieEntries = Object.entries(cookieMap);

  // JavaScript snippet to inject cookies into document.cookie
  const jsLines = cookieEntries.map(([k, v]) => {
    return `document.cookie = "${encodeURIComponent(k)}=${encodeURIComponent(v)}; domain=.muse.ai; path=/; max-age=31536000; SameSite=Lax; Secure";`;
  });

  const fullScript = `(function(){
  if (!location.hostname.includes('muse.ai')) {
    alert('Vui lòng mở trang https://muse.ai trước khi nhấn Bookmarklet này!');
    location.href = 'https://muse.ai';
    return;
  }
  ${jsLines.join('\n  ')}
  alert('Đã inject ${cookieEntries.length} cookies thành công! Trang sẽ được làm mới ngay.');
  location.reload();
})();`;

  const bookmarkletUrl = 'javascript:' + encodeURIComponent(fullScript.replace(/\n\s*/g, ' '));

  res.json({
    bookmarkletUrl,
    consoleScript: fullScript,
  });
});

app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🚀 Muse Session Hub đang chạy tại: http://localhost:${PORT}`);
  console.log(`===============================================`);
});
