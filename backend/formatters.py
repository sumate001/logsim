import random
import time
from datetime import datetime, timezone


def cisco_ios_access(src_ip: str, dst_ip: str, protocol: str = "TCP",
                     src_port: int = 0, dst_port: int = 80, action: str = "permitted") -> str:
    if src_port == 0:
        src_port = random.randint(1024, 65535)
    ts = datetime.now().strftime("%b %d %H:%M:%S")
    packets = random.randint(1, 5)
    return (f"*{ts}: %SEC-6-IPACCESSLOGP: list INBOUND {action} {protocol.lower()} "
            f"{src_ip}({src_port}) -> {dst_ip}({dst_port}), {packets} packet")


def cisco_ios_link_down(iface: str = "GigabitEthernet0/1") -> str:
    ts = datetime.now().strftime("%b %d %H:%M:%S")
    return (f"*{ts}: %LINEPROTO-5-UPDOWN: Line protocol on Interface {iface}, "
            f"changed state to down")


def cisco_ios_fw_drop(src_ip: str, dst_ip: str, protocol: str = "TCP") -> str:
    ts = datetime.now().strftime("%b %d %H:%M:%S")
    return (f"*{ts}: %FW-3-RESPONDER: Dropping {protocol} pkt from zone Outside "
            f"to zone Inside: {src_ip} -> {dst_ip}: {protocol} rst")


def haproxy_access(client_ip: str, frontend: str = "http_front",
                   backend: str = "app_backend", server: str = "app-01",
                   status: int = 200, bytes_: int = 1234, dur_ms: int = 12) -> str:
    ts = datetime.now().strftime("%d/%b/%Y:%H:%M:%S.%f")[:-3]
    pid = random.randint(10000, 19999)
    cport = random.randint(1024, 65535)
    tw = random.randint(1, 5)
    tc = random.randint(1, 3)
    act = random.randint(1, 50)
    return (f"haproxy[{pid}]: {client_ip}:{cport} [{ts} +0000] "
            f"{frontend}~ {backend}/{server} "
            f"{tw}/{tc}/{dur_ms}/{random.randint(1,5)}/{random.randint(0,3)} "
            f"{status} {bytes_} - - ---- {act}/{random.randint(1,10)}/0/0/0 0/0")


def haproxy_server_down(backend: str, server: str, reason: str = "L4CON") -> str:
    ts = datetime.now().strftime("%d/%b/%Y:%H:%M:%S")
    pid = random.randint(10000, 19999)
    return (f"haproxy[{pid}]: Server {backend}/{server} is DOWN, reason: {reason}, "
            f'info: "Connection refused", check duration: 0ms. '
            f"0 active and 0 backup servers left. 0 sessions active, 0 requeued, 0 remaining in queue.")


def nginx_access(client_ip: str, method: str = "GET", path: str = "/",
                 status: int = 200, bytes_: int = 1024,
                 ua: str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36") -> str:
    ts = datetime.now().strftime("%d/%b/%Y:%H:%M:%S +0000")
    return f'{client_ip} - - [{ts}] "{method} {path} HTTP/1.1" {status} {bytes_} "-" "{ua}"'


def nginx_upstream_timeout(upstream_addr: str, path: str = "/api/data") -> str:
    ts = datetime.now().strftime("%Y/%m/%d %H:%M:%S")
    pid = random.randint(10000, 19999)
    conn = random.randint(1, 9999)
    return (f"{ts} [error] {pid}#0: *{conn} upstream timed out (110: Connection timed out) "
            f"while reading response header from upstream, client: 10.0.0.1, server: _, "
            f'request: "GET {path} HTTP/1.1", upstream: "http://{upstream_addr}{path}", '
            f'host: "app.internal"')


def python_log(level: str, logger: str, message: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return f"{ts} {level:<8} {logger}: {message}"


def sqlalchemy_error(query: str = "SELECT 1") -> str:
    return python_log(
        "ERROR", "sqlalchemy.engine",
        "(sqlalchemy.exc.OperationalError) (MySQLdb.OperationalError) "
        "(2006, 'MySQL server has gone away') [SQL: " + query + "]"
    )


def uvicorn_startup() -> str:
    return python_log("INFO", "uvicorn.main", "Application startup complete.")


def uvicorn_shutdown() -> str:
    return python_log("INFO", "uvicorn.main", "Application shutdown complete.")


def nodejs_log(level: str, req_id: str, message: str) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return f"[{ts}] {level:<5} [{req_id}] {message}"


def nodejs_heap_warning(heap_used_mb: int = 1400, heap_total_mb: int = 1536) -> str:
    req_id = f"req_{random.randint(10000, 99999)}"
    return nodejs_log(
        "WARN", req_id,
        f"V8: JavaScript heap out of memory: heap used {heap_used_mb}MB, total {heap_total_mb}MB"
    )


def nodejs_pool_error(pool_size: int = 100) -> str:
    req_id = f"req_{random.randint(10000, 99999)}"
    return nodejs_log(
        "ERROR", req_id,
        f"Error: Connection pool exhausted (size: {pool_size}). "
        f"Timeout waiting for available connection."
    )


def mysql_slow_query(user: str = "app_user", host: str = "10.0.0.10",
                     query_time: float = 5.2, lock_time: float = 0.8,
                     rows_sent: int = 0, rows_examined: int = 1000000,
                     query: str = "SELECT * FROM sessions WHERE user_id = 12345") -> str:
    ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S.%f")
    lines = [
        f"# Time: {ts}",
        f"# User@Host: {user}[{user}] @ {host} []  Id:    42",
        f"# Query_time: {query_time:.6f}  Lock_time: {lock_time:.6f}  "
        f"Rows_sent: {rows_sent}  Rows_examined: {rows_examined}",
        f"SET timestamp={int(time.time())};",
        query + ";",
    ]
    return "\n".join(lines)


def mysql_error(message: str) -> str:
    ts = datetime.now().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
    tid = random.randint(100, 999)
    return f"{ts} {tid} [ERROR] {message}"


def redis_log(level: str, message: str, proc: str = "M") -> str:
    ts = datetime.now().strftime("%d %b %Y %H:%M:%S.%f")[:-3]
    pid = random.randint(1000, 9999)
    char = "#" if level == "WARNING" else "*"
    return f"{pid}:{proc} {ts} {char} {message}"


def redis_maxmemory() -> str:
    return redis_log(
        "WARNING",
        "MAXMEMORY REACHED, evicting keys according to maxmemory-policy allkeys-lru"
    )


def redis_fork_oom() -> str:
    return redis_log("WARNING", "Can't save in background: fork: Cannot allocate memory")


def linux_syslog(hostname: str, process: str, pid: int, message: str) -> str:
    ts = datetime.now().strftime("%b %d %H:%M:%S")
    return f"{ts} {hostname} {process}[{pid}]: {message}"


def linux_oom_kill(hostname: str, process: str, pid: int, mem_kb: int = 524288) -> str:
    lines = [
        linux_syslog(hostname, "kernel", 0,
                     f"Out of memory: Kill process {pid} ({process}) score 900 or sacrifice child"),
        linux_syslog(hostname, "kernel", 0,
                     f"Killed process {pid} ({process}), UID 1000, "
                     f"anon-rss:{mem_kb}kB, file-rss:512kB, shmem-rss:0kB"),
    ]
    return "\n".join(lines)


def linux_disk_error(hostname: str, device: str = "/dev/sdb1") -> str:
    return linux_syslog(
        hostname, "kernel", 0,
        f"EXT4-fs error (device {device}): ext4_journal_check_start:61: "
        f"Detected aborted journal"
    )


def linux_systemd_restart(hostname: str, service: str) -> str:
    pid = random.randint(10000, 99999)
    lines = [
        linux_syslog(hostname, "systemd", 1,
                     f"{service}.service: Main process exited, code=killed, status=9/KILL"),
        linux_syslog(hostname, "systemd", 1,
                     f"{service}.service: Failed with result 'signal'."),
        linux_syslog(hostname, "systemd", 1, f"Started {service}."),
    ]
    return "\n".join(lines)
