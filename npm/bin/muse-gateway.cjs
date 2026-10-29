#!/usr/bin/env node
'use strict';
// Muse Gateway CLI — interactive launcher (9router-style):
//
//   muse-gateway            interactive menu (arrows + enter)
//   muse-gateway --serve    run the server in this terminal (internal/worker)
//   muse-gateway --no-tray  --serve without a tray icon
//   muse-gateway stop       stop a running background instance
//   muse-gateway --open     open the dashboard in a browser
//   muse-gateway --help
//
// App files live beside this script in <pkg>/app; runtime state goes to
// ~/.muse-gateway (sessions, license, API keys, usage, server.log, pid file).

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { execSync, spawn } = require('child_process');
const readline = require('readline');

const PKG_ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(PKG_ROOT, 'app');
const DATA_DIR = path.join(os.homedir(), '.muse-gateway');
const PID_FILE = path.join(DATA_DIR, 'muse-gateway.pid');
const LOG_FILE = path.join(DATA_DIR, 'server.log');
const PORT = process.env.MUSE_PORT || process.env.PORT || '1412';
const BASE = `http://localhost:${PORT}`;
const REG_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const REG_NAME = 'MuseGateway';
const PKG_VERSION = (() => {
  try {
    return require(path.join(PKG_ROOT, 'package.json')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);

// ── Small helpers ─────────────────────────────────────────────────────────
const C = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function openBrowser() {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', BASE], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [BASE], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [BASE], { detached: true, stdio: 'ignore' }).unref();
  } catch {}
}

function getJson(url, timeoutMs = 900) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function postJson(url, body, timeoutMs = 5000) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = http.request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, timeout: timeoutMs },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(buf) });
          } catch {
            resolve({ status: res.statusCode, body: null });
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end(data);
  });
}

/** Server status: null when not reachable, else the /api/license view. */
async function getStatus() {
  const lic = await getJson(`${BASE}/api/license`, 900);
  if (!lic) return null;
  return {
    licensed: !!lic.licensed,
    type: lic.type || 'community',
    expiresAt: lic.expiresAt || '',
    email: lic.email || '',
  };
}

// ── Autostart (Windows registry Run key) ──────────────────────────────────
function isAutostartEnabled() {
  if (process.platform !== 'win32') return false;
  try {
    execSync(`reg query "${REG_KEY}" /v ${REG_NAME}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function toggleAutostart() {
  if (isAutostartEnabled()) {
    execSync(`reg delete "${REG_KEY}" /v ${REG_NAME} /f`, { stdio: 'pipe' });
    return false;
  }
  const cmd = `"${process.execPath}" "${__filename}" --serve`;
  execSync(`reg add "${REG_KEY}" /v ${REG_NAME} /d "${cmd.replace(/"/g, '\\"')}" /f`, { stdio: 'pipe' });
  return true;
}

// ── Process control ───────────────────────────────────────────────────────
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    return pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

function stopInstance() {
  const pid = readPid();
  if (!pid) {
    console.log('Không thấy instance nào đang chạy (không có pid file).');
    return false;
  }
  try {
    process.kill(pid);
  } catch {
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'pipe' });
      } catch {}
    }
  }
  fs.rmSync(PID_FILE, { force: true });
  console.log('Muse Gateway đã dừng.');
  return true;
}

function waitReady(timeoutMs = 30000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      const req = http.get(`${BASE}/api/license`, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - t0 > timeoutMs) resolve(false);
        else setTimeout(tick, 400);
      });
      req.setTimeout(1000, () => req.destroy());
    };
    tick();
  });
}

/** Spawn the server as a detached background worker (logs → server.log). */
function spawnBackground() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const logFd = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [__filename, '--serve'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  return child.pid;
}

/** Ensure a server is reachable — spawn a background worker if needed. */
async function ensureRunning() {
  if (await getStatus()) return true;
  spawnBackground();
  return waitReady();
}

// ── Foreground server (in-process) — used by --serve / "Run in terminal" ──
async function serve() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Runtime state lives under ~/.muse-gateway. Next's standalone server.js
  // chdir()s itself into the app dir at boot, so process.cwd() inside the
  // server is NOT reliable — MUSE_DATA_DIR is the explicit contract.
  process.chdir(DATA_DIR);
  process.env.PORT = PORT;
  process.env.NODE_ENV = 'production';
  process.env.MUSE_APP_DIR = APP_DIR;
  process.env.MUSE_DATA_DIR = DATA_DIR;

  const { createRequire } = require('module');
  const req = createRequire(path.join(APP_DIR, 'server.js'));
  req(path.join(APP_DIR, 'server.js'));

  fs.writeFileSync(PID_FILE, String(process.pid));
  const ok = await waitReady();
  console.log(`Muse Gateway ${ok ? 'đang chạy' : 'đang khởi động'} — ${BASE}`);
  console.log(`Data: ${DATA_DIR}`);
  if (!ok) console.log('Chưa thấy server phản hồi — kiểm tra lại sau vài giây.');

  let tray = null;
  const wantTray = process.platform === 'win32' && !flag('--no-tray');
  if (wantTray) {
    try {
      const { startTray } = require(path.join(PKG_ROOT, 'tray', 'tray-client.cjs'));
      const shutdown = (code = 0) => {
        try {
          tray && tray.kill();
        } catch {}
        try {
          fs.rmSync(PID_FILE, { force: true });
        } catch {}
        process.exit(code);
      };
      tray = startTray({
        ps1Path: path.join(PKG_ROOT, 'tray', 'tray.ps1'),
        iconPath: path.join(PKG_ROOT, 'tray', 'icon.ico'),
        tooltip: `Muse Gateway (Port ${PORT})`,
        items: [
          { title: 'Open Dashboard' },
          { title: `${isAutostartEnabled() ? '✓ ' : ''}Auto-start` },
          { title: 'Quit' },
        ],
        onClick: (i) => {
          if (i === 0) openBrowser();
          else if (i === 1) {
            const on = toggleAutostart();
            tray.updateItem(1, `${on ? '✓ ' : ''}Auto-start`, true);
          } else if (i === 2) shutdown(0);
        },
        onExit: () => {},
      });
      process.on('SIGINT', () => shutdown(0));
      process.on('SIGTERM', () => shutdown(0));
    } catch (e) {
      console.log('Tray không khởi động được:', e?.message || e);
    }
  }
}

// ── Version check (npm registry — only works once the package is public) ──
function checkLatestVersion(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = https.get(
      'https://registry.npmjs.org/muse-gateway/latest',
      { timeout: timeoutMs, headers: { accept: 'application/json' } },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(buf).version || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// ── Interactive menu ──────────────────────────────────────────────────────
function question(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function anyKey() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.once('keypress', () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      resolve();
    });
  });
}

async function interactiveMenu() {
  readline.emitKeypressEvents(process.stdin);

  const latest = await checkLatestVersion();
  const hasUpdate = latest && cmpVersion(latest, PKG_VERSION) > 0;

  const render = (status, sel, items) => {
    const lines = [];
    const bar = '='.repeat(55);
    lines.push('');
    lines.push(C.cyan(bar));
    const statusText = status
      ? status.licensed
        ? C.green(`● running — ${status.type}${status.expiresAt ? ` (exp ${status.expiresAt.slice(0, 10)})` : ''}`)
        : C.yellow('● running — community (chưa kích hoạt)')
      : C.dim('○ stopped');
    lines.push(C.bold(`  Muse Gateway  v${PKG_VERSION}`));
    lines.push(`  Server:  ${C.cyan(BASE)}   ${statusText}`);
    if (status && !status.licensed) lines.push(`  ${C.yellow('Mua key:')} ${C.cyan('https://www.storetiki.online')}`);
    lines.push(C.cyan(bar));
    items.forEach((it, i) => {
      lines.push(i === sel ? C.cyan(`> ${it.label}`) : `  ${it.label}`);
    });
    lines.push('');
    return lines.join('\n');
  };

  const buildItems = (status) => {
    const items = [];
    if (hasUpdate) items.push({ label: `Update to v${latest} (current: v${PKG_VERSION})`, act: 'update' });
    items.push(
      { label: 'Open Dashboard (Web UI)', act: 'open' },
      { label: 'Hide to Tray (Background)', act: 'tray' },
      { label: 'Run in this terminal (foreground)', act: 'fg' },
      { label: status?.licensed ? `License: ${status.email || status.type} — đổi key khác` : 'Enter License Key…', act: 'key' }
    );
    if (status) items.push({ label: 'Stop Server', act: 'stop' });
    items.push({ label: 'Exit', act: 'exit' });
    return items;
  };

  const draw = (status, sel, items) => {
    // redraw in place: move cursor to just below the first blank line we print
    process.stdout.write('\x1b[?25l'); // hide cursor
    process.stdout.write('\x1b[H'); // home
    process.stdout.write(render(status, sel, items));
    process.stdout.write('\x1b[J'); // clear below
    process.stdout.write('\x1b[?25h');
  };

  let status = await getStatus();
  let items = buildItems(status);
  let sel = 0;

  process.stdout.write('\x1b[2J\x1b[H');
  draw(status, sel, items);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  const onKey = async (_, key) => {
    if (!key) return;
    if (key.name === 'up') sel = (sel - 1 + items.length) % items.length;
    else if (key.name === 'down') sel = (sel + 1) % items.length;
    else if (key.name === 'c' && key.ctrl) {
      cleanup();
      process.exit(0);
    } else if (key.name !== 'return' && key.name !== 'enter') return;

    if (key.name === 'up' || key.name === 'down') {
      draw(status, sel, items);
      return;
    }

    const item = items[sel];
    if (!item) return;
    process.stdin.setRawMode(false);
    process.stdin.removeListener('keypress', onKey);

    switch (item.act) {
      case 'exit':
        process.exit(0);
        break;

      case 'open': {
        process.stdout.write('\nĐang mở dashboard…\n');
        if (!(await ensureRunning())) {
          console.log(C.yellow('Server chưa phản hồi — xem log: ' + LOG_FILE));
        }
        openBrowser();
        break;
      }

      case 'tray': {
        process.stdout.write('\nĐang khởi động server nền + tray…\n');
        const ok = await ensureRunning();
        if (ok) {
          console.log(C.green(`Muse Gateway chạy nền tại ${BASE}`));
          console.log('Icon đã có trong system tray — có thể đóng cửa sổ này.');
          console.log(C.dim(`Log: ${LOG_FILE}`));
        } else {
          console.log(C.yellow('Server chưa phản hồi — xem log: ' + LOG_FILE));
        }
        process.exit(0);
        break;
      }

      case 'fg': {
        console.log(`\nChạy foreground tại ${BASE} — Ctrl+C để dừng.\n`);
        await serve();
        return; // serve never returns; keep process alive
      }

      case 'key': {
        process.stdout.write('\n');
        if (!(await ensureRunning())) {
          console.log(C.yellow('Không kết nối được server — kiểm tra ' + LOG_FILE));
          break;
        }
        const key = await question('Dán license key (MUSE1.…): ');
        if (!key) break;
        const r = await postJson(`${BASE}/api/license`, { action: 'activate', licenseKey: key });
        if (r?.body?.licensed) {
          console.log(C.green(`✓ Kích hoạt thành công — ${r.body.email || 'pro'}${r.body.expiresAt ? `, hết hạn ${r.body.expiresAt.slice(0, 10)}` : ''}`));
        } else {
          console.log(C.yellow(`✗ Kích hoạt thất bại: ${r?.body?.error || `HTTP ${r?.status || '?'}`}`));
        }
        console.log('\nNhấn phím bất kỳ để về menu…');
        await anyKey();
        break;
      }

      case 'stop': {
        process.stdout.write('\n');
        stopInstance();
        break;
      }

      case 'update': {
        process.stdout.write(`\nĐang cài muse-gateway v${latest}…\n`);
        try {
          const upd = spawn('npm', ['i', '-g', 'muse-gateway'], { stdio: 'inherit', shell: true });
          upd.on('error', () => {
            console.log('Update thất bại — chạy tay: npm i -g muse-gateway');
            process.exit(0);
          });
          upd.on('exit', () => {
            console.log('\nCập nhật xong — chạy lại `muse-gateway`.');
            process.exit(0);
          });
          return; // npm takes over the terminal
        } catch {
          console.log('Update thất bại — chạy tay: npm i -g muse-gateway');
        }
        break;
      }
    }

    // re-render with fresh status
    status = await getStatus();
    items = buildItems(status);
    sel = Math.min(sel, items.length - 1);
    draw(status, sel, items);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on('keypress', onKey);
  };

  const cleanup = () => {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  };
  process.stdin.on('keypress', onKey);
}

// ── Entry ─────────────────────────────────────────────────────────────────
if (flag('--help') || flag('-h')) {
  console.log(`Muse Gateway CLI

  muse-gateway            menu tương tác (mũi tên + enter)
  muse-gateway --serve    chạy server ở foreground (dùng nội bộ)
  muse-gateway stop       dừng instance đang chạy nền
  muse-gateway --open     mở dashboard
  MUSE_PORT=xxxx muse-gateway  đổi port (mặc định 1412)

Data:  ${DATA_DIR}
Log:   ${LOG_FILE}`);
  process.exit(0);
}

if (flag('--version') || flag('-v')) {
  console.log(`muse-gateway v${PKG_VERSION}`);
  process.exit(0);
}

if (flag('stop')) stopInstance();
else if (flag('--open')) {
  ensureRunning().then(openBrowser);
} else if (flag('--serve') || flag('--tray') || !process.stdin.isTTY) {
  serve().catch((e) => {
    console.error('Lỗi khởi động:', e?.message || e);
    process.exit(1);
  });
} else {
  interactiveMenu().catch((e) => {
    console.error('Lỗi menu:', e?.message || e);
    process.exit(1);
  });
}
