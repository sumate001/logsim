import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LogSim2 — Topology-Aware Log Simulator",
  description: "Drag-and-drop topology builder + realistic log scenario simulator",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
