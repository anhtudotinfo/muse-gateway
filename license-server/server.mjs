#!/usr/bin/env node
// Muse Gateway — online license server (VENDOR-SIDE, never shipped).
//
//   node license-server/server.mjs            # listens on :3210
//   PORT=3210 node license-server/server.mjs
//
// Endpoints
//   POST /activate  {key, hwid, nonce}  — first activation, auto-binds HWID
//   POST /verify    {key, hwid, nonce}  — periodic re-check (heartbeat)
//   POST /unbind    {key|keyId, hwid}   — admin: free a machine slot
//   POST /revoke    {key|keyId}         — admin: kill a key entirely
//   GET  /admin/list                    — admin: all keys + hwids + lastSeen
//
// Every verdict is Ed25519-signed with the vendor key — clients verify the
// signature locally, so responses are unforgeable even over plain HTTP.
//
// Env:
//   MUSE_LICENSE_PRIVATE   vendor private PEM (default: data/.license-private.pem)
//   MUSE_ADMIN_TOKEN       required for admin endpoints
//   VERDICT_TTL_H          verdict validity hours (default 72 — offline grace)
//   MAX_HWIDS              seats per floating key (default 1)

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.dirname(url.fileURLToPath(import.meta.url));
const DB_FILE = path.join(ROOT, 'db.json');
const PRIV_FILE = path.join(process.cwd(), 'data', '.license-private.pem');
const TTL_MS = (Number(process.env.VERDICT_TTL_H) || 24) * 3600_000;
const MAX_HWIDS = Math.max(1, Number(process.env.MAX_HWIDS) || 1);
const ADMIN_TOKEN = process.env.MUSE_ADMIN_TOKEN || '';
const PORT = Number(process.env.PORT) || 3210;

const pem = process.env.MUSE_LICENSE_PRIVATE || (fs.existsSync(PRIV_FILE) ? fs.readFileSync(PRIV_FILE, 'utf8') : '');
if (!pem.trim()) {
  console.error('Thiếu private key — đặt data/.license-private.pem hoặc env MUSE_LICENSE_PRIVATE');
  process.exit(1);
}
const priv = crypto.createPrivateKey(pem);
const pub = crypto.createPublicKey(priv);

// ── db ────────────────────────────────────────────────────────────────────
const loadDb = () => {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { keys: {} };
  }
};
const saveDb = (db) => {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
};

// ── key parsing ───────────────────────────────────────────────────────────
function productOf(payload) {
  const p = String(payload?.p || 'muse').toLowerCase().trim();
  return /^[a-z][a-z0-9]{0,15}$/.test(p) ? p : 'muse';
}
const prefixFor = (product) => product.toUpperCase() + '1';

function parseKey(key) {
  const parts = String(key || '').trim().split('.');
  if (parts.length !== 3) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  // Prefix (unsigned) must match the product claim (signed) — same rule as worker.js.
  const product = productOf(payload);
  if (parts[0] !== prefixFor(product)) return null;
  const sigOk = crypto.verify(null, Buffer.from(parts[1], 'utf8'), pub, Buffer.from(parts[2], 'base64url'));
  return {
    keyId: crypto.createHash('sha256').update(parts[2]).digest('hex').slice(0, 16),
    email: String(payload?.e || ''),
    expMs: Number(payload?.x) || 0, // 0 = forever
    keyHwid: String(payload?.h || ''), // '' = floating
    product,
    sigOk,
    payloadPart: parts[1],
    sigPart: parts[2],
  };
}

function signVerdict(verdict) {
  const v = Buffer.from(JSON.stringify(verdict), 'utf8').toString('base64url');
  const s = crypto.sign(null, Buffer.from(v, 'utf8'), priv).toString('base64url');
  return { v, s };
}

function deny(reason, nonce, keyId = '') {
  const exp = Date.now() + TTL_MS;
  return { ...signVerdict({ ok: false, kid: keyId, h: '', exp, reason, nonce: String(nonce || '') }), reason, ok: false };
}

/** Shared activate/verify logic. `bind` = may auto-bind hwid (activate only). */
function check({ key, hwid, nonce }, bind) {
  const parsed = parseKey(key);
  if (!parsed || !parsed.sigOk) return deny('invalid_signature', nonce);
  const now = Date.now();
  if (parsed.expMs > 0 && now > parsed.expMs) return deny('license_expired', nonce, parsed.keyId);

  const db = loadDb();
  const rec = (db.keys[parsed.keyId] ||= {
    email: parsed.email,
    expMs: parsed.expMs,
    hwids: [],
    revoked: false,
    createdAt: now,
    lastSeen: now,
    product: parsed.product,
  });
  if (rec.revoked) return deny('license_revoked', nonce, parsed.keyId);
  rec.lastSeen = now;

  // Key minted with embedded HWID — server-side check mirrors the payload.
  if (parsed.keyHwid) {
    if (String(hwid) !== parsed.keyHwid) {
      saveDb(db);
      return deny('hwid_mismatch', nonce, parsed.keyId);
    }
  } else {
    // Floating key → auto-bind on first activation; later calls must match.
    if (bind && rec.hwids.length === 0 && hwid) rec.hwids.push(String(hwid));
    if (hwid && !rec.hwids.includes(String(hwid))) {
      if (bind && rec.hwids.length < MAX_HWIDS) {
        rec.hwids.push(String(hwid));
      } else {
        saveDb(db);
        return deny(rec.hwids.length ? 'hwid_not_bound' : 'hwid_required', nonce, parsed.keyId);
      }
    }
  }
  saveDb(db);

  const bound = parsed.keyHwid || String(hwid || '');
  const exp = Math.min(now + TTL_MS, parsed.expMs > 0 ? parsed.expMs : now + TTL_MS);
  return {
    ...signVerdict({ ok: true, kid: parsed.keyId, h: bound, exp, reason: 'ok', nonce: String(nonce || ''), p: parsed.product }),
    ok: true,
    keyId: parsed.keyId,
    email: parsed.email,
    boundHwid: bound,
    expiresAt: parsed.expMs ? new Date(parsed.expMs).toISOString() : '',
  };
}

function adminAuthed(req) {
  return ADMIN_TOKEN && req.headers['x-admin-token'] === ADMIN_TOKEN;
}

const readBody = (req) =>
  new Promise((res) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      try {
        res(JSON.parse(buf || '{}'));
      } catch {
        res({});
      }
    });
  });

const json = (res, code, obj) => {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) });
  res.end(b);
};

http
  .createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      if (req.method === 'POST' && (u.pathname === '/activate' || u.pathname === '/verify')) {
        const body = await readBody(req);
        const out = check(body, u.pathname === '/activate');
        return json(res, out.ok ? 200 : 403, out);
      }
      if (u.pathname === '/admin/list' || u.pathname === '/revoke' || u.pathname === '/unrevoke' || u.pathname === '/unbind') {
        if (!adminAuthed(req)) return json(res, 401, { error: 'admin token required' });
        if (u.pathname === '/admin/list') return json(res, 200, loadDb());
        const body = await readBody(req);
        const db = loadDb();
        const parsed = body.key ? parseKey(body.key) : null;
        let keyId = body.keyId || parsed?.keyId;
        let rec = keyId && db.keys[keyId];
        if (!rec && u.pathname === '/revoke' && parsed?.sigOk) {
          // Tombstone: revoke a minted-but-never-activated key — it has no
          // record yet, and without this the first activation would win.
          keyId = parsed.keyId;
          rec = db.keys[keyId] = { email: parsed.email, expMs: parsed.expMs, hwids: [], revoked: false, createdAt: Date.now(), lastSeen: 0, product: parsed.product };
        }
        if (!rec) return json(res, 404, { error: 'key not found' });
        if (u.pathname === '/revoke') rec.revoked = true;
        else if (u.pathname === '/unrevoke') rec.revoked = false;
        else if (body.hwid) rec.hwids = (rec.hwids || []).filter((h) => h !== body.hwid);
        else rec.hwids = [];
        saveDb(db);
        return json(res, 200, { ok: true, record: rec });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: String(e?.message || e) });
    }
  })
  .listen(PORT, () => {
    console.log(`Muse license server → http://localhost:${PORT}`);
    console.log(`  verdict TTL ${TTL_MS / 3600_000}h · seats/key ${MAX_HWIDS} · admin ${ADMIN_TOKEN ? 'on' : 'OFF (set MUSE_ADMIN_TOKEN)'}`);
  });
