#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/frontend"

if [ ! -d node_modules ]; then
  echo "[logsim2] Installing npm dependencies…"
  npm install
fi

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║  LogSim2 Frontend  →  :3000          ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

npm run dev
