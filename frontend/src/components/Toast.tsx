"use client";
import React, { useEffect, useState } from "react";

type ToastType = "success" | "error" | "info";

interface Props {
  message: string;
  subtext?: string;
  type?: ToastType;
  duration?: number;
  onDismiss: () => void;
}

const ICON: Record<ToastType, string>  = { success: "✓", error: "✕", info: "ℹ" };
const ACCENT: Record<ToastType, string> = {
  success: "text-green-400 border-green-700",
  error:   "text-red-400   border-red-700",
  info:    "text-blue-400  border-blue-700",
};

export default function Toast({
  message, subtext, type = "success", duration = 5000, onDismiss,
}: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation on next frame
    const raf = requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, duration);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [duration, onDismiss]);

  const dismiss = () => { setVisible(false); setTimeout(onDismiss, 300); };

  return (
    <div
      aria-live="polite"
      className={[
        "fixed bottom-20 left-1/2 z-[200] transition-all duration-300",
        visible
          ? "-translate-x-1/2 translate-y-0 opacity-100"
          : "-translate-x-1/2 translate-y-4 opacity-0",
      ].join(" ")}
    >
      <div className={[
        "flex items-start gap-3 px-5 py-3.5 rounded-xl shadow-2xl",
        "border bg-[#111827] backdrop-blur-sm min-w-[300px] max-w-[500px]",
        ACCENT[type],
      ].join(" ")}>
        {/* Icon */}
        <span className={`text-base mt-0.5 shrink-0 font-bold ${ACCENT[type].split(" ")[0]}`}>
          {ICON[type]}
        </span>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100 leading-snug">{message}</p>
          {subtext && (
            <p className="text-xs text-slate-400 mt-1 leading-snug font-mono">{subtext}</p>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={dismiss}
          className="text-slate-500 hover:text-slate-300 text-xl leading-none mt-0.5 shrink-0"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-slate-800 rounded-full mt-1.5 overflow-hidden mx-1">
        <div
          className={`h-full rounded-full ${ACCENT[type].split(" ")[0].replace("text-", "bg-")}`}
          style={{
            animation: visible ? `shrink ${duration}ms linear forwards` : "none",
          }}
        />
      </div>

      <style>{`
        @keyframes shrink { from { width: 100% } to { width: 0% } }
      `}</style>
    </div>
  );
}
