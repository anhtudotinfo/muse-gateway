import { spawn, spawnSync, ChildProcess, execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { readJsonFile, writeJsonAtomic } from './safeJson';
import { dataDir } from './dataDir';

// Tunnel manager: Cloudflare quick tunnel (cloudflared) + Tailscale funnel.
// State persists in data/tunnel.json so "enabled" intent survives restarts;
// the running processes live on the globalThis singleton (survives HMR).

const DATA_DIR = dataDir();
const STATE_FILE = path.join(DATA_DIR, 'tunnel.json');
const BIN_DIR = path.join(DATA_DIR, 'bin');
const IS_WIN = process.platform === 'win32';
const CF_BIN = path.join(BIN_DIR, IS_WIN ? 'cloudflared.exe' : 'cloudflared');

const CF_DOWNLOADS: Record<string, string> = {
  'win32-x64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
  'linux-x64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64',
  'linux-arm64': 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64',
};

interface TunnelPersisted {
  tunnel?: {
    settingsEnabled?: boolean;
    tunnelUrl?: string;
    publicUrl?: string;
    /** 'quick' = random trycloudflare URL each run; 'named' = token-managed tunnel with a fixed hostname set in the CF dashboard. */
    mode?: 'quick' | 'named';
    /** cloudflared `tunnel run --token` value (named mode only). */
    token?: string;
  };
  tailscale?: { settingsEnabled?: boolean; tunnelUrl?: string };
}

interface DlState {
  downloading: boolean;
  progress: number;
}

class TunnelManager {
  private cfProc: ChildProcess | null = null;
  private persisted: TunnelPersisted = {};
  private dl: DlState = { downloading: false, progress: 0 };
  private enablePromise: Promise<{ tunnelUrl: string; publicUrl: string }> | null = null;
  private lastRespawnAttempt = 0;

  // tunnel.json is the source of truth — re-read on every call so state
  // written by other module realms (Next dev workers) is never stale.
  private load() {
    const raw = readJsonFile<TunnelPersisted | null>(STATE_FILE, null);
    if (raw && typeof raw === 'object') this.persisted = raw;
  }

  private save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      writeJsonAtomic(STATE_FILE, this.persisted);
    } catch {}
  }

  private port(): number {
    return Number(process.env.MUSE_PORT || process.env.PORT || 1412) || 1412;
  }

  /* ---------------- Cloudflare quick tunnel ---------------- */

  private cfDownloadUrl(): string | null {
    const key = `${process.platform}-${process.arch}`;
    return CF_DOWNLOADS[key] || null;
  }

  private cfBinaryExists(): boolean {
    return fs.existsSync(CF_BIN);
  }

  private async downloadCloudflared(): Promise<void> {
    const url = this.cfDownloadUrl();
    if (!url) throw new Error(`No cloudflared build for ${process.platform}/${process.arch} — install it manually.`);

    fs.mkdirSync(BIN_DIR, { recursive: true });
    this.dl = { downloading: true, progress: 0 };
    try {
      const buf = await this.fetchWithRedirects(url, 5);
      fs.writeFileSync(CF_BIN, buf);
      if (!IS_WIN) fs.chmodSync(CF_BIN, 0o755);
    } finally {
      this.dl = { downloading: false, progress: 0 };
    }
  }

  // GitHub release URLs redirect twice (latest → version → signed asset) —
  // follow hops recursively, bounded.
  private fetchWithRedirects(url: string, hopsLeft: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'muse-tunnel' } }, (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          if (hopsLeft <= 0) return reject(new Error('Too many redirects'));
          const next = new URL(res.headers.location, url).toString();
          this.fetchWithRedirects(next, hopsLeft - 1).then(resolve, reject);
          return;
        }
        this.consumeDl(res, resolve, reject);
      });
      req.on('error', reject);
      req.setTimeout(120000, () => { req.destroy(new Error('Download timed out')); });
    });
  }

  private consumeDl(res: any, resolve: (b: Buffer) => void, reject: (e: Error) => void) {
    if (res.statusCode !== 200) {
      reject(new Error(`cloudflared download failed (HTTP ${res.statusCode})`));
      res.resume();
      return;
    }
    const total = Number(res.headers['content-length'] || 0);
    const chunks: Buffer[] = [];
    let got = 0;
    res.on('data', (c: Buffer) => {
      chunks.push(c);
      got += c.length;
      if (total > 0) this.dl.progress = Math.min(99, Math.round((got / total) * 100));
    });
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  }

  /**
   * Kill stray cloudflared processes belonging to OUR tunnel. Quick tunnels
   * are matched by the local port in their `--url` arg; named tunnels by
   * their unique token. Without this, repeated enables (or a second server
   * process) pile up duplicates whose URLs diverge from persisted state.
   */
  private killStrayCloudflared(match?: string): void {
    if (!IS_WIN) return;
    try {
      const pattern = match ?? `localhost:${this.port()}`;
      const keepPid = this.cfProc?.pid ?? -1;
      spawnSync('powershell', [
        '-NoProfile', '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.ProcessId -ne ${keepPid} -and $_.CommandLine -match '${pattern}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ], { windowsHide: true, timeout: 15000 });
    } catch {}
  }

  private spawnCloudflared(opts: { token?: string; publicUrl?: string } = {}): Promise<{ tunnelUrl: string; publicUrl: string }> {
    // Reaching spawn means the caller wants a NEW tunnel — kill the current
    // process first (e.g. switching quick→named leaves the old one running
    // since keepPid would have spared it), then sweep strays of the same kind.
    if (this.cfProc) {
      const proc = this.cfProc;
      this.cfProc = null;
      try { proc.kill(); } catch {}
      if (IS_WIN && proc.pid) {
        try { spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F']); } catch {}
      }
    }
    this.killStrayCloudflared(opts.token);
    const named = !!opts.token;
    const args = named
      // --no-autoupdate is a tunnel-level flag — placing it after `run`
      // makes cloudflared exit with "flag provided but not defined".
      ? ['tunnel', '--no-autoupdate', 'run', '--token', opts.token!]
      : ['tunnel', '--url', `http://localhost:${this.port()}`, '--no-autoupdate'];
    return new Promise((resolve, reject) => {
      const proc = spawn(CF_BIN, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.cfProc = proc;

      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error('cloudflared started but no tunnel connection within 30s')); }
      }, 30000);

      const urlRe = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
      const onData = (buf: Buffer) => {
        const s = buf.toString();
        if (settled) return;
        if (named) {
          // Named tunnels don't print a URL — the hostname is configured in
          // the CF Zero Trust dashboard. "Registered tunnel connection" is
          // the signal that the tunnel is live.
          if (!/Registered tunnel connection/i.test(s)) return;
          settled = true;
          clearTimeout(timer);
          const url = (opts.publicUrl || '').trim().replace(/\/+$/, '');
          this.persisted.tunnel = { settingsEnabled: true, tunnelUrl: url, publicUrl: url, mode: 'named', token: opts.token };
          this.save();
          resolve({ tunnelUrl: url, publicUrl: url });
          return;
        }
        const m = s.match(urlRe);
        if (m) {
          settled = true;
          clearTimeout(timer);
          this.persisted.tunnel = { settingsEnabled: true, tunnelUrl: m[0], publicUrl: m[0], mode: 'quick' };
          this.save();
          resolve({ tunnelUrl: m[0], publicUrl: m[0] });
        }
      };
      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      proc.on('error', (e) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(e); }
      });
      proc.on('exit', () => {
        this.cfProc = null;
        const p = this.persisted.tunnel;
        // Quick URLs die with the process — clear them so the UI doesn't
        // display a dead link. Named URLs are stable across respawns, keep.
        if (p && p.mode !== 'named') { p.tunnelUrl = ''; p.publicUrl = ''; }
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('cloudflared exited before producing a URL')); }
      });
    });
  }

  async enableCloudflare(opts: { token?: string; publicUrl?: string } = {}): Promise<{ tunnelUrl: string; publicUrl: string }> {
    this.load();
    if (this.enablePromise) return this.enablePromise;

    this.enablePromise = (async () => {
      const token = opts.token?.trim() || this.persisted.tunnel?.token?.trim() || '';
      const mode = token ? 'named' : 'quick';
      const cur = this.persisted.tunnel;
      // Reuse the live process only when it is the same mode (and same token
      // for named tunnels) — otherwise a stale quick tunnel would be
      // mistaken for the named one being requested.
      if (
        this.cfProc && cur?.tunnelUrl &&
        (cur.mode ?? 'quick') === mode &&
        (mode !== 'named' || cur.token === token)
      ) {
        return { tunnelUrl: cur.tunnelUrl, publicUrl: cur.publicUrl || cur.tunnelUrl };
      }
      if (!this.cfBinaryExists()) await this.downloadCloudflared();
      return this.spawnCloudflared({
        token: mode === 'named' ? token : undefined,
        publicUrl: opts.publicUrl || cur?.publicUrl,
      });
    })().finally(() => { this.enablePromise = null; });

    return this.enablePromise;
  }

  async disableCloudflare(): Promise<void> {
    this.load();
    this.persisted.tunnel = { settingsEnabled: false, tunnelUrl: '', publicUrl: '', token: '' };
    this.save();
    const proc = this.cfProc;
    this.cfProc = null;
    if (proc) {
      try { proc.kill(); } catch {}
      if (IS_WIN && proc.pid) {
        try { spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F']); } catch {}
      }
    }
  }

  /* ---------------- Tailscale ---------------- */

  private tsBin: string | null | undefined;

  // Resolve the tailscale CLI — PATH on a freshly-started process won't
  // include a just-installed copy, so check well-known install dirs too.
  private tailscaleBin(): string | null {
    // Cache only positive hits — a miss must re-resolve so a CLI installed
    // after this process started (via tailscale-install) is still found.
    if (this.tsBin) return this.tsBin;
    const candidates: string[] = ['tailscale'];
    if (IS_WIN) {
      const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
      const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
      candidates.push(
        path.join(pf, 'Tailscale', 'tailscale.exe'),
        path.join(pf86, 'Tailscale', 'tailscale.exe'),
        path.join(pf, 'Tailscale IPN', 'tailscale.exe')
      );
    } else {
      candidates.push('/usr/bin/tailscale', '/usr/local/bin/tailscale', '/sbin/tailscale', '/usr/sbin/tailscale');
    }
    for (const c of candidates) {
      try {
        if (c !== 'tailscale' && !fs.existsSync(c)) continue;
        const r = spawnSync(c, ['version'], { timeout: 8000, windowsHide: true });
        if (r.status === 0 || (r.stdout && r.stdout.length > 0)) {
          this.tsBin = c;
          return c;
        }
      } catch {}
    }
    return null;
  }

  private runTs(args: string[], timeoutMs = 15000): Promise<{ code: number; out: string; err: string }> {
    return new Promise((resolve) => {
      const bin = this.tailscaleBin();
      if (!bin) return resolve({ code: -1, out: '', err: 'tailscale CLI not found' });
      execFile(bin, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
        const code = err && typeof (err as any).code === 'number' ? (err as any).code : err ? -1 : 0;
        resolve({ code, out: String(stdout || ''), err: String(stderr || '') });
      });
    });
  }

  async tailscaleCheck(): Promise<{ installed: boolean; loggedIn: boolean; hasCachedPassword: boolean; dnsName?: string; nodeId?: string; debug?: string }> {
    const ver = await this.runTs(['version'], 8000);
    if (ver.code !== 0) return { installed: false, loggedIn: false, hasCachedPassword: false };

    const st = await this.runTs(['status', '--json'], 10000);
    let loggedIn = false;
    let dnsName: string | undefined;
    let nodeId: string | undefined;
    try {
      const j = JSON.parse(st.out);
      loggedIn = j.BackendState === 'Running';
      dnsName = j.Self?.DNSName ? String(j.Self.DNSName).replace(/\.$/, '') : undefined;
      nodeId = j.Self?.ID ? String(j.Self.ID) : undefined;
    } catch {}
    return { installed: true, loggedIn, hasCachedPassword: true, dnsName, nodeId };
  }

  async tailscaleEnable(): Promise<{
    success: boolean;
    tunnelUrl?: string;
    needsLogin?: boolean;
    authUrl?: string;
    funnelNotEnabled?: boolean;
    enableUrl?: string;
    error?: string;
  }> {
    const check = await this.tailscaleCheck();
    if (!check.installed) return { success: false, error: 'Tailscale is not installed.' };

    if (!check.loggedIn) {
      // `tailscale up` prints an auth URL we can hand to the user
      const up = await this.runTs(['up'], 20000);
      const m = (up.out + '\n' + up.err).match(/https:\/\/login\.tailscale\.com\/a\/\S+/i);
      if (m) return { success: false, needsLogin: true, authUrl: m[0] };
      return { success: false, needsLogin: true, authUrl: 'https://login.tailscale.com/' };
    }

    const r = await this.runTs(['funnel', '--bg', String(this.port())], 20000);
    const blob = `${r.out}\n${r.err}`;
    if (r.code !== 0) {
      if (/funnel.*not.*enabled|not enabled.*funnel/i.test(blob)) {
        return {
          success: false,
          funnelNotEnabled: true,
          // Admin console machine pages are keyed by stable node ID, not DNS name.
          enableUrl: check.nodeId
            ? `https://login.tailscale.com/admin/machines/${check.nodeId}`
            : 'https://login.tailscale.com/admin/machines',
        };
      }
      return { success: false, error: blob.trim().slice(0, 300) || 'tailscale funnel failed' };
    }

    const url = check.dnsName ? `https://${check.dnsName}` : '';
    if (!url) return { success: false, error: 'Funnel started but could not determine machine DNS name.' };

    this.load();
    this.persisted.tailscale = { settingsEnabled: true, tunnelUrl: url };
    this.save();
    return { success: true, tunnelUrl: url };
  }

  async tailscaleDisable(): Promise<{ success: boolean; error?: string }> {
    const check = await this.tailscaleCheck();
    if (!check.installed) return { success: false, error: 'Tailscale is not installed.' };
    const r = await this.runTs(['funnel', 'reset'], 15000);
    if (r.code !== 0) return { success: false, error: (r.out + r.err).trim().slice(0, 300) || 'tailscale funnel reset failed' };
    this.load();
    this.persisted.tailscale = { settingsEnabled: false, tunnelUrl: '' };
    this.save();
    return { success: true };
  }

  /** Streamed winget install — yields log lines; resolves success flag. */
  async *tailscaleInstall(): AsyncGenerator<string> {
    if (!IS_WIN) {
      throw new Error('Auto-install is only supported on Windows — install from https://tailscale.com/download');
    }
    yield 'Installing Tailscale via winget…';
    const proc = spawn('winget', [
      'install', '--id', 'Tailscale.Tailscale', '-e',
      '--accept-package-agreements', '--accept-source-agreements',
    ], { windowsHide: false });
    let out = '';
    proc.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
    proc.stderr?.on('data', (b: Buffer) => { out += b.toString(); });
    const code = await new Promise<number>((resolve) => proc.on('close', (c) => resolve(c ?? -1)));
    for (const line of out.split(/\r?\n/).filter((l) => l.trim()).slice(-15)) yield line.trim();
    if (code !== 0) {
      // winget 0x8A15002B-ish: "already installed" variants still count as success
      if (/already installed|no applicable upgrade/i.test(out)) return;
      throw new Error('winget install failed — install Tailscale manually from https://tailscale.com/download');
    }
  }

  /* ---------------- Combined status ---------------- */

  getStatus() {
    this.load();
    const cf = this.persisted.tunnel || {};
    // Watchdog: the user asked for a tunnel (settingsEnabled) but the process
    // is gone (server restart, cloudflared crash) — respawn it in the
    // background, at most once per 30s so a persistent failure can't loop.
    if (cf.settingsEnabled && !this.cfProc && !this.enablePromise && this.cfBinaryExists()) {
      const now = Date.now();
      if (now - this.lastRespawnAttempt > 30_000) {
        this.lastRespawnAttempt = now;
        void this.enableCloudflare().catch((err) => {
          console.error('[tunnel] watchdog respawn failed:', err?.message || err);
        });
      }
    }
    const ts = this.persisted.tailscale || {};
    return {
      tunnel: {
        enabled: !!this.cfProc,
        settingsEnabled: !!cf.settingsEnabled,
        tunnelUrl: cf.tunnelUrl || '',
        publicUrl: cf.publicUrl || cf.tunnelUrl || '',
        available: !!this.cfDownloadUrl() || this.cfBinaryExists(),
      },
      tailscale: {
        enabled: !!ts.settingsEnabled,
        settingsEnabled: !!ts.settingsEnabled,
        tunnelUrl: ts.tunnelUrl || '',
      },
      download: { ...this.dl },
    };
  }
}

const g = globalThis as unknown as { tunnelManager: TunnelManager };
export const tunnelManager = g.tunnelManager || new TunnelManager();
g.tunnelManager = tunnelManager;
