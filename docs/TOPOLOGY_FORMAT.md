# Topology JSON Format

รูปแบบ JSON ที่ใช้สำหรับ Import / Export topology ใน LogSim2

---

## โครงสร้างหลัก

```json
{
  "network_topology": {
    "nodes": [ ...NetNode ],
    "edges": [ ...NetEdge ]
  },
  "service_dependency": {
    "nodes": [ ...SvcNode ],
    "edges": [ ...SvcEdge ]
  }
}
```

ทั้งสอง section เป็น optional — ถ้าไม่มีจะถือว่าเป็น array ว่าง

---

## Node Object

```json
{
  "id":    "lb1",
  "label": "Load Balancer",
  "role":  "lb",
  "tech":  "haproxy",
  "ip":    "10.0.0.10",
  "os":    "Ubuntu 22.04",
  "x":     340,
  "y":     160
}
```

| Field | Type | Required | ค่าที่รับ |
|-------|------|----------|-----------|
| `id` | string | ✓ | ค่าใดก็ได้ (unique ภายใน section) |
| `label` | string | — | ชื่อแสดงบน canvas |
| `role` | string | — | ดูตาราง NodeRole ด้านล่าง |
| `tech` | string | — | ดูตาราง NodeTech ด้านล่าง |
| `ip` | string | — | IP address หรือ CIDR |
| `os` | string | — | ข้อความอิสระ |
| `x` | number | — | ตำแหน่งบน canvas (pixel) |
| `y` | number | — | ตำแหน่งบน canvas (pixel) |

### NodeRole

| ค่า | คำอธิบาย | รูปร่าง | สี |
|-----|---------|---------|-----|
| `router` | Router | สี่เหลี่ยม | น้ำเงิน |
| `firewall` | Firewall | สี่เหลี่ยม | น้ำเงิน |
| `lb` | Load Balancer | สี่เหลี่ยม | น้ำเงิน |
| `server` | Web/App Server | สี่เหลี่ยม | เขียว |
| `service` | Microservice | สี่เหลี่ยม | เขียว |
| `db` | Database | วงรี | teal |
| `cache` | Cache | วงรี | teal |
| `client` | Client / User | สี่เหลี่ยม | เหลือง |

ค่าที่ไม่รู้จักจะถูก coerce เป็น `server`

### NodeTech

| ค่า | Technology | Log format ที่สร้าง |
|-----|------------|---------------------|
| `cisco_ios` | Cisco IOS | `%SEC-6-IPACCESSLOGP`, `%LINEPROTO-5-UPDOWN` |
| `nginx` | Nginx | combined access log, `[error] upstream timed out` |
| `haproxy` | HAProxy | `haproxy[pid]: client [...] frontend~ backend/server` |
| `python` | Python / uvicorn | `ISO_TS LEVEL logger: message` |
| `nodejs` | Node.js | `[ISO_TS] LEVEL [req_id] message` |
| `mysql` | MySQL 8 | `# Time / # User@Host / # Query_time` slow query |
| `redis` | Redis 7 | `pid:M date * message`, `# WARNING` |
| `linux` | Linux syslog | `Mon DD HH:MM:SS host proc[pid]: message` |
| `generic` | ไม่สร้าง log เอง | ใช้กับ client node |

ค่าที่ไม่รู้จักจะถูก coerce เป็น `generic`

---

## Edge Object

```json
{
  "id":       "lb1->web1",
  "source":   "lb1",
  "target":   "web1",
  "protocol": "HTTP",
  "port":     80,
  "critical": true,
  "callRate": 245
}
```

| Field | Aliases | Type | Required | Default |
|-------|---------|------|----------|---------|
| `id` | — | string | — | auto-generated |
| `source` | `src` | string | ✓ | — |
| `target` | `dst` | string | ✓ | — |
| `protocol` | `proto` | string | — | `"TCP"` |
| `port` | — | number | — | `80` |
| `critical` | — | boolean | — | `true` |
| `callRate` | `call_rate`, `rate` | number | — | `100` |

**Aliases** — parser รับทั้งสองชื่อ โดย canonical name มีความสำคัญกว่า:
- `source` มีความสำคัญกว่า `src`
- `target` มีความสำคัญกว่า `dst`
- `protocol` มีความสำคัญกว่า `proto`
- `callRate` > `call_rate` > `rate`

**Edge validation**: edge ที่มี `source` หรือ `target` ไม่ตรงกับ node id ที่มีอยู่จะถูก**ทิ้ง**อัตโนมัติ

### Protocol ที่แนะนำ

`TCP`, `UDP`, `HTTP`, `HTTPS`, `gRPC`, `WebSocket`, `ICMP`  
(ค่าอื่นก็ได้ — ใช้แสดงบน edge label เท่านั้น)

---

## ตัวอย่างไฟล์สมบูรณ์

```json
{
  "network_topology": {
    "nodes": [
      {
        "id": "client1",
        "label": "Browser",
        "role": "client",
        "tech": "generic",
        "ip": "0.0.0.0/0",
        "os": "",
        "x": 400,
        "y": 40
      },
      {
        "id": "fw1",
        "label": "Firewall",
        "role": "firewall",
        "tech": "cisco_ios",
        "ip": "203.0.113.1",
        "os": "Cisco IOS 15.7",
        "x": 400,
        "y": 160
      },
      {
        "id": "lb1",
        "label": "HAProxy",
        "role": "lb",
        "tech": "haproxy",
        "ip": "10.0.0.10",
        "os": "Ubuntu 22.04",
        "x": 400,
        "y": 280
      },
      {
        "id": "web1",
        "label": "Nginx",
        "role": "server",
        "tech": "nginx",
        "ip": "10.0.1.11",
        "os": "Ubuntu 22.04",
        "x": 200,
        "y": 400
      },
      {
        "id": "db1",
        "label": "MySQL",
        "role": "db",
        "tech": "mysql",
        "ip": "10.0.2.20",
        "os": "Ubuntu 22.04",
        "x": 400,
        "y": 520
      },
      {
        "id": "cache1",
        "label": "Redis",
        "role": "cache",
        "tech": "redis",
        "ip": "10.0.2.21",
        "os": "Ubuntu 22.04",
        "x": 600,
        "y": 520
      }
    ],
    "edges": [
      { "id": "client1->fw1",  "src": "client1", "dst": "fw1",   "proto": "HTTPS", "port": 443,  "critical": true,  "rate": 500 },
      { "id": "fw1->lb1",      "src": "fw1",     "dst": "lb1",   "proto": "HTTPS", "port": 443,  "critical": true,  "rate": 490 },
      { "id": "lb1->web1",     "src": "lb1",     "dst": "web1",  "proto": "HTTP",  "port": 80,   "critical": true,  "rate": 490 },
      { "id": "web1->db1",     "src": "web1",    "dst": "db1",   "proto": "TCP",   "port": 3306, "critical": true,  "rate": 120 },
      { "id": "web1->cache1",  "src": "web1",    "dst": "cache1","proto": "TCP",   "port": 6379, "critical": false, "rate": 300 }
    ]
  },
  "service_dependency": {
    "nodes": [
      { "id": "svc_api",   "label": "api-service",  "role": "service", "tech": "python", "ip": "10.0.1.11", "x": 400, "y": 80  },
      { "id": "svc_auth",  "label": "auth-service", "role": "service", "tech": "nodejs", "ip": "10.0.1.12", "x": 200, "y": 200 },
      { "id": "svc_db",    "label": "mysql",        "role": "db",      "tech": "mysql",  "ip": "10.0.2.20", "x": 300, "y": 340 },
      { "id": "svc_cache", "label": "redis",        "role": "cache",   "tech": "redis",  "ip": "10.0.2.21", "x": 500, "y": 340 }
    ],
    "edges": [
      { "id": "api->auth",  "src": "svc_api",  "dst": "svc_auth",  "proto": "HTTP", "port": 3000, "critical": true,  "rate": 200 },
      { "id": "api->db",    "src": "svc_api",  "dst": "svc_db",    "proto": "TCP",  "port": 3306, "critical": true,  "rate": 120 },
      { "id": "api->cache", "src": "svc_api",  "dst": "svc_cache", "proto": "TCP",  "port": 6379, "critical": false, "rate": 300 },
      { "id": "auth->db",   "src": "svc_auth", "dst": "svc_db",    "proto": "TCP",  "port": 3306, "critical": true,  "rate": 50  }
    ]
  }
}
```

---

## Auto-layout

ถ้า node ส่วนใหญ่มี `x: 0, y: 0` (หรือมากกว่าครึ่งอยู่ที่ origin) parser จะจัดวางอัตโนมัติเป็น grid:

```
col = ceil(sqrt(n_nodes))
node[i].x = (i % col) * 200 + 80
node[i].y = floor(i / col) * 160 + 80
```

ถ้าไฟล์มีพิกัดที่มีความหมาย (ไม่ใช่ทั้งหมดอยู่ที่ origin) พิกัดจะถูกใช้ตามเดิม

---

## Round-trip (Export → Import)

ไฟล์ที่ Export จาก LogSim2 ใช้ canonical field names (`source`, `target`, `protocol`, `callRate`)  
และสามารถ Import กลับได้โดยไม่สูญเสียข้อมูล

```bash
# Export จาก UI แล้ว import กลับ → topology เหมือนเดิมทุก field
```

---

## ข้อจำกัด

- `id` ของ node ต้อง unique **ภายใน section** (net หรือ svc) — แต่ข้าม section ได้
- Edge ที่อ้าง node id ที่ไม่มีจะถูกทิ้งโดยไม่มี error
- ขนาดไฟล์ไม่มีการจำกัด แต่ topology ที่ใหญ่มาก (>500 nodes) อาจทำให้ canvas ช้า
