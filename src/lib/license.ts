import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJsonFile, writeJsonAtomic } from './safeJson';

// Offline license system — no license server needed.
//
// A license key is self-contained:  MUSE1.<base64url(payload)>.<base64url(hmac)>
//   payload   = { e: email, x: expiresAtMs (0 = forever), h: hwid ('' = floating) }
//   signature = HMAC-SHA256(payload, SECRET) truncated — verified with
//               crypto.timingSafeEqual, so a forged/edited key fails.
//
// Keys are minted by `POST /api/license {action:'generate'}` or the CLI:
//   node scripts/gen-license.mjs --email user@x.com --days 365 [--hwid HWID]
//
// SECRET: set MUSE_LICENSE_SECRET in env for real distribution — the default
// below only protects keys inside this codebase.

export interface LicenseFile {
  email: string;
  licenseKey: string;
  expiresAt: string; // ISO or '' = no expiry
  hwidBound: string; // '' = floating license (any machine)
  activatedAt: string;
  lastVerifyAt: string;
  lastVerifyOk: boolean;
}

export interface LicenseView {
  product: string;
  version: string;
  licensed: boolean;
  expired: boolean;
  type: 'pro' | 'community' | 'expired' | 'invalid';
  email: string;
  keyFull: string;
  keyMasked: string;
  expiresAt: string;
  hwidBound: boolean;
  hwid: string;
  hwidMasked: string;
  activatedAt: string;
  lastVerifyAt: string;
  lastVerifyOk: boolean;
  reason: string;
}

const LICENSE_FILE = path.join(process.cwd(), 'data', 'license.json');
const KEY_PREFIX = 'MUSE1';
const SECRET = process.env.MUSE_LICENSE_SECRET || 'muse-pool-local-license-v1';

/** Stable machine fingerprint: hostname + CPU + memory + first real MAC. */
export function computeHwid(): string {
  let mac = '';
  for (const list of Object.values(os.networkInterfaces())) {
    const found = (list || []).find((n) => !n.internal && n.mac && n.mac !== '00:00:00:00:00:00');
    if (found) {
      mac = found.mac;
      break;
    }
  }
  const raw = [os.hostname(), os.cpus()[0]?.model || '', String(os.totalmem()), mac].join('|');
  const h = crypto.createHash('sha256').update(raw).digest('hex').toUpperCase();
  return `${h.slice(0, 5)}-${h.slice(5, 10)}-${h.slice(10, 15)}`;
}

function maskMiddle(value: string, keep = 5): string {
  if (!value) return '—';
  const parts = value.split('-');
  if (parts.length >= 3) return `${parts[0]}-•••••-${parts[parts.length - 1]}`;
  if (value.length > keep) return `${value.slice(0, keep)}••••••••`;
  return '••••••••';
}

function signPayload(payloadB64: string): string {
  return crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url');
}

/** Mint a signed license key. expiresAtMs = 0 → forever; hwid = '' → floating. */
export function issueKey(email: string, expiresAtMs: number, hwid = ''): string {
  const payload = Buffer.from(
    JSON.stringify({ e: String(email || '').trim(), x: expiresAtMs | 0, h: hwid })
  ).toString('base64url');
  return `${KEY_PREFIX}.${payload}.${signPayload(payload)}`;
}

export interface KeyCheck {
  ok: boolean;
  reason: string;
  email: string;
  expiresAtMs: number;
  hwidBound: string;
}

/** Cryptographically verify a key against this machine. */
export function checkKey(key: string): KeyCheck {
  const fail = (reason: string): KeyCheck => ({ ok: false, reason, email: '', expiresAtMs: 0, hwidBound: '' });
  const parts = String(key || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== KEY_PREFIX) {
    return fail('Format key không hợp lệ (kỳ vọng MUSE1.<payload>.<sig>)');
  }
  let p: { e?: string; x?: number; h?: string };
  try {
    p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return fail('Payload key không giải mã được');
  }
  const expected = signPayload(parts[1]);
  const got = parts[2];
  const sigOk =
    expected.length === got.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
  if (!sigOk) return fail('Sai chữ ký — key bị sửa hoặc không do hệ thống này cấp');

  const expiresAtMs = Number(p.x || 0);
  if (expiresAtMs > 0 && expiresAtMs < Date.now()) return fail('License đã hết hạn');

  const hwidBound = String(p.h || '');
  if (hwidBound && hwidBound !== computeHwid()) {
    return fail('Key gắn với máy khác — HWID không khớp');
  }
  return { ok: true, reason: 'Thành công!', email: String(p.e || ''), expiresAtMs, hwidBound };
}

function readFile(): LicenseFile | null {
  const raw = readJsonFile<LicenseFile | null>(LICENSE_FILE, null);
  return raw && typeof raw === 'object' && raw.licenseKey ? raw : null;
}

function writeFile(data: LicenseFile | null): void {
  try {
    fs.mkdirSync(path.dirname(LICENSE_FILE), { recursive: true });
    if (data) writeJsonAtomic(LICENSE_FILE, data);
    else if (fs.existsSync(LICENSE_FILE)) fs.unlinkSync(LICENSE_FILE);
  } catch {}
}

function appVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

class LicenseService {
  getView(): LicenseView {
    const hwid = computeHwid();
    const lic = readFile();
    const check = lic ? checkKey(lic.licenseKey) : null;
    const expired = !!lic?.expiresAt && Date.parse(lic.expiresAt) < Date.now();
    const valid = !!check?.ok && !expired;
    return {
      product: 'muse_gateway',
      version: appVersion(),
      licensed: valid,
      expired,
      type: !lic ? 'community' : expired ? 'expired' : valid ? 'pro' : 'invalid',
      email: lic?.email || '',
      keyFull: lic?.licenseKey || '',
      keyMasked: lic ? maskMiddle(lic.licenseKey, 8) : '—',
      expiresAt: lic?.expiresAt || '',
      hwidBound: !!lic?.hwidBound,
      hwid,
      hwidMasked: maskMiddle(hwid),
      activatedAt: lic?.activatedAt || '',
      lastVerifyAt: lic?.lastVerifyAt || '',
      lastVerifyOk: !!lic?.lastVerifyOk,
      reason: lic ? check?.reason || '' : '',
    };
  }

  /** Activate a SIGNED key — verifies signature, expiry and HWID lock first. */
  activate(licenseKey: string): LicenseView {
    const check = checkKey(licenseKey);
    if (!check.ok) throw new Error(check.reason);
    const lic: LicenseFile = {
      email: check.email,
      licenseKey: licenseKey.trim(),
      expiresAt: check.expiresAtMs > 0 ? new Date(check.expiresAtMs).toISOString() : '',
      hwidBound: check.hwidBound,
      activatedAt: new Date().toISOString(),
      lastVerifyAt: new Date().toISOString(),
      lastVerifyOk: true,
    };
    writeFile(lic);
    return this.getView();
  }

  /** Self-check: signature + HWID + expiry of the stored key. */
  verify(): { ok: boolean; reason: string; view: LicenseView } {
    const lic = readFile();
    if (!lic) return { ok: false, reason: 'Chưa kích hoạt license.', view: this.getView() };
    const check = checkKey(lic.licenseKey);
    let reason = check.reason;
    if (check.ok && lic.expiresAt && Date.parse(lic.expiresAt) < Date.now()) {
      check.ok = false;
      reason = 'License đã hết hạn.';
    }
    lic.lastVerifyAt = new Date().toISOString();
    lic.lastVerifyOk = check.ok;
    writeFile(lic);
    return { ok: check.ok, reason, view: this.getView() };
  }

  remove(): void {
    writeFile(null);
  }

  /** Mint a key — bound to this machine's HWID when bindHwid is true. */
  generate(email: string, days: number, bindHwid: boolean): string {
    const exp = days > 0 ? Date.now() + days * 86_400_000 : 0;
    return issueKey(email, exp, bindHwid ? computeHwid() : '');
  }
}

const g = globalThis as unknown as { licenseService: LicenseService };
export const licenseService = g.licenseService || new LicenseService();
g.licenseService = licenseService;
