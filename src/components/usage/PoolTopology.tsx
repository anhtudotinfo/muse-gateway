"use client";

// Radial client/provider topology for the Usage tab — port of 9router's
// ProviderTopology (@xyflow/react). Muse has no provider registry or
// active-request stream, so ring nodes = pool accounts and edges show
// last-used / error state only (the kame beam renders when "active").

import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  ReactFlow,
  Handle,
  Position,
  Controls,
  BaseEdge,
  getBezierPath,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const KAME_PARTICLE_COUNT = 6;
const SPARK_COUNT = 5;

// Deterministic per-account color (index-based palette, 9router chart colors)
const COLORS = ["#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#10b981", "#f97316"];

export interface TopologyAccount {
  name: string;
  count: number;
  /** Display label — masked when "Ẩn email" is on. Falls back to name. */
  label?: string;
  /** Worker alias w0..wN (from /api/pool). */
  worker?: string;
  /** Live pool status — 'queued' gets an amber held indicator. */
  status?: string;
  /** Account disabled in the pool — node renders dimmed. */
  enabled?: boolean;
}

interface ProviderNodeData extends Record<string, unknown> {
  label: string;
  color: string;
  textIcon: string;
  active: boolean;
  queued: boolean;
  worker?: string;
  count?: number;
  disabled?: boolean;
}

interface RouterNodeData extends Record<string, unknown> {
  activeCount: number;
}

// Custom provider node - rectangle with icon + name
function ProviderNode({ data }: NodeProps<Node<ProviderNodeData>>) {
  const { label, color, textIcon, active, queued, worker, count, disabled } = data;
  return (
    <div
      className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg border-2 transition-all duration-300 bg-bg"
      style={{
        borderColor: active ? color : "var(--color-border)",
        boxShadow: active ? `0 0 16px ${color}40` : "none",
        minWidth: "150px",
        opacity: disabled ? 0.45 : 1,
      }}
      title={disabled ? "Đã tắt trong pool" : undefined}
    >
      <Handle type="target" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      {/* Account icon (letter badge — muse accounts have no image icons) */}
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        <span className="text-sm font-bold" style={{ color }}>{textIcon}</span>
      </div>

      {/* Worker alias + account name */}
      {worker && (
        <span className="rounded bg-primary/15 px-1 py-0.5 font-mono text-[10px] font-semibold text-primary shrink-0">
          {worker}
        </span>
      )}
      <span
        className="text-base font-medium truncate"
        style={{ color: active ? color : "var(--color-text)" }}
      >
        {label}
      </span>

      {/* Request count — matches MuseRouter's "N requests" node caption */}
      <span className="text-[10px] text-text-muted shrink-0 tabular-nums">
        {count ?? 0} req
      </span>

      {/* Queued indicator — request parked behind a busy account */}
      {queued && !active && (
        <span
          className="shrink-0 rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400"
          title="Đang chờ — request xếp hàng sau account busy"
        >
          chờ
        </span>
      )}

      {/* Active indicator */}
      {active && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: color }} />
          <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: color }} />
        </span>
      )}
    </div>
  );
}

// Center pool node — pulse/glow on card only (no expanding rings)
function RouterNode({ data }: NodeProps<Node<RouterNodeData>>) {
  const powering = (data.activeCount || 0) > 0;
  return (
    <div
      className={`relative z-[1] flex items-center justify-center px-5 py-3 rounded-xl border-2 min-w-[130px] ${
        powering
          ? "topology-router-core border-yellow-300 bg-gradient-to-br from-primary/30 via-yellow-400/20 to-cyan-400/25"
          : "border-primary bg-primary/5 shadow-md"
      }`}
    >
      <Handle type="source" position={Position.Top} id="top" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} id="left" className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} id="right" className="!bg-transparent !border-0 !w-0 !h-0" />

      <img
        src="/muse-logo.svg"
        alt="Muse"
        className={`w-6 h-6 mr-2 ${powering ? "topology-router-icon" : ""}`}
        style={{ filter: powering ? "drop-shadow(0 0 6px rgba(0,130,251,.8))" : "drop-shadow(0 2px 6px rgba(0,100,224,.4))" }}
      />
      <span className={`text-sm font-bold ${powering ? "topology-router-label text-yellow-300" : "text-primary"}`}>
        Muse Pool
      </span>
      {data.activeCount > 0 && (
        <span className="ml-2 px-1.5 py-0.5 rounded-full bg-yellow-400 text-black text-xs font-bold topology-router-badge">
          {data.activeCount}
        </span>
      )}
    </div>
  );
}

// Active: electric kame beam (multi-layer stroke + sparks). Idle/last/error: solid BaseEdge.
function TopologyEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  data,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const active = !!(data as { active?: boolean } | undefined)?.active;
  const stroke = style.stroke || "var(--color-border)";
  const filterId = `topo-electric-${id}`;

  if (!active) {
    return <BaseEdge id={id} path={edgePath} style={{ ...style, stroke }} />;
  }

  return (
    <g className="topology-edge-electric">
      <defs>
        <filter id={filterId} x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={2} result="noise">
            <animate attributeName="baseFrequency" values="0.8;1.4;0.8" dur="0.25s" repeatCount="indefinite" />
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={3.5} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
      {/* Outer electric halo */}
      <path
        d={edgePath}
        fill="none"
        stroke="#22d3ee"
        strokeWidth={10}
        strokeOpacity={0.35}
        strokeLinecap="round"
        filter={`url(#${filterId})`}
        className="topology-edge-halo"
      />
      {/* Mid plasma */}
      <path
        d={edgePath}
        fill="none"
        stroke="#4ade80"
        strokeWidth={5}
        strokeOpacity={0.85}
        strokeLinecap="round"
        filter={`url(#${filterId})`}
        className="topology-edge-plasma"
      />
      {/* Hot white core */}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: "#f8fafc", strokeWidth: 2.2, opacity: 1 }}
        className="topology-edge-kame"
      />
      {/* Energy orbs */}
      {Array.from({ length: KAME_PARTICLE_COUNT }, (_, i) => (
        <circle
          key={`${id}-p-${i}`}
          r={i % 2 === 0 ? 4 : 2.5}
          fill={i % 3 === 0 ? "#fde047" : i % 3 === 1 ? "#67e8f9" : "#fff"}
          opacity={0.95}
          style={{ filter: "drop-shadow(0 0 4px #22d3ee)" }}
        >
          <animateMotion
            dur={`${0.4 + i * 0.08}s`}
            repeatCount="indefinite"
            path={edgePath}
            begin={`${i * 0.09}s`}
          />
        </circle>
      ))}
      {/* Electric sparks (short-lived blink along path) */}
      {Array.from({ length: SPARK_COUNT }, (_, i) => (
        <circle
          key={`${id}-s-${i}`}
          r={1.8}
          fill="#e0f2fe"
          opacity={0}
        >
          <animate
            attributeName="opacity"
            values="0;1;0;0;1;0"
            dur={`${0.35 + (i % 3) * 0.1}s`}
            begin={`${i * 0.07}s`}
            repeatCount="indefinite"
          />
          <animateMotion
            dur={`${0.28 + i * 0.05}s`}
            repeatCount="indefinite"
            path={edgePath}
            begin={`${i * 0.11}s`}
          />
        </circle>
      ))}
    </g>
  );
}

const nodeTypes = { provider: ProviderNode, router: RouterNode };
const edgeTypes = { topology: TopologyEdge };

// Place N nodes evenly along an ellipse around the router center.
function buildLayout(
  accounts: TopologyAccount[],
  activeSet: Set<string>,
  lastSet: Set<string>,
  errorSet: Set<string>
) {
  const nodeW = 180;
  const nodeH = 30;
  const routerW = 140;
  const routerH = 44;
  const nodeGap = 24;

  const count = accounts.length;

  // Compute rx so arc spacing between nodes >= nodeW + nodeGap
  const minRx = ((nodeW + nodeGap) * count) / (2 * Math.PI);
  const rx = Math.max(320, minRx);
  const ry = Math.max(200, rx * 0.55); // ellipse ratio ~0.55
  if (count === 0) {
    return {
      nodes: [{ id: "router", type: "router", position: { x: 0, y: 0 }, data: { activeCount: 0 }, draggable: false }] as Node[],
      edges: [] as Edge[],
    };
  }

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: "router",
    type: "router",
    position: { x: -routerW / 2, y: -routerH / 2 },
    data: { activeCount: activeSet.size },
    draggable: false,
  });

  const edgeStyle = (active: boolean, queued: boolean, last: boolean, error: boolean) => {
    if (error) return { stroke: "#ef4444", strokeWidth: 2.5, opacity: 0.9 };
    if (active) return { stroke: "#22d3ee", strokeWidth: 3.5, opacity: 1 };
    if (queued) return { stroke: "#fbbf24", strokeWidth: 2, opacity: 0.8, strokeDasharray: "6 4" };
    if (last) return { stroke: "#f59e0b", strokeWidth: 2, opacity: 0.7 };
    return { stroke: "var(--color-border)", strokeWidth: 1, opacity: 0.3 };
  };

  accounts.forEach((a, i) => {
    const key = a.name.toLowerCase();
    const active = activeSet.has(key);
    const queued = !active && a.status === "queued";
    const last = !active && !queued && lastSet.has(key);
    const error = !active && errorSet.has(key);
    const nodeId = `account-${i}`;
    const data: ProviderNodeData = {
      label: a.label || a.name,
      color: COLORS[i % COLORS.length],
      textIcon: (a.label || a.name).slice(0, 2).toUpperCase(),
      active,
      queued,
      worker: a.worker,
      count: a.count,
      disabled: a.enabled === false,
    };

    // Distribute evenly starting from top (−π/2), clockwise
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const cx = rx * Math.cos(angle);
    const cy = ry * Math.sin(angle);

    // Pick router handle closest to the node direction
    let sourceHandle: string, targetHandle: string;
    if (Math.abs(angle + Math.PI / 2) < Math.PI / 4 || Math.abs(angle - (3 * Math.PI) / 2) < Math.PI / 4) {
      sourceHandle = "top"; targetHandle = "bottom";
    } else if (Math.abs(angle - Math.PI / 2) < Math.PI / 4) {
      sourceHandle = "bottom"; targetHandle = "top";
    } else if (cx > 0) {
      sourceHandle = "right"; targetHandle = "left";
    } else {
      sourceHandle = "left"; targetHandle = "right";
    }

    nodes.push({
      id: nodeId,
      type: "provider",
      position: { x: cx - nodeW / 2, y: cy - nodeH / 2 },
      data,
      draggable: false,
    });

    edges.push({
      id: `e-${nodeId}`,
      type: "topology",
      source: "router",
      sourceHandle,
      target: nodeId,
      targetHandle,
      animated: queued,
      data: { active },
      style: edgeStyle(active, queued, last, error),
    });
  });

  return { nodes, edges };
}

interface PoolTopologyProps {
  accounts?: TopologyAccount[];
  activeAccounts?: string[];
  lastAccount?: string;
  errorAccount?: string;
}

export default function PoolTopology({
  accounts = [],
  activeAccounts = [],
  lastAccount = "",
  errorAccount = "",
}: PoolTopologyProps) {
  const activeKey = useMemo(
    () => activeAccounts.map((a) => a.toLowerCase()).filter(Boolean).sort().join(","),
    [activeAccounts]
  );
  const lastKey = lastAccount?.toLowerCase() || "";
  const errorKey = errorAccount?.toLowerCase() || "";

  const activeSet = useMemo(() => new Set(activeKey ? activeKey.split(",") : []), [activeKey]);
  const lastSet = useMemo(() => new Set(lastKey ? [lastKey] : []), [lastKey]);
  const errorSet = useMemo(() => new Set(errorKey ? [errorKey] : []), [errorKey]);

  const { nodes, edges } = useMemo(
    () => buildLayout(accounts, activeSet, lastSet, errorSet),
    [accounts, activeSet, lastSet, errorSet]
  );

  // Stable key — only remount when account list changes
  const accountsKey = useMemo(
    () => accounts.map((a) => a.name).sort().join(","),
    [accounts]
  );

  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fitOpts = { padding: 0.2, duration: 200 };
  const onInit = useCallback((instance: ReactFlowInstance) => {
    rfInstance.current = instance;
    setTimeout(() => instance.fitView(fitOpts), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit on container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (rfInstance.current) rfInstance.current.fitView(fitOpts);
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fit when node count/layout changes
  useEffect(() => {
    if (rfInstance.current) {
      const id = setTimeout(() => rfInstance.current?.fitView(fitOpts), 50);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length]);

  return (
    <div ref={containerRef} className="h-[320px] w-full min-w-0 rounded-lg border border-border bg-bg-subtle/30 sm:h-[480px]">
      {accounts.length === 0 ? (
        <div className="h-full flex items-center justify-center text-text-muted text-sm">
          No pool accounts yet
        </div>
      ) : (
        <ReactFlow
          key={accountsKey}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={fitOpts}
          minZoom={0.1}
          maxZoom={2}
          onInit={onInit}
          proOptions={{ hideAttribution: true }}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick
          preventScrolling={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
        >
          <Controls showInteractive={false} className="react-flow-controls-custom" />
        </ReactFlow>
      )}
    </div>
  );
}
