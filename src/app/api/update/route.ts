import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Version/update check for the dashboard: compares the running build's
// version against the latest release on npmjs.com. Result is cached in
// process memory for 30 minutes so page loads don't hammer the registry.
const REGISTRY_URL = 'https://registry.npmjs.org/muse-gateway/latest';
const TTL_MS = 30 * 60 * 1000;
let cache: { at: number; data: Record<string, unknown> } | null = null;

function currentVersion(): string {
  try {
    const root = process.env.MUSE_APP_DIR || process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

// 'npm' = installed via `npm i -g` (app dir lives under node_modules),
// 'exe' = SEA-packaged muse-gateway.exe, 'dev' = next dev / npm start.
function channel(): 'npm' | 'exe' | 'dev' {
  if (process.env.MUSE_PACKED === '1') return 'exe';
  const appDir = (process.env.MUSE_APP_DIR || '').replace(/\\/g, '/');
  if (appDir.includes('node_modules')) return 'npm';
  return 'dev';
}

async function latestVersion(timeoutMs = 4000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(REGISTRY_URL, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const j = (await res.json()) as { version?: string };
    return typeof j.version === 'string' ? j.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function cmpVer(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return pa[i] - pb[i];
  return 0;
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return NextResponse.json(cache.data);
  const current = currentVersion();
  const latest = await latestVersion();
  const data = {
    current,
    latest,
    updateAvailable: !!latest && cmpVer(latest, current) > 0,
    channel: channel(),
    checkedAt: new Date().toISOString(),
  };
  cache = { at: now, data };
  return NextResponse.json(data);
}

// Apply update: only meaningful for the npm-installed channel — spawn
// `npm i -g muse-gateway` detached and let it replace the package under the
// running process. The user then restarts the gateway to run the new code.
export async function POST() {
  if (channel() !== 'npm') {
    return NextResponse.json(
      { error: 'Chỉ hỗ trợ tự cập nhật cho bản cài qua npm (npm i -g muse-gateway).' },
      { status: 400 }
    );
  }
  const current = currentVersion();
  const latest = await latestVersion();
  if (!latest || cmpVer(latest, current) <= 0) {
    return NextResponse.json({ ok: false, message: 'Đang chạy bản mới nhất.' });
  }
  // The version string lands inside a cmd.exe command line — pin it to
  // strict semver so a poisoned registry response can't inject arguments.
  if (!/^\d+\.\d+\.\d+(-[\w.-]+)?$/.test(latest)) {
    return NextResponse.json({ error: 'Registry trả version không hợp lệ.' }, { status: 502 });
  }
  try {
    const child = spawn('cmd.exe', ['/c', 'npm', 'i', '-g', `muse-gateway@${latest}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    cache = null; // next GET re-checks after the install
    return NextResponse.json({
      ok: true,
      latest,
      message: `Đang cài v${latest} — khởi động lại muse-gateway sau ~30 giây để dùng bản mới.`,
    });
  } catch (err) {
    return NextResponse.json({ error: `Không chạy được npm: ${(err as Error)?.message || err}` }, { status: 500 });
  }
}
