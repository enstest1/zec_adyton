#!/usr/bin/env python3
"""
ZVAULT broadcast relay — a POSTBOX and nothing more.

POST /broadcast  { "hex": "<signed transaction hex>" }
  → calls node sendrawtransaction, returns { "txid": "..." } or error.

STRUCTURAL CONSTRAINTS (enforced by design, not convention):
  - This process NEVER constructs, modifies, or signs a transaction.
  - It NEVER holds funds or private keys.
  - It NEVER imports signing / wallet / key material modules.
  - It only accepts already-signed bytes and forwards them to the node.

The relay is a convenience. A user can always take the same signed hex
shown on the mint page and broadcast it themselves (zcash-cli, explorer,
or any other RPC). See RUNBOOK.md.

Rate limit + size cap prevent use as a general-purpose broadcast service.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# ---------------------------------------------------------------------------
# Caps — keep this a mint/reveal postbox, not a public mempool gateway.
# ---------------------------------------------------------------------------
MAX_HEX_CHARS = 200_000  # ~100 KB raw; mint/reveal txs are << this
MAX_REQUESTS_PER_MINUTE = 6
MAX_BODY_BYTES = MAX_HEX_CHARS + 512

# Forbidden tokens in THIS file's own source (self-check at startup).
# If someone adds a signing path, the process refuses to start.
_FORBIDDEN_SOURCE = (
    "signrawtransaction",
    "createrawtransaction",
    "fundrawtransaction",
    "private_key",
    "privkey",
    "wif",
    "secp256k1",
    "ecdsa",
    "keyfile",
)


def _self_check_no_signing_path() -> None:
    """Refuse to boot if this module grows a signing / construction path."""
    src = Path(__file__).read_text(encoding="utf-8").lower()
    # Allow the forbidden list itself and this docstring's mentions.
    body = src.split("_FORBIDDEN_SOURCE", 1)[-1] if "_FORBIDDEN_SOURCE" in src else src
    # Scan only code after the constant definition + self-check function.
    marker = "def _self_check_no_signing_path"
    after = src.split(marker, 1)[-1] if marker in src else src
    for tok in _FORBIDDEN_SOURCE:
        if tok in after:
            raise SystemExit(
                f"relay.py structural violation: found '{tok}' after self-check — "
                "signing / construction code is forbidden in the postbox"
            )


class Rpc:
    """JSON-RPC client: sendrawtransaction only from this module's perspective."""

    def __init__(self, url: str, user: str | None = None, password: str | None = None):
        self.url = url
        self.auth = None
        if user is not None:
            import base64

            self.auth = base64.b64encode(f"{user}:{password or ''}".encode()).decode()

    def call(self, method: str, params: list | None = None):
        # Only allow the one method the postbox needs.
        if method != "sendrawtransaction":
            raise RuntimeError(f"relay may only call sendrawtransaction (got {method})")
        body = json.dumps(
            {"jsonrpc": "1.0", "id": "zvault-relay", "method": method, "params": params or []}
        ).encode()
        req = urllib.request.Request(
            self.url, data=body, headers={"Content-Type": "application/json"}
        )
        if self.auth:
            req.add_header("Authorization", f"Basic {self.auth}")
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.loads(r.read())
        if out.get("error"):
            raise RuntimeError(str(out["error"]))
        return out["result"]


class RateLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.time()
        q = self._hits[key]
        while q and now - q[0] > 60.0:
            q.popleft()
        if len(q) >= self.per_minute:
            return False
        q.append(now)
        return True


def make_handler(rpc: Rpc, limiter: RateLimiter):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

        def _json(self, code: int, obj: dict):
            data = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self):
            if self.path in ("/", "/health"):
                self._json(
                    200,
                    {
                        "service": "zvault-relay",
                        "role": "postbox",
                        "methods": ["POST /broadcast"],
                        "note": (
                            "Convenience only — broadcast the same signed hex yourself "
                            "via any node sendrawtransaction."
                        ),
                    },
                )
                return
            self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path.rstrip("/") != "/broadcast":
                self._json(404, {"error": "not found"})
                return
            ip = self.client_address[0]
            if not limiter.allow(ip):
                self._json(429, {"error": "rate limit — retry later"})
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_BODY_BYTES:
                self._json(413, {"error": f"body size cap {MAX_BODY_BYTES} bytes"})
                return
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except Exception:
                self._json(400, {"error": "JSON body required: {\"hex\":\"...\"}"})
                return
            if not isinstance(payload, dict) or set(payload.keys()) - {"hex"}:
                self._json(
                    400,
                    {
                        "error": "only key allowed is 'hex' (already-signed transaction bytes)"
                    },
                )
                return
            hx = payload.get("hex")
            if not isinstance(hx, str) or not hx:
                self._json(400, {"error": "hex string required"})
                return
            hx = hx.strip().lower().replace("0x", "")
            if len(hx) > MAX_HEX_CHARS:
                self._json(413, {"error": f"hex longer than {MAX_HEX_CHARS} chars"})
                return
            if len(hx) % 2 or any(c not in "0123456789abcdef" for c in hx):
                self._json(400, {"error": "hex must be even-length [0-9a-f]"})
                return
            try:
                txid = rpc.call("sendrawtransaction", [hx])
            except Exception as e:
                self._json(502, {"error": f"sendrawtransaction failed: {e}"})
                return
            self._json(200, {"txid": txid})

    return Handler


def main():
    _self_check_no_signing_path()
    ap = argparse.ArgumentParser(description="ZVAULT signed-tx postbox relay")
    ap.add_argument("--rpc-url", default="http://127.0.0.1:8232")
    ap.add_argument("--rpc-user", default=None)
    ap.add_argument("--rpc-password", default=None)
    ap.add_argument("--bind", default="127.0.0.1:8091")
    ap.add_argument("--rate", type=int, default=MAX_REQUESTS_PER_MINUTE)
    args = ap.parse_args()
    host, _, port_s = args.bind.partition(":")
    port = int(port_s or "8091")
    rpc = Rpc(args.rpc_url, args.rpc_user, args.rpc_password)
    limiter = RateLimiter(args.rate)
    httpd = ThreadingHTTPServer((host, port), make_handler(rpc, limiter))
    print(
        f"zvault-relay postbox on http://{host}:{port}/broadcast "
        f"(rpc={args.rpc_url}, rate={args.rate}/min, max_hex={MAX_HEX_CHARS})",
        flush=True,
    )
    httpd.serve_forever()


if __name__ == "__main__":
    main()
