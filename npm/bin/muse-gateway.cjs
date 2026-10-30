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
// Server binds 127.0.0.1 (IPv4 loopback). Advertise that exact address —
// `localhost` can resolve to ::1 on IPv6 machines where Chrome's fallback
// to IPv4 is not guaranteed, producing a refused connection.
const BASE = `http://127.0.0.1:${PORT}`;
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

/** Server status: null when not reachable, else the /api/license view.
 *  runningVersion = the build the RUNNING process reports — an npm update
 *  swaps files on disk but leaves the old process holding the port, so a
 *  mismatch here means "restart to load the new code". */
async function getStatus() {
  const lic = await getJson(`${BASE}/api/license`, 900);
  if (!lic) return null;
  let runningVersion = '';
  try {
    const upd = await getJson(`${BASE}/api/update`, 1500);
    if (upd?.current) runningVersion = String(upd.current);
  } catch {}
  return {
    licensed: !!lic.licensed,
    type: lic.type || 'community',
    expiresAt: lic.expiresAt || '',
    email: lic.email || '',
    runningVersion,
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

/** PID of whatever process is LISTENing on our port — needed because
 *  getStatus() detects the server by HTTP, while the pid file only covers
 *  instances we spawned. An orphan (crashed launcher, older install,
 *  manual `node server`) holds the port but isn't in the pid file, so a
 *  pid-file-only stop reports "nothing to stop" while :1412 stays bound. */
function pidsByPort() {
  const pids = new Set();
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano -p tcp`, { stdio: 'pipe', encoding: 'utf8' });
      for (const line of out.split('\n')) {
        const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
        if (m && m[1] === String(PORT)) pids.add(Number(m[2]));
      }
    } else {
      const out = execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN`, { stdio: 'pipe', encoding: 'utf8' });
      for (const l of out.split('\n')) {
        const p = Number(l.trim());
        if (p > 0) pids.add(p);
      }
    }
  } catch { /* netstat/lsof unavailable — fall through to pid file only */ }
  return [...pids];
}

function killPid(pid) {
  try {
    process.kill(pid);
    return true;
  } catch {
    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'pipe' });
        return true;
      } catch {}
    }
    return false;
  }
}

function stopInstance() {
  const pid = readPid();
  const portPids = pidsByPort().filter((p) => p !== pid && p !== process.pid);
  if (!pid && portPids.length === 0) {
    console.log('No running instance found.');
    return false;
  }
  for (const p of [pid, ...portPids]) if (p > 0) killPid(p);
  fs.rmSync(PID_FILE, { force: true });
  console.log('Muse Gateway stopped.');
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
function spawnBackground(extraArgs = []) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const logFd = fs.openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [__filename, '--serve', ...extraArgs], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  return child.pid;
}

/** Ensure a server is reachable — spawn a background worker if needed. */
async function ensureRunning(extraArgs = []) {
  if (await getStatus()) return true;
  spawnBackground(extraArgs);
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
  // Bind loopback only — tunnels (cloudflared/Tailscale) connect locally so
  // remote access still works, but LAN hosts can't reach the dashboard and
  // spoof `Host: localhost` to bypass the remote guard. MUSE_BIND=0.0.0.0
  // re-opens LAN access for users who need it.
  process.env.HOSTNAME = process.env.MUSE_BIND || '127.0.0.1';

  const { createRequire } = require('module');
  const req = createRequire(path.join(APP_DIR, 'server.js'));
  req(path.join(APP_DIR, 'server.js'));

  fs.writeFileSync(PID_FILE, String(process.pid));
  const ok = await waitReady();
  console.log(`Muse Gateway ${ok ? 'running' : 'starting'} — ${BASE}`);
  console.log(`Data: ${DATA_DIR}`);
  if (!ok) console.log('Server not responding yet — check again in a few seconds.');

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
      // Spawned by "Hide to Tray": confirm via balloon that the terminal can
      // be closed — the worker keeps running detached.
      if (flag('--notify')) {
        setTimeout(() => {
          try {
            tray.balloon(
              'Muse Gateway',
              `Running in the background at ${BASE} — you can close this window.`
            );
          } catch {}
        }, 800);
      }
      process.on('SIGINT', () => shutdown(0));
      process.on('SIGTERM', () => shutdown(0));
    } catch (e) {
      console.log('Tray failed to start:', e?.message || e);
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
        : C.yellow('● running — community (not activated)')
      : C.dim('○ stopped');
    lines.push(C.bold(`  Muse Gateway  v${PKG_VERSION}`));
    lines.push(`  Server:  ${C.cyan(BASE)}   ${statusText}`);
    if (status?.runningVersion && status.runningVersion !== PKG_VERSION) {
      lines.push(
        C.yellow(`  ⚠ Server still running v${status.runningVersion} — "Stop Server" then reopen to load v${PKG_VERSION}.`)
      );
    }
    if (status && !status.licensed) lines.push(`  ${C.yellow('Get a license:')} ${C.cyan('https://www.storetiki.online')}`);
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
      { label: status?.licensed ? `License: ${status.email || status.type} — change key` : 'Enter License Key…', act: 'key' }
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
        process.stdout.write('\nOpening dashboard…\n');
        if (!(await ensureRunning())) {
          console.log(C.yellow('Server not responding — see log: ' + LOG_FILE));
        }
        openBrowser();
        break;
      }

      case 'tray': {
        process.stdout.write('\nStarting background server + tray…\n');
        const ok = await ensureRunning(['--notify']);
        if (ok) {
          console.log(C.green(`Muse Gateway is running in the background at ${BASE}`));
          console.log('Tray icon added — you can close this window.');
          console.log(C.dim(`Log: ${LOG_FILE}`));
        } else {
          console.log(C.yellow('Server not responding — see log: ' + LOG_FILE));
        }
        process.exit(0);
        break;
      }

      case 'fg': {
        console.log(`\nRunning in foreground at ${BASE} — Ctrl+C to stop.\n`);
        await serve();
        return; // serve never returns; keep process alive
      }

      case 'key': {
        process.stdout.write('\n');
        if (!(await ensureRunning())) {
          console.log(C.yellow('Cannot reach the server — check ' + LOG_FILE));
          break;
        }
        const key = await question('Paste license key (MUSE1.…): ');
        if (!key) break;
        const r = await postJson(`${BASE}/api/license`, { action: 'activate', licenseKey: key });
        if (r?.body?.licensed) {
          console.log(C.green(`✓ Activation successful — ${r.body.email || 'pro'}${r.body.expiresAt ? `, expires ${r.body.expiresAt.slice(0, 10)}` : ''}`));
        } else {
          console.log(C.yellow(`✗ Activation failed: ${r?.body?.error || `HTTP ${r?.status || '?'}`}`));
        }
        console.log('\nPress any key to return to the menu…');
        await anyKey();
        break;
      }

      case 'stop': {
        process.stdout.write('\n');
        stopInstance();
        break;
      }

      case 'update': {
        process.stdout.write(`\nInstalling muse-gateway v${latest}…\n`);
        try {
          const upd = spawn('npm', ['i', '-g', 'muse-gateway'], { stdio: 'inherit', shell: true });
          upd.on('error', () => {
            console.log('Update failed — run manually: npm i -g muse-gateway');
            process.exit(0);
          });
          upd.on('exit', async (code) => {
            if (code) {
              console.log('\nUpdate failed — run manually: npm i -g muse-gateway');
              process.exit(0);
            }
            // The old server process still holds the port — files changed on
            // disk but RAM keeps the old build. Kill it and respawn so the
            // new code is actually the one answering :1412.
            console.log('\nRestarting server with the new version…');
            if (await getStatus()) stopInstance();
            spawnBackground();
            const ok = await waitReady(45000);
            const st = ok ? await getStatus() : null;
            console.log(
              st?.runningVersion && cmpVersion(st.runningVersion, latest) >= 0
                ? C.green(`✓ v${st.runningVersion} now serving at ${BASE}`)
                : ok
                  ? `Restarted — dashboard at ${BASE}`
                  : C.yellow('Installed — start manually: muse-gateway')
            );
            process.exit(0);
          });
          return; // npm takes over the terminal
        } catch {
          console.log('Update failed — run manually: npm i -g muse-gateway');
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

  muse-gateway            interactive menu (arrows + enter)
  muse-gateway --serve    run the server in the foreground (internal/worker)
  muse-gateway stop       stop a running background instance
  muse-gateway --open     open the dashboard
  npx muse-gateway        works even when npm's global bin dir is not on PATH
  MUSE_PORT=xxxx muse-gateway  change port (default 1412)
  MUSE_BIND=0.0.0.0 muse-gateway  allow LAN access (default: localhost only)

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
    console.error('Startup error:', e?.message || e);
    process.exit(1);
  });
} else {
  interactiveMenu().catch((e) => {
    console.error('Menu error:', e?.message || e);
    process.exit(1);
  });
}
