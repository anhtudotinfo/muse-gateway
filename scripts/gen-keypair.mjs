#!/usr/bin/env node
// Generate the vendor Ed25519 license keypair — run ONCE on the vendor machine.
//
//   node scripts/gen-keypair.mjs
//
// Writes data/.license-private.pem (KEEP SECRET, never ship to customers)
// and prints the PUBLIC key PEM to paste into src/lib/license.ts (PUBLIC_KEY_PEM).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PRIVATE_KEY_FILE = path.join(process.cwd(), 'data', '.license-private.pem');

if (fs.existsSync(PRIVATE_KEY_FILE)) {
  console.error(`${PRIVATE_KEY_FILE} đã tồn tại — xóa tay nếu thật sự muốn tạo cặp mới (key cũ sẽ vô hiệu mọi license đã cấp).`);
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
fs.mkdirSync(path.dirname(PRIVATE_KEY_FILE), { recursive: true });
fs.writeFileSync(PRIVATE_KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

console.log(`Private key → ${PRIVATE_KEY_FILE}  (giữ bí mật, KHÔNG commit/ship)`);
console.log('\nPublic key — paste vào PUBLIC_KEY_PEM trong src/lib/license.ts:\n');
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
