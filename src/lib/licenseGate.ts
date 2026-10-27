import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { dataPath } from './dataDir';
import { onlineEnabled, onlineOk } from './licenseOnline';

// ── Independent verification ──────────────────────────────────────────────
// This module does NOT reuse license.ts internals: it re-verifies the stored
// key's Ed25519 signature, expiry and HWID on its own code path, so patching
// a single shared helper is not enough to open the gate.

const _pk = ['MCowBQYDK2VwAyEA', 'BaaN1+ps8SiqaaR+', 'bt57fFTP3p+L1/JK', 'jtwo64HgII8='];
const PUB = `-----BEGIN PUBLIC KEY-----\n${_pk.join('')}\n-----END PUBLIC KEY-----`;

function hwid(): string {
  let mac = '';
  for (const list of Object.values(os.networkInterfaces())) {
    const f = (list || []).find((n) => !n.internal && n.mac && n.mac !== '00:00:00:00:00:00');
    if (f) {
      mac = f.mac;
      break;
    }
  }
  const raw = [os.hostname(), os.cpus()[0]?.model || '', String(os.totalmem()), mac].join('|');
  const h = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
  return `${h.slice(0, 5)}-${h.slice(5, 10)}-${h.slice(10, 15)}`;
}

function licensedNow(): boolean {
  try {
    const licFile = dataPath('license.json');
    if (!fs.existsSync(licFile)) return false;
    const lic = JSON.parse(fs.readFileSync(licFile, 'utf8'));
    const key = String(lic?.licenseKey || '');
    const parts = key.split('.');
    if (parts.length !== 3 || parts[0] !== 'MUSE1') return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const sigOk = crypto.verify(
      null,
      Buffer.from(parts[1], 'utf8'),
      PUB,
      Buffer.from(parts[2], 'base64url')
    );
    if (!sigOk) return false;
    if (String(payload?.p || 'muse').toLowerCase() !== 'muse') return false;
    if (Number(payload?.x) > 0 && Date.now() > Number(payload.x)) return false;
    if (String(payload?.h || '').trim() && String(payload.h) !== hwid()) return false;
    if (lic.expiresAt && Date.parse(lic.expiresAt) < Date.now()) return false;
    // Online re-check: a cached vendor-signed verdict must also be fresh.
    // Skipped entirely when no license server is configured (dev builds).
    if (onlineEnabled() && !onlineOk(key).ok) return false;
    return true;
  } catch {
    return false;
  }
}

// ── Build integrity ───────────────────────────────────────────────────────
// The packager writes .next/server/.lk = sha256 over every server chunk.
// At runtime the whole tree is re-hashed once per process: ANY patched file
// flips the digest and the gate stays closed. The manifest's presence arms
// the check even when the exe's launcher env isn't in play; in a packed run
// (MUSE_PACKED=1) a MISSING manifest also blocks — you can't just delete it.

let integrityResult: boolean | null = null;

function serverTreeIntact(): boolean {
  if (integrityResult !== null) return integrityResult;
  // npm-global installs chdir to a data dir — the app tree lives in
  // MUSE_APP_DIR; packed exe/dev runs keep it at process.cwd().
  const appRoot = process.env.MUSE_APP_DIR || process.cwd();
  const serverDir = path.join(appRoot, '.next', 'server');
  const lkFile = path.join(serverDir, '.lk');
  const packed = process.env.MUSE_PACKED === '1';
  if (!fs.existsSync(lkFile)) {
    integrityResult = !packed; // dev/next-start with no manifest → skip
    return integrityResult;
  }
  try {
    const expected = fs.readFileSync(lkFile, 'utf8').trim();
    const h = crypto.createHash('sha256');
    const files: string[] = [path.join(appRoot, 'server.js')];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|json|map|cjs|mjs)$/i.test(e.name)) files.push(p);
      }
    };
    walk(serverDir);
    files.sort();
    for (const f of files) {
      h.update(path.relative(serverDir, f).replace(/\\/g, '/'));
      h.update(fs.readFileSync(f));
    }
    integrityResult = h.digest('hex') === expected;
    return integrityResult;
  } catch {
    integrityResult = false;
    return false;
  }
}

/**
 * Hard gate for every /v1/* gateway route: without a valid activated license
 * the OpenAI-compatible API stays completely closed (dashboard /api/* routes
 * remain reachable so the user can still open the License tab and activate).
 *
 * Returns a NextResponse(402) to send back, or null when licensed.
 */
export function licenseGate(corsHeaders: Record<string, string>): NextResponse | null {
  if (licensedNow() && serverTreeIntact()) return null;
  return NextResponse.json(
    {
      error: {
        message:
          'License required — chưa kích hoạt bản quyền. Mở tab Bản quyền trên dashboard, nhập key rồi bấm Kích hoạt.',
        type: 'license_error',
        code: 'license_required',
      },
    },
    { status: 402, headers: corsHeaders }
  );
}
