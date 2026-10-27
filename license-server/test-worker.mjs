// E2E test against the deployed Cloudflare worker — vendor-side only.
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = 'https://license.storetiki.online';
const KEY = 'MUSE1.REDACTED';
const HWID = 'TEST1-HWID1-AAAAA';
const HWID2 = 'AAAAA-BBBBB-CCCCC';
const TOKEN = readFileSync(new URL('./.admin-token', import.meta.url), 'utf8').trim();
const PUB = readFileSync(new URL('./.pub.tmp', import.meta.url), 'utf8');

const post = async (p, b, admin) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(admin ? { 'x-admin-token': TOKEN } : {}) }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const sigOk = (r) => r?.v && r?.s && cryptoVerify(null, Buffer.from(r.v, 'utf8'), createPublicKey(PUB), Buffer.from(r.s, 'base64url'));
const verdict = (r) => r?.v ? JSON.parse(Buffer.from(r.v, 'base64url').toString('utf8')) : null;

let pass = 0, fail = 0;
const t = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

// 1. activate from machine A
let r = await post('/activate', { key: KEY, hwid: HWID, nonce: 'n1' });
t('activate A binds hwid', r.status === 200 && r.body?.ok === true && verdict(r.body)?.h === HWID, JSON.stringify(r.body));
t('verdict signature valid', sigOk(r.body));

// 2. activate same key from machine B -> deny
r = await post('/activate', { key: KEY, hwid: HWID2, nonce: 'n2' });
t('activate B denied (hwid bound)', r.status === 403 && r.body?.ok === false && verdict(r.body)?.reason === 'hwid_not_bound', r.body?.reason);
t('denial signature valid', sigOk(r.body));

// 3. verify from A -> ok
r = await post('/verify', { key: KEY, hwid: HWID, nonce: 'n3' });
t('verify A ok', r.status === 200 && r.body?.ok === true && sigOk(r.body));

// 4. admin list shows the key bound
r = await fetch(BASE + '/admin/list', { headers: { 'x-admin-token': TOKEN } });
const list = await r.json();
const entry = Object.entries(list.keys || {}).find(([, v]) => (v?.hwids || []).includes(HWID));
const kid = entry?.[0];
t('admin list shows bound hwid', !!kid, String(kid).slice(0, 40));

// 5. admin endpoint without token -> 401
r = await fetch(BASE + '/admin/list');
t('admin without token -> 401', r.status === 401);

// 6. revoke -> verify denied
r = await post('/revoke', { keyId: kid }, true);
t('revoke ok', r.status === 200 && r.body?.ok === true);
r = await post('/verify', { key: KEY, hwid: HWID, nonce: 'n4' });
t('verify after revoke -> denied', r.body?.ok === false && verdict(r.body)?.reason === 'license_revoked' && sigOk(r.body), r.body?.reason);

// 7. unrevoke -> ok again
r = await post('/unrevoke', { keyId: kid }, true);
t('unrevoke ok', r.body?.ok === true);
r = await post('/verify', { key: KEY, hwid: HWID, nonce: 'n5' });
t('verify after unrevoke -> ok', r.body?.ok === true && sigOk(r.body));

// 8. unbind -> machine B can activate
r = await post('/unbind', { keyId: kid, hwid: HWID }, true);
t('unbind hwid', r.body?.ok === true);
r = await post('/activate', { key: KEY, hwid: HWID2, nonce: 'n6' });
t('activate B after unbind', r.status === 200 && r.body?.ok === true && verdict(r.body)?.h === HWID2, r.body?.reason);

// 9. forged/bad key -> deny
r = await post('/activate', { key: KEY.slice(0, -4) + 'XXXX', hwid: HWID, nonce: 'n7' });
t('forged key denied', r.body?.ok === false && sigOk(r.body), r.body?.reason);

// cleanup: rebind to machine A for consistency
await post('/unbind', { keyId: kid }, true);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
