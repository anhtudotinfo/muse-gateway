import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJsonFile, writeJsonAtomic } from './safeJson';
import { dataPath } from './dataDir';
import { onlineEnabled, onlineOk } from './licenseOnline';

// Offline license system — no license server needed.
//
// A license key is self-contained:  MUSE1.<base64url(payload)>.<base64url(ed25519 sig)>
//   payload   = { e: email, x: expiresAtMs (0 = forever), h: hwid ('' = floating) }
//   signature = Ed25519 over the payload — only the vendor's PRIVATE key can
//               mint keys; the shipped app carries only the PUBLIC key, so
//               reading the source can never forge a key.
//
// Keys are minted vendor-side by the CLI:
//   node scripts/gen-license.mjs --email user@x.com --days 365 [--hwid HWID]
// Private key lives in data/.license-private.pem (vendor machine only) or
// env MUSE_LICENSE_PRIVATE. Generate a pair with scripts/gen-keypair.mjs.

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

const LICENSE_FILE = dataPath('license.json');
const PRIVATE_KEY_FILE = dataPath('.license-private.pem');
const KEY_PREFIX = 'MUSE1';

// Public half of the vendor keypair — safe to ship inside the app; it can
// only VERIFY signatures, never create them. Regenerate the pair with
// scripts/gen-keypair.mjs and paste the new public PEM here. Assembled at
// runtime so a greppable "BEGIN PUBLIC KEY" never sits in the shipped chunk.
const _pk = ['MCowBQYDK2VwAyEA', 'BaaN1+ps8SiqaaR+', 'bt57fFTP3p+L1/JK', 'jtwo64HgII8='];
const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----\n${_pk.join('')}\n-----END PUBLIC KEY-----`;

/** Vendor private key — loaded from env or data/.license-private.pem.
 *  Never shipped to users: only present on the machine minting keys. */
function loadPrivateKey(): crypto.KeyObject | null {
  const pem =
    process.env.MUSE_LICENSE_PRIVATE ||
    (fs.existsSync(PRIVATE_KEY_FILE) ? fs.readFileSync(PRIVATE_KEY_FILE, 'utf8') : '');
  if (!pem.trim()) return null;
  try {
    return crypto.createPrivateKey(pem);
  } catch {
    return null;
  }
}

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

function signPayload(payloadB64: string, privKey: crypto.KeyObject): string {
  return crypto.sign(null, Buffer.from(payloadB64, 'utf8'), privKey).toString('base64url');
}

function verifySignature(payloadB64: string, sigB64: string): boolean {
  try {
    return crypto.verify(
      null,
      Buffer.from(payloadB64, 'utf8'),
      PUBLIC_KEY_PEM,
      Buffer.from(sigB64, 'base64url')
    );
  } catch {
    return false;
  }
}

/** Mint a signed license key — VENDOR-side only; needs the private key. */
export function issueKey(email: string, expiresAtMs: number, hwid = ''): string {
  const priv = loadPrivateKey();
  if (!priv) throw new Error('Thiếu private key — đặt data/.license-private.pem hoặc env MUSE_LICENSE_PRIVATE');
  const payload = Buffer.from(
    JSON.stringify({ e: String(email || '').trim(), x: expiresAtMs | 0, h: hwid })
  ).toString('base64url');
  return `${KEY_PREFIX}.${payload}.${signPayload(payload, priv)}`;
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
  let p: { e?: string; x?: number; h?: string; p?: string };
  try {
    p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return fail('Payload key không giải mã được');
  }
  if (!verifySignature(parts[1], parts[2])) {
    return fail('Sai chữ ký — key bị sửa hoặc không do hệ thống này cấp');
  }
  // Multi-product: 'p' claims which tool this key is for. Absent = legacy muse key.
  const product = String(p.p || 'muse').toLowerCase();
  if (product !== 'muse') return fail(`Key này dành cho sản phẩm "${product}", không phải Muse`);

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
    // Under a global npm install, cwd is the data dir — the app itself
    // (with its real package.json) lives in MUSE_APP_DIR.
    const appRoot = process.env.MUSE_APP_DIR || process.cwd();
    const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
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

  /** Mint a key — bound to this machine's HWID when bindHwid is true.
   *  VENDOR-side only (needs the private key file/env). */
  generate(email: string, days: number, bindHwid: boolean): string {
    const exp = days > 0 ? Date.now() + days * 86_400_000 : 0;
    return issueKey(email, exp, bindHwid ? computeHwid() : '');
  }

  /** Fast gate for API routes: true when a stored key verifies (signature
   *  + expiry + HWID) AND — when a license server is configured — the cached
   *  vendor-signed online verdict is still fresh. Re-reads license.json each
   *  call — file is ~1KB and crypto.verify is microseconds. */
  isLicensed(): boolean {
    const lic = readFile();
    if (!lic) return false;
    if (lic.expiresAt && Date.parse(lic.expiresAt) < Date.now()) return false;
    if (!checkKey(lic.licenseKey).ok) return false;
    if (onlineEnabled() && !onlineOk(lic.licenseKey).ok) return false;
    return true;
  }
}

const g = globalThis as unknown as { licenseService: LicenseService };
export const licenseService = g.licenseService || new LicenseService();
g.licenseService = licenseService;
