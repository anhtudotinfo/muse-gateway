// Server-start hook: bring the Telegram bot loop up when it is enabled in
// settings. Guarded to the nodejs runtime — the same file can also load in
// edge/SSR contexts where fs-backed services must never run.
export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  void import('./lib/telegramBot').then((m) => m.telegramBot.ensure());
}
