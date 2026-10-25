import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import puppeteer from 'puppeteer-core';
import { readJsonFile, writeJsonAtomic } from './safeJson';
import type { CookieMap, Profile, SessionTestResult, BrowserDetection } from '@/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const USER_DATA_DIR = path.join(os.tmpdir(), 'muse-browser-profile');

// Ensure data directory exists
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(SESSIONS_FILE)) {
    writeJsonAtomic(SESSIONS_FILE, []);
  }
}

function safeFileExists(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export interface BrowserExecutableInfo {
  type: 'chrome' | 'edge';
  path: string;
}

// Find Chrome/Edge executables on Windows
export function getBrowserExecutable(preferred: string = 'chrome'): BrowserExecutableInfo | null {
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
      if (safeFileExists(p)) return { type: 'edge', path: p };
    }
  }

  for (const p of chromePaths) {
    if (safeFileExists(p)) return { type: 'chrome', path: p };
  }

  for (const p of edgePaths) {
    if (safeFileExists(p)) return { type: 'edge', path: p };
  }

  return null;
}

// Parse cookie string into map
export function parseCookieString(rawCookie: string): CookieMap {
  if (!rawCookie || typeof rawCookie !== 'string') return {};
  const cleaned = rawCookie.replace(/^Cookie:\s*/i, '').trim();
  const pairs = cleaned.split(';').map(p => p.trim()).filter(Boolean);
  const cookieMap: CookieMap = {};

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
export function formatCookiesForPuppeteer(cookieMap: CookieMap): any[] {
  const cookies: any[] = [];
  const domain = '.muse.ai';

  for (const [name, value] of Object.entries(cookieMap)) {
    if (!name || value === undefined) continue;

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

// Test session online
export function testSessionOnline(cookieHeader: string): Promise<SessionTestResult> {
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
              status: res.statusCode,
              data: {
                status: data.status,
                vm_id: data.vm_id,
                vm_state: data.vm_state,
                endpoint_url: data.endpoint_url,
                vm_name: data.vm_name,
                vms: data.vms || [],
              },
            });
          } else {
            resolve({
              valid: false,
              status: res.statusCode,
              message: `HTTP ${res.statusCode}: Session không hợp lệ hoặc đã hết hạn.`,
            });
          }
        } catch {
          resolve({
            valid: res.statusCode === 200,
            status: res.statusCode,
            message: 'Phản hồi không phải JSON hợp lệ',
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        valid: false,
        status: 0,
        message: 'Lỗi kết nối tới muse.ai: ' + err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        valid: false,
        status: 408,
        message: 'Hết thời gian chờ phản hồi từ muse.ai (Timeout 10s)',
      });
    });

    req.end();
  });
}

// Launch browser with injected cookies
export async function launchBrowserWithCookies(cookies: string, browserType: string = 'chrome') {
  const browserInfo = getBrowserExecutable(browserType);
  if (!browserInfo) {
    throw new Error('Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy tính của bạn.');
  }

  const cookieMap = parseCookieString(cookies);
  const puppeteerCookies = formatCookiesForPuppeteer(cookieMap);

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

  await page.setCookie(...puppeteerCookies);

  await page.goto('https://muse.ai/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  browser.disconnect();

  return {
    browser: browserInfo.type,
    totalCookiesInjected: puppeteerCookies.length,
  };
}

// Session store operations
export function getSavedSessions(): Profile[] {
  ensureDataDir();
  return readJsonFile<Profile[]>(SESSIONS_FILE, [], Array.isArray);
}

export function saveSessionProfile({ id, name, cookies }: { id?: string; name: string; cookies: string }): Profile {
  ensureDataDir();
  const sessions = getSavedSessions();
  const sessionId = id || 'session_' + Date.now();
  const sessionName = name || 'Session ' + (sessions.length + 1);
  const existingIdx = sessions.findIndex(s => s.id === sessionId);
  const now = new Date().toISOString();

  const sessionObj: Profile = {
    id: sessionId,
    name: sessionName,
    cookies,
    updatedAt: now,
    createdAt: existingIdx >= 0 ? sessions[existingIdx].createdAt : now,
    lastTested: existingIdx >= 0 ? sessions[existingIdx].lastTested ?? null : null,
    lastStatus: existingIdx >= 0 ? sessions[existingIdx].lastStatus ?? null : null,
  };

  if (existingIdx >= 0) {
    sessions[existingIdx] = sessionObj;
  } else {
    sessions.unshift(sessionObj);
  }

  writeJsonAtomic(SESSIONS_FILE, sessions);
  return sessionObj;
}

/** Persist a liveness-check outcome onto a saved session. */
export function updateSessionTest(id: string, valid: boolean): void {
  ensureDataDir();
  const sessions = getSavedSessions();
  const s = sessions.find((x) => x.id === id);
  if (!s) return;
  s.lastTested = new Date().toISOString();
  s.lastStatus = valid ? 'valid' : 'invalid';
  writeJsonAtomic(SESSIONS_FILE, sessions);
}

/** Extract the session identity — hatch_sess value uniquely identifies a Muse account session. */
export function sessionIdentity(cookies: string): string | null {
  const m = cookies.match(/hatch_sess=([^;]+)/);
  return m ? m[1].trim() : null;
}

/** Find a saved session that is the SAME account — matching hatch_sess, or exact cookie string when no hatch_sess. */
export function findSessionByCookies(cookies: string): Profile | undefined {
  const id1 = sessionIdentity(cookies);
  const sessions = getSavedSessions();
  return sessions.find((s) => {
    const id2 = sessionIdentity(s.cookies);
    return id1 && id2 ? id1 === id2 : s.cookies.trim() === cookies.trim();
  });
}

export function deleteSessionProfile(id: string): boolean {
  ensureDataDir();
  let sessions = getSavedSessions();
  sessions = sessions.filter(s => s.id !== id);
  writeJsonAtomic(SESSIONS_FILE, sessions);
  return true;
}

export function generateBookmarklet(cookies: string): { bookmarkletUrl: string; consoleScript: string } {
  const map = parseCookieString(cookies);
  const entries = Object.entries(map);

  const jsLines = entries.map(([k, v]) => {
    return `document.cookie = "${encodeURIComponent(k)}=${encodeURIComponent(v)}; domain=.muse.ai; path=/; max-age=31536000; SameSite=Lax; Secure";`;
  });

  const fullScript = `(function(){
  if (!location.hostname.includes('muse.ai')) {
    alert('Vui lòng mở trang https://muse.ai trước khi nhấn Bookmarklet này!');
    location.href = 'https://muse.ai';
    return;
  }
  ${jsLines.join('\n  ')}
  alert('Đã inject ${entries.length} cookies thành công! Trang sẽ được làm mới ngay.');
  location.reload();
})();`;

  const bookmarkletUrl = 'javascript:' + encodeURIComponent(fullScript.replace(/\n\s*/g, ' '));

  return { bookmarkletUrl, consoleScript: fullScript };
}
