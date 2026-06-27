# LogSim2 — Topology-Aware Log Simulator

สร้างโทโพโลยีเครือข่ายหรือ service dependency ด้วย drag-and-drop แล้วรัน fault scenario เพื่อสร้าง log ที่สมจริงพร้อม ground truth label สำหรับทดสอบ AIOps, log parser, หรือ anomaly detection model

---

## ภาพรวม

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Next.js :3200)                                        │
│  ┌─────────────────────────────────┐  ┌───────────────────────┐ │
│  │  Topology Canvas (SVG)          │  │  Properties Panel     │ │
│  │  • drag-and-drop nodes          │  │  • edit node/edge     │ │
│  │  • draw edges                   │  └───────────────────────┘ │
│  │  • pan canvas                   │                            │
│  └─────────────────────────────────┘                            │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Toolbar: Add Node | Add Edge | Import | Export | Simulate  │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                          │  POST /api/simulate
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  FastAPI Backend (:8071)                                        │
│  scenarios.py → simulate.py                                     │
│                    │                                            │
│                    ├─ [file]          → per-source .log files   │
│                    ├─ [rsyslog_udp]   → UDP syslog (RFC 5424)   │
│                    ├─ [victoria_logs] → HTTP NDJSON POST        │
│                    └─ [log_analyzer]  → HTTP JSON POST /ingest  │
│                    (ground_truth.json / .log เสมอ)              │
└─────────────────────────────────────────────────────────────────┘
```

---

## ความต้องการของระบบ

| Software | เวอร์ชันขั้นต่ำ |
|----------|--------------|
| Python   | 3.9+         |
| Node.js  | 18+          |
| npm      | 9+           |

---

## เริ่มใช้งาน (วิธีเร็ว)

```bash
git clone <repo>
cd logsim2
./run.sh
```

script จะติดตั้ง dependencies อัตโนมัติในครั้งแรก แล้วเปิดทั้งสองบริการพร้อมกัน

| บริการ | URL |
|--------|-----|
| Frontend | http://localhost:3200 |
| Backend API | http://localhost:8071 |
| Swagger UI | http://localhost:8071/docs |

กด **Ctrl+C** หยุดทั้งคู่พร้อมกัน

---

## การติดตั้งแบบแยก

<details>
<summary>Backend</summary>

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8071
```
</details>

<details>
<summary>Frontend</summary>

```bash
cd frontend
npm install
npm run dev                      # เปิดที่ http://localhost:3200
```
</details>

---

## วิธีใช้งาน UI

### 1. สร้างโทโพโลยี

มีสอง canvas แยกกัน เปลี่ยนที่ tab ด้านบน:

- **Network Topology** — router, firewall, LB, server, DB, client ในระดับ infrastructure
- **Service Dependency** — service-to-service call graph

**เพิ่ม node** — คลิกปุ่มใน toolbar (`+ Router / FW`, `+ Server`, ฯลฯ)  
**ย้าย node** — ลาก node ไปวางที่ต้องการ  
**เพิ่ม edge** — คลิก `⬡ Add Edge` แล้วคลิก node ต้นทาง → node ปลายทาง  
**แก้ไข property** — คลิก node หรือ edge เพื่อเปิด panel ด้านขวา  
**Pan** — ลากบนพื้นที่ว่างของ canvas  

### 2. Node types และสีที่ใช้

| ประเภท | รูปร่าง | สี |
|--------|---------|-----|
| Router / Firewall / LB | สี่เหลี่ยม | น้ำเงิน |
| Server / Service | สี่เหลี่ยม | เขียว |
| DB / Cache | วงรี | เขียวฟ้า (teal) |
| Client | สี่เหลี่ยม | เหลืองอำพัน |

### 3. Edge styles

| ประเภท | เส้น | สี |
|--------|------|-----|
| Critical path | เส้นทึบ | แดง |
| Non-critical | เส้นประ | เทา |

### 4. นำเข้าโทโพโลยี

คลิก **Import Topology** ในแถบล่าง แล้วเลือกไฟล์ `.json`  
ดูรูปแบบ JSON ที่รองรับได้ที่ [`docs/TOPOLOGY_FORMAT.md`](docs/TOPOLOGY_FORMAT.md)

### 5. รัน Simulation

1. คลิก **▶ Run Simulation**
2. เลือก fault scenario
3. เปิด/ปิด "Mix baseline traffic"
4. เลือก **Output Destination** (ดูรายละเอียดด้านล่าง)
5. คลิก **Start Simulation**
6. ดูผลลัพธ์: stats cards, attack schedule, และไฟล์ log
7. คลิกไฟล์ log ใดก็ได้เพื่อ preview พร้อม color-coded labels

#### Output Destination

| ปุ่ม | คำอธิบาย | config field |
|------|----------|-------------|
| 📁 **File** | เขียนไฟล์ `.log` ต่อ node ลง local directory | Output Directory |
| 📡 **rsyslog UDP** | ส่ง log เป็น RFC 5424 UDP packet ทุกบรรทัด | Host + Port (default `127.0.0.1:514`) |
| 🏔 **Victoria Logs** | POST NDJSON batch ไปยัง `/insert/jsonline` | Ingest URL (default `http://localhost:9428/insert/jsonline`) |
| 🤖 **AIOps** | POST GodEyes JSONL ไปยัง log-analyzer `/ingest` | log-analyzer URL + tenant_id + asset_id |

> **หมายเหตุ**: `ground_truth.log` และ `ground_truth.json` เขียนลง local เสมอทุก mode เพื่อแสดงสถิติใน UI

---

## Fault Scenarios

| Scenario Key | ชื่อ | สาเหตุหลัก |
|---|---|---|
| `mysql_cascade` | MySQL Cascade Failure | Slow query → lock → pool exhaust → 502 |
| `oom_cascade` | OOM Cascade | Memory leak → OOM kill → restart loop |
| `redis_degradation` | Redis Degradation | maxmemory → graceful DB fallback (ไม่ 502) |
| `auth_cascade` | Auth Service Cascade | Connection leak → heap OOM → 401 ทุก request |
| `disk_full` | Disk Full Blackout | Disk เต็ม → MySQL shutdown → 503 ทั้งหมด |

แต่ละ scenario ใช้ causal chain: **ROOT_CAUSE** → **PROPAGATION** → **SYMPTOM**

---

## Log labels

| Label | สี (ใน preview) | ความหมาย |
|-------|----------------|----------|
| `ROOT_CAUSE` | แดง | จุดเริ่มต้นของปัญหา |
| `PROPAGATION` | เหลือง | ผลกระทบที่แพร่กระจาย |
| `SYMPTOM` | ฟ้าอมเขียว | อาการที่ user มองเห็น |
| `NORMAL` | เทา | traffic ปกติ |

---

## Output files

ไฟล์ที่สร้างขึ้นขึ้นอยู่กับ Output Destination ที่เลือก:

### Mode: File (default)

```
/tmp/logsim2_output/
├── {node_label}_{tech}.log    # log ต่อ node source (เช่น mysql_db_mysql.log)
├── ground_truth.log           # LABEL|node_id|+delta_s|first_line
└── ground_truth.json          # structured version สำหรับ machine consumption
```

### Mode: rsyslog UDP / Victoria Logs / AIOps (log_analyzer)

```
/tmp/logsim2_output/
├── ground_truth.log           # เหมือนเดิม — เสมอ
└── ground_truth.json          # เหมือนเดิม — เสมอ
```

per-source `.log` จะไม่ถูกเขียน — log ถูกส่งไปยัง remote endpoint แทน  
UI แสดง banner "Delivered X lines to rsyslog/Victoria Logs/log-analyzer" เมื่อสำเร็จ

### ground_truth.log format

```
ROOT_CAUSE|db1|+0.0s|# Time: 2025-01-01T10:00:00.000000
ROOT_CAUSE|db1|+2.5s|# Time: 2025-01-01T10:00:02.500000
PROPAGATION|web1|+11.0s|2025-01-01T10:00:11.000Z ERROR ...
SYMPTOM|lb1|+20.0s|haproxy[12345]: Server app_backend/app-01 is DOWN
```

### ground_truth.json format

```json
[
  {
    "delta_sec": 0.0,
    "label": "ROOT_CAUSE",
    "node_id": "db1",
    "line": "# Time: 2025-01-01T10:00:00.000000"
  }
]
```

---

## AIOps Integration (log_analyzer)

โหมด **AIOps** ส่ง log ทั้งหมดไปยัง log-analyzer ผ่าน HTTP POST พร้อม metadata ที่ครบถ้วนสำหรับงาน root-cause analysis

### Endpoint ที่ใช้

```
POST <log_analyzer_url>/ingest
Content-Type: application/json
```

default URL คือ `http://localhost:8200` (กำหนดได้ใน UI หรือ request body)

---

### Request Body

```json
{
  "tenant_id":   "logsim",
  "window_from": "2026-06-27T10:00:00Z",
  "window_to":   "2026-06-27T10:05:01Z",
  "entries": [ ... ]
}
```

| Field | ประเภท | คำอธิบาย |
|-------|--------|----------|
| `tenant_id` | string | กำหนดได้ใน UI (default `"logsim"`) |
| `window_from` | ISO 8601 UTC | timestamp ของ event แรก |
| `window_to` | ISO 8601 UTC | timestamp ของ event สุดท้าย + อย่างน้อย 1 วินาที |
| `entries` | array | log entry ทุกบรรทัดของ simulation |

---

### Log Entry Format

แต่ละ entry ใน `entries` มีโครงสร้างดังนี้:

```json
{
  "type":            "log",
  "_time":           "2026-06-27T10:01:30Z",
  "message":         "Connection refused to DB at 127.0.0.1:3306",
  "host":            "api-server",
  "hostname":        "logsim-001",
  "service":         "nginx",
  "severity_text":   "err",
  "severity_number": "17",
  "tenant_id":       "logsim",
  "asset_id":        "logsim-001",
  "structured_data.logsim.label":    "ROOT_CAUSE",
  "structured_data.logsim.node_id":  "node-3",
  "structured_data.logsim.scenario": "mysql_cascade"
}
```

#### คำอธิบายแต่ละ field

| Field | มาจาก | ตัวอย่าง |
|-------|-------|----------|
| `type` | hardcoded | `"log"` |
| `_time` | `base_ts` + `delta` ของ event | `"2026-06-27T10:01:30Z"` |
| `message` | log line ที่ simulator สร้าง (ทีละบรรทัด) | `"Deadlock found when trying to get lock"` |
| `host` | `node.label` จาก topology | `"mysql-primary"` |
| `hostname` | `asset_id` ที่กำหนดใน config | `"logsim-001"` |
| `service` | `node.tech` (เทคโนโลยีของ node) | `"mysql"`, `"nginx"`, `"redis"` |
| `severity_text` | แปลงจาก label (ดูตารางด้านล่าง) | `"err"` |
| `severity_number` | แปลงจาก label (ดูตารางด้านล่าง) | `"17"` |
| `tenant_id` | `log_analyzer_tenant_id` ใน config | `"logsim"` |
| `asset_id` | `log_analyzer_asset_id` ใน config | `"logsim-001"` |
| `structured_data.logsim.label` | ground truth label | `"ROOT_CAUSE"` |
| `structured_data.logsim.node_id` | ID ของ node ที่สร้าง log | `"node-3"` |
| `structured_data.logsim.scenario` | ชื่อ fault scenario | `"mysql_cascade"` |

> หมายเหตุ: ถ้า log line ของ event หนึ่งมีหลายบรรทัด (`\n`) ระบบจะแยกเป็นหลาย entry โดยแต่ละบรรทัดมี timestamp เดียวกัน

#### Label → Severity Mapping

| Label | `severity_text` | `severity_number` | ความหมาย |
|-------|----------------|-------------------|----------|
| `NORMAL` | `info` | `9` | traffic ปกติ |
| `RECOVERY_ATTEMPT` | `warning` | `13` | กำลังพยายาม recover |
| `PROPAGATION` | `err` | `17` | ผลกระทบที่แพร่กระจาย |
| `SYMPTOM` | `err` | `17` | อาการที่ user มองเห็น |
| `ROOT_CAUSE` | `err` | `17` | จุดเริ่มต้นของปัญหา |

`severity_number` ใช้มาตรฐาน [RFC 5424 syslog severity](https://datatracker.ietf.org/doc/html/rfc5424#section-6.2.1)

---

### สองโหมดการส่ง

#### Batch mode (default)

ใช้เมื่อ **ไม่ได้** เปิด streaming — simulator รัน scenario ให้เสร็จก่อน จากนั้นส่ง entries ทั้งหมดในครั้งเดียว

```
simulate() → รวบรวม events ทั้งหมด → POST /ingest (ครั้งเดียว)
```

**ข้อดี:** สามารถคำนวณ `window_from` / `window_to` ที่แม่นยำได้  
**ข้อเสีย:** log-analyzer ได้รับข้อมูลหลังจาก simulation เสร็จแล้วเท่านั้น

#### Streaming mode (continuous)

ใช้เมื่อเปิด **Continuous Streaming** — ส่ง batch ทุก ๆ ช่วงเวลาระหว่างที่ simulator กำลังทำงาน

```
simulate() → ส่ง batch ย่อย → ส่ง batch ย่อย → ... → simulation จบ
```

**ข้อดี:** log-analyzer ได้รับ log แบบ near-realtime  
**ข้อเสีย:** `window_to` ของแต่ละ batch คือ timestamp ของ event สุดท้ายใน batch นั้น

---

### Config Fields

| Field | Request body key | Default | UI Label |
|-------|-----------------|---------|----------|
| URL | `log_analyzer_url` | `http://localhost:8200` | AIOps URL |
| Tenant ID | `log_analyzer_tenant_id` | `logsim` | Tenant ID |
| Asset ID | `log_analyzer_asset_id` | `logsim-001` | Asset ID |

`tenant_id` และ `asset_id` ถูกฝังทั้งใน top-level payload และในแต่ละ entry เพื่อให้ log-analyzer filter ได้ทั้งสองระดับ

---

### ตัวอย่าง Payload เต็ม

```json
{
  "tenant_id":   "prod-cluster",
  "window_from": "2026-06-27T10:00:00Z",
  "window_to":   "2026-06-27T10:05:01Z",
  "entries": [
    {
      "type":            "log",
      "_time":           "2026-06-27T10:00:00Z",
      "message":         "InnoDB: page_cleaner: 1000ms intended loop took 4523ms",
      "host":            "mysql-primary",
      "hostname":        "prod-001",
      "service":         "mysql",
      "severity_text":   "err",
      "severity_number": "17",
      "tenant_id":       "prod-cluster",
      "asset_id":        "prod-001",
      "structured_data.logsim.label":    "ROOT_CAUSE",
      "structured_data.logsim.node_id":  "db-node-1",
      "structured_data.logsim.scenario": "mysql_cascade"
    },
    {
      "type":            "log",
      "_time":           "2026-06-27T10:00:11Z",
      "message":         "upstream timed out (110: Connection timed out) while reading response header from upstream",
      "host":            "api-server",
      "hostname":        "prod-001",
      "service":         "nginx",
      "severity_text":   "err",
      "severity_number": "17",
      "tenant_id":       "prod-cluster",
      "asset_id":        "prod-001",
      "structured_data.logsim.label":    "PROPAGATION",
      "structured_data.logsim.node_id":  "web-node-2",
      "structured_data.logsim.scenario": "mysql_cascade"
    }
  ]
}
```

---

## API Reference

| Method | Path | คำอธิบาย |
|--------|------|----------|
| `GET` | `/api/scenarios` | รายชื่อ scenario ทั้งหมด |
| `POST` | `/api/simulate` | เริ่ม simulation job |
| `GET` | `/api/jobs/{job_id}` | ดู status และผลลัพธ์ |
| `GET` | `/api/logs` | list ไฟล์ใน output directory |
| `GET` | `/api/logs/{filename}` | ดู N บรรทัดสุดท้ายของไฟล์ |
| `POST` | `/api/analysis-callback` | รับผล MoA analysis จาก log-analyzer (GodEye callback) |
| `GET` | `/api/analysis-results` | ดูผล analysis ที่ได้รับล่าสุด (max 20) |
| `GET` | `/health` | health check |

#### POST /api/simulate — request body

```jsonc
{
  "topology":          { "netNodes": [], "netEdges": [], "svcNodes": [], "svcEdges": [] },
  "scenario":          "mysql_cascade",
  "mix_baseline":      true,
  "output_dest":       "file",            // "file" | "rsyslog_udp" | "victoria_logs"
  "output_dir":        "/tmp/logsim2_output",  // ใช้เมื่อ output_dest = "file"
  "rsyslog_host":      "127.0.0.1",       // ใช้เมื่อ output_dest = "rsyslog_udp"
  "rsyslog_port":      514,
  "victoria_logs_url":        "http://localhost:9428/insert/jsonline",  // victoria_logs
  "log_analyzer_url":         "http://localhost:8200",   // log_analyzer
  "log_analyzer_tenant_id":   "logsim",
  "log_analyzer_asset_id":    "logsim-001"
}
```

ดูรายละเอียดได้ที่ http://localhost:8071/docs

---

## โครงสร้างโปรเจกต์

```
logsim2/
├── run.sh                    ← รันทั้งสองบริการในคำสั่งเดียว
├── docs/
│   ├── ARCHITECTURE.md       ← ออกแบบระบบและ data flow
│   ├── SCENARIOS.md          ← วิธีเพิ่ม fault scenario
│   └── TOPOLOGY_FORMAT.md    ← JSON import/export schema
├── backend/
│   ├── topology.py           ← dataclasses (NetNode, SvcNode, ...)
│   ├── formatters.py         ← log format generators
│   ├── scenarios.py          ← 5 fault scenarios
│   ├── simulate.py           ← simulation engine
│   └── main.py               ← FastAPI routes
└── frontend/
    └── src/
        ├── types/topology.ts ← TypeScript types + constants
        ├── app/page.tsx      ← main page (state orchestration)
        └── components/
            ├── TopologyCanvas.tsx
            ├── NodePanel.tsx
            ├── SimulationDrawer.tsx
            ├── LogPreview.tsx
            ├── GodEyePanel.tsx
            ├── AnalysisResultsPanel.tsx   ← แสดงผล MoA callback จาก log-analyzer
            └── Toast.tsx
```

---

## สิทธิ์การใช้งาน

MIT License
