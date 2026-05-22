"use client";
import React, { useEffect, useRef, useState } from "react";

type Label = "ROOT_CAUSE" | "PROPAGATION" | "SYMPTOM" | "NORMAL";

interface GroundTruthEntry {
  delta_sec: number;
  label: Label;
  node_id: string;
  line: string;
}

interface Props {
  filename: string;
  outputDir: string;
  onClose: () => void;
}

const LABEL_STYLES: Record<Label, string> = {
  ROOT_CAUSE:  "text-red-400",
  PROPAGATION: "text-yellow-300",
  SYMPTOM:     "text-cyan-300",
  NORMAL:      "text-slate-500",
};

const LABEL_BADGE: Record<Label, string> = {
  ROOT_CAUSE:  "bg-red-950  text-red-400  border border-red-800",
  PROPAGATION: "bg-yellow-950 text-yellow-400 border border-yellow-800",
  SYMPTOM:     "bg-cyan-950 text-cyan-400  border border-cyan-800",
  NORMAL:      "bg-slate-800 text-slate-500 border border-slate-700",
};

export default function LogPreview({ filename, outputDir, onClose }: Props) {
  const [lines, setLines]       = useState<string[]>([]);
  const [total, setTotal]       = useState(0);
  const [labelMap, setLabelMap] = useState<Map<string, Label>>(new Map());
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams({ output_dir: outputDir, n: "200" });

    // Load log file + ground truth in parallel
    Promise.all([
      fetch(`/api/logs/${encodeURIComponent(filename)}?${params}`).then((r) => r.json()),
      fetch(`/api/logs/ground_truth.json?${new URLSearchParams({ output_dir: outputDir })}`).then((r) =>
        r.ok ? r.json() : []
      ).catch(() => []),
    ])
      .then(([logData, gt]: [{ lines: string[]; total_lines: number }, GroundTruthEntry[]]) => {
        setLines(logData.lines ?? []);
        setTotal(logData.total_lines ?? 0);

        // Build line → label map (first line of multi-line entries)
        const map = new Map<string, Label>();
        for (const entry of gt) {
          map.set(entry.line.trim(), entry.label);
        }
        setLabelMap(map);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [filename, outputDir]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ behavior: "auto" });
  }, [loading, lines]);

  const getLabel = (line: string): Label => {
    return labelMap.get(line.trim()) ?? "NORMAL";
  };

  // Count per label
  const counts = lines.reduce<Record<string, number>>((acc, l) => {
    const lbl = getLabel(l);
    acc[lbl] = (acc[lbl] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full bg-[#0a0e1a] rounded-lg overflow-hidden border border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5
                      bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-mono text-xs text-blue-400 truncate">{filename}</span>
          <span className="text-[10px] text-slate-600 shrink-0">{total} lines total</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {(["ROOT_CAUSE","PROPAGATION","SYMPTOM"] as Label[]).map((lbl) => (
            counts[lbl] ? (
              <span key={lbl} className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${LABEL_BADGE[lbl]}`}>
                {lbl.replace("_"," ")} {counts[lbl]}
              </span>
            ) : null
          ))}
          <button onClick={onClose}
            className="ml-2 text-slate-500 hover:text-slate-300 text-lg leading-none">×</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 px-4 py-1.5 bg-[#0c1120] border-b border-slate-800 shrink-0">
        {(["ROOT_CAUSE","PROPAGATION","SYMPTOM","NORMAL"] as Label[]).map((lbl) => (
          <span key={lbl} className={`text-[9px] font-mono ${LABEL_STYLES[lbl]}`}>
            ■ {lbl}
          </span>
        ))}
      </div>

      {/* Log lines */}
      <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-5 p-3 space-y-0">
        {loading && (
          <div className="text-slate-600 text-center py-10">Loading…</div>
        )}
        {error && (
          <div className="text-red-500 text-center py-10">{error}</div>
        )}
        {!loading && !error && lines.map((line, i) => {
          const lbl = getLabel(line);
          return (
            <div key={i}
              className={`whitespace-pre-wrap break-all hover:bg-slate-900/50 px-1 rounded
                          ${LABEL_STYLES[lbl]}`}>
              {lbl !== "NORMAL" && (
                <span className={`inline-block text-[8px] px-1 mr-2 rounded
                                  ${LABEL_BADGE[lbl]} font-semibold align-middle`}>
                  {lbl[0]}
                </span>
              )}
              {line}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
