import fs from 'fs';
import path from 'path';
import { dataPath } from './dataDir';

// Media retention for data/media/. Two kinds of files live there:
//   media-*  — generated results served back to clients via /api/media/*
//   frame-*  — temp uploads decoded from data: URLs for Puppeteer file inputs
// Without a sweep the dir grows unbounded (videos are 10–20MB each).

export const MEDIA_DIR = dataPath('media');

// Tunable via env for deployments (e.g. selling API access — media is an
// ephemeral download link, not a storage service):
//   MUSE_MEDIA_TTL_HOURS   how long a generated file stays downloadable
//   MUSE_MEDIA_MAX_MB      total dir cap; oldest files evicted first when over
//   MUSE_MEDIA_EPHEMERAL   =1 → delete each file GRACE minutes after its first
//                          successful serve (API-service mode: client downloads
//                          once, disk stays near-empty)
//   MUSE_MEDIA_GRACE_MIN   grace window after first serve (default 60 min)
const FRAME_TTL_MS = 24 * 60 * 60 * 1000;                                   // upload temps: 1 day
const MEDIA_TTL_MS = (Number(process.env.MUSE_MEDIA_TTL_HOURS) || 48) * 3600_000;
const MAX_TOTAL_BYTES = (Number(process.env.MUSE_MEDIA_MAX_MB) || 1024) * 1024 * 1024;
const EPHEMERAL = process.env.MUSE_MEDIA_EPHEMERAL === '1';
const SERVE_GRACE_MS = (Number(process.env.MUSE_MEDIA_GRACE_MIN) || 60) * 60_000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;                                   // re-scan at most hourly

let lastSweep = 0;
// First-serve timestamps for ephemeral mode. In-memory only — after a restart
// files simply fall back to TTL, which is the safe direction.
const servedAt = new Map<string, number>();

export function persistMediaFile(fname: string, data: Buffer): string {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, fname), data);
  sweepMediaDir();
  return `/api/media/${fname}`;
}

/** Record that a file was served — starts the ephemeral grace countdown. */
export function markMediaServed(fname: string): void {
  if (!EPHEMERAL) return;
  if (!servedAt.has(fname)) {
    if (servedAt.size > 50_000) servedAt.clear();
    servedAt.set(fname, Date.now());
  }
}

/** Age-based expiry + size-cap eviction (oldest first). Best-effort. */
export function sweepMediaDir(force = false): void {
  const now = Date.now();
  if (!force && now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  try {
    if (!fs.existsSync(MEDIA_DIR)) return;
    const entries = fs.readdirSync(MEDIA_DIR)
      .map((n) => {
        const p = path.join(MEDIA_DIR, n);
        try {
          const st = fs.statSync(p);
          return st.isFile() ? { p, n, size: st.size, mtime: st.mtimeMs } : null;
        } catch { return null; }
      })
      .filter((e): e is NonNullable<typeof e> => !!e);

    const victims: typeof entries = [];
    let total = 0;
    for (const e of entries) {
      const ttl = e.n.startsWith('frame-') ? FRAME_TTL_MS : MEDIA_TTL_MS;
      const served = servedAt.get(e.n);
      const pastGrace = served !== undefined && now - served > SERVE_GRACE_MS;
      if (now - e.mtime > ttl || pastGrace) {
        victims.push(e);
        servedAt.delete(e.n);
      } else total += e.size;
    }

    // Still over cap → evict oldest live files until under.
    if (total > MAX_TOTAL_BYTES) {
      const live = entries
        .filter((e) => !victims.includes(e))
        .sort((a, b) => a.mtime - b.mtime);
      for (const e of live) {
        if (total <= MAX_TOTAL_BYTES) break;
        victims.push(e);
        total -= e.size;
      }
    }

    for (const v of victims) {
      try { fs.unlinkSync(v.p); } catch {}
    }
    if (victims.length) {
      console.log(`[mediaStore] swept ${victims.length} file(s), freed ${(victims.reduce((s, v) => s + v.size, 0) / 1024 / 1024).toFixed(1)}MB`);
    }
  } catch {}
}
