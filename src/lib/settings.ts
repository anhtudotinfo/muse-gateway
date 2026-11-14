import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { readJsonFile, writeJsonAtomic } from './safeJson';
import { dataPath } from './dataDir';

// App-level settings persisted to data/settings.json.
// `hasPassword` reports whether the dashboard still uses an insecure default
// password. Muse ships without dashboard auth at all (localhost tool), so
// there is no default-password weakness — it stays true. The flag is kept
// because the Endpoint page gates tunnel activation on it.
export interface AppSettings {
  requireLogin: boolean;
  hasPassword: boolean;
  tunnelDashboardAccess: boolean;
  /** Secret token gating remote dashboard access — the unlock link
   *  <publicUrl>/?dgk=<token> sets an HttpOnly cookie. Server-generated,
   *  never client-settable via patch(). */
  dashboardToken?: string;
  keepAliveEnabled: boolean;
  keepAliveMin: number;
  maskEmails: boolean;
  /** Parallel pages (tabs) each saved account may run — every lane drives
   *  its own Muse thread, so N lanes = N concurrent generations on one
   *  account. 1–6; each tab costs ~150–300MB RAM. */
  lanesPerAccount: number;
  /** 'auto': the gateway picks each account's lanes itself (grows while
   *  requests queue and runs stay clean, shrinks on browser errors or Muse
   *  limits). 'manual': every account runs exactly lanesPerAccount. */
  lanesMode: 'auto' | 'manual';
  /** Periodically re-test accounts sitting in cooldown and pull them back
   *  into the pool early when their session turns out to be alive. */
  autoHealEnabled: boolean;
  /** Telegram bot — user self-configured from the dashboard; polls the Bot
   *  API inside this process and feeds prompts through the same task pool
   *  as the REST API. Empty token = not configured. */
  telegramEnabled: boolean;
  telegramToken: string;
  telegramRatio: string;
  telegramDurationSec: number;
  /** Comma-separated Telegram chat IDs allowed to use the bot. Empty =
   *  anyone who finds the bot can use it. */
  telegramAllowedChats: string;
}

const SETTINGS_FILE = dataPath('settings.json');

const DEFAULTS: AppSettings = {
  requireLogin: true,
  hasPassword: true,
  tunnelDashboardAccess: false,
  keepAliveEnabled: false,
  keepAliveMin: 30,
  maskEmails: false,
  lanesPerAccount: 3,
  lanesMode: 'auto',
  autoHealEnabled: true,
  telegramEnabled: false,
  telegramToken: '',
  telegramRatio: '9:16',
  telegramDurationSec: 10,
  telegramAllowedChats: '',
};

class SettingsService {
  private settings: AppSettings = { ...DEFAULTS };

  // settings.json is the source of truth — re-read on every call so
  // mutations from other module realms (Next dev workers) are never stale.
  private load(): void {
    const raw = readJsonFile<Partial<AppSettings> | null>(SETTINGS_FILE, null);
    if (raw && typeof raw === 'object') {
      this.settings = { ...DEFAULTS, ...raw };
    }
  }

  private save(): void {
    try {
      writeJsonAtomic(SETTINGS_FILE, this.settings);
    } catch {}
  }

  get(): AppSettings {
    this.load();
    return { ...this.settings };
  }

  /** Lazily mint (or return) the remote-dashboard unlock token. Called when
   *  tunnelDashboardAccess is on but no token exists yet — without it the
   *  toggle would open the dashboard with zero credentials. */
  ensureDashboardToken(): string {
    this.load();
    if (!this.settings.dashboardToken) {
      this.settings.dashboardToken = crypto.randomBytes(24).toString('base64url');
      this.save();
    }
    return this.settings.dashboardToken;
  }

  patch(patch: Partial<AppSettings>): AppSettings {
    this.load();
    for (const key of ['requireLogin', 'hasPassword', 'tunnelDashboardAccess', 'keepAliveEnabled', 'maskEmails', 'autoHealEnabled', 'telegramEnabled'] as const) {
      if (typeof patch[key] === 'boolean') this.settings[key] = patch[key];
    }
    if (typeof patch.telegramToken === 'string') {
      this.settings.telegramToken = patch.telegramToken.trim();
    }
    if (typeof patch.telegramAllowedChats === 'string') {
      this.settings.telegramAllowedChats = patch.telegramAllowedChats.trim();
    }
    if (typeof patch.telegramRatio === 'string' && /^\d{1,2}:\d{1,2}$/.test(patch.telegramRatio.trim())) {
      this.settings.telegramRatio = patch.telegramRatio.trim();
    }
    if (typeof patch.telegramDurationSec === 'number' && patch.telegramDurationSec >= 1 && patch.telegramDurationSec <= 60) {
      this.settings.telegramDurationSec = Math.round(patch.telegramDurationSec);
    }
    if (typeof patch.keepAliveMin === 'number' && patch.keepAliveMin >= 1 && patch.keepAliveMin <= 1440) {
      this.settings.keepAliveMin = Math.round(patch.keepAliveMin);
    }
    if (typeof patch.lanesPerAccount === 'number' && patch.lanesPerAccount >= 1 && patch.lanesPerAccount <= 6) {
      this.settings.lanesPerAccount = Math.round(patch.lanesPerAccount);
    }
    if (patch.lanesMode === 'auto' || patch.lanesMode === 'manual') {
      this.settings.lanesMode = patch.lanesMode;
    }
    this.save();
    return this.get();
  }
}

const g = globalThis as unknown as { settingsService: SettingsService };
export const settingsService = g.settingsService || new SettingsService();
g.settingsService = settingsService;
