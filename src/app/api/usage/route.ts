import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import { musePool, type UsageEntry } from '@/lib/musePool';
import { dataPath } from '@/lib/dataDir';

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

  // ?format=csv — raw per-request export for the selected range.
  if (searchParams.get('format') === 'csv') {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = history.map((e) =>
      [
        new Date(e.ts).toISOString(),
        e.accountName,
        e.model || '',
        e.endpoint || '',
        e.keyName || '',
        clientName(e.ua),
        e.ok ? 'ok' : 'failed',
        e.ms ?? '',
        e.promptChars ?? '',
        e.replyChars ?? '',
        (e.error || '').replace(/\s+/g, ' ').slice(0, 200),
      ]
        .map(esc)
        .join(',')
    );
    const csv = [
      'time,account,model,endpoint,key,client,status,ms,prompt_chars,reply_chars,error',
      ...rows,
    ].join('\n');
    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="muse-usage-${range}.csv"`,
      },
    });
  }

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

  // Media files generated so far (data/media) — "File Media đã tạo" stat,
  // plus a per-day count (by file mtime) for the overview sparkline.
  let mediaFiles = 0;
  const mediaByDay = new Map<string, number>();
  try {
    const dir = dataPath('media');
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.startsWith('.')) continue;
        mediaFiles++;
        try {
          const mt = fs.statSync(path.join(dir, f)).mtimeMs;
          const dk = dayKey(mt);
          mediaByDay.set(dk, (mediaByDay.get(dk) || 0) + 1);
        } catch {}
      }
    }
  } catch {}
  const mediaDays: { day: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const dk = dayKey(now - i * 86400000);
    mediaDays.push({ day: dk.slice(5), count: mediaByDay.get(dk) || 0 });
  }

  return NextResponse.json({
    range,
    totals,
    accounts,
    days,
    graph,
    mediaFiles,
    mediaDays,
    recent: recent.length ? recent : mem.recent.slice(0, 50),
  });
}
