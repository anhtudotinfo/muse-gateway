import fs from 'fs';
import path from 'path';
import { isLoopbackOrigin } from './remoteDetect';
import crypto from 'crypto';
import { readJsonFile, writeJsonAtomic } from './safeJson';
import { dataPath } from './dataDir';

// API key management (9router-style): keys live in data/keys.json.
// When at least one ENABLED key exists, /v1/* requires Bearer auth.

export interface KeyAccessRule {
  restricted: boolean;
  allow: string[]; // model ids / combo names this key may call
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  key: string;
  enabled: boolean;
  createdAt: number;
  lastUsedAt: number;
  access?: KeyAccessRule;
}

const KEYS_FILE = dataPath('keys.json');

class ApiKeyService {
  private keys: ApiKeyRecord[] = [];
  private requireAuth = true; // 9router-style explicit toggle

  // keys.json is the source of truth — re-read on every call so mutations
  // from other module realms/processes (Next dev workers) are never stale.
  private load(): void {
    const raw = readJsonFile<unknown>(KEYS_FILE, null);
    if (Array.isArray(raw)) this.keys = raw as ApiKeyRecord[];
    else if (raw && typeof raw === 'object') {
      const o = raw as { keys?: unknown; requireAuth?: unknown };
      if (Array.isArray(o.keys)) this.keys = o.keys as ApiKeyRecord[];
      if (typeof o.requireAuth === 'boolean') this.requireAuth = o.requireAuth;
    }
  }

  private save(): void {
    try {
      writeJsonAtomic(KEYS_FILE, { keys: this.keys, requireAuth: this.requireAuth });
    } catch {}
  }

  get requireAuthEnabled(): boolean {
    this.load();
    return this.requireAuth;
  }

  setRequireAuth(v: boolean): void {
    this.load();
    this.requireAuth = v;
    this.save();
  }

  list(): ApiKeyRecord[] {
    this.load();
    return this.keys;
  }

  create(name: string): ApiKeyRecord {
    this.load();
    const rec: ApiKeyRecord = {
      id: crypto.randomUUID(),
      name: name.trim() || 'Unnamed key',
      key: `sk-muse-${crypto.randomBytes(20).toString('hex')}`,
      enabled: true,
      createdAt: Date.now(),
      lastUsedAt: 0,
    };
    this.keys.push(rec);
    this.save();
    return rec;
  }

  revoke(id: string): boolean {
    this.load();
    const i = this.keys.findIndex((k) => k.id === id);
    if (i < 0) return false;
    this.keys.splice(i, 1);
    this.save();
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    this.load();
    const k = this.keys.find((x) => x.id === id);
    if (!k) return false;
    k.enabled = enabled;
    this.save();
    return true;
  }

  setAccess(id: string, access: KeyAccessRule | undefined): boolean {
    this.load();
    const k = this.keys.find((x) => x.id === id);
    if (!k) return false;
    if (access && access.restricted) {
      k.access = {
        restricted: true,
        allow: Array.isArray(access.allow) ? access.allow.filter((v) => typeof v === 'string') : [],
      };
    } else {
      delete k.access;
    }
    this.save();
    return true;
  }

  /**
   * Resolve the Bearer/x-api-key token to a key record.
   * Returns the matched ApiKeyRecord, or 'open' when auth is not enforced
   * (toggle off, or no enabled keys on a LOCAL request), or null when a key
   * is required but missing/invalid. Remote callers get no zero-key grace
   * period: requireAuth on + zero keys = closed, so exposing /v1 through a
   * tunnel is never accidentally public.
   */
  resolveKey(authHeader: string | null, remote = false, origin: string | null = null): ApiKeyRecord | 'open' | null {
    this.load();
    // Keyless access is for tools on this machine. A web page the user merely
    // visits can also reach 127.0.0.1 through their browser — it sends an
    // Origin, so a foreign one (or "null") must present a real key.
    const open = !origin || isLoopbackOrigin(origin) ? 'open' : null;
    if (!this.requireAuth) return open;
    const active = this.keys.filter((k) => k.enabled);
    if (active.length === 0) return remote ? null : open;
    const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return null;
    const tb = Buffer.from(token);
    const match = active.find((k) => {
      const kb = Buffer.from(k.key);
      return kb.length === tb.length && crypto.timingSafeEqual(kb, tb);
    });
    if (!match) return null;
    // Persist throttled — every authenticated request shouldn't rewrite the
    // file (churns disk + trips dev-server file watchers).
    const prevUsed = match.lastUsedAt || 0;
    match.lastUsedAt = Date.now();
    if (Date.now() - prevUsed > 60_000) this.save();
    return match;
  }

  /** True when the key may call `model` (unrestricted key, open pool, or allow-listed). */
  allowsModel(key: ApiKeyRecord | 'open' | null, model: string): boolean {
    if (!key || key === 'open') return true;
    if (!key.access?.restricted) return true;
    const allow = new Set((key.access.allow || []).map((v) => v.toLowerCase()));
    return allow.has(String(model || '').toLowerCase());
  }

  /** Returns true if the request is authorized. No keys or toggle off → open. */
  authorize(authHeader: string | null): boolean {
    return this.resolveKey(authHeader) !== null;
  }

  get authRequired(): boolean {
    this.load();
    return this.requireAuth && this.keys.some((k) => k.enabled);
  }
}

const g = globalThis as unknown as { apiKeyService: ApiKeyService };
export const apiKeyService = g.apiKeyService || new ApiKeyService();
g.apiKeyService = apiKeyService;
