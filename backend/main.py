import subprocess
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from scenarios import SCENARIOS
from simulate import (
    OutputDest, SimConfig, GodEyeConfig,
    create_job, get_job, run_simulation, stop_job,
    get_godeye_cleanup, pop_godeye_cleanup,
)
from godeye import client as ge_client

app = FastAPI(title="LogSim2 API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class SimulateRequest(BaseModel):
    topology: dict = Field(default_factory=dict)
    scenario: str = "mysql_cascade"
    output_dir: str = "/tmp/logsim2_output"
    mix_baseline: bool = True
    baseline_duration: float = 30.0
    seed: Optional[int] = None
    # ── output destination ──────────────────────────────
    output_dest: str = "file"   # "file"|"rsyslog_udp"|"victoria_logs"|"godeye"
    rsyslog_host: str = "127.0.0.1"
    rsyslog_port: int = 514
    victoria_logs_url: str = "http://localhost:9428/insert/jsonline"
    # ── GodEye integration ──────────────────────────────
    godeye_iam_url: str       = "http://localhost:3070"
    godeye_email: str         = ""
    godeye_password: str      = ""
    godeye_inventory_url: str = "http://localhost:3010"
    godeye_vminsert_url: str  = "http://localhost:8480"
    godeye_otel_url: str      = "http://localhost:4318"
    godeye_tenant_id: str     = "internal"
    godeye_baseline_minutes: int = 30
    # ── Streaming ──────────────────────────────────────
    total_duration_minutes: float = 0  # 0 = one-shot


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/scenarios")
def list_scenarios():
    return {
        k: {"name": v["name"], "description": v["description"]}
        for k, v in SCENARIOS.items()
    }


@app.post("/api/simulate")
async def start_simulation(req: SimulateRequest, bg: BackgroundTasks):
    job_id = create_job()
    try:
        dest = OutputDest(req.output_dest)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid output_dest: {req.output_dest!r}")
    godeye_cfg = None
    if dest == OutputDest.GODEYE:
        if not req.godeye_email or not req.godeye_password:
            raise HTTPException(status_code=422, detail="GodEye email and password are required")
        godeye_cfg = GodEyeConfig(
            iam_url=req.godeye_iam_url,
            email=req.godeye_email,
            password=req.godeye_password,
            inventory_url=req.godeye_inventory_url,
            vminsert_url=req.godeye_vminsert_url,
            otel_url=req.godeye_otel_url,
            tenant_id=req.godeye_tenant_id,
            baseline_minutes=req.godeye_baseline_minutes,
        )

    config = SimConfig(
        topology=req.topology,
        scenario=req.scenario,
        output_dir=req.output_dir,
        mix_baseline=req.mix_baseline,
        baseline_duration=req.baseline_duration,
        seed=req.seed,
        output_dest=dest,
        rsyslog_host=req.rsyslog_host,
        rsyslog_port=req.rsyslog_port,
        victoria_logs_url=req.victoria_logs_url,
        godeye=godeye_cfg,
        total_duration_minutes=req.total_duration_minutes,
    )
    bg.add_task(run_simulation, job_id, config)
    return {"job_id": job_id}


@app.post("/api/jobs/{job_id}/stop")
def stop_simulation(job_id: str):
    """Request a streaming simulation to stop gracefully."""
    ok = stop_job(job_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "message": "Stop requested"}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job.job_id,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "stats": job.stats,
        "files": job.files,
        "attack_schedule": job.attack_schedule,
        "error": job.error,
    }


@app.get("/api/logs")
def list_logs(output_dir: str = Query("/tmp/logsim2_output")):
    path = Path(output_dir)
    if not path.exists():
        return {"files": []}
    files = [
        {"name": f.name, "size": f.stat().st_size, "path": str(f)}
        for f in sorted(path.iterdir())
        if f.is_file()
    ]
    return {"files": files}


@app.get("/api/logs/{filename}")
def get_log(
    filename: str,
    output_dir: str = Query("/tmp/logsim2_output"),
    n: int = Query(100, ge=1, le=5000),
):
    path = Path(output_dir) / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    lines = path.read_text(errors="replace").splitlines()
    return {
        "filename": filename,
        "total_lines": len(lines),
        "lines": lines[-n:],
    }


@app.get("/api/godeye/check")
def godeye_check(
    iam_url: str      = "http://localhost:3070",
    inventory_url: str = "http://localhost:3010",
    vminsert_url: str  = "http://localhost:8480",
    otel_url: str      = "http://localhost:4318",
):
    """Quick reachability check for all 3 GodEye endpoints."""
    return {
        "iam":       ge_client.check_endpoint(iam_url,       "/health"),
        "inventory": ge_client.check_endpoint(inventory_url, "/health"),
        "vminsert":  ge_client.check_endpoint(vminsert_url,  "/health"),
        "otel":      ge_client.check_endpoint(otel_url,      "/"),
    }


class CleanupRequest(BaseModel):
    job_id: str
    iam_url: str      = "http://localhost:3070"
    email: str        = ""
    password: str     = ""
    inventory_url: str = "http://localhost:3010"


@app.post("/api/godeye/cleanup")
def godeye_cleanup(req: CleanupRequest):
    """Delete all fake assets registered during a simulation job."""
    entries = pop_godeye_cleanup(req.job_id)
    if not entries:
        return {"deleted": 0, "message": "No registered assets found for this job"}

    # Re-login in case original JWT expired
    try:
        jwt = ge_client.login(req.iam_url, req.email, req.password)
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Login failed: {exc}")

    deleted, errors = 0, []
    for inventory_url, _old_jwt, asset_id in entries:
        try:
            ge_client.delete_asset(inventory_url, jwt, asset_id)
            deleted += 1
        except Exception as exc:
            errors.append(f"{asset_id}: {exc}")

    return {
        "deleted": deleted,
        "errors": errors,
        "message": f"Deleted {deleted} asset(s)",
    }


@app.get("/api/godeye/pending-cleanup")
def godeye_pending(job_id: str):
    """Return how many assets are pending cleanup for a job."""
    entries = get_godeye_cleanup(job_id)
    return {"job_id": job_id, "pending": len(entries)}


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/api/update")
def update_from_github():
    """Pull latest code from GitHub and restart services if on server."""
    repo_dir = Path(__file__).parent.parent  # logsim2/

    # ── 1. git pull ──────────────────────────────────────────────────────────
    try:
        pull = subprocess.run(
            ["git", "pull", "origin", "main"],
            cwd=str(repo_dir),
            capture_output=True, text=True, timeout=60,
        )
        pull_output = pull.stdout.strip() or pull.stderr.strip()
        already_up_to_date = "Already up to date" in pull_output
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"git pull failed: {e}")

    # ── 2. On server: rebuild frontend + restart services ────────────────────
    service_file = Path("/etc/systemd/system/logsim2-frontend.service")
    restarted = False
    build_output = ""

    if service_file.exists() and not already_up_to_date:
        try:
            # rebuild Next.js
            build = subprocess.run(
                ["npm", "run", "build"],
                cwd=str(repo_dir / "frontend"),
                capture_output=True, text=True, timeout=300,
            )
            build_output = "build ok" if build.returncode == 0 else build.stderr[-500:]

            # restart both services
            subprocess.run(
                ["sudo", "systemctl", "restart", "logsim2-frontend", "logsim2-backend"],
                capture_output=True, timeout=30,
            )
            restarted = True
        except Exception as e:
            build_output = f"restart error: {e}"

    # ── 3. Get current commit ────────────────────────────────────────────────
    try:
        rev = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(repo_dir), capture_output=True, text=True,
        )
        commit = rev.stdout.strip()
    except Exception:
        commit = "unknown"

    return {
        "pull":      pull_output,
        "commit":    commit,
        "restarted": restarted,
        "build":     build_output or None,
    }
