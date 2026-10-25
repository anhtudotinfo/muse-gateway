import fs from 'fs';
import path from 'path';

// Shared JSON-file persistence for the router's data/*.json state.
// Two guarantees every state file needs:
//  1. Writes are atomic (tmp file + rename) — a crash mid-write can never
//     leave a half-written JSON that wipes the whole state on next load.
//  2. A corrupt file is quarantined to `<name>.corrupt-<ts>.bak`, never
//     silently overwritten by the next save — the data stays recoverable.

/** Atomic JSON write: sibling tmp file, then rename into place. */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 6)}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** Preserve an unusable state file next to itself before it gets overwritten. */
export function quarantineFile(file: string, reason: string): void {
  try {
    const bak = `${file}.corrupt-${Date.now()}.bak`;
    fs.copyFileSync(file, bak);
    console.error(
      `[safeJson] ${path.basename(file)} ${reason} — preserved at ${path.basename(bak)}`,
    );
  } catch {}
}

/**
 * Read + parse a JSON state file. Missing file → `fallback`. Corrupt JSON →
 * the file is quarantined and `fallback` is returned — callers never get
 * silent garbage.
 */
export function readJsonFile<T>(
  file: string,
  fallback: T,
  isValid?: (v: unknown) => v is T,
): T {
  try {
    if (!fs.existsSync(file)) return fallback;
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isValid && !isValid(parsed)) {
      quarantineFile(file, 'has unexpected shape');
      return fallback;
    }
    return parsed as T;
  } catch (err) {
    console.error(`[safeJson] ${path.basename(file)} is corrupt:`, err);
    quarantineFile(file, 'is corrupt');
    return fallback;
  }
}
