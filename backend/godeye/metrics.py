"""
Synthetic metric injector → vminsert :8480

Uses Prometheus text exposition format:
  POST /insert/0/prometheus/api/v1/import/prometheus

Injects:
  1. Baseline (normal) metrics — with PAST timestamps (30 min window)
     so the Isolation Forest on-the-fly trainer sees "normal" history.
  2. Fault metrics — at current timestamps to trigger anomaly detection.

Label schema matches GodEye processed store:
  {asset_id="<id>", tenant_id="<tid>"}
"""
import random
import time
import urllib.error as _err
import urllib.request as _req
from typing import Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Metric templates per host_type
# ---------------------------------------------------------------------------

# Each entry: (metric_name, baseline_range, fault_range)
# fault_range = None means metric doesn't spike during fault

_LINUX_METRICS: List[Tuple[str, Tuple[float, float], Optional[Tuple[float, float]]]] = [
    ("system_cpu_utilization:host_busy",     (10.0, 25.0),   (85.0, 97.0)),
    ("system_memory_utilization:host_busy",  (30.0, 50.0),   (80.0, 94.0)),
    ("system_filesystem_used:host_ratio",    (0.35, 0.55),   (0.85, 0.95)),
    ("system_cpu_load_average_1m",           (0.2,  0.8),    (4.5,  9.0)),
    ("system_cpu_context_switches_total",    (500,  2000),   (8000, 20000)),
    ("system_process_count",                 (80,   200),    (350,  600)),
    ("system_uptime_seconds",                (86400, 864000),(86400, 864000)),  # stable
    ("system_disk_io_bytes_total",           (1e6,  5e6),    (20e6, 80e6)),
    ("system_network_io_bytes_total",        (1e5,  2e6),    (5e6,  20e6)),
]

_POSTGRES_METRICS: List[Tuple[str, Tuple[float, float], Optional[Tuple[float, float]]]] = [
    ("db_connections_active",            (5.0,   20.0),  (150.0, 280.0)),
    ("db_locks_total",                   (2.0,   10.0),  (200.0, 400.0)),
    ("db_deadlocks_per_second",          (0.0,   0.02),  (0.8,   3.0)),
    ("db_cache_hit_ratio",               (0.95,  0.99),  (0.55,  0.75)),
    ("db_size_bytes",                    (1e9,   5e9),   (1e9,   5e9)),   # stable
    ("db_temp_bytes_written_per_second", (0.0,   1000),  (5e6,   20e6)),
    ("db_query_duration_max_seconds",    (0.01,  0.5),   (15.0,  120.0)),
    ("db_availability",                  (1.0,   1.0),   (1.0,   1.0)),   # stays up
]

_MONGODB_METRICS: List[Tuple[str, Tuple[float, float], Optional[Tuple[float, float]]]] = [
    ("db_connections_active",  (5.0,  30.0),  (200.0, 450.0)),
    ("db_queue_depth",         (0.0,  5.0),   (50.0,  150.0)),
    ("db_reads_per_second",    (10.0, 200.0), (800.0, 2000.0)),
    ("db_writes_per_second",   (5.0,  100.0), (400.0, 1000.0)),
    ("db_cache_hit_ratio",     (0.90, 0.99),  (0.40,  0.65)),
    ("db_errors_per_second",   (0.0,  0.1),   (5.0,   20.0)),
    ("system_memory_usage_bytes", (2e9, 8e9), (12e9, 16e9)),
    ("db_availability",        (1.0,  1.0),   (1.0,   1.0)),
]

_HOST_TYPE_METRICS: Dict[str, list] = {
    "linux":      _LINUX_METRICS,
    "postgresql": _POSTGRES_METRICS,
    "mongodb":    _MONGODB_METRICS,
}

# NodeTech.value → Isolation Forest host_type
TECH_TO_HOST_TYPE: Dict[str, str] = {
    "postgres":  "postgresql",
    "mysql":     "postgresql",   # share postgres model
    "mongodb":   "mongodb",
    "redis":     "linux",
    "nginx":     "linux",
    "haproxy":   "linux",
    "python":    "linux",
    "nodejs":    "linux",
    "cisco_ios": "linux",
    "linux":     "linux",
    "generic":   "linux",
}

# NodeTech.value → api-inventory asset class
TECH_TO_ASSET_CLASS: Dict[str, str] = {
    "postgres":  "db_postgres",
    "mysql":     "db_mysql",
    "mongodb":   "db_mongodb",
    "redis":     "db_redis",
    "nginx":     "linux",
    "haproxy":   "linux",
    "python":    "linux",
    "nodejs":    "linux",
    "cisco_ios": "linux",
    "linux":     "linux",
    "generic":   "linux",
}


# ---------------------------------------------------------------------------
# Prometheus text format helpers
# ---------------------------------------------------------------------------

def _prom_line(name: str, labels: Dict[str, str], value: float, ts_ms: int) -> str:
    label_str = ",".join(f'{k}="{v}"' for k, v in labels.items())
    return f"{name}{{{label_str}}} {value:.6g} {ts_ms}"


def _rand(lo: float, hi: float) -> float:
    return random.uniform(lo, hi)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_baseline_lines(
    asset_id: str,
    tenant_id: str,
    tech: str,
    baseline_minutes: int = 30,
    step_seconds: int = 60,
) -> List[str]:
    """
    Generate Prometheus text lines for baseline (normal) metrics.
    Uses past timestamps so the 2-hour on-the-fly Isolation Forest
    trainer sees a clean normal history before the fault window.
    """
    host_type = TECH_TO_HOST_TYPE.get(tech, "linux")
    metric_specs = _HOST_TYPE_METRICS.get(host_type, _LINUX_METRICS)
    labels = {"asset_id": asset_id, "tenant_id": tenant_id}

    now_ms = int(time.time() * 1000)
    start_ms = now_ms - baseline_minutes * 60 * 1000

    lines: List[str] = []
    ts_ms = start_ms
    while ts_ms < now_ms:
        for name, (lo, hi), _ in metric_specs:
            value = _rand(lo, hi)
            lines.append(_prom_line(name, labels, value, ts_ms))
        ts_ms += step_seconds * 1000

    return lines


def build_fault_lines(
    asset_id: str,
    tenant_id: str,
    tech: str,
    fault_points: int = 5,
    step_seconds: int = 30,
) -> List[str]:
    """
    Generate Prometheus text lines for anomalous (fault) metrics.
    Uses current + near-future timestamps to represent the spike.
    """
    host_type = TECH_TO_HOST_TYPE.get(tech, "linux")
    metric_specs = _HOST_TYPE_METRICS.get(host_type, _LINUX_METRICS)
    labels = {"asset_id": asset_id, "tenant_id": tenant_id}

    now_ms = int(time.time() * 1000)
    lines: List[str] = []

    for i in range(fault_points):
        ts_ms = now_ms + i * step_seconds * 1000
        for name, _, fault_range in metric_specs:
            if fault_range is None:
                continue
            value = _rand(*fault_range)
            lines.append(_prom_line(name, labels, value, ts_ms))

    return lines


def inject_metrics(
    vminsert_url: str,
    lines: List[str],
    account_id: int = 0,
) -> Tuple[int, Optional[str]]:
    """
    POST Prometheus text lines to vminsert.
    Endpoint: /insert/{account_id}/prometheus/api/v1/import/prometheus
    Returns (lines_sent, error_or_None).
    """
    if not lines:
        return 0, None

    body = "\n".join(lines).encode("utf-8")
    url = (
        vminsert_url.rstrip("/")
        + f"/insert/{account_id}/prometheus/api/v1/import/prometheus"
    )
    req = _req.Request(
        url, data=body, method="POST",
        headers={"Content-Type": "text/plain"},
    )
    try:
        with _req.urlopen(req, timeout=30):
            return len(lines), None
    except _err.HTTPError as exc:
        body_txt = exc.read().decode(errors="replace")
        return 0, f"HTTP {exc.code}: {body_txt}"
    except Exception as exc:
        return 0, str(exc)
