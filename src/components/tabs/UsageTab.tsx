"use client";

// Thống kê tab — KPIs, stacked daily bars, per-account / per-model breakdowns
// and a grouped detail table over muse's /api/usage payload. Range selector
// and CSV export live in the shell header (<HeaderSlot>). Polls every 8s.
//
// The server aggregates totals, days and accounts over the whole range; model /
// key / endpoint groupings only exist per request, so they are built from the
// `recent` window (newest 50) and labelled as such when the range is larger.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/AppShell";
import { HeaderSlot } from "@/components/HeaderSlot";
import { useT } from "@/lib/i18n";
import { maskName } from "@/lib/mask";
import { estInputTokens, estOutputTokens, fmt, type UsageData, type UsageEntry } from "@/components/usage/types";

const RANGES = [
  { value: "today", label: "Hôm nay" },
  { value: "24h", label: "24 giờ" },
  { value: "7d", label: "7 ngày" },
  { value: "30d", label: "30 ngày" },
  { value: "60d", label: "60 ngày" },
];

type GroupBy = "model" | "account" | "apiKey" | "endpoint";

const GROUP_OPTIONS: { value: GroupBy; label: string; column: string }[] = [
  { value: "model", label: "Model", column: "Model" },
  { value: "account", label: "Tài khoản", column: "Tài khoản" },
  { value: "apiKey", label: "API key", column: "API key" },
  { value: "endpoint", label: "Endpoint", column: "Endpoint" },
];

interface Row {
  key: string;
  requests: number;
  ok: number;
  lastUsed: number;
  inTok: number;
  outTok: number;
}

// Compact counts for KPI values ("27.3k").
function fmtCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

const pct = (ok: number, total: number) => (total ? `${Math.round((ok / total) * 100)}%` : "—");

function groupRecent(recent: UsageEntry[], keyOf: (e: UsageEntry) => string): Row[] {
  const rows = new Map<string, Row>();
  for (const e of recent) {
    const k = keyOf(e);
    const r = rows.get(k) || { key: k, requests: 0, ok: 0, lastUsed: 0, inTok: 0, outTok: 0 };
    r.requests++;
    if (e.ok) r.ok++;
    r.inTok += estInputTokens(e);
    r.outTok += estOutputTokens(e);
    if (e.ts > r.lastUsed) r.lastUsed = e.ts;
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) => b.requests - a.requests);
}

const KEY_OF: Record<GroupBy, (e: UsageEntry) => string> = {
  model: (e) => e.model || "—",
  account: (e) => e.accountName || "—",
  apiKey: (e) => e.keyName || "open",
  endpoint: (e) => e.endpoint || "—",
};

export function UsageTab() {
  const { t } = useT();
  const { maskEmails } = useApp();
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("7d");
  const [groupBy, setGroupBy] = useState<GroupBy>("model");
  const isInitialLoad = useRef(true);

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
    const timer = setInterval(() => refresh(period, false), 8000);
    return () => clearInterval(timer);
  }, [period, refresh]);

  // "47 phút trước" — relative time for the detail table.
  const ago = useCallback(
    (ts: number) => {
      if (!ts) return "—";
      const mins = Math.floor((Date.now() - ts) / 60000);
      if (mins < 1) return t("Vừa xong");
      if (mins < 60) return t("{n} phút trước", { n: mins });
      if (mins < 1440) return t("{n} giờ trước", { n: Math.floor(mins / 60) });
      return new Date(ts).toLocaleDateString("vi-VN");
    },
    [t]
  );

  const recent = useMemo(() => data?.recent || [], [data]);
  const total = data?.totals.requests || 0;
  // Model/key/endpoint numbers come from `recent`; flag when it is a sample.
  const sampled = total > recent.length;

  const kpis = useMemo(() => {
    if (!data) return null;
    const { totals } = data;
    const today = data.days.length ? data.days[data.days.length - 1].requests : 0;
    return [
      { label: t("Request"), value: fmt(totals.requests), sub: t("{n} hôm nay", { n: fmt(today) }) },
      {
        label: t("Thành công"),
        value: pct(totals.ok, totals.requests),
        sub: t("{ok} xong · {failed} lỗi", { ok: fmt(totals.ok), failed: fmt(totals.failed) }),
      },
      {
        label: t("Token"),
        value: fmtCompact(totals.inputTokens + totals.outputTokens),
        sub: t("{in} vào · {out} ra", { in: fmtCompact(totals.inputTokens), out: fmtCompact(totals.outputTokens) }),
      },
      { label: t("File đã tạo"), value: fmt(data.mediaFiles || 0), sub: t("ảnh, video, giọng nói đã lưu") },
    ];
  }, [data, t]);

  const days = useMemo(() => {
    const list = data?.days || [];
    const max = Math.max(1, ...list.map((d) => d.requests));
    return list.map((d, i) => ({
      ...d,
      failed: d.requests - d.ok,
      okH: Math.round((d.ok / max) * 160),
      failH: Math.round(((d.requests - d.ok) / max) * 160),
      label: i === list.length - 1 ? t("Nay") : d.day.slice(3),
      isToday: i === list.length - 1,
    }));
  }, [data, t]);

  // Accounts: server-side over the whole range. Worker aliases (w0/w1) are
  // deliberately not shown — the account name is what people recognise.
  const byAccount = useMemo(
    () =>
      [...(data?.accounts || [])]
        .sort((a, b) => b.requests - a.requests)
        .map((a) => ({ key: a.id || a.name, name: maskName(a.name, maskEmails), requests: a.requests, ok: a.ok })),
    [data, maskEmails]
  );
  const byModel = useMemo(
    () => groupRecent(recent, KEY_OF.model).map((r) => ({ key: r.key, name: r.key, requests: r.requests, ok: r.ok })),
    [recent]
  );

  const rows = useMemo(() => groupRecent(recent, KEY_OF[groupBy]), [recent, groupBy]);
  const group = GROUP_OPTIONS.find((g) => g.value === groupBy)!;

  const sampleNote = sampled ? t("Dựa trên {n} request gần nhất", { n: recent.length }) : null;

  const breakdowns = [
    { title: t("Theo tài khoản"), items: byAccount, note: null as string | null },
    { title: t("Theo model"), items: byModel, note: sampleNote },
  ];

  return (
    <div className="act">
      <HeaderSlot>
        <div className="act-head-tools">
          <div className="acc2-segment small act-range" role="group" aria-label={t("Khoảng thời gian")}>
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                className={period === r.value ? "active" : ""}
                aria-pressed={period === r.value}
                onClick={() => setPeriod(r.value)}
              >
                {t(r.label)}
              </button>
            ))}
          </div>
          <a
            href={`/api/usage?range=${period}&format=csv`}
            download
            className="acc2-btn"
            title={t("Tải lịch sử request dạng CSV")}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
            </svg>
            {t("Tải CSV")}
          </a>
        </div>
      </HeaderSlot>

      {/* Range totals — one card, four columns */}
      <section className="ov2-kpis" aria-label={t("Tổng quan khoảng thời gian")}>
        {(kpis || [0, 1, 2, 3].map(() => null)).map((k, i) => (
          <div key={i} className="ov2-kpi">
            {k ? (
              <>
                <span className="ov2-muted">{k.label}</span>
                <span className="ov2-kpi-value">{k.value}</span>
                <span className="act-note">{k.sub}</span>
              </>
            ) : (
              <>
                <span className="skeleton" style={{ height: 14, width: "40%" }} />
                <span className="skeleton" style={{ height: 34, width: "55%" }} />
                <span className="skeleton" style={{ height: 12, width: "70%" }} />
              </>
            )}
          </div>
        ))}
      </section>

      {/* Requests per day — stacked ok / failed */}
      <section className="ov2-card act-card" aria-label={t("Request theo ngày")}>
        <div className="ov2-section-head">
          <h2>{t("Request theo ngày")}</h2>
          <div className="act-legend">
            <span><span className="act-swatch ok" />{t("Thành công")}</span>
            <span><span className="act-swatch fail" />{t("Lỗi")}</span>
          </div>
        </div>
        {loading && !data ? (
          <div className="skeleton" style={{ height: 200 }} />
        ) : (
          <div
            className="act-bars"
            role="img"
            aria-label={t("Biểu đồ cột chồng request thành công và lỗi theo ngày")}
          >
            {days.map((d) => (
              <div
                key={d.day}
                className="act-bar-col"
                title={t("{day}: {ok} thành công · {failed} lỗi", { day: d.day, ok: d.ok, failed: d.failed })}
              >
                <span className="act-bar-count">{d.requests}</span>
                {d.requests ? (
                  <div className="act-bar">
                    {d.failH > 0 && <div className="fail" style={{ height: Math.max(2, d.failH) }} />}
                    {d.okH > 0 && <div className="ok" style={{ height: Math.max(2, d.okH) }} />}
                  </div>
                ) : (
                  <div className="act-bar empty" />
                )}
                <span className={`act-bar-day ${d.isToday ? "today" : ""}`}>{d.label}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Breakdowns — by account (whole range), by model (recent window) */}
      <div className="act-grid2">
        {breakdowns.map((b) => {
          const max = Math.max(1, ...b.items.map((i) => i.requests));
          return (
            <section key={b.title} className="ov2-card act-card" aria-label={b.title}>
              <div className="ov2-section-head">
                <h2>{b.title}</h2>
                {b.note && <span className="act-note">{b.note}</span>}
              </div>
              {loading && !data ? (
                <>
                  <div className="skeleton" style={{ height: 30 }} />
                  <div className="skeleton" style={{ height: 30 }} />
                </>
              ) : b.items.length === 0 ? (
                <div className="act-empty">{t("Chưa có request trong khoảng này")}</div>
              ) : (
                b.items.map((i) => (
                  <div key={i.key} className="act-meter">
                    <div className="act-meter-row">
                      <span title={i.name}>{i.name}</span>
                      <span>
                        {t("{n} request", { n: fmt(i.requests) })} · {pct(i.ok, i.requests)}
                      </span>
                    </div>
                    <div className="act-meter-track">
                      <div className="act-meter-fill" style={{ width: `${(i.requests / max) * 100}%` }} />
                    </div>
                  </div>
                ))
              )}
            </section>
          );
        })}
      </div>

      {/* Detail table, grouped by the selected dimension */}
      <section className="acc2-card" aria-label={t("Chi tiết")}>
        <div className="act-table-head">
          <div>
            <h2>{t("Chi tiết")}</h2>
            {sampleNote && <div className="act-note">{sampleNote}</div>}
          </div>
          <label className="act-select-label">
            {t("Nhóm theo")}
            <select className="act-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
              {GROUP_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>{t(g.label)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="acc2-scroll">
          <table className="acc2-table">
            <thead>
              <tr>
                <th>{t(group.column)}</th>
                <th className="num">{t("Request")}</th>
                <th className="num">{t("Thành công")}</th>
                <th>{t("Dùng lần cuối")}</th>
                <th className="num">{t("Token vào")}</th>
                <th className="num">{t("Token ra")}</th>
                <th className="num">{t("Tổng token")}</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={7}><div className="skeleton" style={{ height: 18 }} /></td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="act-empty">{t("Chưa có request trong khoảng này")}</td>
                </tr>
              ) : (
                rows.map((r) => {
                  const name = groupBy === "account" ? maskName(r.key, maskEmails) : r.key;
                  return (
                    <tr key={r.key}>
                      <td className={`act-name ${groupBy === "endpoint" ? "mono" : ""}`} title={name}>
                        {name}
                      </td>
                      <td className="num">{fmt(r.requests)}</td>
                      <td className="num">{pct(r.ok, r.requests)}</td>
                      <td className="act-sub">{ago(r.lastUsed)}</td>
                      <td className="num act-sub">{fmt(r.inTok)}</td>
                      <td className="num act-sub">{fmt(r.outTok)}</td>
                      <td className="num">{fmt(r.inTok + r.outTok)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
