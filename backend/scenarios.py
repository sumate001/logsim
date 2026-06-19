import random
from typing import List, Tuple, Any

import formatters as fmt
from topology import Topology, NodeTech, NodeRole

# (delta_sec, log_line, label, node_id)
Event = Tuple[float, str, str, str]


def _by_tech(topo: Topology, tech: NodeTech) -> List[Any]:
    nodes = [n for n in topo.net_nodes if n.tech == tech]
    nodes += [n for n in topo.svc_nodes if n.tech == tech]
    return nodes


def _by_role(topo: Topology, role: NodeRole) -> List[Any]:
    nodes = [n for n in topo.net_nodes if n.role == role]
    nodes += [n for n in topo.svc_nodes if hasattr(n, "role") and n.role == role]
    return nodes


def _id(nodes: list, fallback: str) -> str:
    return nodes[0].id if nodes else fallback


def _label(nodes: list, fallback: str) -> str:
    return nodes[0].label if nodes else fallback


def _ip(nodes: list, fallback: str) -> str:
    return getattr(nodes[0], "ip", fallback) or fallback if nodes else fallback


# ---------------------------------------------------------------------------
# mysql_cascade: slow query → lock → pool exhaustion → 502 → LB health fail
# ---------------------------------------------------------------------------
def mysql_cascade(topo: Topology) -> List[Event]:
    evts: List[Event] = []

    mysql = _by_tech(topo, NodeTech.MYSQL)
    mysql_id = _id(mysql, "mysql_synthetic")
    mysql_host = _ip(mysql, "10.0.0.50")

    app = ([n for n in topo.svc_nodes if n.tech in (NodeTech.PYTHON, NodeTech.NODEJS)]
           or _by_role(topo, NodeRole.SERVER))
    app_id = _id(app, "app_synthetic")
    app_label = _label(app, "app-01")

    nginx = _by_tech(topo, NodeTech.NGINX)
    nginx_id = _id(nginx, "nginx_synthetic")

    lb = _by_role(topo, NodeRole.LB) or _by_tech(topo, NodeTech.HAPROXY)
    lb_id = _id(lb, "lb_synthetic")

    clients = _by_role(topo, NodeRole.CLIENT)
    client_ips = [getattr(c, "ip", f"10.0.1.{100+i}") or f"10.0.1.{100+i}"
                  for i, c in enumerate(clients[:3])] or ["10.0.1.100", "10.0.1.101"]

    # Phase 1 ROOT_CAUSE: slow queries
    for i in range(3):
        evts.append((i * 2.5, fmt.mysql_slow_query(
            host=mysql_host,
            query_time=5.0 + i * 2.5,
            lock_time=0.4 + i * 0.3,
            rows_examined=1_000_000 + i * 500_000,
        ), "ROOT_CAUSE", mysql_id))

    # Phase 2 ROOT_CAUSE: lock contention
    evts.append((8.0, fmt.mysql_error(
        "InnoDB: Deadlock found when trying to get lock; try restarting transaction"
    ), "ROOT_CAUSE", mysql_id))
    evts.append((9.5, fmt.mysql_error(
        "InnoDB: Lock wait timeout exceeded; try restarting transaction"
    ), "ROOT_CAUSE", mysql_id))

    # Phase 3 PROPAGATION: app pool exhaustion
    for i in range(3):
        evts.append((11.0 + i * 1.5, fmt.python_log(
            "ERROR", "database.pool",
            f"Connection pool timeout after 30s. Pool size: {max(0, 100 - i*35)}/100"
        ), "PROPAGATION", app_id))
    evts.append((15.5, fmt.sqlalchemy_error(), "PROPAGATION", app_id))

    # Phase 4 PROPAGATION: upstream 502s
    evts.append((16.0, fmt.nginx_upstream_timeout(f"127.0.0.1:8000"), "PROPAGATION", nginx_id))
    for i in range(4):
        evts.append((16.5 + i * 0.4, fmt.nginx_access(
            client_ips[i % len(client_ips)], "GET", "/api/data", 502, 0
        ), "PROPAGATION", nginx_id))

    # Phase 5 SYMPTOM: LB removes app
    evts.append((20.0, fmt.haproxy_server_down("app_backend", app_label, "L7STS"),
                 "SYMPTOM", lb_id))

    # Phase 6 SYMPTOM: user-facing 502s
    for i in range(5):
        evts.append((21.0 + i * 0.3, fmt.nginx_access(
            f"10.0.1.{random.randint(1, 200)}", "POST", "/api/checkout", 502, 0
        ), "SYMPTOM", nginx_id))

    # NORMAL baseline
    for _ in range(12):
        evts.append((random.uniform(0, 25), fmt.nginx_access(
            f"10.0.1.{random.randint(1, 200)}", "GET",
            random.choice(["/", "/api/products", "/api/users"]),
            200, random.randint(400, 8000)
        ), "NORMAL", nginx_id))

    evts.sort(key=lambda x: x[0])
    return evts


# ---------------------------------------------------------------------------
# oom_cascade: memory leak → OOM kill → restart loop → LB removes → overload
# ---------------------------------------------------------------------------
def oom_cascade(topo: Topology) -> List[Event]:
    evts: List[Event] = []

    py = _by_tech(topo, NodeTech.PYTHON)
    py_id = _id(py, "python_synthetic")
    py_host = _ip(py, "app-server-01")
    py_label = _label(py, "api-service")

    lb = _by_role(topo, NodeRole.LB) or _by_tech(topo, NodeTech.HAPROXY)
    lb_id = _id(lb, "lb_synthetic")

    nginx = _by_tech(topo, NodeTech.NGINX)
    nginx_id = _id(nginx, "nginx_synthetic")

    # Phase 1 ROOT_CAUSE: memory leak building
    for i in range(5):
        evts.append((i * 4.5, fmt.python_log(
            "WARNING", "memory_tracker",
            f"RSS memory: {700 + i * 160}MB / 1536MB limit"
        ), "ROOT_CAUSE", py_id))

    # Phase 2 ROOT_CAUSE: OOM kill
    evts.append((23.0, fmt.linux_oom_kill(py_host, "python",
                                           random.randint(10000, 99999)), "ROOT_CAUSE", py_id))
    evts.append((23.1, fmt.uvicorn_shutdown(), "ROOT_CAUSE", py_id))

    # Phase 3 PROPAGATION: restart loop ×3
    for i in range(3):
        base = 24.0 + i * 5.0
        evts.append((base, fmt.linux_systemd_restart(py_host, py_label), "PROPAGATION", py_id))
        evts.append((base + 0.5, fmt.uvicorn_startup(), "PROPAGATION", py_id))
        evts.append((base + 3.8, fmt.linux_oom_kill(py_host, "python",
                                                      random.randint(10000, 99999)),
                     "ROOT_CAUSE", py_id))

    # Phase 4 SYMPTOM: LB removes server
    evts.append((27.0, fmt.haproxy_server_down("app_backend", py_label, "L4TOUT"),
                 "SYMPTOM", lb_id))

    # Phase 5 SYMPTOM: remaining instance overloaded
    if len(py) > 1:
        other_id = py[1].id
    else:
        other_id = py_id
    for i in range(4):
        evts.append((28.0 + i * 0.6, fmt.python_log(
            "WARNING", "uvicorn.workers",
            f"Worker queue depth: {55 + i * 20}/100. Consider scaling horizontally."
        ), "SYMPTOM", other_id))

    # NORMAL
    for _ in range(12):
        evts.append((random.uniform(0, 38), fmt.nginx_access(
            f"10.0.1.{random.randint(1, 200)}", "GET",
            random.choice(["/api/users", "/api/feed", "/health"]),
            200 if random.random() > 0.25 else 502, random.randint(200, 5000)
        ), "NORMAL", nginx_id))

    evts.sort(key=lambda x: x[0])
    return evts


# ---------------------------------------------------------------------------
# redis_degradation: maxmemory → graceful fallback, no 502
# ---------------------------------------------------------------------------
def redis_degradation(topo: Topology) -> List[Event]:
    evts: List[Event] = []

    redis = _by_tech(topo, NodeTech.REDIS)
    redis_id = _id(redis, "redis_synthetic")

    app = ([n for n in topo.svc_nodes if n.tech in (NodeTech.PYTHON, NodeTech.NODEJS)]
           or _by_role(topo, NodeRole.SERVER))
    app_id = _id(app, "app_synthetic")

    mysql = _by_tech(topo, NodeTech.MYSQL)
    mysql_id = _id(mysql, "mysql_synthetic")

    nginx = _by_tech(topo, NodeTech.NGINX)
    nginx_id = _id(nginx, "nginx_synthetic")

    # Phase 1 ROOT_CAUSE: maxmemory
    for i in range(3):
        evts.append((i * 2.0, fmt.redis_maxmemory(), "ROOT_CAUSE", redis_id))
    evts.append((7.0, fmt.redis_log("WARNING", "1 changes in 3600 seconds. Saving..."),
                 "ROOT_CAUSE", redis_id))
    evts.append((8.5, fmt.redis_fork_oom(), "ROOT_CAUSE", redis_id))

    # Phase 2 PROPAGATION: app notices cache misses, graceful fallback
    evts.append((9.5, fmt.python_log(
        "WARNING", "cache.client",
        "Redis cache miss: key=session:user:*, falling back to database"
    ), "PROPAGATION", app_id))
    for i in range(5):
        evts.append((10.5 + i * 1.2, fmt.python_log(
            "INFO", "cache.client",
            f"Cache MISS (Redis degraded): DB fallback active. Hit rate: {60 - i * 8}%"
        ), "PROPAGATION", app_id))

    # Phase 3 PROPAGATION: DB takes extra load but stays up
    for i in range(3):
        evts.append((12.0 + i * 2.5, fmt.mysql_slow_query(
            query_time=1.2 + i * 0.4,
            rows_examined=60_000 + i * 25_000,
            query="SELECT * FROM sessions WHERE token = 'abc123'"
        ), "PROPAGATION", mysql_id))

    # NORMAL — service stays 200
    for _ in range(18):
        evts.append((random.uniform(0, 22), fmt.nginx_access(
            f"10.0.1.{random.randint(1, 200)}", "GET",
            random.choice(["/api/feed", "/api/timeline", "/api/notifications"]),
            200, random.randint(300, 12000)
        ), "NORMAL", nginx_id))

    evts.sort(key=lambda x: x[0])
    return evts


# ---------------------------------------------------------------------------
# auth_cascade: conn leak → pool exhausted → heap OOM → crash → all 401
# ---------------------------------------------------------------------------
def auth_cascade(topo: Topology) -> List[Event]:
    evts: List[Event] = []

    node = _by_tech(topo, NodeTech.NODEJS)
    node_id = _id(node, "nodejs_synthetic")
    node_host = _ip(node, "auth-server-01")
    node_label = _label(node, "auth-service")

    lb = _by_role(topo, NodeRole.LB) or _by_tech(topo, NodeTech.HAPROXY)
    lb_id = _id(lb, "lb_synthetic")

    nginx = _by_tech(topo, NodeTech.NGINX)
    nginx_id = _id(nginx, "nginx_synthetic")

    # Phase 1 ROOT_CAUSE: connection leak
    for i in range(5):
        evts.append((i * 3.2, fmt.nodejs_log(
            "WARN", f"req_{random.randint(10000, 99999)}",
            f"HTTP keep-alive connection not released. Active connections: {20 + i * 16}/100"
        ), "ROOT_CAUSE", node_id))

    # Phase 2 ROOT_CAUSE: pool exhausted
    evts.append((16.5, fmt.nodejs_pool_error(100), "ROOT_CAUSE", node_id))

    # Phase 3 ROOT_CAUSE: heap OOM
    for i in range(3):
        evts.append((17.5 + i * 1.2, fmt.nodejs_heap_warning(
            1350 + i * 65, 1536
        ), "ROOT_CAUSE", node_id))
    evts.append((22.0, fmt.nodejs_log(
        "ERROR", "process",
        "FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory"
    ), "ROOT_CAUSE", node_id))

    # Phase 4 PROPAGATION: crash + restart
    evts.append((22.5, fmt.linux_systemd_restart(node_host, node_label),
                 "PROPAGATION", node_id))

    # Phase 5 SYMPTOM: all auth requests 401
    paths = ["/api/user/profile", "/api/dashboard", "/api/settings", "/api/orders"]
    for i in range(8):
        evts.append((23.0 + i * 0.45, fmt.nginx_access(
            f"10.0.1.{random.randint(1, 200)}", "GET",
            random.choice(paths), 401, 89
        ), "SYMPTOM", nginx_id))
    evts.append((23.8, fmt.haproxy_server_down("auth_backend", node_label, "L4CON"),
                 "SYMPTOM", lb_id))

    # NORMAL
    for _ in range(10):
        evts.append((random.uniform(0, 23), fmt.nginx_access(
            f"10.0.1.{random.randint(1, 200)}", "GET",
            random.choice(["/static/app.js", "/static/style.css", "/favicon.ico"]),
            200, random.randint(1000, 80000)
        ), "NORMAL", nginx_id))

    evts.sort(key=lambda x: x[0])
    return evts


# ---------------------------------------------------------------------------
# disk_full: disk fills → MySQL IO error → shutdown → total blackout
# ---------------------------------------------------------------------------
def disk_full(topo: Topology) -> List[Event]:
    evts: List[Event] = []

    mysql = _by_tech(topo, NodeTech.MYSQL)
    mysql_id = _id(mysql, "mysql_synthetic")
    mysql_host = _ip(mysql, "db-server-01")

    app = ([n for n in topo.svc_nodes if n.tech in (NodeTech.PYTHON, NodeTech.NODEJS)]
           or _by_role(topo, NodeRole.SERVER))
    app_id = _id(app, "app_synthetic")

    lb = _by_role(topo, NodeRole.LB) or _by_tech(topo, NodeTech.HAPROXY)
    lb_id = _id(lb, "lb_synthetic")

    nginx = _by_tech(topo, NodeTech.NGINX)
    nginx_id = _id(nginx, "nginx_synthetic")

    # Phase 1 ROOT_CAUSE: disk filling up
    for i, pct in enumerate([75, 82, 90, 95, 99]):
        evts.append((i * 5.0, fmt.linux_syslog(
            mysql_host, "disk-monitor", 1234,
            f"ALERT: /var/lib/mysql disk usage at {pct}% ({pct * 10}G/1000G)"
        ), "ROOT_CAUSE", mysql_id))

    # Phase 2 ROOT_CAUSE: MySQL IO errors
    evts.append((26.0, fmt.linux_disk_error(mysql_host, "/dev/sdb1"), "ROOT_CAUSE", mysql_id))
    evts.append((26.5, fmt.mysql_error(
        "[ERROR] InnoDB: Write to file ./ibdata1 failed at offset 104857600. "
        "Cannot write 16384 bytes. OS error: 28, No space left on device"
    ), "ROOT_CAUSE", mysql_id))
    evts.append((27.0, fmt.mysql_error(
        "[ERROR] InnoDB: Database page corruption on disk or a failed file read of tablespace "
        "users/sessions. Ending processing."
    ), "ROOT_CAUSE", mysql_id))

    # Phase 3 ROOT_CAUSE: MySQL shutdown
    evts.append((28.0, fmt.mysql_error(
        "[System] [MY-010910] [Server] /usr/sbin/mysqld: Shutdown complete (mysqld 8.0.32)"
    ), "ROOT_CAUSE", mysql_id))

    # Phase 4 PROPAGATION: app fails to connect
    evts.append((28.5, fmt.sqlalchemy_error("SELECT 1"), "PROPAGATION", app_id))
    evts.append((29.0, fmt.python_log(
        "CRITICAL", "app.startup",
        "Database connection failed. Cannot proceed. Exiting."
    ), "PROPAGATION", app_id))

    # Phase 5 SYMPTOM: LB removes all backends
    app_label = _label(app, "app-01")
    evts.append((30.0, fmt.haproxy_server_down("app_backend", app_label, "L7STS"),
                 "SYMPTOM", lb_id))
    evts.append((30.3, fmt.haproxy_server_down("app_backend", "app-02", "L7STS"),
                 "SYMPTOM", lb_id))

    # Phase 6 SYMPTOM: total 503 blackout
    for i in range(10):
        evts.append((31.0 + i * 0.35, fmt.nginx_access(
            f"10.0.1.{random.randint(1, 200)}", "GET",
            random.choice(["/", "/api/data", "/login", "/dashboard"]), 503, 0
        ), "SYMPTOM", nginx_id))

    # NORMAL pre-incident
    for _ in range(12):
        evts.append((random.uniform(0, 26), fmt.nginx_access(
            f"10.0.1.{random.randint(1, 200)}", "GET",
            random.choice(["/api/products", "/api/search", "/api/users"]),
            200, random.randint(400, 6000)
        ), "NORMAL", nginx_id))

    evts.sort(key=lambda x: x[0])
    return evts


SCENARIOS = {
    "mysql_cascade": {
        "func": mysql_cascade,
        "name": "MySQL Cascade Failure",
        "description": (
            "Slow query → lock contention → pool exhaustion → "
            "app timeout → 502 → LB health fail"
        ),
    },
    "oom_cascade": {
        "func": oom_cascade,
        "name": "OOM Cascade",
        "description": (
            "Python memory leak → OOM kill → restart loop → "
            "LB removes server → remaining node overloaded"
        ),
    },
    "redis_degradation": {
        "func": redis_degradation,
        "name": "Redis Degradation",
        "description": (
            "Redis maxmemory → graceful DB fallback (non-critical path, no 502)"
        ),
    },
    "auth_cascade": {
        "func": auth_cascade,
        "name": "Auth Service Cascade",
        "description": (
            "Node.js connection leak → pool exhausted → "
            "heap OOM → auth crash → all 401"
        ),
    },
    "disk_full": {
        "func": disk_full,
        "name": "Disk Full Blackout",
        "description": (
            "Disk fills → MySQL IO error → shutdown → total 503 blackout"
        ),
    },
}
