"use client";

// Expandable grouped usage table — port of 9router's UsageTable.
// Groups collapse/expand (state persisted to localStorage), headers sort.

import React, { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import Card from "@/components/endpoint/ui/Card";
import { fmt, fmtCost, fmtTime } from "./types";

export interface UsageTableColumn {
  field: string;
  label: string;
  align?: "left" | "right";
}

export interface UsageTableItem {
  key: string;
  requests: number;
  promptTokens?: number;
  cachedTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  inputCost?: number;
  cachedCost?: number;
  outputCost?: number;
  lastUsed?: number | null;
  pending?: number;
  [key: string]: unknown;
}

export interface UsageTableGroup {
  groupKey: string;
  summary: UsageTableItem;
  items: UsageTableItem[];
}

function SortIcon({ field, currentSort, currentOrder }: { field: string; currentSort: string; currentOrder: string }) {
  if (currentSort !== field) return <span className="ml-1 opacity-20">↕</span>;
  return <span className="ml-1">{currentOrder === "asc" ? "↑" : "↓"}</span>;
}

// Render 4 token or cost cells based on viewMode
function ValueCells({ item, viewMode, isSummary = false }: { item: UsageTableItem; viewMode: string; isSummary?: boolean }) {
  if (viewMode === "tokens") {
    return (
      <>
        <td className="px-6 py-3 text-right text-text-muted">
          {isSummary && item.promptTokens === undefined ? "—" : fmt(item.promptTokens)}
        </td>
        <td className="px-6 py-3 text-right text-text-muted">
          {item.cachedTokens ? fmt(item.cachedTokens) : "—"}
        </td>
        <td className="px-6 py-3 text-right text-text-muted">
          {isSummary && item.completionTokens === undefined ? "—" : fmt(item.completionTokens)}
        </td>
        <td className="px-6 py-3 text-right font-medium">
          {fmt(item.totalTokens)}
        </td>
      </>
    );
  }
  return (
    <>
      <td className="px-6 py-3 text-right text-text-muted">
        {isSummary && item.inputCost === undefined ? "—" : fmtCost(item.inputCost)}
      </td>
      <td className="px-6 py-3 text-right text-text-muted">
        {item.cachedCost ? fmtCost(item.cachedCost) : "—"}
      </td>
      <td className="px-6 py-3 text-right text-text-muted">
        {isSummary && item.outputCost === undefined ? "—" : fmtCost(item.outputCost)}
      </td>
      <td className="px-6 py-3 text-right font-medium text-warning">
        {item.cost === undefined && item.totalCost === undefined ? "—" : fmtCost(item.totalCost as number | undefined || item.cost)}
      </td>
    </>
  );
}

interface UsageTableProps {
  title: string;
  columns: UsageTableColumn[];
  groupedData: UsageTableGroup[];
  tableType: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onToggleSort: (tableType: string, field: string) => void;
  viewMode: "tokens" | "costs";
  storageKey: string;
  renderSummaryCells: (group: UsageTableGroup) => React.ReactNode;
  renderDetailCells: (item: UsageTableItem) => React.ReactNode;
  emptyMessage: string;
  /** Optional display transform for the group header (e.g. account masking). */
  formatGroupKey?: (key: string) => string;
}

export default function UsageTable({
  title,
  columns,
  groupedData,
  tableType,
  sortBy,
  sortOrder,
  onToggleSort,
  viewMode,
  storageKey,
  renderDetailCells,
  renderSummaryCells,
  emptyMessage,
  formatGroupKey,
}: UsageTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Load expanded state from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setExpanded(new Set(JSON.parse(saved)));
    } catch (e) {
      console.error(`Failed to load ${storageKey}:`, e);
    }
  }, [storageKey]);

  // Save expanded state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...expanded]));
    } catch (e) {
      console.error(`Failed to save ${storageKey}:`, e);
    }
  }, [expanded, storageKey]);

  const toggleGroup = useCallback((groupKey: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  const valueColumns = useMemo(() => {
    if (viewMode === "tokens") {
      return [
        { field: "promptTokens", label: "Input Tokens" },
        { field: "cachedTokens", label: "Cached" },
        { field: "completionTokens", label: "Output Tokens" },
        { field: "totalTokens", label: "Total Tokens" },
      ];
    }
    return [
      { field: "promptTokens", label: "Input Cost" },
      { field: "cachedCost", label: "Cached Cost" },
      { field: "completionTokens", label: "Output Cost" },
      { field: "cost", label: "Total Cost" },
    ];
  }, [viewMode]);

  const totalColSpan = columns.length + valueColumns.length;

  return (
    <Card className="overflow-hidden">
      <div className="p-4 border-b border-border bg-bg-subtle/50">
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-bg-subtle/30 text-text-muted uppercase text-xs">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.field}
                  className={`px-6 py-3 cursor-pointer hover:bg-bg-subtle/50 ${col.align === "right" ? "text-right" : ""}`}
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  {col.label}{" "}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </th>
              ))}
              {valueColumns.map((col) => (
                <th
                  key={col.field}
                  className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => onToggleSort(tableType, col.field)}
                >
                  {col.label}{" "}
                  <SortIcon field={col.field} currentSort={sortBy} currentOrder={sortOrder} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {groupedData.map((group) => (
              <Fragment key={group.groupKey}>
                {/* Group summary row */}
                <tr
                  className="group-summary cursor-pointer hover:bg-bg-subtle/50 transition-colors"
                  onClick={() => toggleGroup(group.groupKey)}
                >
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`material-symbols-outlined text-[18px] text-text-muted transition-transform ${expanded.has(group.groupKey) ? "rotate-90" : ""}`}>
                        chevron_right
                      </span>
                      <span className={`font-medium transition-colors ${(group.summary.pending || 0) > 0 ? "text-primary" : ""}`}>
                        {formatGroupKey ? formatGroupKey(group.groupKey) : group.groupKey}
                      </span>
                    </div>
                  </td>
                  {renderSummaryCells(group)}
                  <ValueCells item={group.summary} viewMode={viewMode} isSummary />
                </tr>
                {/* Detail rows */}
                {expanded.has(group.groupKey) && group.items.map((item) => (
                  <tr
                    key={`detail-${item.key}`}
                    className="group-detail hover:bg-bg-subtle/20 transition-colors"
                  >
                    {renderDetailCells(item)}
                    <ValueCells item={item} viewMode={viewMode} />
                  </tr>
                ))}
              </Fragment>
            ))}
            {groupedData.length === 0 && (
              <tr>
                <td colSpan={totalColSpan} className="px-6 py-8 text-center text-text-muted">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
