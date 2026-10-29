"use client";

// Usage & Analytics tab — port of 9router's usage page (page.js + UsageStats),
// adapted to muse's /api/usage payload. No backend changes: per-key/endpoint
// breakdowns, cached tokens and cost show graceful empty/"—" states.
// Polls REST every 8s (muse has no usage SSE stream).

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useApp } from "@/components/AppShell";
import { maskName } from "@/lib/mask";
import SegmentedControl from "@/components/endpoint/ui/SegmentedControl";
import Badge from "@/components/endpoint/ui/Badge";
import OverviewCards from "@/components/usage/OverviewCards";
import RecentRequests from "@/components/usage/RecentRequests";
import UsageTable, { type UsageTableGroup, type UsageTableItem } from "@/components/usage/UsageTable";
import RequestDetailsTab from "@/components/usage/RequestDetailsTab";
import {
  USAGE_PERIODS,
  estInputTokens,
  estOutputTokens,
  fmt,
  fmtTime,
  type UsageData,
  type UsageEntry,
} from "@/components/usage/types";

// Lazy-load: keeps @xyflow/react and recharts out of the initial bundle
const PoolTopology = dynamic(() => import("@/components/usage/PoolTopology"), { ssr: false });
const UsageChart = dynamic(() => import("@/components/usage/UsageChart"), { ssr: false });
const AccountBarChart = dynamic(() => import("@/components/usage/AccountBarChart"), { ssr: false });
const TopModelsChart = dynamic(() => import("@/components/usage/TopModelsChart"), { ssr: false });

const MODEL_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Account" },
  { field: "requests", label: "Requests", align: "right" as const },
  { field: "lastUsed", label: "Last Used", align: "right" as const },
];

const ACCOUNT_COLUMNS = [
  { field: "accountName", label: "Account" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Source" },
  { field: "requests", label: "Requests", align: "right" as const },
  { field: "lastUsed", label: "Last Used", align: "right" as const },
];

const API_KEY_COLUMNS = [
  { field: "keyName", label: "API Key Name" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Account" },
  { field: "requests", label: "Requests", align: "right" as const },
  { field: "lastUsed", label: "Last Used", align: "right" as const },
];

const ENDPOINT_COLUMNS = [
  { field: "endpoint", label: "Endpoint" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Account" },
  { field: "requests", label: "Requests", align: "right" as const },
  { field: "lastUsed", label: "Last Used", align: "right" as const },
];

const TABLE_OPTIONS = [
  { value: "model", label: "Usage by Model" },
  { value: "account", label: "Usage by Account" },
  { value: "apiKey", label: "Usage by API Key" },
  { value: "endpoint", label: "Usage by Endpoint" },
];

// Aggregate recent entries by (groupKey, subKey); returns per-group items with
// est token counts and lastUsed — mirrors 9router's groupDataByKey output.
function aggregateRecent(
  recent: UsageEntry[],
  keyOf: (e: UsageEntry) => string,
  itemOf: (e: UsageEntry) => { rawModel: string; provider: string }
): UsageTableGroup[] {
  const groups = new Map<string, Map<string, UsageTableItem>>();
  for (const e of recent) {
    const gk = keyOf(e);
    const { rawModel, provider } = itemOf(e);
    const ik = `${rawModel}||${provider}`;
    if (!groups.has(gk)) groups.set(gk, new Map());
    const items = groups.get(gk)!;
    const cur =
      items.get(ik) ||
      ({
        key: ik,
        rawModel,
        provider,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        lastUsed: null as number | null,
        pending: 0,
      } as UsageTableItem);
    cur.requests += 1;
    const inT = estInputTokens(e);
    const outT = estOutputTokens(e);
    cur.promptTokens = (cur.promptTokens || 0) + inT;
    cur.completionTokens = (cur.completionTokens || 0) + outT;
    cur.totalTokens = (cur.totalTokens || 0) + inT + outT;
    if (!cur.lastUsed || e.ts > cur.lastUsed) cur.lastUsed = e.ts;
    items.set(ik, cur);
  }

  return [...groups.entries()].map(([groupKey, items]) => {
    const itemList = [...items.values()];
    const summary: UsageTableItem = {
      key: groupKey,
      requests: itemList.reduce((s, i) => s + i.requests, 0),
      promptTokens: itemList.reduce((s, i) => s + (i.promptTokens || 0), 0),
      completionTokens: itemList.reduce((s, i) => s + (i.completionTokens || 0), 0),
      totalTokens: itemList.reduce((s, i) => s + (i.totalTokens || 0), 0),
      lastUsed: itemList.reduce<number | null>((m, i) => (i.lastUsed && (!m || i.lastUsed > m) ? i.lastUsed : m), null),
      pending: 0,
    };
    return { groupKey, summary, items: itemList };
  });
}

function sortGroups(groups: UsageTableGroup[], sortBy: string, sortOrder: "asc" | "desc"): UsageTableGroup[] {
  return [...groups].sort((a, b) => {
    let valA: string | number | null | undefined = a.groupKey;
    let valB: string | number | null | undefined = b.groupKey;
    if (sortBy !== "groupKey") {
      valA = a.summary[sortBy] as string | number | null | undefined;
      valB = b.summary[sortBy] as string | number | null | undefined;
    }
    if (typeof valA === "string") valA = valA.toLowerCase();
    if (typeof valB === "string") valB = valB.toLowerCase();
    if (valA == null) return 1;
    if (valB == null) return -1;
    if (valA < valB) return sortOrder === "asc" ? -1 : 1;
    if (valA > valB) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });
}

interface PoolAccountLite {
  id: string;
  name: string;
  worker?: string;
  status?: string;
  enabled?: boolean;
}

export function UsageTab() {
  const { maskEmails } = useApp();
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "details">("overview");
  const [period, setPeriod] = useState("today");
  const [tableView, setTableView] = useState("model");
  const [viewMode, setViewMode] = useState<"costs" | "tokens">("tokens");
  const [sortBy, setSortBy] = useState("requests");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const isInitialLoad = useRef(true);
  const [activeAccounts, setActiveAccounts] = useState<string[]>([]);
  const [poolAccounts, setPoolAccounts] = useState<PoolAccountLite[]>([]);

  // Display helper — masks account names when "Ẩn email" is on.
  const showName = useCallback(
    (name?: string | null) => maskName(name || "", maskEmails),
    [maskEmails]
  );

  // Worker alias (w0..wN) + status, keyed by account id and name.
  const workerById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of poolAccounts) if (a.worker) m.set(a.id, a.worker);
    return m;
  }, [poolAccounts]);
  const busyCount = useMemo(
    () => poolAccounts.filter((a) => a.status === "busy").length,
    [poolAccounts]
  );

  const refresh = useCallback(async (r: string, initial: boolean) => {
    if (initial) setLoading(true);
    try {
      const res = await fetch(`/api/usage?range=${r}`);
      if (res.ok) setData(await res.json());
    } catch {
      /* keep stale data */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = isInitialLoad.current;
    isInitialLoad.current = false;
    refresh(period, initial);
    const t = setInterval(() => refresh(period, false), 8000);
    return () => clearInterval(t);
  }, [period, refresh]);

  // Live "in-flight" edges for the topology: poll the lightweight pool state
  // every 1.5s — busy accounts light their edge beam while a request runs.
  useEffect(() => {
    let dead = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/pool");
        if (!res.ok) return;
        const j = await res.json();
        if (!dead) {
          const accounts: PoolAccountLite[] = j.accounts || [];
          setPoolAccounts(accounts);
          setActiveAccounts(
            accounts
              .filter((a) => a.status === "busy")
              .map((a) => a.name || "")
              .filter(Boolean)
          );
        }
      } catch {
        /* keep last known state */
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, []);

  const toggleSort = useCallback((_tableType: string, field: string) => {
    if (sortBy === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  }, [sortBy]);

  const activeTableConfig = useMemo(() => {
    if (!data) return null;
    const recent = data.recent || [];
    switch (tableView) {
      case "model": {
        const groups = aggregateRecent(
          recent,
          (e) => e.model || "Unknown Model",
          (e) => ({ rawModel: e.model || "Unknown Model", provider: e.accountName || "pool" })
        );
        return {
          columns: MODEL_COLUMNS,
          groupedData: sortGroups(groups, sortBy === "rawModel" ? "groupKey" : sortBy, sortOrder),
          storageKey: "usage-stats:expanded-models",
          emptyMessage: "No model usage in the recent window yet.",
          renderSummaryCells: (group: UsageTableGroup) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item: UsageTableItem) => (
            <>
              <td className="px-6 py-3 font-medium">{item.rawModel as string}</td>
              <td className="px-6 py-3"><Badge variant="neutral" size="sm">{showName(item.provider as string)}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "account": {
        // Server aggregates for the whole range; per-model detail from recent.
        const recentGroups = aggregateRecent(
          recent,
          (e) => e.accountName || "Unknown Account",
          (e) => ({ rawModel: e.model || "Unknown Model", provider: "pool" })
        );
        const recentMap = new Map(recentGroups.map((g) => [g.groupKey, g.items]));
        const groups: UsageTableGroup[] = (data.accounts || []).map((a) => {
          const items = (recentMap.get(a.name) || []).map((i) => ({ ...i, accountName: a.name }));
          const summary: UsageTableItem = {
            key: a.name,
            requests: a.requests,
            promptTokens: items.length ? items.reduce((s, i) => s + (i.promptTokens || 0), 0) : undefined,
            completionTokens: items.length ? items.reduce((s, i) => s + (i.completionTokens || 0), 0) : undefined,
            totalTokens: items.length ? items.reduce((s, i) => s + (i.totalTokens || 0), 0) : undefined,
            lastUsed: items.reduce<number | null>((m, i) => (i.lastUsed && (!m || i.lastUsed > m) ? i.lastUsed : m), null),
            pending: 0,
          };
          return { groupKey: a.name, summary, items };
        });
        return {
          columns: ACCOUNT_COLUMNS,
          groupedData: sortGroups(groups, sortBy === "accountName" ? "groupKey" : sortBy, sortOrder),
          storageKey: "usage-stats:expanded-accounts",
          emptyMessage: "No account-specific usage recorded yet.",
          renderSummaryCells: (group: UsageTableGroup) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item: UsageTableItem) => (
            <>
              <td className="px-6 py-3 font-medium">{showName(item.accountName as string)}</td>
              <td className="px-6 py-3 font-medium">{item.rawModel as string}</td>
              <td className="px-6 py-3"><Badge variant="neutral" size="sm">{item.provider as string}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "apiKey": {
        const groups = aggregateRecent(
          recent,
          (e) => e.keyName || "open",
          (e) => ({ rawModel: e.model || "Unknown Model", provider: e.accountName || "pool" })
        ).map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, keyName: g.groupKey })) }));
        return {
          columns: API_KEY_COLUMNS,
          groupedData: sortGroups(groups, sortBy === "keyName" ? "groupKey" : sortBy, sortOrder),
          storageKey: "usage-stats:expanded-apikeys",
          emptyMessage: "No per-key usage in the recent window yet.",
          renderSummaryCells: (group: UsageTableGroup) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item: UsageTableItem) => (
            <>
              <td className="px-6 py-3 font-medium">{item.keyName as string}</td>
              <td className="px-6 py-3 font-medium">{item.rawModel as string}</td>
              <td className="px-6 py-3"><Badge variant="neutral" size="sm">{showName(item.provider as string)}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "endpoint":
      default: {
        const groups = aggregateRecent(
          recent,
          (e) => e.endpoint || "unknown",
          (e) => ({ rawModel: e.model || "Unknown Model", provider: e.accountName || "pool" })
        ).map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, endpoint: g.groupKey })) }));
        return {
          columns: ENDPOINT_COLUMNS,
          groupedData: sortGroups(groups, sortBy === "endpoint" ? "groupKey" : sortBy, sortOrder),
          storageKey: "usage-stats:expanded-endpoints",
          emptyMessage: "No per-endpoint usage in the recent window yet.",
          renderSummaryCells: (group: UsageTableGroup) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item: UsageTableItem) => (
            <>
              <td className="px-6 py-3 font-mono font-medium">{item.endpoint as string}</td>
              <td className="px-6 py-3 font-medium">{item.rawModel as string}</td>
              <td className="px-6 py-3"><Badge variant="neutral" size="sm">{showName(item.provider as string)}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
    }
  }, [data, tableView, sortBy, sortOrder, showName]);

  // Topology shows EVERY pool account — not only those with traffic — so a
  // newly-added account appears as a node even before its first request.
  const topologyAccounts = useMemo(() => {
    const usageByName = new Map((data?.accounts || []).map((a) => [a.name, a.requests]));
    const out: { name: string; count: number; label: string; worker?: string; status?: string; enabled?: boolean }[] = poolAccounts.map((a) => ({
      name: a.name,
      count: usageByName.get(a.name) || 0,
      label: showName(a.name),
      worker: a.worker,
      status: a.status,
      enabled: a.enabled !== false,
    }));
    // Accounts with usage history but no longer in the pool — keep them visible.
    const poolNames = new Set(poolAccounts.map((a) => a.name));
    const historyOnly = data?.graph?.accounts || data?.accounts?.map((a) => ({ name: a.name, count: a.requests })) || [];
    for (const g of historyOnly) {
      if (!poolNames.has(g.name)) {
        out.push({ name: g.name, count: g.count, label: showName(g.name) });
      }
    }
    return out;
  }, [data, poolAccounts, showName]);

  const spinner = (
    <div className="flex items-center justify-center py-12 text-text-muted">
      <span className="material-symbols-outlined text-[32px] animate-spin">progress_activity</span>
    </div>
  );

  const lastAccount = data?.recent?.[0]?.accountName || "";
  const errorAccount = data?.recent?.[0] && !data.recent[0].ok ? data.recent[0].accountName : "";

  return (
    <div className="ep9r flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "details", label: "Details" },
          ]}
          value={activeTab}
          onChange={(v) => setActiveTab(v as "overview" | "details")}
          className="w-full sm:w-auto"
        />
        {activeTab === "overview" && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <SegmentedControl
              options={USAGE_PERIODS}
              value={period}
              onChange={setPeriod}
              size="sm"
              className="w-full sm:w-auto"
            />
            <a
              href={`/api/usage?range=${period}&format=csv`}
              download
              title="Tải lịch sử request dạng CSV"
              className="apple-tool-btn"
              style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}
            >
              ⬇ CSV
            </a>
          </div>
        )}
      </div>

      {activeTab === "overview" && (
        <div className="flex min-w-0 flex-col gap-6">
          {/* Overview cards */}
          {loading ? spinner : data && <OverviewCards stats={data} busyCount={busyCount} />}

          {/* Pool topology + Recent Requests */}
          {loading ? spinner : data && (
            <div className="grid min-w-0 grid-cols-1 items-stretch gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
              <PoolTopology
                accounts={topologyAccounts}
                activeAccounts={activeAccounts}
                lastAccount={lastAccount}
                errorAccount={errorAccount}
              />
              <RecentRequests requests={data.recent || []} workerById={workerById} showName={showName} />
            </div>
          )}

          {/* Requests-over-time chart - synced period */}
          {loading ? spinner : <UsageChart days={data?.days || []} />}

          {/* Account and model breakdown charts */}
          {!loading && data && (
            <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
              <AccountBarChart accounts={(data.accounts || []).map((a) => ({ ...a, name: showName(a.name) }))} />
              <TopModelsChart recent={data.recent || []} />
            </div>
          )}

          {/* Table with dropdown selector */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <select
                value={tableView}
                onChange={(e) => setTableView(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-main focus:outline-none focus:ring-2 focus:ring-primary/50 sm:w-auto"
                style={{ colorScheme: "auto" }}
              >
                {TABLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <div className="grid grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:flex">
                <button
                  type="button"
                  onClick={() => setViewMode("costs")}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "costs" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
                >
                  Costs
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("tokens")}
                  className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "tokens" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
                >
                  Tokens
                </button>
              </div>
            </div>
            {loading ? spinner : activeTableConfig && (
              <UsageTable
                title=""
                columns={activeTableConfig.columns}
                groupedData={activeTableConfig.groupedData}
                formatGroupKey={tableView === "account" ? showName : undefined}
                tableType={tableView}
                sortBy={sortBy === "groupKey" ? "groupKey" : sortBy}
                sortOrder={sortOrder}
                onToggleSort={toggleSort}
                viewMode={viewMode}
                storageKey={activeTableConfig.storageKey}
                renderSummaryCells={activeTableConfig.renderSummaryCells}
                renderDetailCells={activeTableConfig.renderDetailCells}
                emptyMessage={activeTableConfig.emptyMessage}
              />
            )}
          </div>
        </div>
      )}

      {activeTab === "details" && (
        <Suspense fallback={spinner}>
          <RequestDetailsTab
            recent={data?.recent || []}
            accounts={data?.accounts || []}
            workerById={workerById}
            showName={showName}
          />
        </Suspense>
      )}
    </div>
  );
}
