"use client";
import React, { useEffect, useState } from "react";

interface AnalysisResult {
  id: string;
  tenant_id: string;
  timestamp: string;
  summary?: string;
  aa_synthesis?: {
    root_cause_chain?: string[];
    confidence?: number;
    severity?: string;
  };
  hosts?: Record<string, unknown>;
}

export default function AnalysisResultsPanel() {
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [selected, setSelected] = useState<AnalysisResult | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const load = () =>
      fetch("/api/analysis-results")
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [open]);

  const fmt = (ts: string) => {
    try { return new Date(ts).toLocaleString("th-TH", { hour12: false }); }
    catch { return ts; }
  };

  const severity = (r: AnalysisResult) => r.aa_synthesis?.severity ?? "unknown";
  const sevColor = (s: string) => ({
    critical: "text-red-400 bg-red-950/50 border-red-800",
    high:     "text-orange-400 bg-orange-950/50 border-orange-800",
    medium:   "text-yellow-400 bg-yellow-950/50 border-yellow-800",
    low:      "text-green-400 bg-green-950/50 border-green-800",
  }[s.toLowerCase()] ?? "text-slate-400 bg-slate-800/50 border-slate-700");

  return (
    <div className="border-b border-slate-800">
      {/* Header toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-slate-800/30 transition-colors"
      >
        <span className="text-purple-400 text-xs">●</span>
        <span className="text-sm font-semibold text-slate-300">Analysis Results</span>
        {results.length > 0 && (
          <span className="ml-1 text-[10px] bg-purple-900/60 border border-purple-700 text-purple-300 rounded-full px-1.5 py-0.5">
            {results.length}
          </span>
        )}
        <span className="ml-auto text-slate-600 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="flex min-h-0" style={{ height: 220 }}>
          {/* List */}
          <div className="w-64 shrink-0 border-r border-slate-800 overflow-y-auto">
            {results.length === 0 ? (
              <p className="text-xs text-slate-600 px-4 py-3">ยังไม่มี results — รอ callback...</p>
            ) : results.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelected(r)}
                className={`w-full text-left px-3 py-2 border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors ${selected?.id === r.id ? "bg-slate-800/60" : ""}`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className={`text-[10px] border rounded px-1 py-0 font-semibold ${sevColor(severity(r))}`}>
                    {severity(r).toUpperCase()}
                  </span>
                  <span className="text-[10px] text-slate-500 truncate">{r.tenant_id}</span>
                </div>
                <p className="text-[11px] text-slate-400 truncate">
                  {r.aa_synthesis?.root_cause_chain?.[0] ?? r.summary ?? "—"}
                </p>
                <p className="text-[10px] text-slate-600 mt-0.5">{fmt(r.timestamp)}</p>
              </button>
            ))}
          </div>

          {/* Detail */}
          <div className="flex-1 overflow-y-auto px-4 py-3 text-xs text-slate-300 space-y-2">
            {!selected ? (
              <p className="text-slate-600">เลือก result ทางซ้ายเพื่อดู detail</p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className={`border rounded px-1.5 py-0.5 font-semibold text-[10px] ${sevColor(severity(selected))}`}>
                    {severity(selected).toUpperCase()}
                  </span>
                  <span className="text-slate-500">{fmt(selected.timestamp)}</span>
                  {selected.aa_synthesis?.confidence != null && (
                    <span className="text-slate-500">conf: {(selected.aa_synthesis.confidence * 100).toFixed(0)}%</span>
                  )}
                </div>

                {selected.aa_synthesis?.root_cause_chain && selected.aa_synthesis.root_cause_chain.length > 0 && (
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Root Cause Chain</p>
                    <ol className="space-y-0.5 list-decimal list-inside">
                      {selected.aa_synthesis.root_cause_chain.map((c, i) => (
                        <li key={i} className="text-slate-300 leading-relaxed">{c}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {selected.hosts && Object.keys(selected.hosts).length > 0 && (
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Affected Hosts</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.keys(selected.hosts).map((h) => (
                        <span key={h} className="bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
                          {h}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selected.summary && (
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Summary</p>
                    <p className="text-slate-400 leading-relaxed">{selected.summary}</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
