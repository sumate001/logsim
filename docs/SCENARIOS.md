# Fault Scenarios

เอกสารอ้างอิงสำหรับ scenario ที่มีอยู่และวิธีเพิ่มใหม่

---

## Event Format

ทุก scenario คืน `List[Event]`:

```python
Event = Tuple[float, str, str, str]
#             │      │    │    └── node_id
#             │      │    └─────── label: ROOT_CAUSE | PROPAGATION | SYMPTOM | NORMAL
#             │      └──────────── log_line (อาจมี \n สำหรับ multi-line)
#             └─────────────────── delta_sec (วินาทีหลัง t=0)
```

events ต้อง **เรียงตาม delta_sec** ก่อน return (ใช้ `evts.sort(key=lambda x: x[0])`)

---

## Scenarios ที่มีอยู่

### mysql_cascade

```
t=0.0s    ROOT_CAUSE    MySQL slow query (5s+, rows_examined=1M)
t=2.5s    ROOT_CAUSE    MySQL slow query (7.5s, rows_examined=1.5M)
t=5.0s    ROOT_CAUSE    MySQL slow query (10s, rows_examined=2M)
t=8.0s    ROOT_CAUSE    InnoDB Deadlock
t=9.5s    ROOT_CAUSE    Lock wait timeout
t=11.0s   PROPAGATION   App: connection pool timeout (100% → 65% → 30%)
t=12.5s   PROPAGATION   App: connection pool timeout
t=14.0s   PROPAGATION   App: connection pool timeout
t=15.5s   PROPAGATION   SQLAlchemy: MySQL server has gone away
t=16.0s   PROPAGATION   Nginx: upstream timed out
t=16.5s   PROPAGATION   Nginx: 502 ×4
t=20.0s   SYMPTOM       HAProxy: Server DOWN (L7STS)
t=21.0s   SYMPTOM       Nginx: 502 /api/checkout ×5
```

**Nodes ที่ใช้**: MySQL, Python/Node app, Nginx, HAProxy LB

---

### oom_cascade

```
t=0.0s    ROOT_CAUSE    RSS: 700MB / 1536MB
t=4.5s    ROOT_CAUSE    RSS: 860MB / 1536MB
t=9.0s    ROOT_CAUSE    RSS: 1020MB / 1536MB
t=13.5s   ROOT_CAUSE    RSS: 1180MB / 1536MB
t=18.0s   ROOT_CAUSE    RSS: 1340MB / 1536MB
t=23.0s   ROOT_CAUSE    OOM Kill (kernel message, 2 lines)
t=23.1s   ROOT_CAUSE    uvicorn shutdown
t=24.0s   PROPAGATION   systemd restart + startup (restart loop ×3)
t=28.0s   PROPAGATION   systemd restart
t=29.0s   PROPAGATION   systemd restart
t=27.0s   SYMPTOM       HAProxy: Server DOWN (L4TOUT)
t=28.0s   SYMPTOM       uvicorn: queue depth 55/100
t=28.6s   SYMPTOM       uvicorn: queue depth 75/100
```

**Nodes ที่ใช้**: Python service, HAProxy LB

---

### redis_degradation

```
t=0.0s    ROOT_CAUSE    Redis MAXMEMORY evicting keys
t=2.0s    ROOT_CAUSE    Redis MAXMEMORY (ซ้ำ)
t=4.0s    ROOT_CAUSE    Redis MAXMEMORY (ซ้ำ)
t=7.0s    ROOT_CAUSE    Redis: 1 changes in 3600 seconds
t=8.5s    ROOT_CAUSE    Redis: fork Cannot allocate memory
t=9.5s    PROPAGATION   App: cache miss → DB fallback
t=10.5s   PROPAGATION   Cache hit rate: 60% → 36%
t=12.0s   PROPAGATION   MySQL slow query (1.2s, extra load)
t=14.5s   PROPAGATION   MySQL slow query (1.6s)
t=17.0s   PROPAGATION   MySQL slow query (2.0s)
```

**หมายเหตุ**: scenario นี้ **ไม่มี SYMPTOM** — Redis ใช้ non-critical edge, service ยัง UP

---

### auth_cascade

```
t=0.0s    ROOT_CAUSE    Node.js: keep-alive not released (20/100)
t=3.2s    ROOT_CAUSE    Node.js: keep-alive (36/100)
t=6.4s    ROOT_CAUSE    Node.js: keep-alive (52/100)
t=9.6s    ROOT_CAUSE    Node.js: keep-alive (68/100)
t=12.8s   ROOT_CAUSE    Node.js: keep-alive (84/100)
t=16.5s   ROOT_CAUSE    Node.js: pool exhausted
t=17.5s   ROOT_CAUSE    V8: heap used 1350MB/1536MB
t=18.7s   ROOT_CAUSE    V8: heap used 1415MB/1536MB
t=19.9s   ROOT_CAUSE    V8: heap used 1480MB/1536MB
t=22.0s   ROOT_CAUSE    FATAL: JavaScript heap out of memory
t=22.5s   PROPAGATION   systemd: auth-svc restart
t=23.0s   SYMPTOM       Nginx: 401 /api/user/profile ×8
t=23.8s   SYMPTOM       HAProxy: auth_backend DOWN (L4CON)
```

---

### disk_full

```
t=0.0s    ROOT_CAUSE    disk: 75% (750G/1000G)
t=5.0s    ROOT_CAUSE    disk: 82% (820G/1000G)
t=10.0s   ROOT_CAUSE    disk: 90% (900G/1000G)
t=15.0s   ROOT_CAUSE    disk: 95% (950G/1000G)
t=20.0s   ROOT_CAUSE    disk: 99% (990G/1000G)
t=26.0s   ROOT_CAUSE    EXT4-fs error: Detected aborted journal
t=26.5s   ROOT_CAUSE    InnoDB: Write to file failed, OS error 28
t=27.0s   ROOT_CAUSE    InnoDB: Database page corruption
t=28.0s   ROOT_CAUSE    mysqld: Shutdown complete
t=28.5s   PROPAGATION   SQLAlchemy: MySQL server has gone away
t=29.0s   PROPAGATION   App: CRITICAL cannot connect, exiting
t=30.0s   SYMPTOM       HAProxy: app-01 DOWN (L7STS)
t=30.3s   SYMPTOM       HAProxy: app-02 DOWN (L7STS)
t=31.0s   SYMPTOM       Nginx: 503 ×10
```

**Nodes ที่ใช้**: MySQL (ทุก phase), Python app, HAProxy LB, Nginx

---

## เพิ่ม Scenario ใหม่

### Template

```python
# backend/scenarios.py

def my_scenario(topo: Topology) -> List[Event]:
    """
    สั้น ๆ: root cause → propagation → symptom
    ตัวอย่าง: network partition → service timeout → retry storm → cascading failure
    """
    evts: List[Event] = []

    # ── หา nodes (ถ้าไม่เจอใช้ synthetic id) ────────────────────────────
    mysql   = _by_tech(topo, NodeTech.MYSQL)
    mysql_id = _id(mysql, "mysql_synthetic")

    app     = ([n for n in topo.svc_nodes if n.tech in (NodeTech.PYTHON, NodeTech.NODEJS)]
               or _by_role(topo, NodeRole.SERVER))
    app_id  = _id(app, "app_synthetic")

    lb      = _by_role(topo, NodeRole.LB) or _by_tech(topo, NodeTech.HAPROXY)
    lb_id   = _id(lb, "lb_synthetic")

    nginx   = _by_tech(topo, NodeTech.NGINX)
    nginx_id = _id(nginx, "nginx_synthetic")

    # ── Phase 1: ROOT_CAUSE ──────────────────────────────────────────────
    evts.append((0.0,
        fmt.mysql_error("some initial failure"),
        "ROOT_CAUSE", mysql_id))

    # ── Phase 2: PROPAGATION ─────────────────────────────────────────────
    evts.append((10.0,
        fmt.python_log("ERROR", "db.pool", "connection timeout"),
        "PROPAGATION", app_id))

    # ── Phase 3: SYMPTOM ──────────────────────────────────────────────────
    evts.append((18.0,
        fmt.haproxy_server_down("app_backend", _label(app, "app-01"), "L7STS"),
        "SYMPTOM", lb_id))
    for i in range(5):
        evts.append((19.0 + i * 0.3,
            fmt.nginx_access(f"10.0.1.{random.randint(1,200)}", "GET", "/", 503, 0),
            "SYMPTOM", nginx_id))

    # ── NORMAL baseline ───────────────────────────────────────────────────
    for _ in range(10):
        evts.append((random.uniform(0, 20),
            fmt.nginx_access(f"10.0.1.{random.randint(1,200)}", "GET", "/health", 200, 128),
            "NORMAL", nginx_id))

    evts.sort(key=lambda x: x[0])
    return evts


# ลงทะเบียนใน SCENARIOS dict
SCENARIOS["my_scenario"] = {
    "func": my_scenario,
    "name": "My Scenario Name",
    "description": "Root cause X → Propagation Y → Symptom Z",
}
```

### Helper functions ที่ใช้บ่อย

```python
_by_tech(topo, NodeTech.MYSQL)      # List[node] ทุก tech นั้น (net + svc)
_by_role(topo, NodeRole.LB)         # List[node] ทุก role นั้น
_id(nodes, fallback)                # nodes[0].id ถ้ามี ไม่งั้น fallback
_label(nodes, fallback)             # nodes[0].label ถ้ามี ไม่งั้น fallback
_ip(nodes, fallback)                # nodes[0].ip ถ้ามี/ไม่ว่าง ไม่งั้น fallback
```

### กฎที่ต้องทำตาม

1. **delta ต้องเพิ่มขึ้นตาม phase**: ROOT_CAUSE < PROPAGATION < SYMPTOM
2. **synthetic fallback ทุก node**: ถ้า topology ไม่มี node ที่เกี่ยวข้อง ใช้ id แบบ `"*_synthetic"` — scenario ต้องรันได้แม้ topology ว่างเปล่า
3. **NORMAL events ไม่จำเป็นต้องเพิ่มเอง**: `simulate.py` สร้าง baseline ให้ถ้า `mix_baseline=True` แต่สามารถเพิ่มเองเพื่อ context เฉพาะ scenario ได้
4. **อย่า import module นอก standard library** ใน scenarios.py นอกจาก `formatters`, `topology`, `random`

---

## Causal Graph vs Linear Timeline

scenario ที่ดีต้องสะท้อน causal dependency ของ topology:

```
ถ้า topology มี edge: app → db  (critical=True)

แล้ว db ล้มเหลว (ROOT_CAUSE) ที่ t=0
app ได้รับผลกระทบ (PROPAGATION) ที่ t+5 ถึง t+15
LB รู้สึก (SYMPTOM) ที่ t+15 ถึง t+30
```

สำหรับ scenario ขั้นสูง สามารถใช้ `_get_dependents(topo, node_id)` เพื่อ walk graph:

```python
def advanced_scenario(topo: Topology) -> List[Event]:
    # หา node ที่ขึ้นกับ db1
    dependents = _get_dependents(topo, "db1")
    for i, dep_id in enumerate(dependents):
        # แต่ละ dependent ได้รับผลกระทบช้าลงตามระยะห่าง
        evts.append((10.0 + i * 2.0,
            ...,
            "PROPAGATION", dep_id))
```
