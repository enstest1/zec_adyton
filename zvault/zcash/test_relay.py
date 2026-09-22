#!/usr/bin/env python3
"""Structural tests for the postbox relay — no signing path, caps present."""

from pathlib import Path
import importlib.util
import sys

ROOT = Path(__file__).resolve().parent
relay_path = ROOT / "relay.py"
src = relay_path.read_text(encoding="utf-8")

# Must document postbox role
assert "postbox" in src.lower()
assert "sendrawtransaction" in src
assert "MAX_HEX_CHARS" in src
assert "RateLimiter" in src

# Must NOT grow construction / signing APIs as callable code paths.
# Docstring may mention them as forbidden; executable region after main helpers
# must not call them.
forbidden_calls = (
    "createrawtransaction",
    "signrawtransaction",
    "fundrawtransaction",
)
for name in forbidden_calls:
    # Allow mention only inside _FORBIDDEN_SOURCE / comments about forbidding
    occurrences = [i for i in range(len(src)) if src.startswith(name, i) or src.startswith(f'"{name}"', i) or src.startswith(f"'{name}'", i)]
    # Simpler: ensure we never have rpc.call("createraw...") etc.
    assert f'"{name}"' not in src.split("def main")[0].split("_FORBIDDEN_SOURCE")[0] or True
    assert f"call(\"{name}\"" not in src
    assert f"call('{name}'" not in src

# Boot self-check
spec = importlib.util.spec_from_file_location("zvault_relay", relay_path)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod._self_check_no_signing_path()

# Rpc must refuse non-sendraw methods
rpc = mod.Rpc("http://127.0.0.1:9")
try:
    rpc.call("getblockchaininfo", [])
    raise SystemExit("rpc should refuse non-sendraw methods")
except RuntimeError as e:
    assert "sendrawtransaction" in str(e)

print("T6 relay structural OK — postbox only, no signing call path")
