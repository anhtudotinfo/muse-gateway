"use client";

import React from "react";
import Card from "@/components/endpoint/ui/Card";
import { fmt, type UsageData } from "./types";

interface OverviewCardsProps {
  stats: UsageData;
  /** Live count of accounts currently processing a request (from /api/pool). */
  busyCount?: number;
}

export default function OverviewCards({ stats, busyCount = 0 }: OverviewCardsProps) {
  const t = stats.totals;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 sm:gap-4">
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Total Requests</span>
        <span className="w-full truncate text-lg font-bold xl:text-xl" title={fmt(t.requests)}>{fmt(t.requests)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Total Input Tokens</span>
        <span className="w-full truncate text-lg font-bold text-primary xl:text-xl" title={fmt(t.inputTokens)}>{fmt(t.inputTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Đang chạy</span>
        <span className={`w-full truncate text-lg font-bold xl:text-xl ${busyCount > 0 ? "text-info" : ""}`} title="Account đang xử lý request">
          {busyCount}
        </span>
        <span className="text-[10px] text-text-muted">account busy</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Output Tokens</span>
        <span className="w-full truncate text-lg font-bold text-success xl:text-xl" title={fmt(t.outputTokens)}>{fmt(t.outputTokens)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Media Files</span>
        <span className="w-full truncate text-lg font-bold text-warning xl:text-xl" title="File media đã tạo trong data/media">
          {fmt(stats.mediaFiles)}
        </span>
        <span className="text-[10px] text-text-muted">đã tạo</span>
      </Card>
      <Card className="flex min-w-0 flex-col items-center text-center gap-1 px-3 py-3 sm:px-4">
        <span className="text-text-muted text-xs uppercase font-semibold sm:text-sm">Success Rate</span>
        <span className="w-full truncate text-lg font-bold xl:text-xl">
          {t.requests ? `${Math.round((t.ok / t.requests) * 100)}%` : "—"}
        </span>
        <span className="text-[10px] text-text-muted">{fmt(t.ok)} ok · {fmt(t.failed)} lỗi</span>
      </Card>
    </div>
  );
}
