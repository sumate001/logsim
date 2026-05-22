from dataclasses import dataclass, field
from typing import List
from enum import Enum


class NodeRole(str, Enum):
    ROUTER = "router"
    FIREWALL = "firewall"
    SERVER = "server"
    DB = "db"
    CLIENT = "client"
    SERVICE = "service"
    LB = "lb"
    CACHE = "cache"


class NodeTech(str, Enum):
    CISCO_IOS = "cisco_ios"
    NGINX = "nginx"
    HAPROXY = "haproxy"
    PYTHON = "python"
    NODEJS = "nodejs"
    MYSQL = "mysql"
    REDIS = "redis"
    LINUX = "linux"
    GENERIC = "generic"


@dataclass
class NetNode:
    id: str
    label: str
    role: NodeRole
    tech: NodeTech
    ip: str = ""
    os: str = ""
    x: float = 0
    y: float = 0


@dataclass
class NetEdge:
    id: str
    source: str
    target: str
    protocol: str = "TCP"
    port: int = 80
    critical: bool = True
    call_rate: float = 100.0


@dataclass
class SvcNode:
    id: str
    label: str
    tech: NodeTech
    role: NodeRole = NodeRole.SERVICE
    ip: str = ""
    x: float = 0
    y: float = 0


@dataclass
class SvcEdge:
    id: str
    source: str
    target: str
    protocol: str = "HTTP"
    port: int = 80
    critical: bool = True
    call_rate: float = 100.0


@dataclass
class Topology:
    net_nodes: List[NetNode] = field(default_factory=list)
    net_edges: List[NetEdge] = field(default_factory=list)
    svc_nodes: List[SvcNode] = field(default_factory=list)
    svc_edges: List[SvcEdge] = field(default_factory=list)
