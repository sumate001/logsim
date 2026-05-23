"""
GodEye API client — api-iam login + api-inventory CRUD.
No third-party deps; uses stdlib urllib only.
"""
import json
import urllib.error as _err
import urllib.request as _req
from typing import Optional


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post(url: str, body: dict, jwt: Optional[str] = None) -> dict:
    data = json.dumps(body).encode()
    headers = {"Content-Type": "application/json"}
    if jwt:
        headers["Authorization"] = f"Bearer {jwt}"
    request = _req.Request(url, data=data, headers=headers, method="POST")
    try:
        with _req.urlopen(request, timeout=10) as resp:
            return json.loads(resp.read())
    except _err.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {exc.reason}: {body_text}") from exc


def _delete(url: str, jwt: str) -> None:
    request = _req.Request(
        url,
        headers={"Authorization": f"Bearer {jwt}"},
        method="DELETE",
    )
    try:
        with _req.urlopen(request, timeout=10):
            pass
    except _err.HTTPError as exc:
        if exc.code == 404:
            return   # already gone — treat as success
        body_text = exc.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body_text}") from exc


def _get(url: str, timeout: int = 5) -> bool:
    """Return True if the URL responds with 2xx."""
    try:
        with _req.urlopen(url, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def login(iam_url: str, email: str, password: str) -> str:
    """
    POST {iam_url}/auth/login → returns JWT access_token string.
    Raises RuntimeError on failure.
    """
    url = iam_url.rstrip("/") + "/auth/login"
    resp = _post(url, {"email": email, "password": password})
    try:
        return resp["data"]["access_token"]
    except KeyError:
        raise RuntimeError(f"Unexpected login response: {resp}")


def register_asset(
    inventory_url: str,
    jwt: str,
    name: str,
    asset_class: str = "linux",
    asset_type: str = "server",
    ip: str = "",
    tenant_id: str = "internal",
) -> str:
    """
    POST {inventory_url}/assets → returns the new asset's id string.
    Raises RuntimeError on failure.
    """
    url = inventory_url.rstrip("/") + "/assets"
    body = {
        "name": name,
        "type": asset_type,
        "class": asset_class,
        "ip": ip,
        "description": f"LogSim2 simulated host [{tenant_id}]",
        "tags": [
            {"key": "logsim2", "value": "true"},
            {"key": "tenant_id", "value": tenant_id},
        ],
    }
    resp = _post(url, body, jwt=jwt)
    try:
        return resp["data"]["id"]
    except KeyError:
        raise RuntimeError(f"Unexpected register_asset response: {resp}")


def delete_asset(inventory_url: str, jwt: str, asset_id: str) -> None:
    """DELETE {inventory_url}/assets/{asset_id}. Silently ignores 404."""
    url = inventory_url.rstrip("/") + f"/assets/{asset_id}"
    _delete(url, jwt)


def check_endpoint(url: str, path: str = "/health") -> bool:
    """Return True if {url}{path} responds 2xx within 5 s."""
    return _get(url.rstrip("/") + path)
