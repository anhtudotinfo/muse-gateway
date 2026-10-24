import { NextResponse } from 'next/server';
import { musePool } from '@/lib/musePool';
import { apiKeyService } from '@/lib/apiKeys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function GET() {
  const state = musePool.getState();
  const history = musePool.getUsageHistory(5000);
  const today = dayKey(Date.now());

  const statusCount: Record<string, number> = {};
  for (const a of state.accounts) statusCount[a.status] = (statusCount[a.status] || 0) + 1;

  let todayReq = 0, ok = 0, msSum = 0;
  for (const e of history) {
    msSum += e.ms || 0;
    if (e.ok) ok++;
    if (dayKey(e.ts) === today) todayReq++;
  }

  const days: { day: string; requests: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const dk = dayKey(Date.now() - i * 86400000);
    days.push({ day: dk.slice(5), requests: history.filter((e) => dayKey(e.ts) === dk).length });
  }

  return NextResponse.json({
    strategy: state.strategy,
    accounts: {
      total: state.accounts.length,
      ready: statusCount.ready || 0,
      busy: (statusCount.busy || 0) + (statusCount.queued || 0),
      cooldown: (statusCount.cooldown || 0) + (statusCount.error || 0),
      disabled: statusCount.disabled || 0,
    },
    requests: {
      total: history.length,
      today: todayReq,
      successRate: history.length ? Math.round((ok / history.length) * 100) : 100,
      avgMs: history.length ? Math.round(msSum / history.length) : 0,
    },
    keys: { count: apiKeyService.list().length, authRequired: apiKeyService.authRequired },
    days,
    recent: [...history].reverse().slice(0, 6),
  });
}
