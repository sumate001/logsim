export type NodeRole =
  | "router"
  | "firewall"
  | "server"
  | "db"
  | "client"
  | "service"
  | "lb"
  | "cache";

export type NodeTech =
  | "cisco_ios"
  | "nginx"
  | "haproxy"
  | "python"
  | "nodejs"
  | "mysql"
  | "redis"
  | "linux"
  | "generic";

export interface TopologyNode {
  id: string;
  label: string;
  role: NodeRole;
  tech: NodeTech;
  ip: string;
  os: string;
  x: number;
  y: number;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  protocol: string;
  port: number;
  critical: boolean;
  callRate: number;
}

export interface TopologyData {
  netNodes: TopologyNode[];
  netEdges: TopologyEdge[];
  svcNodes: TopologyNode[];
  svcEdges: TopologyEdge[];
}

export type Selection = { type: "node" | "edge"; id: string } | null;
export type CanvasMode = "select" | "add-edge";

// Role → default tech
export const ROLE_DEFAULT_TECH: Record<NodeRole, NodeTech> = {
  router: "cisco_ios",
  firewall: "cisco_ios",
  lb: "haproxy",
  server: "nginx",
  service: "python",
  db: "mysql",
  cache: "redis",
  client: "generic",
};

// Node colour by role
export const NODE_COLOR: Record<NodeRole, string> = {
  router: "#3B82F6",
  firewall: "#3B82F6",
  lb: "#3B82F6",
  server: "#22C55E",
  service: "#22C55E",
  db: "#14B8A6",
  cache: "#14B8A6",
  client: "#F59E0B",
};

export const ELLIPSE_ROLES: NodeRole[] = ["db", "cache"];

// Toolbar node buttons
export const TOOLBAR_NODES: { label: string; role: NodeRole }[] = [
  { label: "Router / FW", role: "router" },
  { label: "Server",      role: "server"  },
  { label: "DB",          role: "db"      },
  { label: "Client",      role: "client"  },
  { label: "Service",     role: "service" },
  { label: "LB",          role: "lb"      },
  { label: "Cache",       role: "cache"   },
];
