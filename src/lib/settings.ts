import fs from 'fs';
import path from 'path';
import { readJsonFile, writeJsonAtomic } from './safeJson';

// App-level settings persisted to data/settings.json.
// `hasPassword` reports whether the dashboard still uses an insecure default
// password. Muse ships without dashboard auth at all (localhost tool), so
// there is no default-password weakness — it stays true. The flag is kept
// because the Endpoint page gates tunnel activation on it.
export interface AppSettings {
  requireLogin: boolean;
  hasPassword: boolean;
  tunnelDashboardAccess: boolean;
  keepAliveEnabled: boolean;
  keepAliveMin: number;
  maskEmails: boolean;
}

const SETTINGS_FILE = path.join(process.cwd(), 'data', 'settings.json');

const DEFAULTS: AppSettings = {
  requireLogin: true,
  hasPassword: true,
  tunnelDashboardAccess: false,
  keepAliveEnabled: false,
  keepAliveMin: 30,
  maskEmails: false,
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

  patch(patch: Partial<AppSettings>): AppSettings {
    this.load();
    for (const key of ['requireLogin', 'hasPassword', 'tunnelDashboardAccess', 'keepAliveEnabled', 'maskEmails'] as const) {
      if (typeof patch[key] === 'boolean') this.settings[key] = patch[key];
    }
    if (typeof patch.keepAliveMin === 'number' && patch.keepAliveMin >= 1 && patch.keepAliveMin <= 1440) {
      this.settings.keepAliveMin = Math.round(patch.keepAliveMin);
    }
    this.save();
    return this.get();
  }
}

const g = globalThis as unknown as { settingsService: SettingsService };
export const settingsService = g.settingsService || new SettingsService();
g.settingsService = settingsService;
