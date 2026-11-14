import { NextResponse } from 'next/server';
import { settingsService } from '@/lib/settings';
import { telegramBot } from '@/lib/telegramBot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Dashboard-facing bot control: status + config. The token is write-only —
// GET masks it so the page can confirm a bot is configured without
// echoing the secret into the DOM / any screen share.

function view() {
  const s = settingsService.get();
  const token = s.telegramToken.trim();
  const status = telegramBot.status();
  return {
    enabled: s.telegramEnabled,
    token_set: token.length > 0,
    token_hint: token ? `…${token.slice(-6)}` : '',
    ratio: s.telegramRatio,
    duration_sec: s.telegramDurationSec,
    allowed_chats: s.telegramAllowedChats,
    running: status.running,
    username: status.username,
    error: status.error,
  };
}

export async function GET() {
  telegramBot.ensure(); // reconcile with settings in case of a restart race
  return NextResponse.json(view());
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  settingsService.patch({
    telegramEnabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    telegramToken: typeof body.token === 'string' ? body.token : undefined,
    telegramRatio: typeof body.ratio === 'string' ? body.ratio : undefined,
    telegramDurationSec:
      typeof body.duration_sec === 'number'
        ? body.duration_sec
        : typeof body.durationSec === 'number'
          ? body.durationSec
          : undefined,
    telegramAllowedChats:
      typeof body.allowed_chats === 'string'
        ? body.allowed_chats
        : typeof body.allowedChats === 'string'
          ? body.allowedChats
          : undefined,
  });
  telegramBot.ensure(true); // explicit save clears fatal markers & restarts
  return NextResponse.json(view());
}
