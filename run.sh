#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  logsim2 — single-command launcher
#  Usage:  ./run.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ANSI colours
BOLD=$'\033[1m'
B=$'\033[34m'    # blue   – backend
G=$'\033[32m'    # green  – frontend
Y=$'\033[33m'    # yellow – warnings / ctrl-c hint
DIM=$'\033[2m'
R=$'\033[0m'     # reset

log()  { printf "${BOLD}▸ logsim2${R}  %s\n" "$*"; }
ok()   { printf "${G}✔${R}  %s\n" "$*"; }
warn() { printf "${Y}⚠${R}  %s\n" "$*"; }

# ─── Dependency setup (synchronous, runs once) ───────────────────────────────

log "Checking Python backend…"
cd "$ROOT/backend"

if [ ! -d .venv ]; then
  python3 -m venv .venv
  ok "Created virtual environment (.venv)"
fi

source .venv/bin/activate
pip install -q -r requirements.txt
deactivate
ok "Backend dependencies ready"

log "Checking Node.js frontend…"
cd "$ROOT/frontend"

if [ ! -d node_modules ]; then
  warn "First run — installing npm packages (may take ~30 s)…"
  npm install --silent
fi
ok "Frontend dependencies ready"

cd "$ROOT"

# ─── Free ports if already in use ────────────────────────────────────────────
free_port() {
  local port=$1
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    warn "Port $port is in use — killing existing process (PID $pids)…"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 0.4
  fi
}
free_port 8071
free_port 3200

# ─── Signal handler ──────────────────────────────────────────────────────────
cleanup() {
  printf "\n${Y}▸ logsim2${R}  Stopping all services…\n"
  # kill 0 sends SIGTERM to every process in this script's process group
  # (both background subshells + their children: uvicorn, next-server, awk)
  kill 0 2>/dev/null
  wait 2>/dev/null
  printf "${DIM}Done.${R}\n"
  exit 0
}
trap cleanup INT TERM

# ─── Banner ──────────────────────────────────────────────────────────────────
printf "\n"
printf "  ${BOLD}╔═══════════════════════════════════════════════╗${R}\n"
printf "  ${BOLD}║   LogSim2 — Topology-Aware Log Simulator     ║${R}\n"
printf "  ${BOLD}╠═══════════════════════════════════════════════╣${R}\n"
printf "  ${BOLD}║${R}  ${B}●${R} Backend API  ${DIM}→${R}  http://localhost:8071      ${BOLD}║${R}\n"
printf "  ${BOLD}║${R}  ${B}●${R} Swagger UI   ${DIM}→${R}  http://localhost:8071/docs ${BOLD}║${R}\n"
printf "  ${BOLD}║${R}  ${G}●${R} Frontend     ${DIM}→${R}  http://localhost:3200      ${BOLD}║${R}\n"
printf "  ${BOLD}╠═══════════════════════════════════════════════╣${R}\n"
printf "  ${BOLD}║${R}  ${Y}Ctrl+C${R} to stop both services               ${BOLD}║${R}\n"
printf "  ${BOLD}╚═══════════════════════════════════════════════╝${R}\n\n"

# ─── Launch backend ──────────────────────────────────────────────────────────
(
  cd "$ROOT/backend"
  source .venv/bin/activate
  exec uvicorn main:app --reload --host 0.0.0.0 --port 8071 2>&1
) | awk -v tag="${B}[backend] ${R}" '{ print tag $0; fflush() }' &

# ─── Launch frontend ─────────────────────────────────────────────────────────
(
  cd "$ROOT/frontend"
  exec npm run dev 2>&1
) | awk -v tag="${G}[frontend]${R} " '{ print tag $0; fflush() }' &

# ─── Wait for both to exit (or Ctrl+C) ───────────────────────────────────────
wait
