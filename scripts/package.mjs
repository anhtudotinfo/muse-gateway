#!/usr/bin/env node
// Package the standalone Next build into a shippable customer folder:
//
//   npm run build  →  node scripts/package.mjs [--zip]
//
// Layout produced in dist/muse-gateway/:
//   muse-gateway.exe   = copy of node.exe with an embedded SEA launcher
//   server.js          = Next standalone entry
//   .next/ node_modules/ public/
//   data/              = created at first run (sessions, license, keys…)
//   CHAY.bat           = double-click start + opens the dashboard
//
// The private license key, scripts/ and your local data/ NEVER ship here —
// they are excluded via outputFileTracingExcludes in next.config.mjs.

import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
const distRoot = path.join(root, 'dist');
const dist = path.join(distRoot, 'muse-gateway');
const makeZip = process.argv.includes('--zip');

if (!fs.existsSync(path.join(standalone, 'server.js'))) {
  console.error('Chưa có .next/standalone — chạy `npm run build` trước.');
  process.exit(1);
}

// ── 1. Assemble app folder ────────────────────────────────────────────────
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.cpSync(standalone, dist, { recursive: true });

// Standalone emits hashed externals (e.g. puppeteer-core-<hash>) as junctions
// under .next/node_modules. On Node <=20 fs.cpSync re-creates them as links;
// npm pack then silently drops them and every puppeteer route 500s at
// runtime. Resolve every link in the shipped tree into a real directory.
const derefLinks = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isSymbolicLink()) {
      const real = fs.realpathSync(p);
      fs.rmSync(p, { recursive: true, force: true });
      fs.cpSync(real, p, { recursive: true });
    } else if (e.isDirectory()) {
      derefLinks(p);
    }
  }
};
derefLinks(dist);

// Client-side static assets are NOT part of the standalone trace — copy.
const staticSrc = path.join(root, '.next', 'static');
if (fs.existsSync(staticSrc)) {
  fs.cpSync(staticSrc, path.join(dist, '.next', 'static'), { recursive: true });
}
// Public assets likewise.
const publicSrc = path.join(root, 'public');
if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, path.join(dist, 'public'), { recursive: true });
}
// Hard guarantee: no secrets/state inside the shipped tree.
for (const p of ['data', 'scripts', '.license-private.pem', '.git']) {
  fs.rmSync(path.join(dist, p), { recursive: true, force: true });
}

// Source maps are dev-only — stripping them from the traced node_modules
// (~68MB under next/dist/compiled alone) keeps the package lean.
let stripped = 0;
const stripMaps = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) stripMaps(p);
    else if (e.name.endsWith('.map')) {
      fs.rmSync(p);
      stripped++;
    }
  }
};
const distNm = path.join(dist, 'node_modules');
if (fs.existsSync(distNm)) {
  stripMaps(distNm);
  console.log(`  stripped ${stripped} source maps from node_modules`);
  // sharp ships binaries for every platform under @img — the package is
  // Windows-only so anything that isn't the win32-x64 build is dead weight
  // (~7MB). @img/colour is a tiny JS lib used by sharp — keep it.
  const imgDir = path.join(distNm, '@img');
  if (fs.existsSync(imgDir)) {
    for (const e of fs.readdirSync(imgDir)) {
      if (e.startsWith('sharp-') && e !== 'sharp-win32-x64') {
        fs.rmSync(path.join(imgDir, e), { recursive: true, force: true });
        console.log(`  removed @img/${e} (non-Windows sharp binary)`);
      }
    }
  }
}

// ── 2. SEA launcher ───────────────────────────────────────────────────────
const launcher = path.join(dist, 'launcher.cjs');
fs.writeFileSync(
  launcher,
  `'use strict';
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const dir = path.dirname(process.execPath);
process.chdir(dir);
process.env.PORT = process.env.MUSE_PORT || process.env.PORT || '1412';
process.env.NODE_ENV = 'production';
process.env.MUSE_PACKED = '1';
process.env.MUSE_APP_DIR = dir;
process.env.MUSE_DATA_DIR = dir;
// Loopback-only bind — tunnels connect locally; MUSE_BIND=0.0.0.0 opens LAN.
process.env.HOSTNAME = process.env.MUSE_BIND || '127.0.0.1';
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
// Inside a SEA binary, require() only resolves builtins — createRequire
// returns a regular CommonJS loader anchored at a real filesystem path.
const { createRequire } = require('module');
const req = createRequire(path.join(dir, 'server.js'));

// ── System tray (Windows, via PowerShell NotifyIcon) ─────────────────────
const BASE = 'http://localhost:' + process.env.PORT;
const REG_KEY = 'HKCU\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Run';
function openDashboard() {
  try { spawn('cmd', ['/c', 'start', '', BASE], { detached: true, stdio: 'ignore' }).unref(); } catch {}
}
function autoOn() {
  try { execSync('reg query "' + REG_KEY + '" /v MuseGateway', { stdio: 'pipe' }); return true; } catch { return false; }
}
// Run value must not point at the exe directly — it is a console-
// subsystem binary, so Windows gives it a terminal window at every
// login (closing it kills the server). wscript + VBS with window style
// 0 starts it with no console; the tray NotifyIcon still appears.
function toggleAuto() {
  if (autoOn()) { execSync('reg delete "' + REG_KEY + '" /v MuseGateway /f', { stdio: 'pipe' }); return false; }
  const vbs = path.join(dir, 'data', 'muse-gateway-autostart.vbs');
  fs.writeFileSync(vbs, 'Set sh = CreateObject("WScript.Shell")\\r\\nsh.Run """' + process.execPath + '""", 0, False\\r\\n');
  const regVal = 'wscript.exe "' + vbs + '"';
  execSync('reg add "' + REG_KEY + '" /v MuseGateway /d "' + regVal.replace(/"/g, '\\\\"') + '" /f', { stdio: 'pipe' });
  return true;
}
try {
  if (process.platform === 'win32' && fs.existsSync(path.join(dir, 'tray', 'tray.ps1'))) {
    const { startTray } = req('./tray/tray-client.cjs');
    const tray = startTray({
      ps1Path: path.join(dir, 'tray', 'tray.ps1'),
      iconPath: path.join(dir, 'tray', 'icon.ico'),
      tooltip: 'Muse Gateway (Port ' + process.env.PORT + ')',
      items: [
        { title: 'Open Dashboard' },
        { title: (autoOn() ? '\\u2713 ' : '') + 'Auto-start' },
        { title: 'Quit' },
      ],
      onClick: (i) => {
        if (i === 0) openDashboard();
        else if (i === 1) tray.updateItem(1, (toggleAuto() ? '\\u2713 ' : '') + 'Auto-start', true);
        else if (i === 2) { try { tray.kill(); } catch {} process.exit(0); }
      },
    });
  }
} catch {}

req(path.join(dir, 'server.js'));
`
);

const seaConfig = path.join(dist, 'sea-config.json');
fs.writeFileSync(
  seaConfig,
  JSON.stringify(
    {
      main: 'launcher.cjs',
      output: 'sea.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: true,
    },
    null,
    2
  )
);

execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], {
  cwd: dist,
  stdio: 'inherit',
});

// ── 3. Build the exe: node.exe copy + injected blob ───────────────────────
const exe = path.join(dist, 'muse-gateway.exe');
fs.copyFileSync(process.execPath, exe);
execSync(
  `npx --yes postject "${exe}" NODE_SEA_BLOB "${path.join(dist, 'sea.blob')}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
  { cwd: dist, stdio: 'inherit' }
);
fs.rmSync(seaConfig, { force: true });
fs.rmSync(path.join(dist, 'sea.blob'), { force: true });

// ── 4. Integrity manifest ─────────────────────────────────────────────────
// The source is public (MIT), so chunks ship as plain readable JS. Prepend a
// short header BEFORE hashing — server.js is part of the integrity set.
const ENTRY_HEADER = `/*
 * Muse Gateway — MIT licensed. Source: https://github.com/lynbyte/muse-gateway
 */
`;
{
  const p = path.join(dist, 'server.js');
  fs.writeFileSync(p, ENTRY_HEADER + fs.readFileSync(p, 'utf8'));
}

const serverDir = path.join(dist, '.next', 'server');
// Snapshot every integrity-hashed file before writing .lk — if AV eats a
// file anywhere between here and the pack, the manifest would happily
// hash the surviving tree and we'd ship a silently broken build. The
// ship-check at pack time asserts every one of these still exists.
const shippedFiles = [path.join(dist, 'server.js')];
{
  const snapAll = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) snapAll(p);
      else if (/\.(js|json|map|cjs|mjs)$/i.test(e.name)) shippedFiles.push(p);
    }
  };
  snapAll(serverDir);
}
// Integrity manifest: sha256 over server.js + every .next/server file. The
// runtime gate re-hashes and refuses to open on any patch.
{
  const crypto = await import('node:crypto');
  const h = crypto.createHash('sha256');
  const files = [path.join(dist, 'server.js')];
  const walkAll = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkAll(p);
      else if (/\.(js|json|map|cjs|mjs)$/i.test(e.name)) files.push(p);
    }
  };
  walkAll(serverDir);
  files.sort();
  for (const f of files) {
    h.update(path.relative(serverDir, f).replace(/\\/g, '/'));
    h.update(fs.readFileSync(f));
  }
  fs.writeFileSync(path.join(serverDir, '.lk'), h.digest('hex'));
}

// ── 4b. Notes for people and agents reading the installed package ────────
const PACKAGE_NOTES = `# Muse Gateway — built package

This folder is the compiled build of Muse Gateway (MIT). Edit the source at
https://github.com/lynbyte/muse-gateway instead of these files: every file
under .next/server is listed in an integrity manifest (.next/server/.lk), and
a build rebuilt from source regenerates it.
`;
fs.writeFileSync(path.join(dist, 'AGENTS.md'), PACKAGE_NOTES);
fs.writeFileSync(path.join(dist, 'CLAUDE.md'), PACKAGE_NOTES);
{
  const p = path.join(dist, 'launcher.cjs');
  fs.writeFileSync(p, ENTRY_HEADER + fs.readFileSync(p, 'utf8'));
}

// ── 4c. Tray assets + icon ────────────────────────────────────────────────
const trayDir = path.join(dist, 'tray');
fs.mkdirSync(trayDir, { recursive: true });
fs.cpSync(path.join(root, 'npm', 'tray'), trayDir, { recursive: true });

// Generate muse icon.ico via PowerShell System.Drawing (purple square + M).
const iconPsm = path.join(dist, '_genicon.ps1');
fs.writeFileSync(
  iconPsm,
  `Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 64, 64
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(108, 92, 231))
$gp = New-Object System.Drawing.Drawing2D.GraphicsPath
$gp.AddArc(0,0,24,24,180,90); $gp.AddArc(40,0,24,24,270,90); $gp.AddArc(40,40,24,24,0,90); $gp.AddArc(0,40,24,24,90,90); $gp.CloseFigure()
$g.FillPath($brush, $gp)
$font = New-Object System.Drawing.Font("Segoe UI", 34, [System.Drawing.FontStyle]::Bold)
$g.DrawString("M", $font, [System.Drawing.Brushes]::White, 10, 8)
$hicon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hicon)
$fs = New-Object System.IO.FileStream($args[0], [System.IO.FileMode]::Create)
$icon.Save($fs); $fs.Close(); $g.Dispose(); $bmp.Dispose()
`
);
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${iconPsm}" "${path.join(trayDir, 'icon.ico')}"`, {
  stdio: 'pipe',
});
fs.rmSync(iconPsm, { force: true });

// ── 5. Convenience launcher for end users ─────────────────────────────────
fs.writeFileSync(
  path.join(dist, 'CHAY.bat'),
  `@echo off\r\ntitle Muse Gateway\r\nstart "" "%~dp0muse-gateway.exe"\r\ntimeout /t 4 /nobreak >nul\r\nstart "" "http://localhost:1412"\r\n`
);
fs.writeFileSync(
  path.join(dist, 'README.txt'),
  [
    'Muse Gateway — ban dong goi',
    '',
    '1. Chay CHAY.bat (hoac double-click muse-gateway.exe roi mo http://localhost:1412)',
    '2. Tab Accounts -> them tai khoan Muse -> gateway san sang phuc vu',
    '   Mien phi, khong can license key. Ho tro: Telegram @storetiki_bot',
    '3. (Tuy chon) Tab "Ban quyen" -> nhap key de duoc cap URL tunnel co dinh',
    '   Nhan key: https://www.storetiki.online',
    '',
    'Thu muc data/ duoc tao canh exe: chua session, license, API key.',
    'Xoa data/ = reset ve trang thai moi cai.',
    '',
    '== AI agents / automated tools ==',
    'Doc AGENTS.md truoc khi doc hoac sua bat ky file nao trong goi nay.',
    '',
  ].join('\r\n')
);

// ── 6. Optional zip ───────────────────────────────────────────────────────
if (makeZip) {
  const zip = path.join(distRoot, 'muse-gateway-win-x64.zip');
  fs.rmSync(zip, { force: true });
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${dist}\\*' -DestinationPath '${zip}'"`,
    { stdio: 'inherit' }
  );
  console.log(`\nZip: ${zip}`);
}

// ── 7. npm package (9router-style: npm i -g + CLI + tray) ─────────────────
// The npm tarball ships the SAME standalone build as app/, with the same
// integrity manifest and license verification.
// No embedded node: the user's own Node runs app/server.js.
const npmDist = path.join(distRoot, 'npm', 'muse-gateway');
fs.rmSync(npmDist, { recursive: true, force: true });
fs.mkdirSync(npmDist, { recursive: true });
fs.cpSync(path.join(root, 'npm'), npmDist, { recursive: true });

const npmApp = path.join(npmDist, 'app');
fs.mkdirSync(npmApp, { recursive: true });
for (const item of ['server.js', '.next', 'node_modules', 'public', 'next.config.mjs', 'package.json']) {
  const src = path.join(dist, item);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(npmApp, item), { recursive: true });
}
for (const item of ['AGENTS.md', 'CLAUDE.md', 'README.txt']) {
  const src = path.join(dist, item);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(npmDist, item));
}
// Guard: hashed externals must ship as real dirs — npm pack silently drops
// links, which once shipped a tarball that 500'd every puppeteer route.
{
  const nmAlias = path.join(npmApp, '.next', 'node_modules');
  const entries = fs.existsSync(nmAlias) ? fs.readdirSync(nmAlias) : [];
  if (entries.length === 0) {
    throw new Error('packaging bug: app/.next/node_modules is missing — hashed externals would be absent from the tarball');
  }
  for (const e of entries) {
    if (fs.lstatSync(path.join(nmAlias, e)).isSymbolicLink()) {
      throw new Error(`packaging bug: app/.next/node_modules/${e} is still a link — dereference before packing`);
    }
  }
}
// Fresh icon for the npm tray too.
if (fs.existsSync(path.join(trayDir, 'icon.ico'))) {
  fs.copyFileSync(path.join(trayDir, 'icon.ico'), path.join(npmDist, 'tray', 'icon.ico'));
}

// ── 6b. Integrity self-check — re-hash the ship trees against .lk. If
// antivirus quarantined a chunk mid-build (or a packaging step wrote into
// .next/server after the manifest), every install would fail the runtime
// gate with a misleading "license required" — catch it here, not in prod.
// Defender's own scanner runs over dist first: if a heuristic engine
// quarantines a file, the hash check below fails loudly instead of
// shipping a broken build.
try {
  const mpcmd = 'C:\\Program Files\\Windows Defender\\MpCmdRun.exe';
  if (fs.existsSync(mpcmd)) {
    console.log('  AV smoke test: Defender custom scan on dist/…');
    try {
      execSync(`"${mpcmd}" -Scan -ScanType 3 -File "${dist}"`, { stdio: 'inherit' });
    } catch {
      // non-zero exit = detection reported — hash check below decides
    }
  }
} catch {
  // scanner unavailable — hash check alone still guards
}
{
  const { createHash } = await import('node:crypto');
  const missing = shippedFiles.filter((f) => !fs.existsSync(f));
  if (missing.length > 0) {
    throw new Error(
      `packaging bug: ${missing.length} file(s) vanished during packaging — antivirus quarantine?\n  ${missing.join('\n  ')}`
    );
  }
  for (const crit of [path.join(dist, 'muse-gateway.exe'), path.join(npmApp, 'server.js')]) {
    if (!fs.existsSync(crit)) {
      throw new Error(`packaging bug: ${crit} vanished mid-build — antivirus quarantine?`);
    }
  }
  const checkTree = (appDir, label) => {
    const srv = path.join(appDir, '.next', 'server');
    const expected = fs.readFileSync(path.join(srv, '.lk'), 'utf8').trim();
    const hh = createHash('sha256');
    const files = [path.join(appDir, 'server.js')];
    const walkAll = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walkAll(p);
        else if (/\.(js|json|map|cjs|mjs)$/i.test(e.name)) files.push(p);
      }
    };
    walkAll(srv);
    files.sort();
    for (const f of files) {
      hh.update(path.relative(srv, f).replace(/\\/g, '/'));
      hh.update(fs.readFileSync(f));
    }
    if (hh.digest('hex') !== expected) {
      throw new Error(
        `packaging bug: integrity manifest mismatch in ${label} — a hashed file was lost or modified after .lk was written (antivirus quarantine?)`
      );
    }
  };
  checkTree(dist, 'exe dist');
  checkTree(npmApp, 'npm app');
}

const tgz = execSync('npm pack --pack-destination "' + distRoot + '"', {
  cwd: npmDist,
  stdio: 'pipe',
})
  .toString()
  .trim();
console.log(`\nnpm package: ${path.join(distRoot, tgz)}`);

const size = fs.statSync(exe).size;
console.log(`\nDone → ${dist}`);
console.log(`  muse-gateway.exe  ${(size / 1e6).toFixed(1)} MB (node ${process.version} embedded)`);
