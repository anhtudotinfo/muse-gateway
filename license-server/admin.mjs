#!/usr/bin/env node
// License server admin CLI (vendor-side).
//
//   node license-server/admin.mjs list
//   node license-server/admin.mjs revoke <keyId|fullkey>
//   node license-server/admin.mjs unbind <keyId> <hwid>
//
// Env: LICENSE_SERVER (default http://localhost:3210), MUSE_ADMIN_TOKEN.

const BASE = (process.env.LICENSE_SERVER || 'http://localhost:3210').replace(/\/$/, '');
const TOKEN = process.env.MUSE_ADMIN_TOKEN || '';
const [, , cmd, a1, a2] = process.argv;

const post = (p, body) =>
  fetch(BASE + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-admin-token': TOKEN },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const get = (p) => fetch(BASE + p, { headers: { 'x-admin-token': TOKEN } }).then((r) => r.json());

const fmt = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'never');

if (cmd === 'list') {
  const db = await get('/admin/list');
  for (const [kid, r] of Object.entries(db.keys || {})) {
    console.log(
      `${kid}  ${r.email}  exp=${fmt(r.expMs)}  ${r.revoked ? 'REVOKED' : 'active'}  hwids=[${(r.hwids || []).join(', ')}]  seen=${new Date(r.lastSeen).toISOString()}`
    );
  }
} else if ((cmd === 'revoke' || cmd === 'unrevoke') && a1) {
  const body = a1.startsWith('MUSE1.') ? { key: a1 } : { keyId: a1 };
  console.log(await post('/' + cmd, body));
} else if (cmd === 'unbind' && a1) {
  const body = a1.startsWith('MUSE1.') ? { key: a1, hwid: a2 } : { keyId: a1, hwid: a2 };
  console.log(await post('/unbind', body));
} else {
  console.log(`Usage:
  node license-server/admin.mjs list
  node license-server/admin.mjs revoke <keyId|fullkey>
  node license-server/admin.mjs unrevoke <keyId|fullkey>
  node license-server/admin.mjs unbind <keyId|fullkey> [hwid]   # no hwid = reset all bindings`);
}
