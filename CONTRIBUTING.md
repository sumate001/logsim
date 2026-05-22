# Contributing to LogSim2

คู่มือสำหรับนักพัฒนาที่ต้องการเพิ่มฟีเจอร์ใหม่ แก้บัก หรือเพิ่ม scenario/node type

---

## สารบัญ

1. [Dev environment setup](#1-dev-environment-setup)
2. [โครงสร้างโค้ดโดยละเอียด](#2-โครงสร้างโค้ดโดยละเอียด)
3. [เพิ่ม Fault Scenario ใหม่](#3-เพิ่ม-fault-scenario-ใหม่)
4. [เพิ่ม Log Formatter ใหม่](#4-เพิ่ม-log-formatter-ใหม่)
5. [เพิ่ม Node Type ใหม่](#5-เพิ่ม-node-type-ใหม่)
6. [เพิ่ม API Endpoint ใหม่](#6-เพิ่ม-api-endpoint-ใหม่)
7. [เพิ่ม Output Destination ใหม่](#7-เพิ่ม-output-destination-ใหม่)
8. [แก้ไข Frontend Canvas](#8-แก้ไข-frontend-canvas)
9. [ทดสอบ](#9-ทดสอบ)
10. [Style guide](#10-style-guide)

---

## 1. Dev Environment Setup

```bash
# Clone และติดตั้ง
git clone <repo> && cd logsim2

# Backend (ใช้ venv)
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (terminal ใหม่)
cd frontend
npm install
npm run dev
```

**Hot reload**: backend ใช้ `--reload` ของ uvicorn, frontend ใช้ Next.js HMR  
เปลี่ยนโค้ดแล้วบันทึก → บราวเซอร์อัปเดตอัตโนมัติ

---

## 2. โครงสร้างโค้ดโดยละเอียด

### Backend data flow

```
POST /api/simulate
      │
      ▼
main.py          ← รับ JSON request, validate OutputDest, สร้าง background job
      │
      ▼
simulate.py
  _parse_topology()        ← JSON dict → Topology dataclass
  scenario_func()          ← Topology → List[Event]     (scenarios.py)
  _make_baseline()         ← Topology → List[Event]     (formatters.py)
  
  ── output routing ────────────────────────────────────────────────
  output_dest == "file"
    _write_logs()          ← events → per-source .log + ground_truth.*
  output_dest == "rsyslog_udp"
    _send_rsyslog_udp()    ← events → UDP packets (RFC 5424)
    _write_ground_truth()  ← events → ground_truth.* only
  output_dest == "victoria_logs"
    _send_victoria_logs()  ← events → HTTP POST NDJSON
    _write_ground_truth()  ← events → ground_truth.* only
```

**Event tuple**: `(delta_sec: float, log_line: str, label: str, node_id: str)`

- `delta_sec` — วินาทีหลังเริ่ม simulation (เรียงจากน้อยไปมาก)
- `log_line` — บรรทัด log จริง (อาจมี `\n` สำหรับ multi-line entries)
- `label` — `ROOT_CAUSE` | `PROPAGATION` | `SYMPTOM` | `NORMAL`
- `node_id` — id ของ node ที่สร้าง log นี้

### Backend files

| File | หน้าที่ |
|------|---------|
| `topology.py` | dataclasses: `Topology`, `NetNode`, `NetEdge`, `SvcNode`, `SvcEdge` และ enums `NodeRole`, `NodeTech` |
| `formatters.py` | ฟังก์ชันสร้าง log string ที่สมจริงต่อ technology (Cisco IOS, HAProxy, Nginx, Python, Node.js, MySQL, Redis, syslog) |
| `scenarios.py` | ฟังก์ชัน 5 scenarios คืนค่า `List[Event]` — ใช้ Topology หา node ที่เกี่ยวข้อง |
| `simulate.py` | engine หลัก: parse topology, เรียก scenario, สร้าง baseline, **route output** (`OutputDest`: file / rsyslog UDP / Victoria Logs) |
| `main.py` | FastAPI routes, Pydantic models, background task management |

### Frontend component tree

```
page.tsx  (state orchestration)
├── <header>
│   ├── tabs (Network / Service)
│   ├── node-add buttons
│   └── Add Edge toggle
├── <TopologyCanvas>  ×2 (net + svc, overlaid)
│   └── SVG: defs → edges → temp-edge → nodes
├── <NodePanel>   (right panel, shows selected element)
├── <footer>
│   ├── Import Topology  (hidden file input)
│   ├── Export JSON
│   └── Run Simulation
├── <SimulationDrawer>  (right overlay)
│   └── <LogPreview>    (inline at drawer bottom)
└── <Toast>  ×n  (notification stack)
```

### State ที่สำคัญใน page.tsx

| State | Type | คำอธิบาย |
|-------|------|----------|
| `topo` | `TopologyData` | nodes+edges ของทั้งสอง tab |
| `netSel` / `svcSel` | `Selection` | element ที่ถูก select ต่อ tab |
| `mode` | `CanvasMode` | `"select"` หรือ `"add-edge"` |
| `netFit` / `svcFit` | `number` | counter สำหรับ trigger auto-fit |

---

## 3. เพิ่ม Fault Scenario ใหม่

### ขั้นตอน

**ขั้นที่ 1** — เขียนฟังก์ชันใน `backend/scenarios.py`

```python
def my_new_scenario(topo: Topology) -> List[Event]:
    evts: List[Event] = []

    # 1. หา node ที่เกี่ยวข้องจาก topology
    #    ใช้ helper _by_tech() หรือ _by_role()
    db_nodes = _by_tech(topo, NodeTech.MYSQL)
    db_id    = _id(db_nodes, "db_synthetic")   # fallback ถ้าไม่มีใน topology

    app_nodes = _by_role(topo, NodeRole.SERVICE)
    app_id    = _id(app_nodes, "app_synthetic")

    # 2. Phase 1 ROOT_CAUSE — จุดเริ่มต้น
    evts.append((0.0,
        fmt.mysql_error("some root cause message"),
        "ROOT_CAUSE", db_id))

    # 3. Phase 2 PROPAGATION — แพร่กระจายไปยัง dependent node
    #    delta ควรมากกว่า ROOT_CAUSE เพื่อแสดง causal delay
    evts.append((5.0,
        fmt.python_log("ERROR", "db.client", "cannot connect to database"),
        "PROPAGATION", app_id))

    # 4. Phase 3 SYMPTOM — user-facing impact
    nginx_nodes = _by_tech(topo, NodeTech.NGINX)
    nginx_id    = _id(nginx_nodes, "nginx_synthetic")
    evts.append((8.0,
        fmt.nginx_access("10.0.1.100", "GET", "/api/data", 503, 0),
        "SYMPTOM", nginx_id))

    # 5. NORMAL baseline (optional — simulate.py เพิ่มให้อยู่แล้วถ้า mix_baseline=True)
    for _ in range(10):
        evts.append((random.uniform(0, 10),
            fmt.nginx_access(f"10.0.1.{random.randint(1,200)}", "GET", "/", 200, 1024),
            "NORMAL", nginx_id))

    evts.sort(key=lambda x: x[0])
    return evts
```

**ขั้นที่ 2** — ลงทะเบียนใน `SCENARIOS` dict (ปลายไฟล์ scenarios.py)

```python
SCENARIOS = {
    # ... existing ...
    "my_new_scenario": {
        "func": my_new_scenario,
        "name": "My New Scenario",
        "description": "อธิบาย causal chain ให้ชัดเจน เช่น X → Y → Z → ผลกระทบ",
    },
}
```

**ขั้นที่ 3** — ทดสอบ

```bash
cd backend
python3 -c "
from topology import Topology, NetNode, NodeRole, NodeTech
from scenarios import SCENARIOS

topo = Topology()
topo.net_nodes = [
    NetNode('db1','DB',NodeRole.DB,NodeTech.MYSQL,'10.0.0.1','',0,0),
]
evts = SCENARIOS['my_new_scenario']['func'](topo)
labels = [e[2] for e in evts]
print('events:', len(evts))
print('RC:', labels.count('ROOT_CAUSE'),
      'PROP:', labels.count('PROPAGATION'),
      'SYM:', labels.count('SYMPTOM'))
"
```

### กฎ causal ordering

```
ROOT_CAUSE     delta: 0–10s      จุดเริ่มต้น — ใกล้ 0
PROPAGATION    delta: +5–20s     หลัง ROOT_CAUSE เสมอ
SYMPTOM        delta: +15–35s    หลัง PROPAGATION เสมอ
```

ใช้ `_get_dependents(topo, node_id)` เพื่อหา node ที่ขึ้นกับ node นั้นตาม edge graph

---

## 4. เพิ่ม Log Formatter ใหม่

เพิ่มฟังก์ชันใน `backend/formatters.py` — ต้อง return `str` และใช้ `datetime.now()` เป็น timestamp

```python
def my_service_log(level: str, component: str, message: str) -> str:
    """
    Example: [2025-01-01T10:00:00.123Z] INFO  [auth-svc] user login successful
    """
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    return f"[{ts}] {level:<5} [{component}] {message}"
```

**Multi-line formatters** (เช่น MySQL slow query) — คืน string ที่มี `\n`:

```python
def my_multiline_log(query: str) -> str:
    lines = [
        f"# Time: {datetime.now().strftime('%Y-%m-%dT%H:%M:%S')}",
        f"# Query: {query}",
    ]
    return "\n".join(lines)
```

`simulate.py` จะเขียน multi-line เป็นหลายบรรทัดในไฟล์, และ ground_truth เก็บแค่บรรทัดแรก

---

## 5. เพิ่ม Node Type ใหม่

### Backend

เพิ่มค่าใน enum ที่ `backend/topology.py`:

```python
class NodeRole(str, Enum):
    # ... existing ...
    GATEWAY = "gateway"       # ← ใหม่

class NodeTech(str, Enum):
    # ... existing ...
    KONG = "kong"             # ← ใหม่
```

เพิ่ม baseline generator ใน `simulate.py` → `_make_baseline()`:

```python
elif node.tech == NodeTech.KONG:
    for _ in range(count):
        evts.append((random.uniform(0, duration),
            fmt.kong_access_log(...),   # formatter ใหม่
            "NORMAL", node.id))
```

### Frontend

**`src/types/topology.ts`** — เพิ่มค่าใน type และ constants:

```typescript
// เพิ่มใน NodeRole type
export type NodeRole = "router" | ... | "gateway";

// เพิ่มสี
export const NODE_COLOR: Record<NodeRole, string> = {
  // ...
  gateway: "#8B5CF6",   // purple
};

// เพิ่ม default tech
export const ROLE_DEFAULT_TECH: Record<NodeRole, NodeTech> = {
  // ...
  gateway: "kong",
};

// เพิ่มปุ่ม toolbar
export const TOOLBAR_NODES = [
  // ...
  { label: "Gateway", role: "gateway" as NodeRole },
];
```

**`src/components/TopologyCanvas.tsx`** — ถ้าต้องการรูปร่างพิเศษ เพิ่มใน `ELLIPSE_ROLES`:

```typescript
// เฉพาะถ้าต้องการเป็นวงรี (ปัจจุบัน db, cache)
export const ELLIPSE_ROLES: NodeRole[] = ["db", "cache", "gateway"];
```

---

## 6. เพิ่ม API Endpoint ใหม่

เพิ่มใน `backend/main.py`:

```python
from pydantic import BaseModel

class MyRequest(BaseModel):
    some_field: str
    optional_field: int = 0

@app.post("/api/my-endpoint")
async def my_endpoint(req: MyRequest):
    # ทำงาน...
    return {"result": "ok"}
```

เพิ่ม rewrite ถ้าต้องการเรียกจาก frontend (Next.js proxy ผ่าน `/api/*` ไปที่ `:8000` อัตโนมัติแล้ว ตาม `next.config.mjs`)

---

## 7. เพิ่ม Output Destination ใหม่

Output Destination คือตัวเลือกว่า log ที่สร้างจะไปที่ไหน ปัจจุบันมี `file`, `rsyslog_udp`, `victoria_logs`

### ขั้นที่ 1 — เพิ่มค่าใน `OutputDest` enum (`backend/simulate.py`)

```python
class OutputDest(str, enum.Enum):
    FILE          = "file"
    RSYSLOG_UDP   = "rsyslog_udp"
    VICTORIA_LOGS = "victoria_logs"
    LOKI          = "loki"       # ← ใหม่
```

### ขั้นที่ 2 — เขียน sender function ใน `backend/simulate.py`

```python
def _send_loki(
    events: List[Tuple[float, str, str, str]],
    topo: Topology,
    url: str,
) -> Tuple[int, Optional[str]]:
    """POST events ไปยัง Loki /loki/api/v1/push (JSON format)
    Returns (lines_sent, error_msg_or_None).
    """
    all_nodes = {n.id: n for n in topo.net_nodes}
    all_nodes.update({n.id: n for n in topo.svc_nodes})
    base_ts = datetime.utcnow()

    streams = {}   # label_key → list of [ts_ns_str, line]
    for delta, line, label, node_id in events:
        node   = all_nodes.get(node_id)
        host_f = (node.label if node else node_id) or "logsim2"
        ts_ns  = str(int((base_ts + timedelta(seconds=delta)).timestamp() * 1e9))
        key    = f'{{"host":"{host_f}","label":"{label}"}}'
        streams.setdefault(key, [])
        for sub in line.split("\n"):
            sub = sub.strip()
            if sub:
                streams[key].append([ts_ns, sub])

    body = json.dumps({
        "streams": [{"stream": json.loads(k), "values": v} for k, v in streams.items()]
    }).encode("utf-8")

    req = _urllib_req.Request(url, data=body, method="POST",
                              headers={"Content-Type": "application/json"})
    try:
        with _urllib_req.urlopen(req, timeout=30) as _:
            return sum(len(v) for v in streams.values()), None
    except _urllib_err.HTTPError as exc:
        return 0, f"HTTP {exc.code}: {exc.reason}"
    except Exception as exc:
        return 0, str(exc)
```

### ขั้นที่ 3 — เพิ่ม routing ใน `run_simulation()` (`backend/simulate.py`)

```python
elif dest == OutputDest.LOKI:
    job.progress = 0.65
    job.message  = "Sending to Loki…"
    await asyncio.sleep(0)
    sent, err = _send_loki(all_events, topo, config.loki_url)
    if err:
        raise RuntimeError(f"Loki: {err}")
    _write_ground_truth(config.output_dir, all_events)
```

### ขั้นที่ 4 — เพิ่ม field ใน `SimConfig` dataclass

```python
loki_url: str = "http://localhost:3100/loki/api/v1/push"
```

### ขั้นที่ 5 — เพิ่มใน `SimulateRequest` Pydantic model (`backend/main.py`)

```python
loki_url: str = "http://localhost:3100/loki/api/v1/push"
```

และส่งต่อใน `SimConfig(...)`:

```python
loki_url=req.loki_url,
```

### ขั้นที่ 6 — เพิ่มปุ่มและ config field ใน `SimulationDrawer.tsx`

```typescript
// เพิ่มใน DEST_TABS array
{ key: "loki", label: "🟡  Loki", hint: "POST to Grafana Loki /loki/api/v1/push" },

// เพิ่ม state
const [lokiUrl, setLokiUrl] = useState("http://localhost:3100/loki/api/v1/push");

// เพิ่ม conditional config section
{outputDest === "loki" && (
  <div>
    <label className="text-xs text-slate-400 block mb-1">Loki Push URL</label>
    <input value={lokiUrl} onChange={(e) => setLokiUrl(e.target.value)} className={inputCls} />
  </div>
)}

// เพิ่มใน startSim body
loki_url: lokiUrl,
```

---

## 8. แก้ไข Frontend Canvas

### การทำงานของ SVG canvas

```
SVG element (w-full h-full)
└── <g transform="translate(pan.x, pan.y)">   ← pan offset
    ├── edges (lines + markers)
    ├── temp-edge (ขณะวาด edge ใหม่)
    └── nodes (rect หรือ ellipse + text)
```

**Coordinate system**: `node.x, node.y` คือ top-left corner ของ node เสมอ  
**World coords**: `worldX = screenX - svgRect.left - pan.x`

### เพิ่ม interaction ใหม่

ตัวอย่าง: เพิ่ม double-click เพื่อ rename node

```typescript
// ใน TopologyCanvas.tsx
const onNodeDblClick = useCallback((e: React.MouseEvent, id: string) => {
  e.stopPropagation();
  const node = nodes.find(n => n.id === id);
  if (!node) return;
  const newLabel = window.prompt("Rename node:", node.label);
  if (newLabel !== null) {
    onNodesChange(nodes.map(n => n.id === id ? { ...n, label: newLabel } : n));
  }
}, [nodes, onNodesChange]);

// แล้ว bind ที่ <g data-node>
<g ... onDoubleClick={(e) => onNodeDblClick(e, node.id)}>
```

### fitTrigger pattern

เมื่อต้องการ auto-fit canvas จาก parent:

```typescript
// ใน page.tsx
const [fitNet, setFitNet] = useState(0);

// trigger fit
setFitNet(v => v + 1);

// ส่งผ่าน prop
<TopologyCanvas fitTrigger={fitNet} ... />
```

---

## 9. ทดสอบ

### Backend — unit test

```bash
cd backend
# test scenario
python3 -c "
from scenarios import SCENARIOS
from topology import Topology
topo = Topology()
for name, info in SCENARIOS.items():
    evts = info['func'](topo)
    print(name, len(evts), 'events')
"

# end-to-end simulation
python3 -c "
import asyncio
from simulate import SimConfig, create_job, run_simulation, get_job

async def test():
    cfg = SimConfig(
        topology={'netNodes':[],'netEdges':[],'svcNodes':[],'svcEdges':[]},
        scenario='mysql_cascade',
        output_dir='/tmp/test_output',
    )
    jid = create_job()
    await run_simulation(jid, cfg)
    job = get_job(jid)
    print('status:', job.status)
    print('stats:', job.stats)

asyncio.run(test())
"
```

### Backend — test output destinations

```bash
cd backend
# ทดสอบ rsyslog UDP (ฟัง port 9514 ก่อน แล้วรัน)
python3 -c "
import asyncio
from simulate import SimConfig, OutputDest, create_job, run_simulation, get_job

async def test():
    cfg = SimConfig(
        topology={'netNodes':[],'netEdges':[],'svcNodes':[],'svcEdges':[]},
        scenario='mysql_cascade',
        output_dest=OutputDest.RSYSLOG_UDP,
        rsyslog_host='127.0.0.1',
        rsyslog_port=9514,
    )
    jid = create_job()
    await run_simulation(jid, cfg)
    job = get_job(jid)
    print('status:', job.status)
    print('sent_lines:', job.stats.get('sent_lines'))

asyncio.run(test())
"

# รัน netcat เป็น UDP listener ก่อน (terminal แยก)
# nc -ulk 9514
```

```bash
# ทดสอบ Victoria Logs (ต้องมี VictoriaLogs รันอยู่ หรือใช้ nc)
python3 -c "
import asyncio
from simulate import SimConfig, OutputDest, create_job, run_simulation, get_job

async def test():
    cfg = SimConfig(
        topology={'netNodes':[],'netEdges':[],'svcNodes':[],'svcEdges':[]},
        scenario='oom_cascade',
        output_dest=OutputDest.VICTORIA_LOGS,
        victoria_logs_url='http://localhost:9428/insert/jsonline',
    )
    jid = create_job()
    await run_simulation(jid, cfg)
    job = get_job(jid)
    print('status:', job.status)    # failed ถ้า VictoriaLogs ไม่ running
    print('message:', job.message)

asyncio.run(test())
"
```

### Frontend — manual checklist

- [ ] เพิ่ม node ทุก type แล้วดูสีและรูปร่างถูกต้อง
- [ ] ลาก node แล้วไม่กระโดด
- [ ] Pan canvas แล้วพิกัดถูกต้อง
- [ ] Add Edge → source highlight → คลิก target → edge ปรากฏ
- [ ] Import JSON → โหลด nodes+edges → toast แสดงสรุป
- [ ] Export JSON → import กลับมาได้ (round-trip)
- [ ] Run Simulation (File) → progress bar → stats cards → ไฟล์ .log
- [ ] Run Simulation (rsyslog UDP) → banner "Sent X lines" → เฉพาะ ground_truth ใน Files
- [ ] Run Simulation (Victoria Logs) → banner ถ้าสำเร็จ หรือ error ถ้า endpoint ไม่มี

---

## 10. Style Guide

### Python

- ใช้ type hints ทุก function signature
- formatter function คืน `str` เสมอ
- scenario function คืน `List[Event]` เสมอ
- อย่าใช้ global state ใน scenarios — รับ `topo` เป็น argument

### TypeScript / React

- ใช้ `useCallback` สำหรับ event handlers ที่ส่งเป็น prop
- ใช้ `useRef` แทน `useEffect` เมื่อต้องการค่า latest โดยไม่ trigger re-render
- Component ที่มี mouse event ต้อง `e.stopPropagation()` ก่อนทำงาน
- ไม่ใช้ external UI library — ใช้ Tailwind CSS ล้วน

### ตั้งชื่อ

| สิ่งที่ | Convention | ตัวอย่าง |
|---------|-----------|---------|
| Scenario function | `snake_case` | `my_new_scenario` |
| Formatter function | `snake_case` | `nginx_upstream_timeout` |
| React component | `PascalCase` | `TopologyCanvas` |
| TypeScript type | `PascalCase` | `TopologyNode` |
| Tailwind helper string | inline ternary | `isActive ? "bg-blue-600" : "bg-slate-800"` |
