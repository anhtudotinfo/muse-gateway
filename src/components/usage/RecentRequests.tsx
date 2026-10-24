"use client";

import React, { useState, useEffect } from "react";
import Card from "@/components/endpoint/ui/Card";
import { estInputTokens, estOutputTokens, fmtTokens, timeAgo, type UsageEntry } from "./types";

// Auto-update time display every second without re-rendering parent
function TimeAgo({ timestamp }: { timestamp: number }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return <>{timeAgo(timestamp)}</>;
}

interface RecentRequestsProps {
  requests?: UsageEntry[];
  /** accountId → worker alias (w0, w1, …) from /api/pool */
  workerById?: Map<string, string>;
  /** display transform for account names (Ẩn email) */
  showName?: (name: string) => string;
}

export default function RecentRequests({ requests = [], workerById, showName }: RecentRequestsProps) {
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden" padding="sm" style={{ height: 480 }}>
      {/* Header */}
      <div className="px-1 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Recent Requests</span>
      </div>

      {!requests.length ? (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">No requests yet.</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full min-w-[300px] border-collapse text-xs">
            <thead className="sticky top-0 bg-bg z-10">
              <tr className="border-b border-border">
                <th className="py-1.5 text-left font-semibold text-text-muted w-2"></th>
                <th className="py-1.5 text-left font-semibold text-text-muted">Model</th>
                <th className="py-1.5 text-left font-semibold text-text-muted">Worker</th>
                <th className="py-1.5 text-right font-semibold text-text-muted whitespace-nowrap">In / Out</th>
                <th className="py-1.5 text-right font-semibold text-text-muted">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {requests.map((r, i) => (
                <tr key={`${r.ts}-${i}`} className="hover:bg-bg-subtle transition-colors">
                  <td className="py-1.5">
                    <span className={`block w-1.5 h-1.5 rounded-full ${r.ok ? "bg-success" : "bg-error"}`} />
                  </td>
                  <td className="py-1.5 font-mono truncate max-w-[120px]" title={r.model || ""}>
                    {r.model || "—"}
                  </td>
                  <td className="py-1.5 whitespace-nowrap" title={showName ? showName(r.accountName) : r.accountName}>
                    {workerById?.get(r.accountId) ? (
                      <span className="inline-block rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                        {workerById.get(r.accountId)}
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <span className="text-primary">{fmtTokens(estInputTokens(r))}↑</span>
                    {" "}
                    <span className="text-success">{fmtTokens(estOutputTokens(r))}↓</span>
                  </td>
                  <td className="py-1.5 text-right text-text-muted whitespace-nowrap">
                    <TimeAgo timestamp={r.ts} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
