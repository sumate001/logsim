#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/backend"

# Create venv if absent
if [ ! -d .venv ]; then
  python3 -m venv .venv
  echo "[logsim2] Created virtual environment"
fi

source .venv/bin/activate
pip install -q -r requirements.txt

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║  LogSim2 Backend  →  :8071           ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

uvicorn main:app --reload --host 0.0.0.0 --port 8071
