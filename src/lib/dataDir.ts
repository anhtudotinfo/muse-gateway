import path from 'node:path';

/**
 * Writable runtime-data root for all app state (sessions, license, keys,
 * pool, usage, media, settings).
 *
 * Packaged npm installs run server.js from the global package dir — Next's
 * standalone entry chdir()s there, so process.cwd() would point inside
 * node_modules. The CLI sets MUSE_DATA_DIR (~/.muse-gateway) instead.
 * The packed exe and dev runs leave it unset → falls back to process.cwd()
 * (dir beside muse-gateway.exe / the repo root).
 */
export function dataDir(): string {
  return path.join(process.env.MUSE_DATA_DIR || process.cwd(), 'data');
}

export function dataPath(...parts: string[]): string {
  return path.join(dataDir(), ...parts);
}
