# LogSim2 — Topology-Aware Log Simulator

สร้างโทโพโลยีเครือข่ายหรือ service dependency ด้วย drag-and-drop แล้วรัน fault scenario เพื่อสร้าง log ที่สมจริงพร้อม ground truth label สำหรับทดสอบ AIOps, log parser, หรือ anomaly detection model

---

## ภาพรวม

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Next.js :3000)                                        │
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
│  FastAPI Backend (:8000)                                        │
│  scenarios.py → simulate.py → per-source .log files            │
│                             → ground_truth.json / .log         │
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
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000 |
| Swagger UI | http://localhost:8000/docs |

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
uvicorn main:app --reload --port 8000
```
</details>

<details>
<summary>Frontend</summary>

```bash
cd frontend
npm install
npm run dev                      # เปิดที่ http://localhost:3000
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
4. กำหนด output directory
5. คลิก **Start Simulation**
6. ดูผลลัพธ์: stats cards, attack schedule, และไฟล์ log
7. คลิกไฟล์ log ใดก็ได้เพื่อ preview พร้อม color-coded labels

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

หลังจาก simulate เสร็จ จะมีไฟล์ใน output directory:

```
/tmp/logsim2_output/
├── {node_label}_{tech}.log    # log ต่อ node source (เช่น mysql_db_mysql.log)
├── ground_truth.log           # LABEL|node_id|+delta_s|first_line
└── ground_truth.json          # structured version สำหรับ machine consumption
```

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

## API Reference

| Method | Path | คำอธิบาย |
|--------|------|----------|
| `GET` | `/api/scenarios` | รายชื่อ scenario ทั้งหมด |
| `POST` | `/api/simulate` | เริ่ม simulation job |
| `GET` | `/api/jobs/{job_id}` | ดู status และผลลัพธ์ |
| `GET` | `/api/logs` | list ไฟล์ใน output directory |
| `GET` | `/api/logs/{filename}` | ดู N บรรทัดสุดท้ายของไฟล์ |
| `GET` | `/health` | health check |

ดูรายละเอียดได้ที่ http://localhost:8000/docs

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
            └── Toast.tsx
```

---

## สิทธิ์การใช้งาน

MIT License
