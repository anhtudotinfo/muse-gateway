// Muse Gateway license server — Cloudflare Worker variant (free tier fits:
// ~100k req/day, KV included, HTTPS + stable URL on *.workers.dev).
//
// Deploy:
//   npx wrangler login
//   npx wrangler kv namespace create LICENSE_KV     # → paste id into wrangler.toml
//   npx wrangler secret put MUSE_LICENSE_PRIVATE    # contents of data/.license-private.pem
//   npx wrangler secret put MUSE_LICENSE_PUBLIC     # the public PEM
//   npx wrangler secret put MUSE_ADMIN_TOKEN        # random admin secret
//   npx wrangler deploy license-server/wrangler.toml
//
// Then set BAKED_SERVER in src/lib/licenseOnline.ts to the workers.dev URL
// and repackage the app.
//
// Endpoints: POST /activate · POST /verify · POST /revoke · POST /unrevoke ·
// POST /unbind · GET /admin/list · POST /admin/mint — same protocol as
// server.mjs plus admin key issuance for the store dashboard.

const enc = new TextEncoder();
const dec = new TextDecoder();

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pemDer = (pem) => unb64u(String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));

async function importPriv(env) {
  return crypto.subtle.importKey('pkcs8', pemDer(env.MUSE_LICENSE_PRIVATE), 'Ed25519', false, ['sign']);
}
async function importPub(env) {
  return crypto.subtle.importKey('spki', pemDer(env.MUSE_LICENSE_PUBLIC), 'Ed25519', false, ['verify']);
}
async function sha256hex(str) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const TTL_MS = (env) => (Number(env.VERDICT_TTL_H) || 24) * 3600_000;
const MAX_HWIDS = (env) => Math.max(1, Number(env.MAX_HWIDS) || 1);

// ── key parsing ───────────────────────────────────────────────────────────
function productOf(payload) {
  const p = String(payload?.p || 'muse').toLowerCase().trim();
  return /^[a-z][a-z0-9]{0,15}$/.test(p) ? p : 'muse';
}
function prefixFor(product) {
  return product.toUpperCase() + '1';
}

async function parseKey(env, key) {
  const parts = String(key || '').trim().split('.');
  if (parts.length !== 3) return null;
  let payload;
  try {
    payload = JSON.parse(dec.decode(unb64u(parts[1])));
  } catch {
    return null;
  }
  // Any product shares this server; the (unsigned) prefix must match the
  // (signed) product claim so a key can't be re-badged for another tool.
  const product = productOf(payload);
  if (parts[0] !== prefixFor(product)) return null;
  const sigOk = await crypto.subtle
    .verify('Ed25519', await importPub(env), unb64u(parts[2]), enc.encode(parts[1]))
    .catch(() => false);
  const kid = (await sha256hex(parts[2])).slice(0, 16);
  return {
    keyId: kid,
    email: String(payload?.e || ''),
    expMs: Number(payload?.x) || 0,
    keyHwid: String(payload?.h || ''),
    product,
    sigOk,
  };
}

async function signVerdict(env, verdict) {
  const v = b64u(enc.encode(JSON.stringify(verdict)));
  const s = b64u(await crypto.subtle.sign('Ed25519', await importPriv(env), enc.encode(v)));
  return { v, s };
}

// Mint a MUSE1.<b64u(payload)>.<b64u(sig)> license — same shape as
// scripts/gen-license.mjs so existing clients verify it unchanged.
async function signLicense(env, payload, prefix = 'MUSE1') {
  const v = b64u(enc.encode(JSON.stringify(payload)));
  const s = b64u(await crypto.subtle.sign('Ed25519', await importPriv(env), enc.encode(v)));
  return `${prefix}.${v}.${s}`;
}

function deny(env, reason, nonce, keyId = '') {
  const exp = Date.now() + TTL_MS(env);
  return signVerdict(env, { ok: false, kid: keyId, h: '', exp, reason, nonce: String(nonce || '') })
    .then((signed) => ({ ...signed, reason, ok: false }));
}

async function loadRec(env, keyId, create) {
  const cur = await env.LICENSE_KV.get('key:' + keyId, 'json');
  if (cur) return cur;
  return create;
}

async function saveRec(env, keyId, rec) {
  await env.LICENSE_KV.put('key:' + keyId, JSON.stringify(rec));
}

async function check(env, body, bind) {
  const { key, hwid, nonce } = body || {};
  const parsed = await parseKey(env, key);
  if (!parsed || !parsed.sigOk) return deny(env, 'invalid_signature', nonce);
  const now = Date.now();
  if (parsed.expMs > 0 && now > parsed.expMs) return deny(env, 'license_expired', nonce, parsed.keyId);

  let rec = await loadRec(env, parsed.keyId, null);
  let dirty = false;
  if (!rec) {
    if (!bind) return deny(env, 'key_not_activated', nonce, parsed.keyId);
    rec = { email: parsed.email, expMs: parsed.expMs, hwids: [], revoked: false, createdAt: now, lastSeen: 0, product: parsed.product };
    dirty = true;
  }
  if (rec.revoked) {
    if (dirty) await saveRec(env, parsed.keyId, rec);
    return deny(env, 'license_revoked', nonce, parsed.keyId);
  }
  // Throttle lastSeen writes — KV free tier caps writes/day.
  if (now - (rec.lastSeen || 0) > 24 * 3600_000) {
    rec.lastSeen = now;
    dirty = true;
  }

  if (parsed.keyHwid) {
    if (String(hwid) !== parsed.keyHwid) {
      if (dirty) await saveRec(env, parsed.keyId, rec);
      return deny(env, 'hwid_mismatch', nonce, parsed.keyId);
    }
  } else if (hwid && !rec.hwids.includes(String(hwid))) {
    if (bind && rec.hwids.length < MAX_HWIDS(env)) {
      rec.hwids.push(String(hwid));
      dirty = true;
    } else {
      if (dirty) await saveRec(env, parsed.keyId, rec);
      return deny(env, rec.hwids.length ? 'hwid_not_bound' : 'hwid_required', nonce, parsed.keyId);
    }
  }
  if (dirty) await saveRec(env, parsed.keyId, rec);

  const bound = parsed.keyHwid || String(hwid || '');
  const exp = Math.min(now + TTL_MS(env), parsed.expMs > 0 ? parsed.expMs : now + TTL_MS(env));
  const signed = await signVerdict(env, { ok: true, kid: parsed.keyId, h: bound, exp, reason: 'ok', nonce: String(nonce || ''), p: parsed.product });
  return {
    ...signed,
    ok: true,
    keyId: parsed.keyId,
    email: parsed.email,
    boundHwid: bound,
    expiresAt: parsed.expMs ? new Date(parsed.expMs).toISOString() : '',
  };
}

const json = (code, obj) =>
  new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json' } });

export default {
  async fetch(request, env) {
    try {
      const u = new URL(request.url);
      if (request.method === 'POST' && (u.pathname === '/activate' || u.pathname === '/verify')) {
        const body = await request.json().catch(() => ({}));
        const out = await check(env, body, u.pathname === '/activate');
        return json(out.ok ? 200 : 403, out);
      }

      const admin = ['/admin/list', '/admin/mint', '/revoke', '/unrevoke', '/unbind'];
      if (admin.includes(u.pathname)) {
        if (!env.MUSE_ADMIN_TOKEN || request.headers.get('x-admin-token') !== String(env.MUSE_ADMIN_TOKEN).trim()) {
          return json(401, { error: 'admin token required' });
        }
        if (u.pathname === '/admin/list') {
          const out = { keys: {} };
          let cursor;
          do {
            const page = await env.LICENSE_KV.list({ prefix: 'key:', cursor });
            for (const k of page.keys) {
              const v = await env.LICENSE_KV.get(k.name, 'json');
              out.keys[k.name.slice(4)] = v;
            }
            cursor = page.list_complete ? undefined : page.cursor;
          } while (cursor);
          return json(200, out);
        }
        const body = await request.json().catch(() => ({}));
        if (u.pathname === '/admin/mint') {
          const email = String(body.email || '').trim();
          if (!email || email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return json(400, { error: 'valid email required' });
          }
          const product = String(body.product || 'muse').toLowerCase().trim();
          if (!/^[a-z][a-z0-9]{0,15}$/.test(product)) {
            return json(400, { error: 'product must match /^[a-z][a-z0-9]{0,15}$/' });
          }
          const forever = body.forever === true;
          const days = Number(body.days);
          if (!forever && (!Number.isFinite(days) || days <= 0 || days > 36500)) {
            return json(400, { error: 'days must be 1..36500, or forever:true' });
          }
          const hwid = String(body.hwid || '').trim();
          const expMs = forever ? 0 : Date.now() + days * 86_400_000;
          const key = await signLicense(env, { e: email, x: expMs, h: hwid, p: product }, prefixFor(product));
          const keyId = (await sha256hex(key.split('.')[2])).slice(0, 16);
          return json(200, {
            ok: true, key, keyId, email, product,
            expiresAt: expMs ? new Date(expMs).toISOString() : null,
            hwid: hwid || null,
          });
        }
        const parsed = body.key ? await parseKey(env, body.key) : null;
        let keyId = body.keyId || parsed?.keyId;
        let rec = keyId && (await env.LICENSE_KV.get('key:' + keyId, 'json'));
        if (!rec && u.pathname === '/revoke' && parsed?.sigOk) {
          // Tombstone: a minted-but-never-activated key has no record yet —
          // create one so revocation still lands before first activation.
          keyId = parsed.keyId;
          rec = { email: parsed.email, expMs: parsed.expMs, hwids: [], revoked: false, createdAt: Date.now(), lastSeen: 0, product: parsed.product };
        }
        if (!rec) return json(404, { error: 'key not found' });
        if (u.pathname === '/revoke') rec.revoked = true;
        else if (u.pathname === '/unrevoke') rec.revoked = false;
        else if (body.hwid) rec.hwids = (rec.hwids || []).filter((h) => h !== body.hwid);
        else rec.hwids = [];
        await saveRec(env, keyId, rec);
        return json(200, { ok: true, record: rec });
      }

      return json(404, { error: 'not found' });
    } catch (e) {
      return json(500, { error: String(e?.message || e) });
    }
  },
};
