// Postbuild: make .next/standalone directly runnable for dev testing.
// `next build` does NOT copy .next/static or public/ into standalone —
// the production packager (scripts/package.mjs) handles that itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const standalone = path.join(root, '.next', 'standalone');

if (!fs.existsSync(path.join(standalone, 'server.js'))) process.exit(0);

const pairs = [
  [path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static')],
  [path.join(root, 'public'), path.join(standalone, 'public')],
];
for (const [src, dest] of pairs) {
  if (fs.existsSync(src)) fs.cpSync(src, dest, { recursive: true });
}
console.log('postbuild: copied .next/static + public into standalone');
