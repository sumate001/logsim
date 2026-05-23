"""
OTLP HTTP log sender → OTEL Collector :4318/v1/logs

Sends log events in OTLP JSON format. The OTEL Collector's
otlp_to_canonical transform processor will:
  resource.host.name  → host
  resource.service.name → service
  severity_number/severity_text passthrough
→ stored in VictoriaLogs with GodEye canonical schema.
"""
import json
import time
import urllib.error as _err
import urllib.request as _req
from typing import Any, Dict, List, Optional, Tuple

# fault label → (OTEL severity_number, severity_text)
_SEVERITY: Dict[str, Tuple[int, str]] = {
    "ROOT_CAUSE":  (17, "ERROR"),
    "PROPAGATION": (13, "WARN"),
    "SYMPTOM":     (9,  "INFO"),
    "NORMAL":      (9,  "INFO"),
}

# NodeTech.value → OTEL service.name
_TECH_SERVICE: Dict[str, str] = {
    "postgres":  "postgres",
    "mysql":     "mysql",
    "mongodb":   "mongodb",
    "redis":     "redis",
    "nginx":     "nginx",
    "haproxy":   "haproxy",
    "python":    "python-app",
    "nodejs":    "node-app",
    "cisco_ios": "cisco-ios",
    "linux":     "syslog",
    "generic":   "app",
}


def _otlp_attr(key: str, value: str) -> Dict:
    return {"key": key, "value": {"stringValue": value}}


def _otlp_attr_int(key: str, value: int) -> Dict:
    return {"key": key, "value": {"intValue": str(value)}}


def send_logs(
    events: List[Tuple[float, str, str, str]],
    nodes_map: Dict[str, Any],
    otel_url: str,
    tenant_id: str = "internal",
    base_ts_ns: Optional[int] = None,
) -> Tuple[int, Optional[str]]:
    """
    Send events to OTEL Collector via OTLP HTTP JSON (/v1/logs).

    events: list of (delta_sec, log_line, label, node_id)
    nodes_map: {node_id: node_object} with .label and .tech attributes
    Returns (records_sent, error_or_None)
    """
    if base_ts_ns is None:
        base_ts_ns = int(time.time() * 1e9)

    # Group records by (hostname, service) to build resourceLogs batches
    # key: (hostname, service_name) → list of log record dicts
    batches: Dict[Tuple[str, str], List[Dict]] = {}

    for delta, line, label, node_id in events:
        node = nodes_map.get(node_id)
        hostname = (node.label if node else node_id).replace(" ", "-").lower()
        tech_val = node.tech.value if node else "generic"
        service_name = _TECH_SERVICE.get(tech_val, tech_val)
        sev_num, sev_text = _SEVERITY.get(label, (9, "INFO"))

        ts_ns = base_ts_ns + int(delta * 1e9)

        for sub in line.split("\n"):
            sub = sub.strip()
            if not sub:
                continue

            record = {
                "timeUnixNano": str(ts_ns),
                "severityNumber": sev_num,
                "severityText": sev_text,
                "body": {"stringValue": sub},
                "attributes": [
                    _otlp_attr("sim_label", label),
                    _otlp_attr("data_source_agent", "logsim2"),
                ],
            }
            key = (hostname, service_name)
            batches.setdefault(key, []).append(record)

    if not batches:
        return 0, None

    # Build OTLP payload
    resource_logs = []
    for (hostname, service_name), records in batches.items():
        resource_logs.append({
            "resource": {
                "attributes": [
                    _otlp_attr("host.name",     hostname),
                    _otlp_attr("service.name",  service_name),
                    _otlp_attr("tenant_id",     tenant_id),
                ]
            },
            "scopeLogs": [{
                "scope": {"name": "logsim2", "version": "2.0"},
                "logRecords": records,
            }],
        })

    payload = json.dumps({"resourceLogs": resource_logs}).encode("utf-8")
    url = otel_url.rstrip("/") + "/v1/logs"
    req = _req.Request(
        url, data=payload, method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with _req.urlopen(req, timeout=30) as _:
            total = sum(len(r) for r in batches.values())
            return total, None
    except _err.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        return 0, f"HTTP {exc.code}: {body}"
    except Exception as exc:
        return 0, str(exc)
