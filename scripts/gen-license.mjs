#!/usr/bin/env node
// Mint a signed Muse Pool license key — VENDOR-side only, offline.
//
//   node scripts/gen-license.mjs --email user@x.com --days 365
//   node scripts/gen-license.mjs --email user@x.com --forever
//   node scripts/gen-license.mjs --email user@x.com --days 90 --hwid 3C808-XXXXX-AF9BE
//
// --hwid locks the key to one machine (get it from that machine's License page).
// Signing: Ed25519. Private key is read from data/.license-private.pem or env
// MUSE_LICENSE_PRIVATE — generate a pair once with scripts/gen-keypair.mjs.
// NEVER ship the private key (or this script) inside the customer build.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PRIVATE_KEY_FILE = path.join(process.cwd(), 'data', '.license-private.pem');

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const email = (get('--email') || '').trim();
const product = (get('--product') || 'muse').toLowerCase().trim();
if (!/^[a-z][a-z0-9]{0,15}$/.test(product)) {
  console.error('--product must match /^[a-z][a-z0-9]{0,15}$/');
  process.exit(1);
}
const KEY_PREFIX = product.toUpperCase() + '1';
if (!email) {
  console.error('Usage: node scripts/gen-license.mjs --email <email> [--days N | --forever] [--hwid HWID] [--product slug]');
  process.exit(1);
}

const pem = process.env.MUSE_LICENSE_PRIVATE || (fs.existsSync(PRIVATE_KEY_FILE) ? fs.readFileSync(PRIVATE_KEY_FILE, 'utf8') : '');
if (!pem.trim()) {
  console.error(`Thiếu private key — chạy: node scripts/gen-keypair.mjs (tạo ${PRIVATE_KEY_FILE})`);
  process.exit(1);
}
const privKey = crypto.createPrivateKey(pem);

let expiresAtMs = 0;
if (!args.includes('--forever')) {
  const days = Number(get('--days') || 365);
  expiresAtMs = days > 0 ? Date.now() + days * 86_400_000 : 0;
}

const hwid = (get('--hwid') || '').trim();
const payload = Buffer.from(JSON.stringify({ e: email, x: expiresAtMs, h: hwid, p: product })).toString('base64url');
const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), privKey).toString('base64url');
const key = `${KEY_PREFIX}.${payload}.${sig}`;

console.log('\nLicense key:');
console.log(key);
console.log(
  `\nemail=${email}  product=${product}  expires=${expiresAtMs ? new Date(expiresAtMs).toISOString().slice(0, 10) : 'never'}  hwid=${hwid || 'floating'}\n`
);
