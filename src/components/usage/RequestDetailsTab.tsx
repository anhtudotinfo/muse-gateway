"use client";

// Request details table — port of 9router's RequestDetailsTab, adapted to
// muse's recent-request log (no request/response payload storage, so the
// drawer shows what the backend actually records: prompt preview + error).

import React, { useMemo, useState } from "react";
import Card from "@/components/endpoint/ui/Card";
import Button from "@/components/endpoint/ui/Button";
import Drawer from "@/components/endpoint/ui/Drawer";
import Pagination from "@/components/endpoint/ui/Pagination";
import { cn } from "@/lib/cn";
import {
  estInputTokens,
  estOutputTokens,
  type UsageAccount,
  type UsageEntry,
} from "./types";

function CollapsibleSection({ title, children, defaultOpen = false, icon = null }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  icon?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-black/5 dark:border-white/5 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon && <span className="material-symbols-outlined text-[18px] text-text-muted">{icon}</span>}
          <span className="font-semibold text-sm text-text-main">{title}</span>
        </div>
        <span className={cn(
          "material-symbols-outlined text-[20px] text-text-muted transition-transform duration-200",
          isOpen ? "rotate-90" : ""
        )}>
          chevron_right
        </span>
      </button>

      {isOpen && (
        <div className="p-4 border-t border-black/5 dark:border-white/5">
          {children}
        </div>
      )}
    </div>
  );
}

interface RequestDetailsTabProps {
  recent?: UsageEntry[];
  accounts?: UsageAccount[];
  workerById?: Map<string, string>;
  showName?: (name: string) => string;
}

export default function RequestDetailsTab({ recent = [], accounts = [], workerById, showName }: RequestDetailsTabProps) {
  const disp = (n?: string | null) => (showName ? showName(n || "") : n || "");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedDetail, setSelectedDetail] = useState<UsageEntry | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [filters, setFilters] = useState({ account: "", startDate: "", endDate: "" });

  const filtered = useMemo(() => {
    const start = filters.startDate ? new Date(filters.startDate).getTime() : null;
    const end = filters.endDate ? new Date(filters.endDate).getTime() : null;
    return recent.filter((e) => {
      if (filters.account && e.accountName !== filters.account) return false;
      if (start !== null && e.ts < start) return false;
      if (end !== null && e.ts > end) return false;
      return true;
    });
  }, [recent, filters]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const currentPage = Math.min(page, Math.max(1, totalPages));
  const pageItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleViewDetail = (detail: UsageEntry) => {
    setSelectedDetail(detail);
    setIsDrawerOpen(true);
  };

  const handleClearFilters = () => {
    setFilters({ account: "", startDate: "", endDate: "" });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card padding="md">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="account-filter" className="text-sm font-medium text-text-main">Account</label>
            <select
              id="account-filter"
              value={filters.account}
              onChange={(e) => setFilters({ ...filters, account: e.target.value })}
              className={cn(
                "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20",
                "w-full min-w-0 cursor-pointer"
              )}
              style={{ colorScheme: "auto" }}
            >
              <option value="">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.name}>
                  {disp(a.name)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="start-date-filter" className="text-sm font-medium text-text-main">Start Date</label>
            <input
              id="start-date-filter"
              type="datetime-local"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className={cn(
                "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "w-full min-w-0 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20"
              )}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <label htmlFor="end-date-filter" className="text-sm font-medium text-text-main">End Date</label>
            <input
              id="end-date-filter"
              type="datetime-local"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className={cn(
                "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "w-full min-w-0 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20"
              )}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2 sm:col-span-2 lg:col-span-1">
            <span className="hidden text-sm font-medium text-text-main opacity-0 lg:block" aria-hidden="true">Clear</span>
            <Button
              variant="ghost"
              onClick={handleClearFilters}
              disabled={!filters.account && !filters.startDate && !filters.endDate}
              className="w-full"
            >
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px]">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/5">
                <th className="text-left p-4 text-sm font-semibold text-text-main">Timestamp</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Model</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Account</th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">Input Tokens</th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">Cached</th>
                <th className="text-right p-4 text-sm font-semibold text-text-main">Output Tokens</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Latency</th>
                <th className="text-center p-4 text-sm font-semibold text-text-main">Action</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-text-muted">
                    No request details found
                  </td>
                </tr>
              ) : (
                pageItems.map((detail, index) => (
                  <tr
                    key={`${detail.ts}-${index}`}
                    className="border-b border-black/5 dark:border-white/5 last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="whitespace-nowrap p-4 text-sm text-text-main">
                      {new Date(detail.ts).toLocaleString()}
                    </td>
                    <td className="max-w-[260px] truncate p-4 font-mono text-sm text-text-main">
                      {detail.model || "—"}
                    </td>
                    <td className="max-w-[180px] truncate p-4 text-sm text-text-main">
                      {workerById?.get(detail.accountId) && (
                        <span className="mr-1.5 inline-block rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                          {workerById.get(detail.accountId)}
                        </span>
                      )}
                      <span className="font-medium">{disp(detail.accountName)}</span>
                    </td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">
                      {estInputTokens(detail).toLocaleString()}
                    </td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">—</td>
                    <td className="p-4 text-sm text-text-main text-right font-mono">
                      {estOutputTokens(detail).toLocaleString()}
                    </td>
                    <td className="p-4 text-sm text-text-muted">
                      <span className="font-mono">Total: {(detail.ms || 0).toLocaleString()}ms</span>
                    </td>
                    <td className="p-4 text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewDetail(detail)}
                      >
                        Detail
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="border-t border-black/5 dark:border-white/5">
            <Pagination
              currentPage={currentPage}
              pageSize={pageSize}
              totalItems={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            />
          </div>
        )}
      </Card>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Request Details"
        width="lg"
      >
        {selectedDetail && (
          <div className="space-y-6">
            <div className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-text-muted">Timestamp:</span>{" "}
                <span className="text-text-main">{new Date(selectedDetail.ts).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-text-muted">Account:</span>{" "}
                <span className="text-text-main font-medium">
                  {workerById?.get(selectedDetail.accountId) ? `${workerById.get(selectedDetail.accountId)} · ` : ""}
                  {disp(selectedDetail.accountName)}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Model:</span>{" "}
                <span className="text-text-main font-mono">{selectedDetail.model || "—"}</span>
              </div>
              <div>
                <span className="text-text-muted">Endpoint:</span>{" "}
                <span className="text-text-main font-mono">{selectedDetail.endpoint || "—"}</span>
              </div>
              <div>
                <span className="text-text-muted">API Key:</span>{" "}
                <span className="text-text-main">{selectedDetail.keyName || "open"}</span>
              </div>
              <div>
                <span className="text-text-muted">Status:</span>{" "}
                <span className={cn(
                  "font-medium",
                  selectedDetail.ok ? "text-green-600" : "text-red-600"
                )}>
                  {selectedDetail.ok ? "success" : "failed"}
                </span>
              </div>
              <div>
                <span className="text-text-muted">Latency:</span>{" "}
                <span className="text-text-main font-mono">
                  Total {(selectedDetail.ms || 0).toLocaleString()}ms
                </span>
              </div>
              <div>
                <span className="text-text-muted">Input Tokens:</span>{" "}
                <span className="text-text-main font-mono">
                  {estInputTokens(selectedDetail).toLocaleString()} <span className="text-text-muted">(est)</span>
                </span>
              </div>
              <div>
                <span className="text-text-muted">Output Tokens:</span>{" "}
                <span className="text-text-main font-mono">
                  {estOutputTokens(selectedDetail).toLocaleString()} <span className="text-text-muted">(est)</span>
                </span>
              </div>
              {selectedDetail.ua && (
                <div>
                  <span className="text-text-muted">Client:</span>{" "}
                  <span className="break-all font-mono text-text-main">{selectedDetail.ua}</span>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <CollapsibleSection title="Client Request (Preview)" defaultOpen={true} icon="input">
                <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4 whitespace-pre-wrap">
                  {selectedDetail.promptPreview || "[No prompt recorded]"}
                </pre>
              </CollapsibleSection>

              {selectedDetail.error && (
                <CollapsibleSection title="Error" defaultOpen={true} icon="error">
                  <pre className="max-h-[300px] max-w-full overflow-auto rounded-lg border border-red-200 bg-red-50 p-3 font-mono text-xs text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-100 sm:p-4 whitespace-pre-wrap">
                    {selectedDetail.error}
                  </pre>
                </CollapsibleSection>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
