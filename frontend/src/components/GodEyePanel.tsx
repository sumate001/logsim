"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";

export interface GodEyeConfig {
  iamUrl: string;
  email: string;
  password: string;
  inventoryUrl: string;
  vminsertUrl: string;
  otelUrl: string;
  tenantId: string;
  baselineMinutes: number;
}

export const DEFAULT_GODEYE_CONFIG: GodEyeConfig = {
  iamUrl:          "http://localhost:3070",
  email:           "",
  password:        "",
  inventoryUrl:    "http://localhost:3010",
  vminsertUrl:     "http://localhost:8480",
  otelUrl:         "http://localhost:4318",
  tenantId:        "internal",
  baselineMinutes: 30,
};

type ConnStatus = "unknown" | "ok" | "err" | "checking";

interface ConnDot {
  key: "iam" | "inventory" | "vminsert" | "otel";
  label: string;
}

const CONN_DOTS: ConnDot[] = [
  { key: "iam",       label: "api-iam :3070"      },
  { key: "inventory", label: "api-inventory :3010" },
  { key: "vminsert",  label: "vminsert :8480"      },
  { key: "otel",      label: "otel-collector :4318" },
];

interface Props {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  config: GodEyeConfig;
  onChange: (c: GodEyeConfig) => void;
  pendingCleanup: number;   // asset count awaiting cleanup
  lastJobId: string | null;
}

export default function GodEyePanel({
  enabled, onToggle, config, onChange, pendingCleanup, lastJobId,
}: Props) {
  const [status, setStatus] = useState<Record<string, ConnStatus>>({
    iam: "unknown", inventory: "unknown", vminsert: "unknown", otel: "unknown",
  });
  const [checking, setChecking]     = useState(false);
  const [cleaning, setCleaning]     = useState(false);
  const [cleanMsg, setCleanMsg]     = useState<string | null>(null);
  const [showPass, setShowPass]     = useState(false);
  const checkRef = useRef(false);

  const inp = (
    "w-full bg-slate-900 border border-slate-700 rounded px-3 py-1.5 " +
    "text-sm font-mono text-slate-100 focus:outline-none focus:border-green-500"
  );

  const check = useCallback(async () => {
    if (checkRef.current) return;
    checkRef.current = true;
    setChecking(true);
    setStatus({ iam: "checking", inventory: "checking", vminsert: "checking", otel: "checking" });

    const params = new URLSearchParams({
      iam_url:       config.iamUrl,
      inventory_url: config.inventoryUrl,
      vminsert_url:  config.vminsertUrl,
      otel_url:      config.otelUrl,
    });
    try {
      const res  = await fetch(`/api/godeye/check?${params}`);
      const data = await res.json();
      setStatus({
        iam:       data.iam       ? "ok" : "err",
        inventory: data.inventory ? "ok" : "err",
        vminsert:  data.vminsert  ? "ok" : "err",
        otel:      data.otel      ? "ok" : "err",
      });
    } catch {
      setStatus({ iam: "err", inventory: "err", vminsert: "err", otel: "err" });
    } finally {
      setChecking(false);
      checkRef.current = false;
    }
  }, [config.iamUrl, config.inventoryUrl, config.vminsertUrl, config.otelUrl]);

  // Auto-check when panel opens
  useEffect(() => {
    if (enabled) check();
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const cleanup = useCallback(async () => {
    if (!lastJobId || !config.email || !config.password) return;
    setCleaning(true);
    setCleanMsg(null);
    try {
      const res = await fetch("/api/godeye/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id:        lastJobId,
          iam_url:       config.iamUrl,
          email:         config.email,
          password:      config.password,
          inventory_url: config.inventoryUrl,
        }),
      });
      const data = await res.json();
      setCleanMsg(data.message ?? "Done");
    } catch (e) {
      setCleanMsg(`Error: ${e}`);
    } finally {
      setCleaning(false);
    }
  }, [lastJobId, config]);

  const dot = (s: ConnStatus) => ({
    unknown:  "bg-slate-600",
    checking: "bg-yellow-400 animate-pulse",
    ok:       "bg-green-500",
    err:      "bg-red-500",
  }[s]);

  const set = (k: keyof GodEyeConfig, v: string | number) =>
    onChange({ ...config, [k]: v });

  return (
    <div className={`border-b border-slate-800 transition-all duration-200 ${
      enabled ? "bg-green-950/20" : "bg-transparent"}`}>

      {/* ── Header row ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2">
        {/* Toggle */}
        <button
          onClick={() => onToggle(!enabled)}
          className={`relative w-10 h-5 rounded-full transition-colors shrink-0
            ${enabled ? "bg-green-600" : "bg-slate-700"}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full
                            transition-transform ${enabled ? "translate-x-5" : ""}`} />
        </button>

        <span className={`text-sm font-semibold tracking-wide
          ${enabled ? "text-green-400" : "text-slate-500"}`}>
          GodEye Mode
        </span>

        {enabled && (
          <>
            {/* Connection dots */}
            <div className="flex items-center gap-1.5 ml-2">
              {CONN_DOTS.map(({ key, label }) => (
                <div key={key} title={label}
                  className={`w-2 h-2 rounded-full ${dot(status[key] as ConnStatus)}`} />
              ))}
            </div>

            {/* Check button */}
            <button onClick={check} disabled={checking}
              className="ml-1 text-[11px] text-slate-400 hover:text-slate-200
                         border border-slate-700 rounded px-2 py-0.5 disabled:opacity-50">
              {checking ? "checking…" : "↺ check"}
            </button>

            {/* Cleanup badge */}
            {pendingCleanup > 0 && (
              <button onClick={cleanup} disabled={cleaning}
                className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold
                           bg-red-950/60 border border-red-800 rounded px-2.5 py-1
                           text-red-300 hover:bg-red-900/60 disabled:opacity-50 shrink-0">
                🗑 {cleaning ? "cleaning…" : `Cleanup (${pendingCleanup} host${pendingCleanup > 1 ? "s" : ""})`}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Config form ─────────────────────────────────────────────────── */}
      {enabled && (
        <div className="px-4 pb-3 space-y-2.5">

          {/* Status dots legend */}
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {CONN_DOTS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <div className={`w-2 h-2 rounded-full ${dot(status[key] as ConnStatus)}`} />
                {label}
                {status[key] === "err" && <span className="text-red-400">✗</span>}
                {status[key] === "ok"  && <span className="text-green-400">✓</span>}
              </div>
            ))}
          </div>

          {cleanMsg && (
            <p className="text-[11px] text-green-400 bg-green-950/40 rounded px-2 py-1">
              {cleanMsg}
            </p>
          )}

          {/* Endpoints */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "api-iam URL",          key: "iamUrl"       as const },
              { label: "api-inventory URL",    key: "inventoryUrl" as const },
              { label: "vminsert URL",         key: "vminsertUrl"  as const },
              { label: "OTEL Collector URL",   key: "otelUrl"      as const },
            ].map(({ label, key }) => (
              <div key={key}>
                <label className="text-[10px] text-slate-500 block mb-0.5">{label}</label>
                <input value={config[key] as string}
                  onChange={(e) => set(key, e.target.value)}
                  className={inp} />
              </div>
            ))}
          </div>

          {/* Credentials */}
          <div className="grid grid-cols-[1fr_1fr_32px] gap-2 items-end">
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Email</label>
              <input value={config.email} placeholder="user@example.com"
                onChange={(e) => set("email", e.target.value)}
                className={inp} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Password</label>
              <input value={config.password}
                type={showPass ? "text" : "password"}
                placeholder="••••••••"
                onChange={(e) => set("password", e.target.value)}
                className={inp} />
            </div>
            <button onClick={() => setShowPass(!showPass)}
              className="pb-0.5 text-slate-500 hover:text-slate-300 text-base">
              {showPass ? "🙈" : "👁"}
            </button>
          </div>

          {/* tenant_id + baseline */}
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Tenant ID</label>
              <input value={config.tenantId}
                onChange={(e) => set("tenantId", e.target.value)}
                className={inp} />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 block mb-0.5">Baseline (min)</label>
              <input type="number" value={config.baselineMinutes} min={5} max={120}
                onChange={(e) => set("baselineMinutes", Number(e.target.value))}
                className={inp} />
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
