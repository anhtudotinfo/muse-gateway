// Shared types for the Muse Usage & Analytics tab (adapted from 9router's
// /api/usage payload — leaner shape: no cached tokens, cost, SSE stream).

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

export interface UsageAccount {
  id: string;
  name: string;
  requests: number;
  ok: number;
  failed: number;
  avgMs: number;
}

export interface UsageDay {
  day: string;
  requests: number;
  ok: number;
}

export interface UsageGraph {
  clients: { name: string; count: number }[];
  accounts: { name: string; count: number }[];
  edges: { from: string; to: string; count: number }[];
}

export interface UsageData {
  range: string;
  totals: {
    requests: number;
    ok: number;
    failed: number;
    avgMs: number;
    inputTokens: number;
    outputTokens: number;
  };
  accounts: UsageAccount[];
  days: UsageDay[];
  graph: UsageGraph;
  mediaFiles?: number;
  recent: UsageEntry[];
}

export const USAGE_PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

// Estimated token counts — muse tracks prompt/reply char counts, /4 ≈ tokens.
export function estInputTokens(e: UsageEntry): number {
  return Math.round((e.promptChars ?? e.promptPreview?.length ?? 0) / 4);
}

export function estOutputTokens(e: UsageEntry): number {
  return Math.round((e.replyChars ?? 0) / 4);
}

export const fmt = (n?: number) => new Intl.NumberFormat().format(n || 0);

export const fmtTokens = (n?: number) => {
  const v = n || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
};

export const fmtCost = (n?: number) => `$${(n || 0).toFixed(2)}`;

export function fmtTime(ts?: number | null) {
  if (!ts) return "Never";
  const diffMins = Math.floor((Date.now() - ts) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function timeAgo(ts: number) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
