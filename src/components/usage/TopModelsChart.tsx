"use client";

// "Top Models" horizontal bar chart — port of 9router's TopModelsChart
// (recharts). Muse has no per-model aggregate API, so model/token counts are
// derived client-side from the recent-request window (noted in the header).

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
import { estInputTokens, estOutputTokens, fmtTokens, type UsageEntry } from "./types";

const COLORS = ["#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6"];

const truncate = (s: string, max = 22) => (s && s.length > max ? s.slice(0, max) + "…" : s || "");

interface TopModelsChartProps {
  recent?: UsageEntry[];
}

export default function TopModelsChart({ recent = [] }: TopModelsChartProps) {
  const [viewMode, setViewMode] = useState<"tokens" | "requests">("requests");

  const chartData = useMemo(() => {
    const byModel = new Map<string, { tokens: number; requests: number }>();
    for (const e of recent) {
      const name = e.model || "unknown";
      const cur = byModel.get(name) || { tokens: 0, requests: 0 };
      cur.requests += 1;
      cur.tokens += estInputTokens(e) + estOutputTokens(e);
      byModel.set(name, cur);
    }
    return [...byModel.entries()]
      .map(([name, d]) => ({ name: truncate(name), ...d }))
      .filter((d) => d[viewMode] > 0)
      .sort((a, b) => b[viewMode] - a[viewMode])
      .slice(0, 5);
  }, [recent, viewMode]);

  const fmt = viewMode === "tokens" ? fmtTokens : (n: number) => String(n || 0);
  const label = viewMode === "tokens" ? "Tokens" : "Requests";

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-muted uppercase tracking-wide">
          Top Models <span className="normal-case font-normal opacity-70">(recent)</span>
        </span>
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
        <div className="h-44 flex items-center justify-center text-text-muted text-sm">No model usage yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 4, right: 40, left: 4, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={fmt}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.7 }}
              tickLine={false}
              axisLine={false}
              width={90}
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
            <Bar dataKey={viewMode} radius={[0, 4, 4, 0]}>
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
