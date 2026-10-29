import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import puppeteer from 'puppeteer-core';
import { spawnSync } from 'child_process';
import { readJsonFile, writeJsonAtomic } from './safeJson';
import { dataDir } from './dataDir';
import type { CookieMap, Profile, SessionTestResult, BrowserDetection } from '@/types';

const DATA_DIR = dataDir();
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

/** Kill browser processes still bound to a userDataDir — a previous
 * session window left open (or a zombie after a gateway restart) holds
 * the profile's SingletonLock and every next launch on that dir fails. */
function killProfileBrowsers(userDataDir: string): void {
  const base = path.basename(userDataDir);
  if (!base) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -match '${base.replace(/'/g, "''")}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ], { windowsHide: true, timeout: 10000 });
    } else {
      spawnSync('pkill', ['-f', base], { timeout: 8000 });
    }
  } catch {}
}

/** puppeteer.launch with one recovery retry: if the profile dir is locked
 * by a leftover browser, kill it and launch again instead of erroring. */
async function launchWithProfileRetry(
  opts: Parameters<typeof puppeteer.launch>[0],
): Promise<import('puppeteer-core').Browser> {
  try {
    return await puppeteer.launch(opts);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (!/already running|userDataDir|ProcessSingleton|profile directory/i.test(msg)) throw err;
    killProfileBrowsers(String(opts?.userDataDir || ''));
    await new Promise((r) => setTimeout(r, 800));
    return await puppeteer.launch(opts);
  }
}

// Launch browser with injected cookies
export async function launchBrowserWithCookies(cookies: string, browserType: string = 'chrome') {
  const browserInfo = getBrowserExecutable(browserType);
  if (!browserInfo) {
    throw new Error('Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy tính của bạn.');
  }

  const cookieMap = parseCookieString(cookies);
  const puppeteerCookies = formatCookiesForPuppeteer(cookieMap);

  const browser = await launchWithProfileRetry({
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

export function saveSessionProfile({ id, name, cookies, proxy }: { id?: string; name: string; cookies: string; proxy?: string | null }): Profile {
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
    // proxy === undefined → keep the existing value; null clears it.
    proxy: proxy !== undefined ? proxy : (existingIdx >= 0 ? sessions[existingIdx].proxy ?? null : null),
  };

  if (existingIdx >= 0) {
    sessions[existingIdx] = sessionObj;
  } else {
    sessions.unshift(sessionObj);
  }

  writeJsonAtomic(SESSIONS_FILE, sessions);
  return sessionObj;
}

/** Normalize + validate a proxy URL. Returns the canonical URL or throws.
 *  Accepts "http://host:port", "socks5://user:pass@host:1080", or bare
 *  "host:port" (treated as http). */
export function normalizeProxy(raw: string | null | undefined): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new Error(`Proxy không hợp lệ: "${s}" — dạng đúng: http://[user:pass@]host:port hoặc socks5://host:port`);
  }
  if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(u.protocol)) {
    throw new Error(`Proxy scheme "${u.protocol}" không hỗ trợ — dùng http, https, socks4 hoặc socks5`);
  }
  if (!u.hostname) throw new Error(`Proxy thiếu host: "${s}"`);
  return u.toString();
}

/** Set/clear the egress proxy on a saved session. */
export function updateSessionProxy(id: string, proxy: string | null): Profile | null {
  ensureDataDir();
  const sessions = getSavedSessions();
  const s = sessions.find((x) => x.id === id);
  if (!s) return null;
  s.proxy = proxy;
  s.updatedAt = new Date().toISOString();
  writeJsonAtomic(SESSIONS_FILE, sessions);
  return s;
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

/* ------------------------------------------------------------------ */
/* Login capture — open a real browser, let the user sign in to Muse   */
/* themselves, then harvest the resulting cookies into a saved session. */
/* ------------------------------------------------------------------ */

export interface LoginCaptureJob {
  id: string;
  status: 'waiting' | 'captured' | 'error' | 'closed';
  error?: string;
  browserType: string;
  /** Set once the session lands in the store. */
  sessionId?: string;
  deduped?: boolean;
  /** Re-login mode — captured cookies overwrite this existing session. */
  targetSessionId?: string;
  startedAt: number;
}

const loginJobs = new Map<string, LoginCaptureJob>();
const LOGIN_CAPTURE_TIMEOUT_MS = 5 * 60 * 1000;
const LOGIN_URL = 'https://muse.ai/';
/** Separate profile from USER_DATA_DIR — the session-verify browser may
 * still be open with that profile and Chrome refuses to launch twice on
 * the same userDataDir. */
const LOGIN_USER_DATA_DIR = path.join(os.tmpdir(), 'muse-login-profile');

export function getLoginCaptureJob(id: string): LoginCaptureJob | null {
  return loginJobs.get(id) ?? null;
}

export function cancelLoginCapture(id: string): boolean {
  const job = loginJobs.get(id);
  if (!job || job.status !== 'waiting') return false;
  job.status = 'closed';
  return true;
}

/** Drop jobs older than their timeout so the map doesn't leak. */
function pruneLoginJobs(): void {
  const cutoff = Date.now() - LOGIN_CAPTURE_TIMEOUT_MS * 2;
  for (const [id, job] of loginJobs) {
    if (job.startedAt < cutoff && job.status !== 'waiting') {
      loginJobs.delete(id);
    }
  }
}

/** Puppeteer cookie jar → the `name=value; …` string the session store eats. */
function cookiesToHeader(cookies: { name: string; value: string }[]): string {
  return cookies
    .filter((c) => c.name && c.value)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** Start the capture job — returns immediately; the browser keeps polling
 * in the background until hatch_sess appears, the user closes it, or the
 * 5-minute timeout hits. `targetSessionId` re-logins an existing account:
 * captured cookies overwrite that card directly (hatch_sess rotates on
 * re-login, so dedupe-by-cookie would create a duplicate card). */
export async function startLoginCapture(browserType: string = 'chrome', targetSessionId?: string | null): Promise<LoginCaptureJob> {
  const browserInfo = getBrowserExecutable(browserType);
  if (!browserInfo) {
    throw new Error('Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy tính của bạn.');
  }
  pruneLoginJobs();
  const job: LoginCaptureJob = {
    id: `login_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status: 'waiting',
    browserType: browserInfo.type,
    startedAt: Date.now(),
    targetSessionId: targetSessionId || undefined,
  };
  loginJobs.set(job.id, job);
  void runLoginCapture(job, browserInfo);
  return job;
}

async function runLoginCapture(
  job: LoginCaptureJob,
  browserInfo: BrowserExecutableInfo,
): Promise<void> {
  let browser: import('puppeteer-core').Browser | null = null;
  try {
    browser = await launchWithProfileRetry({
      executablePath: browserInfo.path,
      headless: false,
      defaultViewport: null,
      userDataDir: LOGIN_USER_DATA_DIR,
      args: [
        '--start-maximized',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-infobars',
        '--window-name=Muse_Login_Capture',
      ],
      ignoreDefaultArgs: ['--enable-automation'],
    });
  } catch (err: any) {
    job.status = 'error';
    job.error = 'Không mở được trình duyệt: ' + (err?.message || String(err));
    return;
  }

  try {
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    try {
      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch {
      // Navigation may stall on slow networks — the poll loop below still
      // reads cookies, so a half-loaded login page is workable.
    }

    const deadline = Date.now() + LOGIN_CAPTURE_TIMEOUT_MS;
    while (job.status === 'waiting' && Date.now() < deadline) {
      if (!browser.connected) {
        job.status = 'closed';
        break;
      }
      try {
        // Browser-level jar — catches hatch_sess whichever muse.ai
        // subdomain the login flow bounced through.
        const cookies = await browser.cookies();
        const hasSession = cookies.some((c) => c.name === 'hatch_sess' && !!c.value);
        if (hasSession) {
          const cookieHeader = cookiesToHeader(cookies);
          let session: Profile;
          if (job.targetSessionId) {
            // Re-login — write straight onto the target card.
            const target = getSavedSessions().find((s) => s.id === job.targetSessionId);
            session = target
              ? saveSessionProfile({ id: target.id, name: target.name, cookies: cookieHeader })
              : saveSessionProfile({ name: `Tài khoản ${getSavedSessions().length + 1}`, cookies: cookieHeader });
            job.deduped = !!target;
          } else {
            // Same dedupe rule as manual paste — re-login refreshes the
            // existing card instead of stacking a duplicate.
            const existing = findSessionByCookies(cookieHeader);
            session = existing
              ? saveSessionProfile({ id: existing.id, name: existing.name, cookies: cookieHeader })
              : saveSessionProfile({
                  name: `Tài khoản ${getSavedSessions().length + 1}`,
                  cookies: cookieHeader,
                });
            job.deduped = !!existing;
          }
          job.status = 'captured';
          job.sessionId = session.id;
          break;
        }
      } catch {
        // Page is mid-navigation — cookies() rejects briefly; retry.
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (job.status === 'waiting') {
      job.status = 'error';
      job.error = 'Hết 5 phút chờ đăng nhập — trình duyệt đã đóng.';
    }
    if (job.status === 'closed' && browser.connected) {
      // User pressed cancel while the window was still open.
      job.error = undefined;
    }
  } finally {
    try {
      if (browser.connected) await browser.close();
    } catch { /* window may already be gone */ }
  }
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
