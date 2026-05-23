"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { TopologyData } from "@/types/topology";
import LogPreview from "./LogPreview";
import { GodEyeConfig } from "./GodEyePanel";

interface ScenarioMeta { name: string; description: string; }

interface JobResult {
  status: string;
  progress: number;
  message: string;
  stats?: {
    total_lines: number;
    normal: number;
    anomaly: number;
    attacks: number;
    root_cause: number;
    propagation: number;
    symptom: number;
    output_dest?: string;
    sent_lines?: number | null;
  };
  files?: { name: string; size: number; path: string }[];
  attack_schedule?: { delta_sec: number; label: string; node_id: string; summary: string }[];
  error?: string;
}

type OutputDest = "file" | "rsyslog_udp" | "victoria_logs";

const DEST_TABS: { key: OutputDest; label: string; hint: string }[] = [
  { key: "file",          label: "📁  File",          hint: "Write .log files to a local directory" },
  { key: "rsyslog_udp",   label: "📡  rsyslog UDP",    hint: "Stream via RFC 5424 syslog over UDP" },
  { key: "victoria_logs", label: "🏔  Victoria Logs",  hint: "POST NDJSON to Victoria Logs HTTP API" },
];

const LABEL_COL: Record<string, string> = {
  ROOT_CAUSE:  "text-red-400",
  PROPAGATION: "text-yellow-300",
  SYMPTOM:     "text-cyan-300",
  NORMAL:      "text-slate-500",
};

const STAT_CARDS = [
  { key: "total_lines", label: "Total Lines",  color: "text-slate-200",  bg: "bg-slate-800" },
  { key: "normal",      label: "Normal",       color: "text-green-400",  bg: "bg-green-950/50" },
  { key: "anomaly",     label: "Anomaly",      color: "text-yellow-400", bg: "bg-yellow-950/50" },
  { key: "attacks",     label: "Root Causes",  color: "text-red-400",    bg: "bg-red-950/50" },
] as const;

interface Props {
  open: boolean;
  onClose: () => void;
  topology: TopologyData;
  godeyeEnabled?: boolean;
  godeyeConfig?: GodEyeConfig;
  onGodeyeJobComplete?: (jobId: string, assetCount: number) => void;
  onCleanupDone?: () => void;
}

export default function SimulationDrawer({
  open, onClose, topology,
  godeyeEnabled = false,
  godeyeConfig,
  onGodeyeJobComplete,
}: Props) {
  const [scenarios, setScenarios] = useState<Record<string, ScenarioMeta>>({});
  const [scenario, setScenario]   = useState("mysql_cascade");
  const [mixBase, setMixBase]     = useState(true);

  // ── output destination state ────────────────────────────────────────────
  const [outputDest,   setOutputDest]   = useState<OutputDest>("file");
  const [outputDir,    setOutputDir]    = useState("/tmp/logsim2_output");
  const [rsyslogHost,  setRsyslogHost]  = useState("127.0.0.1");
  const [rsyslogPort,  setRsyslogPort]  = useState(514);
  const [victoriaUrl,  setVictoriaUrl]  = useState("http://localhost:9428/insert/jsonline");

  const [jobId,   setJobId]   = useState<string | null>(null);
  const [job,     setJob]     = useState<JobResult | null>(null);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load scenario list
  useEffect(() => {
    fetch("/api/scenarios")
      .then((r) => r.json())
      .then(setScenarios)
      .catch(() => {});
  }, []);

  // Poll job status
  useEffect(() => {
    if (!jobId || !running) return;
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`/api/jobs/${jobId}`);
        const data: JobResult = await res.json();
        setJob(data);
        if (data.status === "completed" || data.status === "failed") {
          setRunning(false);
          if (pollRef.current) clearInterval(pollRef.current);
          // Notify parent of GodEye job completion (for cleanup tracking)
          if (data.status === "completed" && godeyeEnabled && jobId) {
            const assetCount =
              (topology.netNodes.length + topology.svcNodes.length) || 0;
            onGodeyeJobComplete?.(jobId, assetCount);
          }
        }
      } catch {}
    }, 800);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId, running]);

  const startSim = useCallback(async () => {
    setJob(null);
    setPreview(null);
    setRunning(true);

    const dest        = godeyeEnabled ? "godeye" : outputDest;
    const ge          = godeyeConfig;

    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topology: {
            netNodes: topology.netNodes,
            netEdges: topology.netEdges,
            svcNodes: topology.svcNodes,
            svcEdges: topology.svcEdges,
          },
          scenario,
          output_dir:        outputDir,
          mix_baseline:      mixBase,
          output_dest:       dest,
          rsyslog_host:      rsyslogHost,
          rsyslog_port:      rsyslogPort,
          victoria_logs_url: victoriaUrl,
          // GodEye fields
          ...(godeyeEnabled && ge ? {
            godeye_iam_url:          ge.iamUrl,
            godeye_email:            ge.email,
            godeye_password:         ge.password,
            godeye_inventory_url:    ge.inventoryUrl,
            godeye_vminsert_url:     ge.vminsertUrl,
            godeye_otel_url:         ge.otelUrl,
            godeye_tenant_id:        ge.tenantId,
            godeye_baseline_minutes: ge.baselineMinutes,
          } : {}),
        }),
      });
      const { job_id } = await res.json();
      setJobId(job_id);
    } catch (e) {
      setRunning(false);
      setJob({ status: "failed", progress: 0, message: String(e), error: String(e) });
    }
  }, [topology, scenario, outputDir, mixBase, outputDest, rsyslogHost, rsyslogPort,
      victoriaUrl, godeyeEnabled, godeyeConfig]);

  const fmtBytes = (b: number) =>
    b > 1_000_000 ? `${(b / 1e6).toFixed(1)} MB`
    : b > 1000    ? `${(b / 1e3).toFixed(1)} KB`
    :               `${b} B`;

  if (!open) return null;

  const inputCls =
    "w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 " +
    "text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-500";

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-30" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-[520px] max-w-[98vw] z-40
                      bg-[#111827] border-l border-slate-800
                      flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4
                        border-b border-slate-800 shrink-0">
          <h2 className="text-base font-semibold text-slate-100">Run Simulation</h2>
          <button onClick={onClose}
            className="text-slate-500 hover:text-slate-300 text-2xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* ── Scenario ────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1">Fault Scenario</label>
              <select value={scenario}
                onChange={(e) => setScenario(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2
                           text-sm text-slate-100 focus:outline-none focus:border-blue-500">
                {Object.entries(scenarios).map(([k, v]) => (
                  <option key={k} value={k}>{v.name}</option>
                ))}
              </select>
              {scenarios[scenario] && (
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                  {scenarios[scenario].description}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button onClick={() => setMixBase(!mixBase)}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0
                  ${mixBase ? "bg-blue-600" : "bg-slate-700"}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full
                                  transition-transform ${mixBase ? "translate-x-5" : ""}`} />
              </button>
              <span className="text-sm text-slate-300">Mix baseline traffic</span>
            </div>
          </section>

          {/* ── GodEye mode banner ──────────────────────────────────────── */}
          {godeyeEnabled && (
            <div className="flex items-center gap-2 bg-green-950/40 border border-green-800
                            rounded-lg px-3 py-2">
              <span className="text-green-400 text-base">👁</span>
              <div>
                <p className="text-xs font-semibold text-green-300">GodEye Mode Active</p>
                <p className="text-[11px] text-green-600">
                  Logs → OTLP :4318 · Metrics → vminsert :8480 · Hosts registered in api-inventory
                </p>
              </div>
            </div>
          )}

          {/* ── Output Destination ──────────────────────────────────────── */}
          <section className={`space-y-3 ${godeyeEnabled ? "opacity-40 pointer-events-none" : ""}`}>
            <div>
              <label className="text-xs text-slate-400 block mb-2">Output Destination</label>
              <div className="grid grid-cols-3 gap-1.5">
                {DEST_TABS.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setOutputDest(key)}
                    className={`py-2 px-1 rounded text-xs font-medium border transition-colors
                      ${outputDest === key
                        ? "bg-indigo-600 border-indigo-500 text-white"
                        : "bg-slate-900 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-1.5">
                {DEST_TABS.find((d) => d.key === outputDest)?.hint}
              </p>
            </div>

            {/* File */}
            {outputDest === "file" && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">Output Directory</label>
                <input value={outputDir} onChange={(e) => setOutputDir(e.target.value)}
                  className={inputCls} />
              </div>
            )}

            {/* rsyslog UDP */}
            {outputDest === "rsyslog_udp" && (
              <div className="grid grid-cols-[1fr_96px] gap-2">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Host</label>
                  <input value={rsyslogHost}
                    onChange={(e) => setRsyslogHost(e.target.value)}
                    placeholder="127.0.0.1"
                    className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Port</label>
                  <input type="number" value={rsyslogPort}
                    onChange={(e) => setRsyslogPort(Number(e.target.value))}
                    className={inputCls} />
                </div>
              </div>
            )}

            {/* Victoria Logs */}
            {outputDest === "victoria_logs" && (
              <div>
                <label className="text-xs text-slate-400 block mb-1">Ingest URL</label>
                <input value={victoriaUrl}
                  onChange={(e) => setVictoriaUrl(e.target.value)}
                  placeholder="http://localhost:9428/insert/jsonline"
                  className={inputCls} />
              </div>
            )}
          </section>

          {/* ── Start button ────────────────────────────────────────────── */}
          <button onClick={startSim} disabled={running}
            className={`w-full py-2.5 rounded-lg font-semibold text-sm transition-colors
                       disabled:opacity-50 disabled:cursor-not-allowed text-white
                       ${godeyeEnabled
                         ? "bg-green-700 hover:bg-green-600"
                         : "bg-blue-600 hover:bg-blue-500"}`}>
            {running
              ? "Simulating…"
              : godeyeEnabled
                ? "👁  Run GodEye Simulation"
                : "▶  Start Simulation"}
          </button>

          {/* ── Progress ────────────────────────────────────────────────── */}
          {job && (
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-slate-400">
                <span>{job.message}</span>
                <span>{Math.round(job.progress * 100)}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${job.progress * 100}%` }} />
              </div>
              {job.status === "failed" && (
                <p className="text-red-400 text-xs font-mono bg-red-950/40 rounded p-2 mt-2">
                  {job.error || job.message}
                </p>
              )}
            </div>
          )}

          {/* ── Remote-delivery banner ───────────────────────────────────── */}
          {job?.status === "completed" && job.stats?.sent_lines != null && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 border
              ${job.stats.output_dest === "godeye"
                ? "bg-green-950/60 border-green-800"
                : "bg-indigo-950/60 border-indigo-800"}`}>
              <span className="text-lg">
                {job.stats.output_dest === "godeye"       ? "👁"
                 : job.stats.output_dest === "rsyslog_udp"? "📡"
                 :                                          "🏔"}
              </span>
              <div>
                <p className={`text-xs font-semibold
                  ${job.stats.output_dest === "godeye" ? "text-green-300" : "text-indigo-200"}`}>
                  {job.stats.output_dest === "godeye"
                    ? "GodEye delivery complete — waiting for ml-sweep (≤15 min)"
                    : "Delivery successful"}
                </p>
                <p className={`text-[11px]
                  ${job.stats.output_dest === "godeye" ? "text-green-600" : "text-indigo-400"}`}>
                  {job.stats.sent_lines.toLocaleString()} log records sent
                  {job.stats.output_dest === "godeye"
                    ? ` via OTLP → ${godeyeConfig?.otelUrl ?? ""}`
                    : job.stats.output_dest === "rsyslog_udp"
                      ? ` → rsyslog udp://${rsyslogHost}:${rsyslogPort}`
                      : ` → ${victoriaUrl}`}
                </p>
              </div>
            </div>
          )}

          {/* ── Stats cards ─────────────────────────────────────────────── */}
          {job?.status === "completed" && job.stats && (
            <section>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Statistics
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {STAT_CARDS.map(({ key, label, color, bg }) => (
                  <div key={key} className={`${bg} rounded-lg p-3 border border-slate-800`}>
                    <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
                    <p className={`text-xl font-bold font-mono ${color}`}>
                      {job.stats![key as keyof typeof job.stats]?.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[
                  { key: "root_cause",  label: "Root Cause",  color: "text-red-400"    },
                  { key: "propagation", label: "Propagation", color: "text-yellow-400" },
                  { key: "symptom",     label: "Symptom",     color: "text-cyan-400"   },
                ].map(({ key, label, color }) => (
                  <div key={key} className="bg-slate-900 rounded-lg p-2 border border-slate-800 text-center">
                    <p className="text-[9px] text-slate-500">{label}</p>
                    <p className={`text-base font-bold font-mono ${color}`}>
                      {job.stats![key as keyof typeof job.stats]}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Attack schedule ─────────────────────────────────────────── */}
          {job?.attack_schedule && job.attack_schedule.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Attack Schedule
              </h3>
              <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                {job.attack_schedule.map((ev, i) => (
                  <div key={i} className="flex items-start gap-2 text-[11px] font-mono
                                          bg-slate-900 rounded px-2 py-1.5 border border-slate-800">
                    <span className="text-slate-600 w-12 shrink-0">+{ev.delta_sec.toFixed(1)}s</span>
                    <span className={`w-20 shrink-0 font-semibold ${LABEL_COL[ev.label] ?? "text-slate-400"}`}>
                      {ev.label.replace("_", " ")}
                    </span>
                    <span className="text-slate-500 truncate">{ev.summary}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── File list ───────────────────────────────────────────────── */}
          {job?.files && job.files.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Generated Files
              </h3>
              <div className="space-y-1">
                {job.files.map((f) => (
                  <button key={f.name}
                    onClick={() => setPreview(preview === f.name ? null : f.name)}
                    className={`w-full flex justify-between items-center px-3 py-2 rounded text-xs
                                border transition-colors text-left
                      ${preview === f.name
                        ? "bg-blue-950 border-blue-700 text-blue-300"
                        : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600"}`}>
                    <span className="font-mono truncate">{f.name}</span>
                    <span className="text-slate-500 shrink-0 ml-2">{fmtBytes(f.size)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Log preview panel (inline at bottom of drawer) */}
        {preview && (
          <div className="h-80 border-t border-slate-800 shrink-0">
            <LogPreview
              filename={preview}
              outputDir={outputDir}
              onClose={() => setPreview(null)}
            />
          </div>
        )}
      </div>
    </>
  );
}
