import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { musePool, type UsageEntry } from '@/lib/musePool';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Normalize user-agent to a friendly client name for the graph view.
function clientName(ua?: string): string {
  const u = (ua || '').toLowerCase();
  if (!u) return 'unknown';
  if (u.includes('codex')) return 'Codex Desktop';
  if (u.includes('chatgpt')) return 'ChatGPT Desktop';
  if (u.includes('curl')) return 'curl';
  if (u.includes('node')) return 'Node.js';
  if (u.includes('mozilla') || u.includes('chrome')) return 'Browser';
  return ua!.slice(0, 24);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get('range') || 'today';
  const now = Date.now();
  const since =
    range === 'all' ? 0
    : range === '24h' ? now - 86400000
    : range === '7d' ? now - 7 * 86400000
    : range === '30d' ? now - 30 * 86400000
    : range === '60d' ? now - 60 * 86400000
    : new Date().setHours(0, 0, 0, 0); // today

  const all = musePool.getUsageHistory(5000);
  const history = all.filter((e) => e.ts >= since);

  const totals = {
    requests: history.length,
    ok: 0,
    failed: 0,
    avgMs: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  const byAccount = new Map<string, { name: string; requests: number; ok: number; ms: number }>();
  const byDay = new Map<string, { requests: number; ok: number }>();
  const clients = new Map<string, number>();
  const edges = new Map<string, number>();
  let msSum = 0;

  for (const e of history) {
    if (e.ok) totals.ok++;
    else totals.failed++;
    msSum += e.ms || 0;
    totals.inputTokens += Math.round((e.promptChars || e.promptPreview?.length || 0) / 4);
    totals.outputTokens += Math.round((e.replyChars || 0) / 4);

    const acc = byAccount.get(e.accountId) || { name: e.accountName, requests: 0, ok: 0, ms: 0 };
    acc.requests++;
    if (e.ok) acc.ok++;
    acc.ms += e.ms || 0;
    byAccount.set(e.accountId, acc);

    const dk = dayKey(e.ts);
    const day = byDay.get(dk) || { requests: 0, ok: 0 };
    day.requests++;
    if (e.ok) day.ok++;
    byDay.set(dk, day);

    const cn = clientName(e.ua);
    clients.set(cn, (clients.get(cn) || 0) + 1);
    const ek = `${cn}→${e.accountName}`;
    edges.set(ek, (edges.get(ek) || 0) + 1);
  }

  totals.avgMs = history.length ? Math.round(msSum / history.length) : 0;

  // Day buckets sized to the selected range (max 14 bars)
  const rangeDays = range === 'today' || range === '24h' ? 14 : range === '7d' ? 7 : 14;
  const days: { day: string; requests: number; ok: number }[] = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    const dk = dayKey(now - i * 86400000);
    const d = byDay.get(dk) || { requests: 0, ok: 0 };
    days.push({ day: dk.slice(5), requests: d.requests, ok: d.ok });
  }

  const accounts = [...byAccount.entries()].map(([id, a]) => ({
    id,
    name: a.name,
    requests: a.requests,
    ok: a.ok,
    failed: a.requests - a.ok,
    avgMs: a.requests ? Math.round(a.ms / a.requests) : 0,
  }));

  const graph = {
    clients: [...clients.entries()].map(([name, count]) => ({ name, count })),
    accounts: accounts.map((a) => ({ name: a.name, count: a.requests })),
    edges: [...edges.entries()].map(([k, count]) => {
      const [from, to] = k.split('→');
      return { from, to, count };
    }),
  };

  const recent: UsageEntry[] = [...history].reverse().slice(0, 50);
  const mem = musePool.getUsage();

  // Media files generated so far (data/media) — "File Media đã tạo" stat.
  let mediaFiles = 0;
  try {
    const dir = path.join(process.cwd(), 'data', 'media');
    if (fs.existsSync(dir)) mediaFiles = fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length;
  } catch {}

  return NextResponse.json({
    range,
    totals,
    accounts,
    days,
    graph,
    mediaFiles,
    recent: recent.length ? recent : mem.recent.slice(0, 50),
  });
}
