#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  logsim2 — launcher
#  Usage:
#    ./run.sh            Start both services in the foreground (Ctrl+C to stop)
#    ./run.sh --start    Start both services in the background, return the prompt
#    ./run.sh --stop     Stop the background services
#    ./run.sh --restart  Restart the background services
#    ./run.sh --status   Show whether the services are running
#    ./run.sh --logs     Tail the background service logs (Ctrl+C to stop tailing)
# ─────────────────────────────────────────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="$ROOT/.run"
LOG_DIR="$RUN_DIR/logs"
BACKEND_PID="$RUN_DIR/backend.pid"
FRONTEND_PID="$RUN_DIR/frontend.pid"

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
err()  { printf "${Y}✗${R}  %s\n" "$*" >&2; }

# ─── Dependency setup (synchronous, runs once) ───────────────────────────────
setup_deps() {
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
}

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

banner() {
  printf "\n"
  printf "  ${BOLD}╔═══════════════════════════════════════════════╗${R}\n"
  printf "  ${BOLD}║   LogSim2 — Topology-Aware Log Simulator     ║${R}\n"
  printf "  ${BOLD}╠═══════════════════════════════════════════════╣${R}\n"
  printf "  ${BOLD}║${R}  ${B}●${R} Backend API  ${DIM}→${R}  http://localhost:8071      ${BOLD}║${R}\n"
  printf "  ${BOLD}║${R}  ${B}●${R} Swagger UI   ${DIM}→${R}  http://localhost:8071/docs ${BOLD}║${R}\n"
  printf "  ${BOLD}║${R}  ${G}●${R} Frontend     ${DIM}→${R}  http://localhost:3200      ${BOLD}║${R}\n"
  printf "  ${BOLD}╚═══════════════════════════════════════════════╝${R}\n\n"
}

# ─── PID helpers ─────────────────────────────────────────────────────────────
is_running() {
  local pidfile=$1
  [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null
}

# ─── Foreground mode (default) ───────────────────────────────────────────────
run_foreground() {
  setup_deps
  free_port 8071
  free_port 3200

  cleanup() {
    printf "\n${Y}▸ logsim2${R}  Stopping all services…\n"
    kill 0 2>/dev/null
    wait 2>/dev/null
    printf "${DIM}Done.${R}\n"
    exit 0
  }
  trap cleanup INT TERM

  banner
  printf "  ${Y}Ctrl+C${R} to stop both services\n\n"

  (
    cd "$ROOT/backend"
    source .venv/bin/activate
    exec uvicorn main:app --reload --host 0.0.0.0 --port 8071 2>&1
  ) | awk -v tag="${B}[backend] ${R}" '{ print tag $0; fflush() }' &

  (
    cd "$ROOT/frontend"
    exec npm run dev 2>&1
  ) | awk -v tag="${G}[frontend]${R} " '{ print tag $0; fflush() }' &

  wait
}

# ─── Background mode (--start) ───────────────────────────────────────────────
run_start() {
  if is_running "$BACKEND_PID" || is_running "$FRONTEND_PID"; then
    warn "Services already running — use ./run.sh --restart to restart."
    cmd_status
    exit 0
  fi

  setup_deps
  free_port 8071
  free_port 3200

  mkdir -p "$LOG_DIR"

  log "Starting backend in background…"
  setsid bash -c '
    cd "'"$ROOT"'/backend"
    source .venv/bin/activate
    exec uvicorn main:app --reload --host 0.0.0.0 --port 8071
  ' >"$LOG_DIR/backend.log" 2>&1 &
  echo $! >"$BACKEND_PID"

  log "Starting frontend in background…"
  setsid bash -c '
    cd "'"$ROOT"'/frontend"
    exec npm run dev
  ' >"$LOG_DIR/frontend.log" 2>&1 &
  echo $! >"$FRONTEND_PID"

  sleep 1
  banner
  ok "Services started in background."
  printf "  ${DIM}Logs:${R}   ./run.sh --logs\n"
  printf "  ${DIM}Status:${R} ./run.sh --status\n"
  printf "  ${DIM}Stop:${R}   ./run.sh --stop\n\n"
}

# ─── Stop ────────────────────────────────────────────────────────────────────
cmd_stop() {
  local stopped=0
  for entry in "backend:$BACKEND_PID" "frontend:$FRONTEND_PID"; do
    local name=${entry%%:*}
    local pidfile=${entry#*:}
    if is_running "$pidfile"; then
      local pid; pid=$(cat "$pidfile")
      # kill the whole process group so children (uvicorn/next) die too
      kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      ok "Stopped $name (PID $pid)"
      stopped=1
    fi
    rm -f "$pidfile"
  done
  # belt-and-suspenders: free the ports
  free_port 8071
  free_port 3200
  [ "$stopped" -eq 0 ] && warn "No background services were running."
  return 0
}

# ─── Status ──────────────────────────────────────────────────────────────────
cmd_status() {
  for entry in "Backend (:8071)|$BACKEND_PID" "Frontend (:3200)|$FRONTEND_PID"; do
    local name=${entry%%|*}
    local pidfile=${entry##*|}
    if is_running "$pidfile"; then
      printf "  ${G}●${R} %-18s running ${DIM}(PID %s)${R}\n" "$name" "$(cat "$pidfile")"
    else
      printf "  ${DIM}○ %-18s stopped${R}\n" "$name"
    fi
  done
}

# ─── Logs ────────────────────────────────────────────────────────────────────
cmd_logs() {
  if [ ! -d "$LOG_DIR" ]; then
    warn "No logs yet — start the services with ./run.sh --start"
    exit 1
  fi
  log "Tailing logs (Ctrl+C to stop)…"
  tail -n 40 -f "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log"
}

# ─── Dispatch ────────────────────────────────────────────────────────────────
case "${1:-}" in
  ""|--foreground|-f) run_foreground ;;
  --start|start)      run_start ;;
  --stop|stop)        cmd_stop ;;
  --restart|restart)  cmd_stop; run_start ;;
  --status|status)    cmd_status ;;
  --logs|logs)        cmd_logs ;;
  --help|-h)
    grep '^#' "$0" | sed 's/^# \{0,1\}//' | head -n 12
    ;;
  *)
    err "Unknown option: $1"
    err "Try: ./run.sh --help"
    exit 1
    ;;
esac
