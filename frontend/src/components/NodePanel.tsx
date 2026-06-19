"use client";
import React from "react";
import {
  TopologyNode, TopologyEdge, Selection,
  NodeRole, NodeTech,
} from "@/types/topology";

const ROLES: NodeRole[]  = ["router","firewall","server","db","client","service","lb","cache"];
const TECHS: NodeTech[]  = ["cisco_ios","nginx","haproxy","python","nodejs","mysql","redis","linux","generic"];
const PROTOS = ["TCP","UDP","HTTP","HTTPS","gRPC","WebSocket","ICMP"];

interface Props {
  selected: Selection;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  onNodesChange: (n: TopologyNode[]) => void;
  onEdgesChange: (e: TopologyEdge[]) => void;
  onDeselect: () => void;
}

const label = (s: string) => (
  <label className="block text-xs text-slate-400 mb-1 mt-3">{s}</label>
);
const input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5
               text-sm text-slate-100 focus:outline-none focus:border-blue-500
               placeholder:text-slate-600"
  />
);
const Sel = ({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { children?: React.ReactNode }) => (
  <select
    {...props}
    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5
               text-sm text-slate-100 focus:outline-none focus:border-blue-500">
    {children}
  </select>
);

export default function NodePanel({
  selected, nodes, edges, onNodesChange, onEdgesChange, onDeselect,
}: Props) {
  if (!selected) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600 p-6 gap-3">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <circle cx="20" cy="20" r="18" stroke="#334155" strokeWidth="2"/>
          <circle cx="20" cy="20" r="6" fill="#334155"/>
          <line x1="20" y1="2" x2="20" y2="12" stroke="#334155" strokeWidth="2"/>
          <line x1="20" y1="28" x2="20" y2="38" stroke="#334155" strokeWidth="2"/>
          <line x1="2" y1="20" x2="12" y2="20" stroke="#334155" strokeWidth="2"/>
          <line x1="28" y1="20" x2="38" y2="20" stroke="#334155" strokeWidth="2"/>
        </svg>
        <p className="text-xs text-center">Click a node or edge<br/>to edit its properties</p>
      </div>
    );
  }

  // ── NODE ──────────────────────────────────────────────────────────────────
  if (selected.type === "node") {
    const node = nodes.find((n) => n.id === selected.id);
    if (!node) return null;

    const update = (patch: Partial<TopologyNode>) =>
      onNodesChange(nodes.map((n) => n.id === node.id ? { ...n, ...patch } : n));
    const remove = () => {
      onNodesChange(nodes.filter((n) => n.id !== node.id));
      onEdgesChange(edges.filter((e) => e.source !== node.id && e.target !== node.id));
      onDeselect();
    };

    return (
      <div className="p-4 overflow-y-auto h-full">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-200">Node Properties</h2>
          <span className="text-[10px] text-slate-500 font-mono">{node.id}</span>
        </div>

        {label("Label")}
        {input({ value: node.label, placeholder: node.role,
          onChange: (e) => update({ label: e.target.value }) })}

        {label("IP / CIDR")}
        {input({ value: node.ip, placeholder: "10.0.0.1",
          onChange: (e) => update({ ip: e.target.value }) })}

        {label("Role")}
        <Sel value={node.role} onChange={(e) => update({ role: e.target.value as NodeRole })}>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </Sel>

        {label("Technology")}
        <Sel value={node.tech} onChange={(e) => update({ tech: e.target.value as NodeTech })}>
          {TECHS.map((t) => <option key={t} value={t}>{t}</option>)}
        </Sel>

        {label("OS / Runtime")}
        {input({ value: node.os, placeholder: "Ubuntu 22.04",
          onChange: (e) => update({ os: e.target.value }) })}

        <button onClick={remove}
          className="mt-5 w-full py-1.5 rounded text-xs font-medium
                     bg-red-950 text-red-400 border border-red-800
                     hover:bg-red-900 transition-colors">
          Delete Node
        </button>
      </div>
    );
  }

  // ── EDGE ──────────────────────────────────────────────────────────────────
  const edge = edges.find((e) => e.id === selected.id);
  if (!edge) return null;

  const update = (patch: Partial<TopologyEdge>) =>
    onEdgesChange(edges.map((e) => e.id === edge.id ? { ...e, ...patch } : e));
  const remove = () => {
    onEdgesChange(edges.filter((e) => e.id !== edge.id));
    onDeselect();
  };

  const srcNode = nodes.find((n) => n.id === edge.source);
  const tgtNode = nodes.find((n) => n.id === edge.target);

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-200">Edge Properties</h2>
        <span className="text-[10px] text-slate-500 font-mono">{edge.id}</span>
      </div>

      <div className="text-xs text-slate-500 mb-3 font-mono bg-slate-900 rounded p-2">
        {srcNode?.label || edge.source}
        <span className="text-slate-600"> → </span>
        {tgtNode?.label || edge.target}
      </div>

      {label("Protocol")}
      <Sel value={edge.protocol} onChange={(e) => update({ protocol: e.target.value })}>
        {PROTOS.map((p) => <option key={p} value={p}>{p}</option>)}
      </Sel>

      {label("Port")}
      {input({ type: "number", value: edge.port, min: 1, max: 65535,
        onChange: (e) => update({ port: parseInt(e.target.value) || edge.port }) })}

      {label("Critical Path")}
      <div className="flex gap-3 mt-1">
        {[true, false].map((v) => (
          <button key={String(v)} onClick={() => update({ critical: v })}
            className={`flex-1 py-1.5 rounded text-xs font-medium border transition-colors
              ${edge.critical === v
                ? v ? "bg-red-950 border-red-700 text-red-300"
                    : "bg-slate-700 border-slate-600 text-slate-200"
                : "bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-500"}`}>
            {v ? "Critical" : "Non-critical"}
          </button>
        ))}
      </div>

      {label("Call Rate (req/s)")}
      {input({ type: "number", value: edge.callRate, min: 0,
        onChange: (e) => update({ callRate: parseFloat(e.target.value) || edge.callRate }) })}

      <button onClick={remove}
        className="mt-5 w-full py-1.5 rounded text-xs font-medium
                   bg-red-950 text-red-400 border border-red-800
                   hover:bg-red-900 transition-colors">
        Delete Edge
      </button>
    </div>
  );
}

