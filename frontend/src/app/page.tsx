"use client";
import React, { useCallback, useRef, useState } from "react";
import TopologyCanvas from "@/components/TopologyCanvas";
import NodePanel from "@/components/NodePanel";
import SimulationDrawer from "@/components/SimulationDrawer";
import Toast from "@/components/Toast";
import {
  TopologyData, TopologyNode, TopologyEdge,
  NodeRole, NodeTech,
  Selection, CanvasMode,
  TOOLBAR_NODES, ROLE_DEFAULT_TECH, NODE_COLOR,
  ELLIPSE_ROLES,
} from "@/types/topology";

// ─── Default topology ────────────────────────────────────────────────────────
const DEFAULT: TopologyData = {
  netNodes: [
    { id: "fw1",  label: "Firewall",     role: "firewall", tech: "cisco_ios", ip: "10.0.0.1",  os: "Cisco IOS", x: 340, y: 60  },
    { id: "lb1",  label: "Load Balancer",role: "lb",       tech: "haproxy",  ip: "10.0.0.10", os: "Ubuntu 22", x: 340, y: 160 },
    { id: "web1", label: "Web Server",   role: "server",   tech: "nginx",    ip: "10.0.1.11", os: "Ubuntu 22", x: 160, y: 280 },
    { id: "web2", label: "App Server",   role: "service",  tech: "python",   ip: "10.0.1.12", os: "Ubuntu 22", x: 520, y: 280 },
    { id: "db1",  label: "MySQL DB",     role: "db",       tech: "mysql",    ip: "10.0.2.20", os: "Ubuntu 22", x: 260, y: 420 },
    { id: "red1", label: "Redis Cache",  role: "cache",    tech: "redis",    ip: "10.0.2.21", os: "Ubuntu 22", x: 460, y: 420 },
    { id: "cli1", label: "Client",       role: "client",   tech: "generic",  ip: "0.0.0.0/0", os: "",          x: 340, y: -60 },
  ],
  netEdges: [
    { id: "ne1", source: "cli1", target: "fw1",  protocol: "HTTPS", port: 443,  critical: true,  callRate: 500 },
    { id: "ne2", source: "fw1",  target: "lb1",  protocol: "HTTPS", port: 443,  critical: true,  callRate: 490 },
    { id: "ne3", source: "lb1",  target: "web1", protocol: "HTTP",  port: 80,   critical: true,  callRate: 245 },
    { id: "ne4", source: "lb1",  target: "web2", protocol: "HTTP",  port: 8000, critical: true,  callRate: 245 },
    { id: "ne5", source: "web1", target: "db1",  protocol: "TCP",   port: 3306, critical: true,  callRate: 120 },
    { id: "ne6", source: "web2", target: "db1",  protocol: "TCP",   port: 3306, critical: true,  callRate: 120 },
    { id: "ne7", source: "web1", target: "red1", protocol: "TCP",   port: 6379, critical: false, callRate: 300 },
    { id: "ne8", source: "web2", target: "red1", protocol: "TCP",   port: 6379, critical: false, callRate: 300 },
  ],
  svcNodes: [
    { id: "svc_lb",    label: "haproxy",  role: "lb",      tech: "haproxy", ip: "10.0.0.10", os: "", x: 340, y: 60  },
    { id: "svc_api",   label: "api",      role: "service", tech: "python",  ip: "10.0.1.12", os: "", x: 340, y: 180 },
    { id: "svc_auth",  label: "auth-svc", role: "service", tech: "nodejs",  ip: "10.0.1.13", os: "", x: 160, y: 300 },
    { id: "svc_db",    label: "mysql",    role: "db",      tech: "mysql",   ip: "10.0.2.20", os: "", x: 260, y: 420 },
    { id: "svc_cache", label: "redis",    role: "cache",   tech: "redis",   ip: "10.0.2.21", os: "", x: 460, y: 420 },
  ],
  svcEdges: [
    { id: "se1", source: "svc_lb",   target: "svc_api",   protocol: "HTTP", port: 8000, critical: true,  callRate: 490 },
    { id: "se2", source: "svc_api",  target: "svc_auth",  protocol: "HTTP", port: 3000, critical: true,  callRate: 200 },
    { id: "se3", source: "svc_api",  target: "svc_db",    protocol: "TCP",  port: 3306, critical: true,  callRate: 120 },
    { id: "se4", source: "svc_api",  target: "svc_cache", protocol: "TCP",  port: 6379, critical: false, callRate: 300 },
    { id: "se5", source: "svc_auth", target: "svc_db",    protocol: "TCP",  port: 3306, critical: true,  callRate: 50  },
  ],
};

// ─── JSON import helpers ─────────────────────────────────────────────────────

const VALID_ROLES = new Set<string>(["router","firewall","server","db","client","service","lb","cache"]);
const VALID_TECHS = new Set<string>(["cisco_ios","nginx","haproxy","python","nodejs","mysql","redis","linux","generic"]);

function coerceRole(v: unknown): NodeRole {
  return VALID_ROLES.has(String(v)) ? (v as NodeRole) : "server";
}
function coerceTech(v: unknown): NodeTech {
  return VALID_TECHS.has(String(v)) ? (v as NodeTech) : "generic";
}

/** If more than half the nodes cluster at the same point, spread them in a grid. */
function maybeAutoLayout(nodes: TopologyNode[]): TopologyNode[] {
  if (nodes.length === 0) return nodes;
  const atOrigin = nodes.filter((n) => n.x === 0 && n.y === 0).length;
  if (atOrigin < nodes.length / 2) return nodes;   // coords look intentional

  const cols = Math.max(2, Math.ceil(Math.sqrt(nodes.length)));
  return nodes.map((n, i) => ({
    ...n,
    x: (i % cols) * 200 + 80,
    y: Math.floor(i / cols) * 160 + 80,
  }));
}

function parseNodes(raw: unknown[]): TopologyNode[] {
  return raw.map((n: unknown, i) => {
    const obj = (n && typeof n === "object" ? n : {}) as Record<string, unknown>;
    return {
      id:    String(obj.id    ?? `n_import_${i}`),
      label: String(obj.label ?? obj.id ?? `node_${i}`),
      role:  coerceRole(obj.role),
      tech:  coerceTech(obj.tech),
      ip:    String(obj.ip  ?? ""),
      os:    String(obj.os  ?? ""),
      x:     typeof obj.x === "number" ? obj.x : 0,
      y:     typeof obj.y === "number" ? obj.y : 0,
    };
  });
}

function parseEdges(raw: unknown[], nodeIds: Set<string>): TopologyEdge[] {
  return (raw as Record<string, unknown>[])
    .map((e, i) => {
      // Accept both canonical names and the alternative field names used by
      // exported topologies: src/dst, proto, rate
      const source   = String(e.source   ?? e.src  ?? "");
      const target   = String(e.target   ?? e.dst  ?? "");
      const protocol = String(e.protocol ?? e.proto ?? "TCP");
      const callRate = Number(e.callRate ?? e.call_rate ?? e.rate ?? 100);

      return {
        id:       String(e.id ?? `e_import_${i}`),
        source,
        target,
        protocol,
        port:     Number(e.port ?? 80),
        critical: e.critical !== false,
        callRate,
      };
    })
    .filter((e) => e.source && e.target && nodeIds.has(e.source) && nodeIds.has(e.target));
}

interface ImportResult {
  topo: TopologyData;
  netNodes: number; netEdges: number;
  svcNodes: number; svcEdges: number;
}

function parseTopologyJSON(raw: unknown): ImportResult {
  if (!raw || typeof raw !== "object") throw new Error("JSON must be an object");
  const d = raw as Record<string, unknown>;

  const net = (d.network_topology   ?? {}) as Record<string, unknown>;
  const svc = (d.service_dependency ?? {}) as Record<string, unknown>;

  const netNodes = maybeAutoLayout(parseNodes(Array.isArray(net.nodes) ? net.nodes : []));
  const svcNodes = maybeAutoLayout(parseNodes(Array.isArray(svc.nodes) ? svc.nodes : []));

  const netNodeIds = new Set(netNodes.map((n) => n.id));
  const svcNodeIds = new Set(svcNodes.map((n) => n.id));

  const netEdges = parseEdges(Array.isArray(net.edges) ? net.edges : [], netNodeIds);
  const svcEdges = parseEdges(Array.isArray(svc.edges) ? svc.edges : [], svcNodeIds);

  return {
    topo: { netNodes, netEdges, svcNodes, svcEdges },
    netNodes: netNodes.length, netEdges: netEdges.length,
    svcNodes: svcNodes.length, svcEdges: svcEdges.length,
  };
}

// ─── Toast queue type ─────────────────────────────────────────────────────────
interface ToastItem {
  id: number;
  message: string;
  subtext?: string;
  type?: "success" | "error" | "info";
}

// ─── Component ───────────────────────────────────────────────────────────────
type Tab = "network" | "service";

export default function Home() {
  const [tab, setTab]           = useState<Tab>("network");
  const [topo, setTopo]         = useState<TopologyData>(DEFAULT);
  const [netSel, setNetSel]     = useState<Selection>(null);
  const [svcSel, setSvcSel]     = useState<Selection>(null);
  const [mode, setMode]         = useState<CanvasMode>("select");
  const [drawerOpen, setDrawer] = useState(false);
  const [toasts, setToasts]     = useState<ToastItem[]>([]);
  const [netFit, setNetFit]     = useState(0);
  const [svcFit, setSvcFit]     = useState(0);
  const fileInputRef            = useRef<HTMLInputElement>(null);
  const toastId                 = useRef(0);

  // Active-tab shortcuts
  const isNet    = tab === "network";
  const nodes    = isNet ? topo.netNodes    : topo.svcNodes;
  const edges    = isNet ? topo.netEdges    : topo.svcEdges;
  const selected = isNet ? netSel           : svcSel;
  const setSelected = isNet ? setNetSel     : setSvcSel;

  const setNodes = useCallback((ns: TopologyNode[]) =>
    setTopo((t) => isNet ? { ...t, netNodes: ns } : { ...t, svcNodes: ns }),
  [isNet]);

  const setEdges = useCallback((es: TopologyEdge[]) =>
    setTopo((t) => isNet ? { ...t, netEdges: es } : { ...t, svcEdges: es }),
  [isNet]);

  // ── Toast helpers ───────────────────────────────────────────────────────
  const pushToast = useCallback((t: Omit<ToastItem, "id">) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, ...t }]);
  }, []);

  const dismissToast = useCallback((id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id)),
  []);

  // ── Add node ────────────────────────────────────────────────────────────
  const addNode = useCallback((role: NodeRole) => {
    const id = `n_${Date.now()}`;
    const newNode: TopologyNode = {
      id, label: role, role, tech: ROLE_DEFAULT_TECH[role],
      ip: "", os: "",
      x: 150 + Math.random() * 400,
      y: 100 + Math.random() * 300,
    };
    setNodes([...nodes, newNode]);
    setSelected({ type: "node", id });
    setMode("select");
  }, [nodes, setNodes, setSelected]);

  // ── Clear ───────────────────────────────────────────────────────────────
  const clearAll = useCallback(() => {
    setNodes([]); setEdges([]); setSelected(null);
  }, [setNodes, setEdges, setSelected]);

  // ── Export JSON (uses import-compatible format) ─────────────────────────
  const exportJSON = useCallback(() => {
    const out = {
      network_topology:   { nodes: topo.netNodes, edges: topo.netEdges },
      service_dependency: { nodes: topo.svcNodes, edges: topo.svcEdges },
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "logsim2_topology.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [topo]);

  // ── Import JSON ─────────────────────────────────────────────────────────
  const openFilePicker = () => fileInputRef.current?.click();

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so the same file can be re-imported
    e.target.value = "";

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string);
        const { topo: newTopo, netNodes, netEdges, svcNodes, svcEdges } = parseTopologyJSON(raw);

        setTopo(newTopo);
        setNetSel(null);
        setSvcSel(null);
        setMode("select");

        // Fit both canvases — each reacts to its own counter
        setNetFit((v) => v + 1);
        setSvcFit((v) => v + 1);

        pushToast({
          type: "success",
          message: `Topology imported from "${file.name}"`,
          subtext:
            `Network: ${netNodes} node${netNodes !== 1 ? "s" : ""}, ` +
            `${netEdges} edge${netEdges !== 1 ? "s" : ""}` +
            `  ·  ` +
            `Service: ${svcNodes} node${svcNodes !== 1 ? "s" : ""}, ` +
            `${svcEdges} edge${svcEdges !== 1 ? "s" : ""}`,
        });
      } catch (err) {
        pushToast({
          type: "error",
          message: "Import failed",
          subtext: err instanceof Error ? err.message : String(err),
        });
      }
    };
    reader.readAsText(file);
  }, [pushToast]);

  // ── Tab switch resets edge-drawing mode ────────────────────────────────
  const switchTab = (t: Tab) => {
    setTab(t);
    if (mode === "add-edge") setMode("select");
  };

  // ── Styles ─────────────────────────────────────────────────────────────
  const tabCls = (t: Tab) =>
    `px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
      tab === t
        ? "border-blue-500 text-blue-400"
        : "border-transparent text-slate-500 hover:text-slate-300"
    }`;

  return (
    <div className="flex flex-col h-full bg-[#0f1117]">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-2
                         bg-[#111827] border-b border-slate-800 shrink-0 flex-wrap">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <span className="text-blue-500 font-bold text-lg">⬡</span>
          <span className="font-semibold text-slate-100 text-sm tracking-wide">LogSim2</span>
        </div>

        <div className="w-px h-5 bg-slate-700" />

        {/* Tabs */}
        <div className="flex gap-0.5">
          <button className={tabCls("network")} onClick={() => switchTab("network")}>
            Network Topology
          </button>
          <button className={tabCls("service")} onClick={() => switchTab("service")}>
            Service Dependency
          </button>
        </div>

        <div className="flex-1" />

        {/* Add-node buttons */}
        <div className="flex items-center gap-1">
          {TOOLBAR_NODES.map(({ label, role }) => (
            <button key={role} onClick={() => addNode(role)}
              title={`Add ${label} node`}
              style={{ borderColor: NODE_COLOR[role] + "55", color: NODE_COLOR[role] }}
              className="px-2 py-1 text-[11px] font-medium rounded border
                         bg-transparent hover:bg-white/5 transition-colors">
              + {label}
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-slate-700" />

        {/* Add-edge toggle */}
        <button
          onClick={() => setMode(mode === "add-edge" ? "select" : "add-edge")}
          className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
            mode === "add-edge"
              ? "bg-amber-600 border-amber-500 text-white"
              : "bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500"
          }`}
        >
          {mode === "add-edge" ? "⬡ Drawing Edge…" : "⬡ Add Edge"}
        </button>
      </header>

      {/* ── Canvas + Right Panel ──────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* Canvas area — two overlaid instances, inactive gets pointer-events-none */}
        <div className="flex-1 relative overflow-hidden">

          {/* Network Topology canvas */}
          <div className={`absolute inset-0 transition-opacity duration-150 ${
            isNet ? "z-10 opacity-100" : "z-0 opacity-0 pointer-events-none"
          }`}>
            <TopologyCanvas
              nodes={topo.netNodes}
              edges={topo.netEdges}
              onNodesChange={(ns) => setTopo((t) => ({ ...t, netNodes: ns }))}
              onEdgesChange={(es) => setTopo((t) => ({ ...t, netEdges: es }))}
              selected={netSel}
              onSelect={setNetSel}
              mode={isNet ? mode : "select"}
              onModeChange={setMode}
              fitTrigger={netFit}
            />
          </div>

          {/* Service Dependency canvas */}
          <div className={`absolute inset-0 transition-opacity duration-150 ${
            !isNet ? "z-10 opacity-100" : "z-0 opacity-0 pointer-events-none"
          }`}>
            <TopologyCanvas
              nodes={topo.svcNodes}
              edges={topo.svcEdges}
              onNodesChange={(ns) => setTopo((t) => ({ ...t, svcNodes: ns }))}
              onEdgesChange={(es) => setTopo((t) => ({ ...t, svcEdges: es }))}
              selected={svcSel}
              onSelect={setSvcSel}
              mode={!isNet ? mode : "select"}
              onModeChange={setMode}
              fitTrigger={svcFit}
            />
          </div>

          {/* Mode pill overlay */}
          {mode === "add-edge" && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20
                            bg-amber-600/90 text-white text-xs font-medium
                            px-4 py-1.5 rounded-full shadow-lg pointer-events-none">
              Click source node → then destination node · Click canvas to cancel
            </div>
          )}
        </div>

        {/* Right properties panel */}
        <div className="w-64 shrink-0 bg-[#111827] border-l border-slate-800 overflow-y-auto z-10">
          <NodePanel
            selected={selected}
            nodes={nodes}
            edges={edges}
            onNodesChange={setNodes}
            onEdgesChange={setEdges}
            onDeselect={() => setSelected(null)}
          />
        </div>
      </div>

      {/* ── Bottom Toolbar ────────────────────────────────────────────────── */}
      <footer className="flex items-center gap-2 px-5 py-3
                         bg-[#111827] border-t border-slate-800 shrink-0">
        <span className="text-xs text-slate-600">
          {nodes.length} nodes · {edges.length} edges
        </span>

        <div className="flex-1" />

        <button onClick={clearAll}
          className="px-3.5 py-1.5 text-xs font-medium rounded border
                     border-slate-700 text-slate-400 hover:text-slate-200
                     hover:border-slate-500 transition-colors">
          Clear
        </button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={handleFileChange}
        />

        <button onClick={openFilePicker}
          className="px-3.5 py-1.5 text-xs font-medium rounded border
                     border-blue-800 text-blue-400 hover:text-blue-300
                     hover:border-blue-600 bg-blue-950/30 transition-colors
                     flex items-center gap-1.5">
          {/* Upload icon */}
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
            <path d="M6 1v7M3 4l3-3 3 3M1 10h10" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Import Topology
        </button>

        <button onClick={exportJSON}
          className="px-3.5 py-1.5 text-xs font-medium rounded border
                     border-slate-700 text-slate-400 hover:text-slate-200
                     hover:border-slate-500 transition-colors">
          Export JSON
        </button>

        <button onClick={() => setDrawer(true)}
          className="px-5 py-1.5 text-xs font-semibold rounded
                     bg-blue-600 hover:bg-blue-500 text-white transition-colors">
          ▶ Run Simulation
        </button>
      </footer>

      {/* ── Simulation Drawer ─────────────────────────────────────────────── */}
      <SimulationDrawer
        open={drawerOpen}
        onClose={() => setDrawer(false)}
        topology={topo}
      />

      {/* ── Toast stack ───────────────────────────────────────────────────── */}
      {toasts.map((t) => (
        <Toast
          key={t.id}
          message={t.message}
          subtext={t.subtext}
          type={t.type}
          onDismiss={() => dismissToast(t.id)}
        />
      ))}
    </div>
  );
}
