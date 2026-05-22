"use client";
import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  TopologyNode,
  TopologyEdge,
  Selection,
  CanvasMode,
  NODE_COLOR,
  ELLIPSE_ROLES,
} from "@/types/topology";

// ─── Layout constants ───────────────────────────────────────────────────────
const NW = 120;   // node rect width
const NH = 40;    // node rect height
const ERX = 62;   // ellipse rx
const ERY = 26;   // ellipse ry

interface Props {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  onNodesChange: (nodes: TopologyNode[]) => void;
  onEdgesChange: (edges: TopologyEdge[]) => void;
  selected: Selection;
  onSelect: (s: Selection) => void;
  mode: CanvasMode;
  onModeChange: (m: CanvasMode) => void;
  /** Increment to trigger an auto-fit of all nodes into the viewport. */
  fitTrigger?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function isEllipse(role: string) {
  return ELLIPSE_ROLES.includes(role as never);
}
function cx(n: TopologyNode) { return isEllipse(n.role) ? n.x + ERX : n.x + NW / 2; }
function cy(n: TopologyNode) { return isEllipse(n.role) ? n.y + ERY : n.y + NH / 2; }

function edgePts(src: TopologyNode, tgt: TopologyNode) {
  const sx = cx(src), sy = cy(src);
  const tx = cx(tgt), ty = cy(tgt);
  const dx = tx - sx, dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const off = 30;
  return { x1: sx + (dx / len) * off, y1: sy + (dy / len) * off,
           x2: tx - (dx / len) * off, y2: ty - (dy / len) * off };
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function TopologyCanvas({
  nodes, edges, onNodesChange, onEdgesChange,
  selected, onSelect, mode, onModeChange, fitTrigger,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pan, setPan] = useState({ x: 40, y: 40 });

  // ── Auto-fit ──────────────────────────────────────────────────────────────
  // nodesRef is always current; the effect only fires when fitTrigger changes,
  // avoiding stale-closure problems and spurious re-fits during normal dragging.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    if (!fitTrigger) return;
    const ns = nodesRef.current;
    if (ns.length === 0) return;

    const svg = svgRef.current;
    const svgW = (svg?.clientWidth  || 900);
    const svgH = (svg?.clientHeight || 600);

    // Bounding box — node.x/y is always the top-left corner for both shapes
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of ns) {
      const el    = isEllipse(n.role);
      const right = el ? n.x + 2 * ERX : n.x + NW;
      const bot   = el ? n.y + 2 * ERY : n.y + NH;
      if (n.x        < x1) x1 = n.x;
      if (n.y        < y1) y1 = n.y;
      if (right      > x2) x2 = right;
      if (bot        > y2) y2 = bot;
    }

    const PAD = 80;
    const bw = x2 - x1, bh = y2 - y1;
    setPan({
      x: Math.round((svgW - bw) / 2 - x1 + (PAD * 0)),   // centered; PAD already inside
      y: Math.round((svgH - bh) / 2 - y1),
    });
  }, [fitTrigger]); // eslint-disable-line react-hooks/exhaustive-deps
  const [drag, setDrag] = useState<{ id: string; ox: number; oy: number } | null>(null);
  const [panState, setPanState] = useState<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const [edgeSrc, setEdgeSrc] = useState<string | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);

  // Convert screen → world
  const toWorld = useCallback((e: React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - pan.x, y: e.clientY - r.top - pan.y };
  }, [pan]);

  // ── Node mouse-down ──────────────────────────────────────────────────────
  const onNodeDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();

    if (mode === "add-edge") {
      if (!edgeSrc) {
        setEdgeSrc(id);
        onSelect({ type: "node", id });
      } else if (edgeSrc !== id) {
        const newEdge: TopologyEdge = {
          id: `e_${Date.now()}`,
          source: edgeSrc,
          target: id,
          protocol: "TCP",
          port: 80,
          critical: true,
          callRate: 100,
        };
        onEdgesChange([...edges, newEdge]);
        setEdgeSrc(null);
        setMouse(null);
        onModeChange("select");
        onSelect({ type: "edge", id: newEdge.id });
      }
      return;
    }

    // Drag
    const node = nodes.find((n) => n.id === id)!;
    const w = toWorld(e);
    setDrag({ id, ox: w.x - node.x, oy: w.y - node.y });
    onSelect({ type: "node", id });
  }, [mode, edgeSrc, nodes, edges, onEdgesChange, onModeChange, onSelect, toWorld]);

  // ── SVG background mouse-down ────────────────────────────────────────────
  const onSvgDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const tgt = e.target as Element;
    if (tgt.closest("[data-node]") || tgt.closest("[data-edge]")) return;

    if (mode === "add-edge" && edgeSrc) {
      setEdgeSrc(null); setMouse(null);
      return;
    }
    const r = svgRef.current!.getBoundingClientRect();
    setPanState({ sx: e.clientX - r.left, sy: e.clientY - r.top, px: pan.x, py: pan.y });
    onSelect(null);
  }, [mode, edgeSrc, pan, onSelect]);

  // ── Mouse move ───────────────────────────────────────────────────────────
  const onSvgMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (drag) {
      const w = toWorld(e);
      onNodesChange(nodes.map((n) =>
        n.id === drag.id ? { ...n, x: w.x - drag.ox, y: w.y - drag.oy } : n
      ));
    } else if (panState) {
      const r = svgRef.current!.getBoundingClientRect();
      setPan({
        x: panState.px + (e.clientX - r.left - panState.sx),
        y: panState.py + (e.clientY - r.top - panState.sy),
      });
    }
    if (mode === "add-edge" && edgeSrc) {
      setMouse(toWorld(e));
    }
  }, [drag, panState, mode, edgeSrc, nodes, onNodesChange, toWorld]);

  // ── Mouse up ─────────────────────────────────────────────────────────────
  const onSvgUp = useCallback(() => {
    setDrag(null);
    setPanState(null);
  }, []);

  // ── Edge click ───────────────────────────────────────────────────────────
  const onEdgeClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    onSelect({ type: "edge", id });
  }, [onSelect]);

  const cursor = mode === "add-edge" ? "crosshair" : panState ? "grabbing" : "default";

  return (
    <svg
      ref={svgRef}
      className="w-full h-full no-select"
      style={{ cursor, display: "block" }}
      onMouseDown={onSvgDown}
      onMouseMove={onSvgMove}
      onMouseUp={onSvgUp}
      onMouseLeave={onSvgUp}
    >
      {/* ── Defs ─────────────────────────────────────────────────────────── */}
      <defs>
        <pattern
          id="grid" width="40" height="40" patternUnits="userSpaceOnUse"
          patternTransform={`translate(${pan.x % 40},${pan.y % 40})`}
        >
          <circle cx="1" cy="1" r="1" fill="#2d3348" />
        </pattern>
        <marker id="arr-red"  markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#EF4444" />
        </marker>
        <marker id="arr-gray" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#6B7280" />
        </marker>
        <marker id="arr-amber" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0 0, 8 3, 0 6" fill="#FBBF24" />
        </marker>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* ── Background ───────────────────────────────────────────────────── */}
      <rect width="100%" height="100%" fill="#0f1117" />
      <rect width="100%" height="100%" fill="url(#grid)" />

      <g transform={`translate(${pan.x},${pan.y})`}>
        {/* ── Edges ──────────────────────────────────────────────────────── */}
        {edges.map((edge) => {
          const src = nodes.find((n) => n.id === edge.source);
          const tgt = nodes.find((n) => n.id === edge.target);
          if (!src || !tgt) return null;
          const { x1, y1, x2, y2 } = edgePts(src, tgt);
          const isSel = selected?.type === "edge" && selected.id === edge.id;
          const col = isSel ? "#FBBF24" : edge.critical ? "#EF4444" : "#6B7280";
          const marker = isSel ? "arr-amber" : edge.critical ? "arr-red" : "arr-gray";
          const dash = edge.critical ? undefined : "6 4";
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;

          return (
            <g key={edge.id} data-edge="1">
              {/* hit area */}
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke="transparent" strokeWidth={14}
                style={{ cursor: "pointer" }}
                onClick={(e) => onEdgeClick(e, edge.id)} />
              {/* visible */}
              <line x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={col} strokeWidth={isSel ? 2.5 : 1.5}
                strokeDasharray={dash}
                markerEnd={`url(#${marker})`}
                onClick={(e) => onEdgeClick(e, edge.id)}
                style={{ cursor: "pointer" }} />
              {/* label */}
              <text x={mx} y={my - 7} fill="#94A3B8" fontSize={9}
                textAnchor="middle" style={{ pointerEvents: "none" }}>
                {edge.protocol}:{edge.port}
              </text>
            </g>
          );
        })}

        {/* ── Temp edge while drawing ──────────────────────────────────── */}
        {mode === "add-edge" && edgeSrc && mouse && (() => {
          const src = nodes.find((n) => n.id === edgeSrc);
          if (!src) return null;
          return (
            <line x1={cx(src)} y1={cy(src)} x2={mouse.x} y2={mouse.y}
              stroke="#FBBF24" strokeWidth={1.5} strokeDasharray="5 4"
              style={{ pointerEvents: "none" }} />
          );
        })()}

        {/* ── Nodes ──────────────────────────────────────────────────────── */}
        {nodes.map((node) => {
          const isSel  = selected?.type === "node" && selected.id === node.id;
          const isSrc  = edgeSrc === node.id;
          const col    = NODE_COLOR[node.role] ?? "#6B7280";
          const fill   = col + "22";
          const stroke = isSel || isSrc ? "#FBBF24" : col;
          const sw     = isSel || isSrc ? 2.5 : 1.5;
          const ncx    = cx(node), ncy = cy(node);
          const el     = isEllipse(node.role);
          const cur    = mode === "add-edge" ? "crosshair" : "move";

          return (
            <g key={node.id} data-node="1"
              onMouseDown={(e) => onNodeDown(e, node.id)}
              style={{ cursor: cur }}
              filter={isSrc ? "url(#glow)" : undefined}>
              {el ? (
                <ellipse cx={ncx} cy={ncy} rx={ERX} ry={ERY}
                  fill={fill} stroke={stroke} strokeWidth={sw} />
              ) : (
                <rect x={node.x} y={node.y} width={NW} height={NH} rx={5}
                  fill={fill} stroke={stroke} strokeWidth={sw} />
              )}
              {/* Role badge */}
              <text x={ncx} y={ncy - (node.ip ? 8 : 0)}
                fill={col} fontSize={12} fontWeight="600"
                textAnchor="middle" dominantBaseline="middle"
                style={{ pointerEvents: "none" }}>
                {node.label || node.role}
              </text>
              {node.ip && (
                <text x={ncx} y={ncy + 9} fill="#64748B" fontSize={9}
                  textAnchor="middle" dominantBaseline="middle"
                  style={{ pointerEvents: "none" }}>
                  {node.ip}
                </text>
              )}
              {/* Tech tag */}
              <text x={ncx} y={el ? ncy + ERY + 12 : node.y + NH + 12}
                fill="#475569" fontSize={8}
                textAnchor="middle"
                style={{ pointerEvents: "none" }}>
                {node.tech}
              </text>
            </g>
          );
        })}

        {/* Empty-state hint */}
        {nodes.length === 0 && (
          <g style={{ pointerEvents: "none" }}>
            <text x={400} y={300} fill="#2d3348" fontSize={18} textAnchor="middle">
              Click toolbar buttons to add nodes
            </text>
            <text x={400} y={325} fill="#2d3348" fontSize={13} textAnchor="middle">
              then drag to position · select Add Edge to connect them
            </text>
          </g>
        )}
      </g>
    </svg>
  );
}
