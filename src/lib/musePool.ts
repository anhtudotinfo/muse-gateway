import fs from 'fs';
import path from 'path';
import { getSavedSessions } from './museService';
import { museDriver } from './museDriver';
import { settingsService } from './settings';
import './logBuffer';
import type { Profile } from '@/types';
import type { ChatOptions, ChatResult } from './museDriver';

// Pool of Muse accounts (one per saved cookie profile) with 9router-style
// selection: strategy (fallback order / round-robin), per-account cooldown
// on failure, and usage stats persisted to data/pool.json.

export type PoolStrategy = 'fallback' | 'round-robin' | 'fusion';

// 9router-style combo: a named group of accounts with its own strategy.
// The request `model` field selects the combo by name (default → all accounts).
export interface PoolCombo {
  id: string;
  name: string;
  accountIds: string[];
  strategy: PoolStrategy;
}
export type AccountStatus = 'ready' | 'busy' | 'queued' | 'cooldown' | 'disabled' | 'error';

export interface PoolAccountStats {
  enabled: boolean;
  cooldownUntil: number; // epoch ms, 0 = not cooling
  cooldownReason: string; // 'auth' | 'quota' | 'transient' | ''
  failCount: number;
  totalRequests: number;
  lastUsedAt: number;
  lastError: string;
}

export interface PoolAccountView extends PoolAccountStats {
  id: string;
  name: string;
  /** Stable worker alias derived from account order: w0, w1, … */
  worker: string;
  status: AccountStatus;
  cooldownRemainingMs: number;
}

export interface PoolStateView {
  strategy: PoolStrategy;
  accounts: PoolAccountView[];
}

interface PoolFile {
  strategy: PoolStrategy;
  rrPointer: number;
  accounts: Record<string, Partial<PoolAccountStats>>;
  combos?: PoolCombo[];
}

// Recent request log for the Usage page (in-memory, last 200).
export interface UsageEntry {
  ts: number;
  accountId: string;
  accountName: string;
  ok: boolean;
  ms: number;
  promptPreview: string;
  error?: string;
  model?: string;
  ua?: string;
  keyName?: string;
  endpoint?: string;
  promptChars?: number;
  replyChars?: number;
}

const POOL_FILE = path.join(process.cwd(), 'data', 'pool.json');
const USAGE_FILE = path.join(process.cwd(), 'data', 'usage.jsonl');
const COOLDOWN_BASE_MS = 5 * 60 * 1000; // transient: 5min, scales with failCount
const COOLDOWN_MAX_MS = 60 * 60 * 1000; // quota: 1h
const COOLDOWN_AUTH_MS = 24 * 60 * 60 * 1000; // auth/dead cookie: 24h
const MAX_ACCOUNTS_PER_REQUEST = 8;

function defaultStats(): PoolAccountStats {
  return {
    enabled: true,
    cooldownUntil: 0,
    cooldownReason: '',
    failCount: 0,
    totalRequests: 0,
    lastUsedAt: 0,
    lastError: '',
  };
}

class MusePoolService {
  private state: PoolFile = { strategy: 'round-robin', rrPointer: 0, accounts: {} };
  private usageLog: UsageEntry[] = [];
  private lastKeepAlive = 0;

  constructor() {
    this.load();
    // Keep-alive loop — checks every minute, pings enabled sessions on the
    // configured interval so their pages/realtime sockets stay warm.
    const t = setInterval(() => { void this.keepAliveTick(); }, 60_000);
    t.unref?.();
  }

  private async keepAliveTick(): Promise<void> {
    try {
      const s = settingsService.get();
      if (!s.keepAliveEnabled) return;
      if (Date.now() - this.lastKeepAlive < s.keepAliveMin * 60_000) return;
      this.lastKeepAlive = Date.now();
      await this.keepAliveAll();
    } catch {}
  }

  /** Ping every enabled, non-busy account's browser page once. */
  async keepAliveAll(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const a of this.getState().accounts) {
      if (!a.enabled) {
        out[a.name] = 'disabled';
        continue;
      }
      out[a.name] = await museDriver.keepAlive(a.id);
    }
    const ok = Object.values(out).filter((v) => v === 'ok').length;
    console.log(`[MusePool] keep-alive: ${ok}/${Object.keys(out).length} account ấm`);
    return out;
  }

  private load(): void {
    try {
      if (fs.existsSync(POOL_FILE)) {
        const raw = JSON.parse(fs.readFileSync(POOL_FILE, 'utf8'));
        this.state = {
          strategy: raw.strategy === 'fallback' ? 'fallback' : raw.strategy === 'fusion' ? 'fusion' : 'round-robin',
          rrPointer: typeof raw.rrPointer === 'number' ? raw.rrPointer : 0,
          accounts: raw.accounts && typeof raw.accounts === 'object' ? raw.accounts : {},
          combos: Array.isArray(raw.combos) ? raw.combos : [],
        };
      }
    } catch {}
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(POOL_FILE), { recursive: true });
      fs.writeFileSync(POOL_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    } catch {}
  }

  // pool.json is the source of truth — re-read on every access so mutations
  // from other module realms/processes (dev workers, a second `npm start`)
  // are never stale. The file is a few KB; all mutations save() immediately.
  private statsFor(id: string): PoolAccountStats {
    this.load();
    return { ...defaultStats(), ...(this.state.accounts[id] || {}) };
  }

  private setStats(id: string, stats: PoolAccountStats): void {
    this.state.accounts[id] = stats;
    this.save();
  }

  getState(): PoolStateView {
    this.load();
    const now = Date.now();
    return {
      strategy: this.state.strategy,
      accounts: getSavedSessions().map((s, i) => {
        const st = this.statsFor(s.id);
        let status: AccountStatus = 'ready';
        if (!st.enabled) status = 'disabled';
        else if (st.cooldownUntil > now)
          status = st.cooldownReason === 'auth' ? 'error' : 'cooldown';
        else if (museDriver.isBusy(s.id)) status = 'busy';
        else if (museDriver.isQueued(s.id)) status = 'queued';
        return {
          id: s.id,
          name: s.name,
          worker: `w${i}`,
          ...st,
          status,
          cooldownRemainingMs: Math.max(0, st.cooldownUntil - now),
        };
      }),
    };
  }

  setStrategy(strategy: PoolStrategy): void {
    this.load();
    this.state.strategy = strategy;
    this.save();
  }

  // ---- Combos (9router-style model groups) ----

  getCombos(): PoolCombo[] {
    this.load();
    return this.state.combos || [];
  }

  createCombo(name: string, accountIds: string[], strategy: PoolStrategy): PoolCombo {
    this.load();
    const combo: PoolCombo = {
      id: `combo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      accountIds,
      strategy,
    };
    (this.state.combos ||= []).push(combo);
    this.save();
    return combo;
  }

  updateCombo(id: string, patch: Partial<Omit<PoolCombo, 'id'>>): boolean {
    this.load();
    const c = this.getCombos().find((x) => x.id === id);
    if (!c) return false;
    if (patch.name !== undefined) c.name = patch.name.trim();
    if (patch.accountIds !== undefined) c.accountIds = patch.accountIds;
    if (patch.strategy !== undefined) c.strategy = patch.strategy;
    this.save();
    return true;
  }

  deleteCombo(id: string): boolean {
    this.load();
    const i = this.getCombos().findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.state.combos!.splice(i, 1);
    this.save();
    return true;
  }

  /** Case-insensitive name lookup — used by /api/combos to reject duplicates. */
  findComboByName(name: string): PoolCombo | null {
    const m = name.trim().toLowerCase();
    return this.getCombos().find((c) => c.name.toLowerCase() === m) || null;
  }

  /** Remove a deleted session from every combo that referenced it. */
  removeAccountFromCombos(accountId: string): void {
    this.load();
    let dirty = false;
    for (const c of this.getCombos()) {
      const next = c.accountIds.filter((x) => x !== accountId);
      if (next.length !== c.accountIds.length) {
        c.accountIds = next;
        dirty = true;
      }
    }
    if (dirty) this.save();
  }

  private resolveCombo(model?: string | null): PoolCombo | null {
    if (!model) return null;
    const m = model.trim().toLowerCase();
    return (
      this.getCombos().find(
        (c) => c.name.toLowerCase() === m || c.id.toLowerCase() === m
      ) || null
    );
  }

  setEnabled(id: string, enabled: boolean): void {
    const st = this.statsFor(id);
    st.enabled = enabled;
    this.setStats(id, st);
  }

  resetAccount(id: string): void {
    this.load();
    const st = this.statsFor(id);
    st.cooldownUntil = 0;
    st.cooldownReason = '';
    st.failCount = 0;
    st.lastError = '';
    this.setStats(id, st);
  }

  private pickAccount(
    tried: Set<string>,
    accountIds: string[] | null,
    strategy: PoolStrategy
  ): Profile | null {
    const now = Date.now();
    const candidates = getSavedSessions().filter((s) => {
      if (tried.has(s.id)) return false;
      if (accountIds && !accountIds.includes(s.id)) return false;
      const st = this.statsFor(s.id);
      return st.enabled && st.cooldownUntil <= now;
    });
    if (!candidates.length) return null;
    if (strategy === 'fallback') return candidates[0];
    const idx = this.state.rrPointer % candidates.length;
    this.state.rrPointer = (this.state.rrPointer + 1) % Math.max(candidates.length, 1);
    this.save();
    return candidates[idx];
  }

  // Classify the failure to decide how long the account sits out.
  private classifyError(err: any): 'auth' | 'quota' | 'transient' {
    const msg = String(err?.message || err || '').toLowerCase();
    if (/khung chat|textarea|cookie|session|login|đăng nhập|unauthorized|401|403/.test(msg))
      return 'auth';
    if (/limit|lượt|quota|upgrade|rate.?limit|429|hết/.test(msg)) return 'quota';
    return 'transient';
  }

  async chat(opts: ChatOptions): Promise<ChatResult> {
    this.load();
    const combo = this.resolveCombo(opts.model);
    // Empty accountIds on a combo means "all accounts" (per the Combos UI).
    const accountIds = combo && combo.accountIds.length ? combo.accountIds : null;
    const strategy: PoolStrategy = combo ? combo.strategy : this.state.strategy;

    if (strategy === 'fusion') return this.chatFusion(opts, accountIds);

    const tried = new Set<string>();
    let lastErr: any = new Error('Không có tài khoản Muse nào khả dụng.');

    for (let i = 0; i < MAX_ACCOUNTS_PER_REQUEST; i++) {
      const acc = this.pickAccount(tried, accountIds, strategy);
      if (!acc) break;

      console.log(
        `[MusePool] route → "${acc.name}" (strategy=${strategy}${combo ? `, combo="${combo.name}"` : ''})`
      );
      const t0 = Date.now();
      try {
        const result = await museDriver.chat({ ...opts, sessionId: acc.id });
        const st = this.statsFor(acc.id);
        st.failCount = 0;
        st.cooldownUntil = 0;
        st.cooldownReason = '';
        st.totalRequests++;
        st.lastUsedAt = Date.now();
        st.lastError = '';
        this.setStats(acc.id, st);
        this.recordUsage(acc.id, acc.name, true, Date.now() - t0, opts.prompt, undefined, opts, result.text.length);
        console.log(`[MusePool] "${acc.name}" ok — ${Date.now() - t0}ms, reply ${result.text.length} chars${result.media?.length ? `, ${result.media.length} media` : ''}`);
        return result;
      } catch (err: any) {
        tried.add(acc.id);
        lastErr = err;
        if (opts.signal?.aborted) throw err; // client gone — don't burn accounts

        this.applyFailure(acc, err, t0, opts);
        console.log(
          `[MusePool] Account "${acc.name}" failed (${this.statsFor(acc.id).cooldownReason}) → cooldown, trying next account`
        );
      }
    }
    throw lastErr;
  }

  // Fusion (9router "race" variant): fire the prompt at every eligible account
  // in parallel; first successful reply wins. Losers keep running detached —
  // no judge call, no extra billing beyond parallel Muse usage.
  private async chatFusion(opts: ChatOptions, accountIds: string[] | null): Promise<ChatResult> {
    this.load();
    const now = Date.now();
    const candidates = getSavedSessions().filter((s) => {
      if (accountIds && !accountIds.includes(s.id)) return false;
      const st = this.statsFor(s.id);
      return st.enabled && st.cooldownUntil <= now;
    });
    if (!candidates.length) throw new Error('Không có tài khoản Muse nào khả dụng.');

    console.log(`[MusePool] fusion: racing ${candidates.length} account(s)`);
    const attempts = candidates.map(async (acc) => {
      const t0 = Date.now();
      try {
        // Chunk streaming disabled mid-race to avoid interleaved output;
        // the winning reply is emitted once at the end.
        const result = await museDriver.chat({ ...opts, sessionId: acc.id, onChunk: null });
        const st = this.statsFor(acc.id);
        st.failCount = 0;
        st.cooldownUntil = 0;
        st.cooldownReason = '';
        st.totalRequests++;
        st.lastUsedAt = Date.now();
        st.lastError = '';
        this.setStats(acc.id, st);
        this.recordUsage(acc.id, acc.name, true, Date.now() - t0, opts.prompt, undefined, opts, result.text.length);
        return { result, acc };
      } catch (err: any) {
        this.applyFailure(acc, err, t0, opts);
        throw err;
      }
    });

    const { result, acc: winner } = await Promise.any(attempts);
    console.log(`[MusePool] fusion: "${winner.name}" thắng race`);
    if (opts.onChunk) opts.onChunk(result.text);
    return result;
  }

  private applyFailure(acc: Profile, err: any, t0: number, opts: ChatOptions): void {
    const kind = this.classifyError(err);
    const st = this.statsFor(acc.id);
    st.failCount++;
    st.lastError = String(err?.message || err).slice(0, 300);
    st.cooldownReason = kind;
    st.cooldownUntil =
      Date.now() +
      (kind === 'auth'
        ? COOLDOWN_AUTH_MS
        : kind === 'quota'
          ? COOLDOWN_MAX_MS
          : Math.min(COOLDOWN_BASE_MS * st.failCount, COOLDOWN_MAX_MS));
    this.setStats(acc.id, st);
    this.recordUsage(
      acc.id,
      acc.name,
      false,
      Date.now() - t0,
      opts.prompt,
      String(err?.message || err).slice(0, 200),
      opts
    );
  }

  private recordUsage(
    accountId: string,
    accountName: string,
    ok: boolean,
    ms: number,
    prompt: string,
    error?: string,
    opts?: ChatOptions,
    replyChars?: number
  ): void {
    const entry: UsageEntry = {
      ts: Date.now(),
      accountId,
      accountName,
      ok,
      ms,
      promptPreview: (prompt || '').replace(/\s+/g, ' ').slice(0, 120),
      error,
      model: opts?.model || undefined,
      ua: opts?.ua || undefined,
      keyName: opts?.keyName || undefined,
      endpoint: opts?.endpoint || undefined,
      promptChars: (prompt || '').length,
      replyChars: replyChars ?? 0,
    };
    this.usageLog.push(entry);
    if (this.usageLog.length > 200) {
      this.usageLog.splice(0, this.usageLog.length - 200);
    }
    // Persist rolling history (9router usageDb-style JSONL)
    try {
      fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
      fs.appendFileSync(USAGE_FILE, JSON.stringify(entry) + '\n', 'utf8');
    } catch {}
  }

  /** Read persisted usage history (JSONL, newest last). */
  getUsageHistory(limit = 5000): UsageEntry[] {
    try {
      if (!fs.existsSync(USAGE_FILE)) return [];
      const lines = fs.readFileSync(USAGE_FILE, 'utf8').trim().split('\n');
      const out: UsageEntry[] = [];
      for (let i = Math.max(0, lines.length - limit); i < lines.length; i++) {
        try {
          out.push(JSON.parse(lines[i]));
        } catch {}
      }
      return out;
    } catch {
      return [];
    }
  }

  getUsage(): {
    totals: { requests: number; ok: number; failed: number };
    recent: UsageEntry[];
  } {
    const recent = [...this.usageLog].reverse();
    const ok = this.usageLog.filter((e) => e.ok).length;
    return {
      totals: { requests: this.usageLog.length, ok, failed: this.usageLog.length - ok },
      recent,
    };
  }
}

const globalForPool = globalThis as unknown as { musePool: MusePoolService };
export const musePool = globalForPool.musePool || new MusePoolService();
if (process.env.NODE_ENV !== 'production') {
  globalForPool.musePool = musePool;
}
