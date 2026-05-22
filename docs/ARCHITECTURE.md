# Architecture

ภาพรวมการออกแบบระบบ LogSim2 สำหรับนักพัฒนา

---

## ภาพรวม Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│ USER                                                                 │
│  1. วาด topology ใน canvas                                           │
│  2. คลิก "Run Simulation"                                            │
└────────────────────────┬─────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│ FRONTEND  (Next.js :3000)                                            │
│                                                                      │
│  page.tsx                                                            │
│    └── topology: TopologyData  ──────────────────────────────────┐  │
│    └── fitTrigger (net/svc)      (two-canvas per-tab pattern)    │  │
│    └── toasts[]                                                   │  │
│                                                                   │  │
│  TopologyCanvas (×2)   NodePanel   SimulationDrawer               │  │
│                                          │                        │  │
│                          POST /api/simulate ◄──────────────────── │  │
│                          { topology, scenario, output_dir, ... }  │  │
│                                          │                           │
│                          poll GET /api/jobs/{id} every 800ms         │
└──────────────────────────────────────────────────────────────────────┘
                         │
               HTTP/JSON │
                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│ BACKEND  (FastAPI :8000)                                             │
│                                                                      │
│  main.py                                                             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ POST /api/simulate                                           │   │
│  │   create_job() → job_id                                      │   │
│  │   BackgroundTasks.add_task(run_simulation, job_id, config)   │   │
│  │   return { job_id }                                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  simulate.py  (async background)                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  _parse_topology(dict)  →  Topology                          │   │
│  │  scenarios.SCENARIOS[name]["func"](topo)  →  List[Event]     │   │
│  │  _make_baseline(topo, duration)  →  List[Event]              │   │
│  │  all_events = fault + baseline → sort by delta_sec           │   │
│  │  _write_logs(output_dir, all_events, topo)                   │   │
│  │    → {node_label}_{tech}.log  (per source)                   │   │
│  │    → ground_truth.log                                        │   │
│  │    → ground_truth.json                                       │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
                         │
                         ▼
              /tmp/logsim2_output/*.log
```

---

## Backend Architecture

### topology.py — Domain model

```
Topology
├── net_nodes: List[NetNode]    infrastructure layer
├── net_edges: List[NetEdge]
├── svc_nodes: List[SvcNode]    service layer
└── svc_edges: List[SvcEdge]

NetNode / SvcNode
  id, label, role (NodeRole), tech (NodeTech), ip, os, x, y

NetEdge / SvcEdge
  id, source, target, protocol, port, critical, call_rate
```

`NodeRole` และ `NodeTech` เป็น `str Enum` → JSON serializable และ validate ได้ใน _parse_topology

### formatters.py — Log realism layer

ไม่มี state — ทุกฟังก์ชันเป็น pure function คืน string

```
cisco_ios_access(src, dst, proto, ...)   → "%SEC-6-IPACCESSLOGP: ..."
haproxy_access(client, frontend, ...)   → "haproxy[pid]: ..."
nginx_access(client, method, ...)       → combined access log
nginx_upstream_timeout(upstream, ...)   → "[error] upstream timed out ..."
python_log(level, logger, msg)          → "ISO_TS LEVEL logger: msg"
sqlalchemy_error()                      → python_log wrapping ORM error
nodejs_log(level, req_id, msg)          → "[ISO_TS] LEVEL [req_id] msg"
nodejs_heap_warning(used_mb, total_mb)  → nodejs_log with V8 warning
mysql_slow_query(user, host, ...)       → multi-line "# Time / # User ..."
mysql_error(msg)                        → "TIMESTAMP tid [ERROR] msg"
redis_log(level, msg)                   → "pid:M timestamp * msg"
linux_syslog(host, proc, pid, msg)      → "Mon DD HH:MM:SS host proc[pid]: msg"
linux_oom_kill(host, proc, pid)         → 2-line kernel OOM killer
linux_systemd_restart(host, service)    → 3-line systemd restart sequence
```

### scenarios.py — Fault scenario layer

แต่ละ scenario:
1. ค้นหา node ที่เกี่ยวข้องจาก Topology (`_by_tech`, `_by_role`)
2. สร้าง events ตาม causal chain
3. return `List[Event]` เรียงตาม delta_sec

```
Event = Tuple[float, str, str, str]
         delta  line  label node_id
```

**Causal chain pattern**:

```
Phase 1  ROOT_CAUSE    delta 0-10s   — ต้นเหตุ (DB, memory, disk)
Phase 2  PROPAGATION   delta +5-20s  — กระทบ app tier
Phase 3  PROPAGATION   delta +10-25s — กระทบ web/proxy tier
Phase 4  SYMPTOM       delta +15-35s — user-facing (502, 401, 503)
```

### simulate.py — Execution engine

```python
async def run_simulation(job_id, config):
    # 1. parse topology JSON → Topology
    topo = _parse_topology(config.topology)

    # 2. run scenario → fault events
    fault_events = SCENARIOS[config.scenario]["func"](topo)

    # 3. generate baseline traffic (ถ้า mix_baseline=True)
    if config.mix_baseline:
        baseline = _make_baseline(topo, config.baseline_duration)
        all_events = fault_events + baseline
    else:
        all_events = fault_events

    # 4. sort by time and write
    all_events.sort(key=lambda x: x[0])
    _write_logs(config.output_dir, all_events, topo)

    # 5. compute stats and store in job
    job.stats = { "total_lines", "normal", "anomaly", "attacks", ... }
```

**_write_logs** grouping:
- group events by `node_id`
- sort each group by `delta_sec`
- write to `{node.label}_{node.tech}.log`
- write ground_truth.log: `LABEL|node_id|+delta_s|first_line`
- write ground_truth.json: structured array

### main.py — API layer

job store เป็น in-memory dict (`_jobs: Dict[str, JobStatus]`) — เหมาะสำหรับ single-process  
ถ้าต้องการ multi-process ให้เปลี่ยนเป็น Redis หรือ database

---

## Frontend Architecture

### สองแบบ canvas

page.tsx render `TopologyCanvas` สองตัวพร้อมกัน (overlay):

```
┌─────────────────────────────────────┐
│  div.relative.overflow-hidden       │
│  ┌───────────────────────────────┐  │
│  │ div.absolute.inset-0 z-10     │  │  ← active tab
│  │   <TopologyCanvas net... />   │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │ div.absolute.inset-0 z-0      │  │  ← inactive (pointer-events-none)
│  │   <TopologyCanvas svc... />   │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

ข้อดี: ทั้งสอง canvas มีขนาด SVG จริง → auto-fit ใช้ `svg.clientWidth/Height` ได้เลย

### Auto-fit mechanism

```
page.tsx                TopologyCanvas
setNetFit(v => v+1) → fitTrigger prop changes
                     → useEffect([fitTrigger]) fires
                     → nodesRef.current = latest nodes  (always synced)
                     → bounding box calculation
                     → setPan({ x: centered, y: centered })
```

`nodesRef` pattern หลีกเลี่ยง stale closure — effect ขึ้นกับ `fitTrigger` เท่านั้น ไม่ขึ้นกับ `nodes`

### Canvas interaction state machine

```
mode: "select"
  mousedown(background) → start pan
  mousedown(node)       → start drag + select
  mousedown(edge)       → select edge
  
mode: "add-edge"
  mousedown(node) [no src]    → set edgeSrc + highlight
  mousedown(node) [has src]   → create edge + back to "select"
  mousedown(background)       → cancel (clear edgeSrc)
```

### Import JSON parsing pipeline

```
File picker → FileReader.readAsText()
           → JSON.parse()
           → parseTopologyJSON()
               ├── parseNodes(net.nodes)     → TopologyNode[]
               ├── parseEdges(net.edges)     → TopologyEdge[]  (filter invalid src/dst)
               ├── parseNodes(svc.nodes)     → TopologyNode[]
               └── parseEdges(svc.edges)     → TopologyEdge[]
           → maybeAutoLayout() ถ้า nodes กองอยู่ที่ (0,0)
           → setTopo(newTopo)
           → setNetFit / setSvcFit (trigger auto-fit ทั้งสอง tab)
           → pushToast(summary)
```

---

## การจัดการ State ที่ซับซ้อน

### Topology state

`topo: TopologyData` เก็บทั้งสี่ arrays ใน object เดียว  
canvas แต่ละ tab อ่าน slice ของตัวเอง: `topo.netNodes`, `topo.svcNodes`  
update ผ่าน partial spread: `setTopo(t => ({ ...t, netNodes: ns }))`

### Selection state แยก tab

`netSel` และ `svcSel` แยกกัน — เพราะ node id อาจซ้ำกันระหว่าง tab  
`NodePanel` อ่านจาก active tab เท่านั้น

### Toast stack

```typescript
toasts: ToastItem[]   // array ของ { id, message, subtext, type }
```

แต่ละ toast มี `id` จาก monotonic counter → `dismissToast(id)` filter ออก  
Toast auto-dismiss ใน component เอง → call `onDismiss` → parent remove จาก array

---

## ข้อจำกัดที่ควรรู้

| ข้อจำกัด | สาเหตุ | วิธีแก้ถ้าต้องการ |
|---|---|---|
| Job store หาย restart | in-memory dict | เปลี่ยนเป็น SQLite / Redis |
| ไม่มี authentication | design ตั้งต้น | เพิ่ม FastAPI middleware |
| ไม่มี zoom | SVG pan เท่านั้น | เพิ่ม `scale` state + CSS transform |
| Single-process backend | uvicorn default | ใช้ `--workers N` (ต้องย้าย job store ออก) |
| ไม่มี undo/redo | complex state | เพิ่ม history stack ด้วย `useReducer` |
