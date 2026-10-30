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
// POST /unbind · GET /admin/list · POST /admin/mint · POST /admin/extend ·
// POST /admin/delete · GET /admin/history — same protocol as
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

// Per-key event log at 'log:<keyId>' — capped at 50 entries, newest last.
// Only state-changing events are logged (mint/activate/bind/admin actions);
// routine /verify calls would burn through the free-tier KV write quota.
const LOG_CAP = 50;
async function logEvent(env, keyId, action, detail) {
  try {
    const name = 'log:' + keyId;
    const events = (await env.LICENSE_KV.get(name, 'json')) || [];
    events.push({ t: Date.now(), a: action, ...(detail ? { d: detail } : {}) });
    await env.LICENSE_KV.put(name, JSON.stringify(events.slice(-LOG_CAP)));
  } catch { /* logging must never break the request path */ }
}

async function check(env, body, bind) {
  const { key, hwid, nonce } = body || {};
  const parsed = await parseKey(env, key);
  if (!parsed || !parsed.sigOk) return deny(env, 'invalid_signature', nonce);
  const now = Date.now();
  // Hard-deleted keys leave a 'del:' tombstone — a still-valid signature
  // would otherwise silently re-activate on the next /activate.
  if (await env.LICENSE_KV.get('del:' + parsed.keyId, 'json')) {
    return deny(env, 'license_deleted', nonce, parsed.keyId);
  }

  let rec = await loadRec(env, parsed.keyId, null);
  // rec.expMs is the effective expiry: /admin/extend rewrites it, while the
  // expiry baked into the signed payload is immutable. An "expired" key can
  // be revived by extending the record — so check the record first.
  const effExpMs = rec ? Number(rec.expMs) || 0 : parsed.expMs;
  if (effExpMs > 0 && now > effExpMs) return deny(env, 'license_expired', nonce, parsed.keyId);

  let dirty = false;
  let firstActivation = false;
  if (!rec) {
    if (!bind) return deny(env, 'key_not_activated', nonce, parsed.keyId);
    rec = { email: parsed.email, expMs: parsed.expMs, hwids: [], revoked: false, createdAt: now, lastSeen: 0, product: parsed.product };
    dirty = true;
    firstActivation = true;
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

  let boundNewHwid = false;
  if (parsed.keyHwid) {
    if (String(hwid) !== parsed.keyHwid) {
      if (dirty) await saveRec(env, parsed.keyId, rec);
      return deny(env, 'hwid_mismatch', nonce, parsed.keyId);
    }
  } else if (hwid && !rec.hwids.includes(String(hwid))) {
    if (bind && rec.hwids.length < MAX_HWIDS(env)) {
      rec.hwids.push(String(hwid));
      dirty = true;
      boundNewHwid = !firstActivation;
    } else {
      if (dirty) await saveRec(env, parsed.keyId, rec);
      return deny(env, rec.hwids.length ? 'hwid_not_bound' : 'hwid_required', nonce, parsed.keyId);
    }
  }
  if (dirty) await saveRec(env, parsed.keyId, rec);
  if (firstActivation) {
    await logEvent(env, parsed.keyId, 'activate', hwid ? { hwid: String(hwid) } : undefined);
  } else if (boundNewHwid) {
    await logEvent(env, parsed.keyId, 'bind', { hwid: String(hwid) });
  }

  const bound = parsed.keyHwid || String(hwid || '');
  const exp = Math.min(now + TTL_MS(env), effExpMs > 0 ? effExpMs : now + TTL_MS(env));
  const signed = await signVerdict(env, { ok: true, kid: parsed.keyId, h: bound, exp, reason: 'ok', nonce: String(nonce || ''), p: parsed.product });
  return {
    ...signed,
    ok: true,
    keyId: parsed.keyId,
    email: parsed.email,
    boundHwid: bound,
    expiresAt: effExpMs ? new Date(effExpMs).toISOString() : '',
  };
}

const json = (code, obj) =>
  new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json' } });

// ── named-tunnel provisioning ─────────────────────────────────────────────
// POST /tunnel/provision {key} — verifies the license signature + record
// state, then ensures a Cloudflare named tunnel exists for that key under
// env.TUNNEL_DOMAIN and returns { ok, tunnelToken, publicUrl, hostname } for
// the gateway dashboard's named-tunnel form.
//
// KV 'tun:<keyId>' caches { tunnelId, hostname }; the connector token is
// fetched fresh from the CF API each call (rotation is harmless). Idempotent
// per license — one tunnel/hostname per keyId.
//
// Worker env needed (wrangler secret put … / [vars]):
//   CF_API_TOKEN   — API token: Account→Cloudflare Tunnel:Edit + Zone→DNS:Edit
//                    scoped to the TUNNEL_DOMAIN parent zone
//   CF_ACCOUNT_ID  — account that owns the zone
//   CF_ZONE_ID     — zone id of the TUNNEL_DOMAIN parent (e.g. storetiki.online)
//   TUNNEL_DOMAIN  — e.g. "gw.storetiki.online" (set in [vars])
//   TUNNEL_TARGET  — optional, default "http://localhost:1412"
const CF_API = 'https://api.cloudflare.com/client/v4';

async function cf(env, method, path, body) {
  const res = await fetch(`${CF_API}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.CF_API_TOKEN}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) {
    const msg = (j.errors && j.errors[0] && j.errors[0].message) || `cf_${res.status}`;
    throw new Error(msg);
  }
  return j.result;
}

async function provisionTunnel(env, body) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_ZONE_ID || !env.TUNNEL_DOMAIN) {
    return json(503, { error: 'tunnel provisioning is not configured on this server' });
  }
  const parsed = await parseKey(env, body?.key);
  if (!parsed || !parsed.sigOk) return json(403, { error: 'invalid_signature' });
  if (await env.LICENSE_KV.get('del:' + parsed.keyId, 'json')) return json(403, { error: 'license_deleted' });
  const rec = await env.LICENSE_KV.get('key:' + parsed.keyId, 'json');
  const effExpMs = rec ? Number(rec.expMs) || 0 : parsed.expMs;
  if (effExpMs > 0 && Date.now() > effExpMs) return json(403, { error: 'license_expired' });
  if (rec?.revoked) return json(403, { error: 'license_revoked' });

  const domain = String(env.TUNNEL_DOMAIN).replace(/^\.+|\.+$/g, '').toLowerCase();
  const hostname = `u-${parsed.keyId}.${domain}`;
  const target = String(env.TUNNEL_TARGET || 'http://localhost:1412');

  let tun = await env.LICENSE_KV.get('tun:' + parsed.keyId, 'json');
  if (!tun || tun.hostname !== hostname) {
    const tunName = `muse-${parsed.keyId}`;
    let t;
    try {
      t = await cf(env, 'POST', `/accounts/${env.CF_ACCOUNT_ID}/cfd_tunnel`, {
        name: tunName,
        config_src: 'cloudflare',
      });
    } catch (e) {
      // A previous attempt may have created the tunnel then failed later —
      // reuse it instead of erroring out (idempotent per key).
      if (!/already have a tunnel/i.test(String(e?.message || e))) throw e;
      const list = await cf(
        env, 'GET',
        `/accounts/${env.CF_ACCOUNT_ID}/cfd_tunnel?name=${encodeURIComponent(tunName)}&is_deleted=false`
      );
      t = Array.isArray(list) && list[0];
      if (!t) throw e;
    }
    tun = { tunnelId: t.id, hostname, createdAt: Date.now() };
    // Public hostname → customer-local gateway; catch-all 404 after it.
    await cf(env, 'PUT', `/accounts/${env.CF_ACCOUNT_ID}/cfd_tunnel/${t.id}/configurations`, {
      config: { ingress: [{ hostname, service: target }, { service: 'http_status:404' }] },
    });
    const wantContent = `${tun.tunnelId}.cfargotunnel.com`;
    try {
      await cf(env, 'POST', `/zones/${env.CF_ZONE_ID}/dns_records`, {
        type: 'CNAME',
        name: hostname,
        content: wantContent,
        proxied: true,
      });
    } catch (e) {
      if (!/already exists/i.test(String(e?.message || e))) throw e;
      // Record exists — repair it if a previous run wrote stale content
      // (e.g. the t.tunnelId bug produced "undefined.cfargotunnel.com").
      const recs = await cf(env, 'GET', `/zones/${env.CF_ZONE_ID}/dns_records?name=${encodeURIComponent(hostname)}`);
      const rec = Array.isArray(recs) && recs[0];
      if (rec && rec.content !== wantContent) {
        await cf(env, 'PATCH', `/zones/${env.CF_ZONE_ID}/dns_records/${rec.id}`, {
          type: 'CNAME', name: hostname, content: wantContent, proxied: true,
        });
      }
    }
    await env.LICENSE_KV.put('tun:' + parsed.keyId, JSON.stringify(tun));
  }

  const token = await cf(env, 'GET', `/accounts/${env.CF_ACCOUNT_ID}/cfd_tunnel/${tun.tunnelId}/token`);
  return json(200, {
    ok: true,
    tunnelToken: token,
    publicUrl: `https://${hostname}`,
    hostname,
    email: parsed.email,
  });
}

// Hard-delete a key: wipe the record, event log and tunnel cache, clean up
// the Cloudflare tunnel + DNS (best effort), then leave a 'del:' tombstone
// so the still-valid signed key can never activate again.
async function deleteKey(env, keyId, rec, parsed) {
  const email = rec?.email || parsed?.email || '';
  const product = rec?.product || parsed?.product || 'muse';
  try {
    const tun = await env.LICENSE_KV.get('tun:' + keyId, 'json');
    if (tun?.tunnelId && env.CF_API_TOKEN && env.CF_ACCOUNT_ID) {
      try {
        await cf(env, 'DELETE', `/accounts/${env.CF_ACCOUNT_ID}/cfd_tunnel/${tun.tunnelId}`);
      } catch { /* tunnel may already be gone */ }
      if (tun.hostname && env.CF_ZONE_ID) {
        try {
          const recs = await cf(env, 'GET', `/zones/${env.CF_ZONE_ID}/dns_records?name=${encodeURIComponent(tun.hostname)}`);
          const r = Array.isArray(recs) && recs[0];
          if (r) await cf(env, 'DELETE', `/zones/${env.CF_ZONE_ID}/dns_records/${r.id}`);
        } catch { /* DNS cleanup is best-effort */ }
      }
    }
  } catch { /* KV read issues must not block deletion */ }
  await env.LICENSE_KV.delete('key:' + keyId);
  await env.LICENSE_KV.delete('tun:' + keyId);
  await env.LICENSE_KV.delete('log:' + keyId);
  await env.LICENSE_KV.put('del:' + keyId, JSON.stringify({ email, product, deletedAt: Date.now() }));
}

export default {
  async fetch(request, env) {
    try {
      const u = new URL(request.url);
      if (request.method === 'POST' && (u.pathname === '/activate' || u.pathname === '/verify')) {
        const body = await request.json().catch(() => ({}));
        const out = await check(env, body, u.pathname === '/activate');
        return json(out.ok ? 200 : 403, out);
      }

      if (request.method === 'POST' && u.pathname === '/tunnel/provision') {
        const body = await request.json().catch(() => ({}));
        return await provisionTunnel(env, body);
      }

      const admin = ['/admin/list', '/admin/mint', '/admin/extend', '/admin/delete', '/admin/history', '/revoke', '/unrevoke', '/unbind'];
      if (admin.includes(u.pathname)) {
        if (!env.MUSE_ADMIN_TOKEN || request.headers.get('x-admin-token') !== String(env.MUSE_ADMIN_TOKEN).trim()) {
          return json(401, { error: 'admin token required' });
        }
        if (u.pathname === '/admin/history') {
          const keyId = u.searchParams.get('keyId') || '';
          if (!keyId) return json(400, { error: 'keyId required' });
          const events = (await env.LICENSE_KV.get('log:' + keyId, 'json')) || [];
          return json(200, { ok: true, events });
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
          await logEvent(env, keyId, 'mint', { email, product, days: forever ? 0 : days });
          return json(200, {
            ok: true, key, keyId, email, product,
            expiresAt: expMs ? new Date(expMs).toISOString() : null,
            hwid: hwid || null,
          });
        }
        if (u.pathname === '/admin/delete') {
          const parsed = body.key ? await parseKey(env, body.key) : null;
          const keyId = body.keyId || parsed?.keyId;
          if (!keyId) return json(400, { error: 'keyId or key required' });
          const rec = await env.LICENSE_KV.get('key:' + keyId, 'json');
          await deleteKey(env, keyId, rec, parsed);
          return json(200, { ok: true, keyId });
        }
        if (u.pathname === '/admin/extend') {
          const parsed = body.key ? await parseKey(env, body.key) : null;
          let keyId = body.keyId || parsed?.keyId;
          let rec = keyId && (await env.LICENSE_KV.get('key:' + keyId, 'json'));
          if (!rec && parsed?.sigOk) {
            // Same tombstone trick as /revoke — extending a never-activated
            // key creates its record so the new expiry has somewhere to live.
            keyId = parsed.keyId;
            rec = { email: parsed.email, expMs: parsed.expMs, hwids: [], revoked: false, createdAt: Date.now(), lastSeen: 0, product: parsed.product };
          }
          if (!rec) return json(404, { error: 'key not found' });
          const forever = body.forever === true;
          const days = Number(body.days);
          if (!forever && (!Number.isFinite(days) || days <= 0 || days > 36500)) {
            return json(400, { error: 'days must be 1..36500, or forever:true' });
          }
          const base = Math.max(Date.now(), Number(rec.expMs) || 0);
          rec.expMs = forever ? 0 : base + days * 86_400_000;
          await saveRec(env, keyId, rec);
          await logEvent(env, keyId, 'extend', { days: forever ? 0 : days, expMs: rec.expMs });
          return json(200, { ok: true, record: rec });
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
        if (u.pathname === '/revoke') { rec.revoked = true; await logEvent(env, keyId, 'revoke'); }
        else if (u.pathname === '/unrevoke') { rec.revoked = false; await logEvent(env, keyId, 'unrevoke'); }
        else if (body.hwid) {
          rec.hwids = (rec.hwids || []).filter((h) => h !== body.hwid);
          await logEvent(env, keyId, 'unbind', { hwid: body.hwid });
        } else {
          rec.hwids = [];
          await logEvent(env, keyId, 'unbind_all');
        }
        await saveRec(env, keyId, rec);
        return json(200, { ok: true, record: rec });
      }

      return json(404, { error: 'not found' });
    } catch (e) {
      return json(500, { error: String(e?.message || e) });
    }
  },
};
