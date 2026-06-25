"use client";
import React, { useEffect, useState } from "react";

// ── Schema mirrors aiops AnalyzeResponse (app/models/response.py) ──
interface AnomalyScore {
  metric: string;
  score: number;
  severity: string;
}
interface TopError {
  msg: string;
  count: number;
  first_seen?: string;
  last_seen?: string;
}
interface Prediction {
  risk_level: string;
  confidence: number;
  estimated_incident_in?: string | null;
  contributing_signals?: string[];
  recommendation?: string;
  matched_fingerprint?: string | null;
}
interface Synthesis {
  root_cause_chain: string[];
  confidence: number;
  fix_steps: string[];
  method: string;
  top_frame?: string | null;
}
interface MiroFishFrame {
  frame: string;
  relevance: number;
  top_keywords?: string[];
}
interface PerplexicaSource {
  title: string;
  url: string;
}
interface Enrichment {
  query: string;
  answer: string;
  sources: PerplexicaSource[];
}
interface HostAnalysis {
  host: string;
  status: string;
  health_score: number;
  entry_count: number;
  error_count: number;
  warn_count: number;
  anomalies?: AnomalyScore[];
  top_errors?: TopError[];
  prediction?: Prediction | null;
  mirofish?: MiroFishFrame[];
  synthesis?: Synthesis | null;
  enrichment?: Enrichment | null;
}
interface AnalysisResult {
  request_id?: string | null;
  tenant_id: string;
  analyzed_at: string;
  health_score: number;
  status: string;
  summary?: string;
  hosts?: HostAnalysis[];
}

const sevColor = (s: string) =>
  ({
    critical: "text-red-400 bg-red-950/50 border-red-800",
    high: "text-orange-400 bg-orange-950/50 border-orange-800",
    medium: "text-yellow-400 bg-yellow-950/50 border-yellow-800",
    low: "text-green-400 bg-green-950/50 border-green-800",
    healthy: "text-green-400 bg-green-950/50 border-green-800",
  }[(s || "").toLowerCase()] ?? "text-slate-400 bg-slate-800/50 border-slate-700");

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{children}</p>
);

export default function AnalysisResultsPanel() {
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
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

  const fmt = (ts?: string) => {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleString("th-TH", { hour12: false });
    } catch {
      return ts;
    }
  };

  // first host's first root-cause line, for the list preview
  const preview = (r: AnalysisResult) =>
    r.hosts?.[0]?.synthesis?.root_cause_chain?.[0] ??
    r.hosts?.[0]?.top_errors?.[0]?.msg ??
    r.summary ??
    "—";

  const selected = selectedIdx != null ? results[selectedIdx] : null;

  return (
    <div className="border-b border-slate-800">
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
        <div className="flex min-h-0" style={{ height: 340 }}>
          {/* List */}
          <div className="w-64 shrink-0 border-r border-slate-800 overflow-y-auto">
            {results.length === 0 ? (
              <p className="text-xs text-slate-600 px-4 py-3">ยังไม่มี results — รอ callback...</p>
            ) : (
              results.map((r, idx) => (
                <button
                  key={r.request_id ?? `${r.analyzed_at}-${idx}`}
                  onClick={() => setSelectedIdx(idx)}
                  className={`w-full text-left px-3 py-2 border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors ${
                    selectedIdx === idx ? "bg-slate-800/60" : ""
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[10px] border rounded px-1 py-0 font-semibold ${sevColor(r.status)}`}>
                      {(r.status || "unknown").toUpperCase()}
                    </span>
                    <span className="text-[10px] text-slate-500 truncate">
                      {r.hosts?.length ?? 0} host{(r.hosts?.length ?? 0) === 1 ? "" : "s"}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">{preview(r)}</p>
                  <p className="text-[10px] text-slate-600 mt-0.5">{fmt(r.analyzed_at)}</p>
                </button>
              ))
            )}
          </div>

          {/* Detail */}
          <div className="flex-1 overflow-y-auto px-4 py-3 text-xs text-slate-300 space-y-3">
            {!selected ? (
              <p className="text-slate-600">เลือก result ทางซ้ายเพื่อดู detail</p>
            ) : (
              <>
                {/* Overall header */}
                <div className="flex items-center flex-wrap gap-2">
                  <span className={`border rounded px-1.5 py-0.5 font-semibold text-[10px] ${sevColor(selected.status)}`}>
                    {(selected.status || "unknown").toUpperCase()}
                  </span>
                  <span className="text-slate-500">{fmt(selected.analyzed_at)}</span>
                  <span className="text-slate-500">health: {(selected.health_score ?? 0).toFixed(0)}</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-500">{selected.tenant_id}</span>
                </div>

                {selected.summary && <p className="text-slate-400 leading-relaxed">{selected.summary}</p>}

                {/* Per-host */}
                {(selected.hosts ?? []).map((h) => (
                  <div key={h.host} className="border border-slate-800 rounded-lg p-2.5 space-y-2 bg-slate-900/40">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] text-slate-200">{h.host}</span>
                      <span className={`text-[10px] border rounded px-1 ${sevColor(h.status)}`}>{(h.status || "").toUpperCase()}</span>
                      <span className="text-[10px] text-slate-500">
                        {h.error_count} err / {h.entry_count} entries · health {(h.health_score ?? 0).toFixed(0)}
                      </span>
                    </div>

                    {/* Synthesis — root cause chain + fix */}
                    {h.synthesis?.root_cause_chain && h.synthesis.root_cause_chain.length > 0 && (
                      <div>
                        <SectionLabel>
                          Root Cause Chain{" "}
                          {h.synthesis.confidence != null && (
                            <span className="text-slate-600 normal-case">· conf {(h.synthesis.confidence * 100).toFixed(0)}%</span>
                          )}
                        </SectionLabel>
                        <ol className="space-y-0.5 list-decimal list-inside">
                          {h.synthesis.root_cause_chain.map((c, i) => (
                            <li key={i} className="text-slate-300 leading-relaxed">{c}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {h.synthesis?.fix_steps && h.synthesis.fix_steps.length > 0 && (
                      <div>
                        <SectionLabel>Fix Steps</SectionLabel>
                        <ul className="space-y-0.5 list-disc list-inside text-slate-400">
                          {h.synthesis.fix_steps.map((c, i) => (
                            <li key={i} className="leading-relaxed">{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Prediction */}
                    {h.prediction && (
                      <div>
                        <SectionLabel>Prediction</SectionLabel>
                        <p className="text-slate-400">
                          <span className={`border rounded px-1 text-[10px] ${sevColor(h.prediction.risk_level)}`}>
                            {h.prediction.risk_level?.toUpperCase()}
                          </span>{" "}
                          conf {(h.prediction.confidence * 100).toFixed(0)}%
                          {h.prediction.estimated_incident_in ? ` · ${h.prediction.estimated_incident_in}` : ""}
                          {h.prediction.matched_fingerprint ? ` · ${h.prediction.matched_fingerprint}` : ""}
                        </p>
                        {h.prediction.recommendation && (
                          <p className="text-slate-500 mt-0.5 leading-relaxed">{h.prediction.recommendation}</p>
                        )}
                      </div>
                    )}

                    {/* Anomalies */}
                    {h.anomalies && h.anomalies.length > 0 && (
                      <div>
                        <SectionLabel>Anomalies</SectionLabel>
                        <div className="flex flex-wrap gap-1">
                          {h.anomalies.map((a, i) => (
                            <span key={i} className={`text-[10px] border rounded px-1 ${sevColor(a.severity)}`}>
                              {a.metric} {a.score.toFixed(2)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* MiroFish frames */}
                    {h.mirofish && h.mirofish.some((f) => f.relevance > 0) && (
                      <div>
                        <SectionLabel>MiroFish Frames</SectionLabel>
                        <div className="flex flex-wrap gap-1">
                          {h.mirofish
                            .filter((f) => f.relevance > 0)
                            .sort((a, b) => b.relevance - a.relevance)
                            .map((f, i) => (
                              <span key={i} className="text-[10px] bg-slate-800 border border-slate-700 rounded px-1 text-slate-300">
                                {f.frame} {(f.relevance * 100).toFixed(0)}%
                              </span>
                            ))}
                        </div>
                      </div>
                    )}

                    {/* Top errors */}
                    {h.top_errors && h.top_errors.length > 0 && (
                      <div>
                        <SectionLabel>Top Errors</SectionLabel>
                        <ul className="space-y-0.5">
                          {h.top_errors.slice(0, 3).map((e, i) => (
                            <li key={i} className="text-slate-400 font-mono text-[10px] leading-relaxed">
                              <span className="text-slate-600">×{e.count}</span> {e.msg}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* A2 Perplexica enrichment */}
                    {h.enrichment && (
                      <div className="border-t border-slate-800 pt-2">
                        <SectionLabel>🔎 A2 External Knowledge (Perplexica)</SectionLabel>
                        <p className="text-slate-400 leading-relaxed whitespace-pre-wrap">{h.enrichment.answer}</p>
                        {h.enrichment.sources && h.enrichment.sources.length > 0 && (
                          <div className="mt-1.5 space-y-0.5">
                            {h.enrichment.sources.map((s, i) => (
                              <a
                                key={i}
                                href={s.url}
                                target="_blank"
                                rel="noreferrer"
                                className="block text-[10px] text-blue-400 hover:underline truncate"
                              >
                                [{i + 1}] {s.title || s.url}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
