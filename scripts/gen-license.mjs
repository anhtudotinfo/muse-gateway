#!/usr/bin/env node
// Mint a signed Muse Pool license key — offline, no server needed.
//
//   node scripts/gen-license.mjs --email user@x.com --days 365
//   node scripts/gen-license.mjs --email user@x.com --forever
//   node scripts/gen-license.mjs --email user@x.com --days 90 --hwid 3C808-XXXXX-AF9BE
//
// --hwid locks the key to one machine (get it from that machine's /license page).
// Signing secret: env MUSE_LICENSE_SECRET (must match the server's value).

import crypto from 'node:crypto';

const SECRET = process.env.MUSE_LICENSE_SECRET || 'muse-pool-local-license-v1';
const KEY_PREFIX = 'MUSE1';

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const email = (get('--email') || '').trim();
if (!email) {
  console.error('Usage: node scripts/gen-license.mjs --email <email> [--days N | --forever] [--hwid HWID]');
  process.exit(1);
}

let expiresAtMs = 0;
if (args.includes('--forever')) {
  expiresAtMs = 0;
} else {
  const days = Number(get('--days') || 365);
  expiresAtMs = days > 0 ? Date.now() + days * 86_400_000 : 0;
}

const hwid = (get('--hwid') || '').trim();
const payload = Buffer.from(JSON.stringify({ e: email, x: expiresAtMs, h: hwid })).toString('base64url');
const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
const key = `${KEY_PREFIX}.${payload}.${sig}`;

console.log('\nLicense key:');
console.log(key);
console.log(
  `\nemail=${email}  expires=${expiresAtMs ? new Date(expiresAtMs).toISOString().slice(0, 10) : 'never'}  hwid=${hwid || 'floating'}\n`
);
