from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from scenarios import SCENARIOS
from simulate import OutputDest, SimConfig, create_job, get_job, run_simulation

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
    output_dest: str = "file"          # "file" | "rsyslog_udp" | "victoria_logs"
    rsyslog_host: str = "127.0.0.1"
    rsyslog_port: int = 514
    victoria_logs_url: str = "http://localhost:9428/insert/jsonline"


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
    )
    bg.add_task(run_simulation, job_id, config)
    return {"job_id": job_id}


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


@app.get("/health")
def health():
    return {"status": "ok"}
