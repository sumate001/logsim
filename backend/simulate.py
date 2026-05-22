import asyncio
import json
import os
import random
import string
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from topology import Topology, NetNode, NetEdge, SvcNode, SvcEdge, NodeTech, NodeRole
from scenarios import SCENARIOS
import formatters as fmt

# ---------------------------------------------------------------------------
# Config + Job state
# ---------------------------------------------------------------------------

@dataclass
class SimConfig:
    topology: Dict[str, Any]
    scenario: str
    output_dir: str = "/tmp/logsim2_output"
    mix_baseline: bool = True
    baseline_duration: float = 30.0
    seed: Optional[int] = None


@dataclass
class JobStatus:
    job_id: str
    status: str = "pending"        # pending | running | completed | failed
    progress: float = 0.0
    message: str = "Job created"
    stats: Optional[Dict] = None
    files: Optional[List[Dict]] = None
    attack_schedule: Optional[List[Dict]] = None
    error: Optional[str] = None


_jobs: Dict[str, JobStatus] = {}

# ---------------------------------------------------------------------------
# Topology parsing
# ---------------------------------------------------------------------------

def _parse_topology(data: Dict) -> Topology:
    topo = Topology()

    def safe_role(v: str) -> NodeRole:
        try:
            return NodeRole(v)
        except ValueError:
            return NodeRole.SERVER

    def safe_tech(v: str) -> NodeTech:
        try:
            return NodeTech(v)
        except ValueError:
            return NodeTech.GENERIC

    for n in data.get("netNodes", []):
        topo.net_nodes.append(NetNode(
            id=n["id"],
            label=n.get("label", ""),
            role=safe_role(n.get("role", "server")),
            tech=safe_tech(n.get("tech", "generic")),
            ip=n.get("ip", ""),
            os=n.get("os", ""),
            x=float(n.get("x", 0)),
            y=float(n.get("y", 0)),
        ))

    for e in data.get("netEdges", []):
        topo.net_edges.append(NetEdge(
            id=e["id"],
            source=e["source"],
            target=e["target"],
            protocol=e.get("protocol", "TCP"),
            port=int(e.get("port", 80)),
            critical=bool(e.get("critical", True)),
            call_rate=float(e.get("callRate", 100.0)),
        ))

    for n in data.get("svcNodes", []):
        topo.svc_nodes.append(SvcNode(
            id=n["id"],
            label=n.get("label", ""),
            tech=safe_tech(n.get("tech", "generic")),
            role=safe_role(n.get("role", "service")),
            ip=n.get("ip", ""),
            x=float(n.get("x", 0)),
            y=float(n.get("y", 0)),
        ))

    for e in data.get("svcEdges", []):
        topo.svc_edges.append(SvcEdge(
            id=e["id"],
            source=e["source"],
            target=e["target"],
            protocol=e.get("protocol", "HTTP"),
            port=int(e.get("port", 80)),
            critical=bool(e.get("critical", True)),
            call_rate=float(e.get("callRate", 100.0)),
        ))

    return topo

# ---------------------------------------------------------------------------
# Baseline traffic generator
# ---------------------------------------------------------------------------

def _make_baseline(topo: Topology, duration: float) -> List[Tuple[float, str, str, str]]:
    evts: List[Tuple[float, str, str, str]] = []
    all_nodes = list(topo.net_nodes) + list(topo.svc_nodes)

    def rand_ip():
        return f"10.0.{random.randint(0,5)}.{random.randint(1,254)}"

    for node in all_nodes:
        count = max(1, int(duration * 1.5))

        if node.tech == NodeTech.NGINX:
            for _ in range(count):
                evts.append((random.uniform(0, duration), fmt.nginx_access(
                    rand_ip(),
                    random.choice(["GET", "GET", "GET", "POST"]),
                    random.choice(["/", "/api/data", "/api/users", "/static/app.js", "/health"]),
                    random.choice([200, 200, 200, 200, 304]),
                    random.randint(200, 12000),
                ), "NORMAL", node.id))

        elif node.tech == NodeTech.HAPROXY:
            for _ in range(max(1, int(duration * 0.8))):
                evts.append((random.uniform(0, duration), fmt.haproxy_access(
                    rand_ip(), "http_front", "app_backend",
                    f"app-{random.randint(1,3):02d}",
                    200, random.randint(500, 8000), random.randint(5, 80),
                ), "NORMAL", node.id))

        elif node.tech == NodeTech.MYSQL:
            for _ in range(max(1, int(duration * 0.3))):
                evts.append((random.uniform(0, duration), fmt.mysql_error(
                    f"[Note] InnoDB: page_cleaner: 1000ms intended loop took "
                    f"{random.randint(10, 80)}ms"
                ), "NORMAL", node.id))

        elif node.tech == NodeTech.REDIS:
            for _ in range(max(1, int(duration * 0.2))):
                evts.append((random.uniform(0, duration), fmt.redis_log(
                    "INFO",
                    f"DB 0: {random.randint(10000,60000)} keys "
                    f"({random.randint(0,10)} volatile) in "
                    f"{random.randint(100000,200000)} slots HT."
                ), "NORMAL", node.id))

        elif node.tech == NodeTech.PYTHON:
            paths = ["/health", "/api/users", "/api/data", "/api/products"]
            for _ in range(count):
                evts.append((random.uniform(0, duration), fmt.python_log(
                    "INFO", "uvicorn.access",
                    f'"GET {random.choice(paths)} HTTP/1.1" 200'
                ), "NORMAL", node.id))

        elif node.tech == NodeTech.NODEJS:
            for _ in range(count):
                req_id = f"req_{random.randint(10000,99999)}"
                evts.append((random.uniform(0, duration), fmt.nodejs_log(
                    "INFO", req_id,
                    f"Processed request in {random.randint(5,80)}ms — 200 OK"
                ), "NORMAL", node.id))

        elif node.tech == NodeTech.CISCO_IOS:
            for _ in range(max(1, int(duration * 0.4))):
                evts.append((random.uniform(0, duration), fmt.cisco_ios_access(
                    f"192.168.{random.randint(0,3)}.{random.randint(1,254)}",
                    f"10.0.0.{random.randint(1,50)}",
                    random.choice(["TCP", "UDP"]),
                    random.randint(1024, 65535),
                    random.choice([80, 443, 8080, 3306, 6379]),
                ), "NORMAL", node.id))

    return evts

# ---------------------------------------------------------------------------
# Log writer
# ---------------------------------------------------------------------------

def _write_logs(
    output_dir: str,
    events: List[Tuple[float, str, str, str]],
    topo: Topology,
) -> None:
    path = Path(output_dir)
    path.mkdir(parents=True, exist_ok=True)

    # node_id → label_slug
    all_nodes: Dict[str, Any] = {n.id: n for n in topo.net_nodes}
    all_nodes.update({n.id: n for n in topo.svc_nodes})

    def slug(node_id: str) -> str:
        node = all_nodes.get(node_id)
        if node:
            lbl = (node.label or node_id).replace(" ", "_").lower()
            return f"{lbl}_{node.tech.value}"
        return node_id.replace(" ", "_").lower()

    # Group events per node
    node_events: Dict[str, List[Tuple[float, str, str]]] = {}
    for delta, line, label, node_id in events:
        node_events.setdefault(node_id, []).append((delta, line, label))

    for node_id, evts in node_events.items():
        filename = path / f"{slug(node_id)}.log"
        lines = [line for _, line, _ in sorted(evts, key=lambda x: x[0])]
        with open(filename, "w") as f:
            f.write("\n".join(lines) + "\n")

    # ground_truth.log  FORMAT: LABEL|node_id|+delta_s|first_line
    fault_events = [(d, l, lbl, nid) for d, l, lbl, nid in events if lbl != "NORMAL"]
    gt_lines = [
        f"{lbl}|{nid}|+{d:.1f}s|{l.split(chr(10))[0]}"
        for d, l, lbl, nid in sorted(fault_events, key=lambda x: x[0])
    ]
    (path / "ground_truth.log").write_text("\n".join(gt_lines) + "\n")

    # ground_truth.json
    gt_json = [
        {
            "delta_sec": d,
            "label": lbl,
            "node_id": nid,
            "line": l.split("\n")[0],
        }
        for d, l, lbl, nid in sorted(fault_events, key=lambda x: x[0])
    ]
    (path / "ground_truth.json").write_text(json.dumps(gt_json, indent=2))

# ---------------------------------------------------------------------------
# Simulation runner (async background task)
# ---------------------------------------------------------------------------

async def run_simulation(job_id: str, config: SimConfig) -> None:
    job = _jobs[job_id]
    job.status = "running"

    try:
        job.progress = 0.05
        job.message = "Parsing topology…"
        await asyncio.sleep(0)

        topo = _parse_topology(config.topology)

        if config.seed is not None:
            random.seed(config.seed)

        job.progress = 0.15
        job.message = "Running scenario…"
        await asyncio.sleep(0)

        if config.scenario not in SCENARIOS:
            raise ValueError(f"Unknown scenario: {config.scenario!r}")

        fault_events: List[Tuple[float, str, str, str]] = SCENARIOS[config.scenario]["func"](topo)

        job.progress = 0.40
        job.message = "Generating baseline traffic…"
        await asyncio.sleep(0)

        all_events = list(fault_events)
        if config.mix_baseline:
            baseline = _make_baseline(topo, config.baseline_duration)
            all_events.extend(baseline)

        all_events.sort(key=lambda x: x[0])

        job.progress = 0.65
        job.message = "Writing log files…"
        await asyncio.sleep(0)

        _write_logs(config.output_dir, all_events, topo)

        job.progress = 0.90
        job.message = "Computing statistics…"
        await asyncio.sleep(0)

        labels = [e[2] for e in all_events]
        n_normal = labels.count("NORMAL")
        n_rc = labels.count("ROOT_CAUSE")
        n_prop = labels.count("PROPAGATION")
        n_sym = labels.count("SYMPTOM")

        # Per-line count (multi-line entries count as multiple lines)
        total_lines = sum(len(e[1].split("\n")) for e in all_events)

        attack_schedule = [
            {
                "delta_sec": round(d, 2),
                "label": lbl,
                "node_id": nid,
                "summary": l.split("\n")[0][:120],
            }
            for d, l, lbl, nid in sorted(fault_events, key=lambda x: x[0])
        ]

        out = Path(config.output_dir)
        file_list = []
        if out.exists():
            for f in sorted(out.iterdir()):
                if f.is_file():
                    file_list.append({
                        "name": f.name,
                        "size": f.stat().st_size,
                        "path": str(f),
                    })

        job.status = "completed"
        job.progress = 1.0
        job.message = "Simulation complete."
        job.stats = {
            "total_lines": total_lines,
            "normal": n_normal,
            "anomaly": n_rc + n_prop + n_sym,
            "attacks": n_rc,
            "root_cause": n_rc,
            "propagation": n_prop,
            "symptom": n_sym,
        }
        job.files = file_list
        job.attack_schedule = attack_schedule

    except Exception as exc:
        import traceback
        job.status = "failed"
        job.progress = 0.0
        job.message = f"Failed: {exc}"
        job.error = traceback.format_exc()

# ---------------------------------------------------------------------------
# Job store helpers
# ---------------------------------------------------------------------------

def create_job() -> str:
    jid = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    _jobs[jid] = JobStatus(job_id=jid)
    return jid


def get_job(job_id: str) -> Optional[JobStatus]:
    return _jobs.get(job_id)
