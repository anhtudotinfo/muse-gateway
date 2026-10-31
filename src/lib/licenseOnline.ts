import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataPath } from './dataDir';
import { readJsonFile, writeJsonAtomic } from './safeJson';

// Online license verification — the client-side half.
//
// The vendor license server answers /activate and /verify with an Ed25519-
// SIGNED verdict { ok, kid, h, exp, reason, nonce }. The gateway stores the
// verdict inside license.json and the /v1 gate re-verifies the signature on
// every request — responses are unforgeable even over plain HTTP, and a
// signed denial stays a denial if the user firewalls the server afterwards.
//
// Offline grace: a valid verdict covers offline use until its `exp`
// (default 72h — set by VERDICT_TTL_H on the server). Past that, the gate
// closes until the server is reachable again.
//
// Server URL: baked into BAKED_SERVER at packaging time; MUSE_LICENSE_SERVER
// overrides it (dev/test). Empty = online check disabled entirely.

const BAKED_SERVER = 'https://license.storetiki.online';
const VERIFY_INTERVAL_MS = 3600_000; // refresh verdict hourly — revoke propagates fast

export function onlineServer(): string {
  return (process.env.MUSE_LICENSE_SERVER || BAKED_SERVER).replace(/\/+$/, '');
}

export function onlineEnabled(): boolean {
  return onlineServer().length > 0;
}

const _pk = ['MCowBQYDK2VwAyEA', 'BaaN1+ps8SiqaaR+', 'bt57fFTP3p+L1/JK', 'jtwo64HgII8='];
const PUB = `-----BEGIN PUBLIC KEY-----\n${_pk.join('')}\n-----END PUBLIC KEY-----`;

const LICENSE_FILE = dataPath('license.json');

interface OnlineVerdict {
  v: string; // base64url JSON verdict
  s: string; // base64url Ed25519 signature over `v`
  at: number; // fetchedAt ms
}

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

function readLic(): any {
  const raw = readJsonFile<any>(LICENSE_FILE, null);
  return raw && typeof raw === 'object' && raw.licenseKey ? raw : null;
}

function writeOnline(v: string, s: string): void {
  const lic = readLic();
  if (!lic) return;
  lic.online = { v, s, at: Date.now() } satisfies OnlineVerdict;
  try {
    fs.mkdirSync(path.dirname(LICENSE_FILE), { recursive: true });
    writeJsonAtomic(LICENSE_FILE, lic);
  } catch {}
}

/** Parse + cryptographically verify the stored online verdict. */
export function onlineOk(licenseKey: string): { ok: boolean; reason: string } {
  const lic = readLic();
  const on = lic?.online as OnlineVerdict | undefined;
  if (!on?.v || !on?.s) return { ok: false, reason: 'no_verdict' };
  let v: { ok?: boolean; kid?: string; h?: string; exp?: number };
  try {
    v = JSON.parse(Buffer.from(on.v, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'verdict_corrupt' };
  }
  let sigOk = false;
  try {
    sigOk = crypto.verify(null, Buffer.from(on.v, 'utf8'), PUB, Buffer.from(on.s, 'base64url'));
  } catch {}
  if (!sigOk) return { ok: false, reason: 'verdict_forged' };
  if (v.ok !== true) return { ok: false, reason: 'denied' };
  if (!v.exp || Date.now() > Number(v.exp)) return { ok: false, reason: 'verdict_stale' };
  // Verdict must belong to THIS key — sig part doubles as the key id.
  const sigPart = String(licenseKey).split('.')[2] || '';
  const kid = crypto.createHash('sha256').update(sigPart).digest('hex').slice(0, 16);
  if (v.kid !== kid) return { ok: false, reason: 'verdict_key_mismatch' };
  // …and to THIS machine when the verdict carries a bound HWID.
  if (v.h && String(v.h) !== hwid()) return { ok: false, reason: 'verdict_hwid_mismatch' };
  return { ok: true, reason: 'ok' };
}

async function fetchVerdict(action: 'activate' | 'verify', key: string): Promise<{ ok: boolean; reason: string }> {
  const base = onlineServer();
  if (!base) return { ok: true, reason: 'online_disabled' };
  try {
    const nonce = crypto.randomBytes(12).toString('base64url');
    const res = await fetch(`${base}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, hwid: hwid(), nonce }),
      signal: AbortSignal.timeout(10_000),
    });
    const body: any = await res.json().catch(() => null);
    // 'key_not_activated' can be a KV propagation artifact: a /verify landing
    // on a different POP within seconds of /activate misses the fresh record.
    // Never let it overwrite a still-valid ok verdict — real revocations
    // (revoked/deleted/expired) carry distinct reasons and still overwrite.
    const lagDeny = body?.ok === false && body?.reason === 'key_not_activated' && onlineOk(key).ok;
    if (body?.v && body?.s && !lagDeny) writeOnline(body.v, body.s); // store signed verdicts AND denials
    if (!body?.ok) return { ok: false, reason: String(body?.reason || `http_${res.status}`) };
    return { ok: true, reason: 'ok' };
  } catch (e: any) {
    return { ok: false, reason: `server_unreachable: ${e?.message || e}` };
  }
}

/** Called by /api/license right after a local activate — binds HWID server-side. */
export async function activateOnline(licenseKey: string) {
  return fetchVerdict('activate', licenseKey);
}

/** Periodic re-verify — keeps the cached verdict fresh while the app runs. */
export async function refreshOnline(): Promise<{ ok: boolean; reason: string }> {
  const lic = readLic();
  if (!lic?.licenseKey || !onlineEnabled()) return { ok: false, reason: 'no_license' };
  return fetchVerdict('verify', lic.licenseKey);
}

// Self-starting refresh loop — runs once per process regardless of which
// module imported us first (survives Next HMR via globalThis).
const g = globalThis as any;
if (!g.__museOnlineLoop) {
  g.__museOnlineLoop = true;
  const tick = () => {
    refreshOnline().finally(() => setTimeout(tick, VERIFY_INTERVAL_MS));
  };
  if (onlineEnabled()) setTimeout(tick, 5_000); // small delay after boot
}
