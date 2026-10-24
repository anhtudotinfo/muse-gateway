"use client";

// "By Account" bar chart — port of 9router's ProviderBarChart (recharts).
// Muse aggregates per-account request counts only; Tokens mode shows the
// graceful empty state.

import React, { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import Card from "@/components/endpoint/ui/Card";
import { fmtTokens, type UsageAccount } from "./types";

const COLORS = ["#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#10b981", "#f97316"];

interface AccountBarChartProps {
  accounts?: UsageAccount[];
}

export default function AccountBarChart({ accounts = [] }: AccountBarChartProps) {
  const [viewMode, setViewMode] = useState<"tokens" | "requests">("requests");

  const chartData = useMemo(
    () =>
      accounts
        .map((a) => ({
          name: a.name,
          tokens: 0, // per-account tokens not tracked by muse backend
          requests: a.requests || 0,
        }))
        .filter((d) => d[viewMode] > 0)
        .sort((a, b) => b[viewMode] - a[viewMode]),
    [accounts, viewMode]
  );

  const fmt = viewMode === "tokens" ? fmtTokens : (n: number) => String(n || 0);
  const label = viewMode === "tokens" ? "Tokens" : "Requests";

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-muted uppercase tracking-wide">By Account</span>
        <div className="grid grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1">
          <button
            type="button"
            onClick={() => setViewMode("tokens")}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors ${viewMode === "tokens" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
          >
            Tokens
          </button>
          <button
            type="button"
            onClick={() => setViewMode("requests")}
            className={`px-2.5 py-0.5 rounded-md text-xs font-medium transition-colors ${viewMode === "requests" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
          >
            Requests
          </button>
        </div>
      </div>

      {!chartData.length ? (
        <div className="h-44 flex items-center justify-center text-text-muted text-sm">
          {viewMode === "requests" ? "No account usage yet" : "No token data — not tracked per account"}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.6 }}
              tickLine={false}
              axisLine={false}
              interval={0}
              tickFormatter={(v: string) => (v.length > 10 ? v.slice(0, 10) + "…" : v)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={fmt}
              width={44}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              formatter={(value) => [fmt(Number(value)), label]}
            />
            <Bar dataKey={viewMode} radius={[4, 4, 0, 0]}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
