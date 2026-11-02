import crypto from 'node:crypto';
import { apiKeyService } from './apiKeys';

// One-click connect for desktop/web apps (SparkCut). The app asks to pair,
// the user approves in the gateway's own page, and the app then collects an
// API key once. Approval has to happen here because any website open in the
// user's browser can reach localhost:1412 — handing a key to whoever asks
// would let a malicious page spend the user's Muse accounts.
//
//   app  → POST /api/pair            { app }          → { id, code, secret, approve_url }
//   user → /pair/<id> (gateway page) → POST /api/pair/<id>/decision
//   app  → GET  /api/pair/<id>  with X-Pair-Secret    → { status, base_url, api_key } once

export type PairStatus = 'pending' | 'approved' | 'denied' | 'expired' | 'collected';

export interface PairRequest {
  id: string;
  /** Short code shown in both the app and the approval page, to compare. */
  code: string;
  /** Only the app that started the request knows it — needed to collect. */
  secret: string;
  app: string;
  origin: string;
  createdAt: number;
  status: PairStatus;
  keyId: string | null;
}

const TTL_MS = 5 * 60_000;
const MAX_PENDING = 20;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function shortCode(): string {
  const bytes = crypto.randomBytes(6);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 3).join('')}-${chars.slice(3).join('')}`;
}

/** App names become the key's name: keep them short and printable. */
export function cleanAppName(raw: unknown): string {
  const name = String(raw ?? '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 40);
  return name || 'App';
}

/** Browser origins allowed to start pairing: loopback dev servers, the Tauri
 *  webview, and anything listed in MUSE_PAIR_ORIGINS (comma-separated) for a
 *  hosted web build. Approval is still required for every request. */
export function isPairOrigin(origin: string | null): boolean {
  if (!origin) return true; // native callers (no browser) send none
  const extra = (process.env.MUSE_PAIR_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  if (extra.includes(origin.replace(/\/+$/, ''))) return true;
  try {
    const u = new URL(origin);
    if (u.protocol === 'tauri:' && u.hostname === 'localhost') return true;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    return ['localhost', '127.0.0.1', '[::1]', 'tauri.localhost'].includes(u.hostname);
  } catch {
    return false;
  }
}

class PairingService {
  private requests = new Map<string, PairRequest>();

  private prune() {
    const now = Date.now();
    for (const [id, r] of this.requests) {
      if (r.status === 'pending' && now - r.createdAt > TTL_MS) r.status = 'expired';
      if (now - r.createdAt > TTL_MS * 4) this.requests.delete(id);
    }
  }

  start(app: string, origin: string | null): PairRequest {
    this.prune();
    const pending = [...this.requests.values()].filter((r) => r.status === 'pending');
    if (pending.length >= MAX_PENDING) pending[0].status = 'expired';
    const req: PairRequest = {
      id: crypto.randomBytes(12).toString('hex'),
      code: shortCode(),
      secret: crypto.randomBytes(24).toString('hex'),
      app: cleanAppName(app),
      origin: origin || 'native app',
      createdAt: Date.now(),
      status: 'pending',
      keyId: null,
    };
    this.requests.set(req.id, req);
    return req;
  }

  get(id: string): PairRequest | null {
    this.prune();
    return this.requests.get(id) ?? null;
  }

  /** The user's answer. Approving reuses an existing enabled key with the
   *  app's name, so reconnecting doesn't pile up keys. */
  decide(id: string, approve: boolean): PairRequest | null {
    const req = this.get(id);
    if (!req || req.status !== 'pending') return req;
    if (!approve) {
      req.status = 'denied';
      return req;
    }
    const existing = apiKeyService.list().find((k) => k.enabled && k.name === req.app);
    req.keyId = (existing ?? apiKeyService.create(req.app)).id;
    req.status = 'approved';
    return req;
  }

  /** Hands the key to the app that started the request — once. */
  collect(id: string, secret: string | null): { req: PairRequest; key: string | null } | null {
    const req = this.get(id);
    if (!req) return null;
    const ok =
      !!secret &&
      secret.length === req.secret.length &&
      crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(req.secret));
    if (!ok || req.status !== 'approved' || !req.keyId) return { req, key: null };
    const key = apiKeyService.list().find((k) => k.id === req.keyId)?.key ?? null;
    if (key) req.status = 'collected';
    return { req, key };
  }
}

const g = globalThis as unknown as { pairingService?: PairingService };
export const pairingService = g.pairingService || new PairingService();
g.pairingService = pairingService;
