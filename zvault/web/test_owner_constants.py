#!/usr/bin/env python3
"""
Owner-constant consistency — MAINNET pair only (X1).

Testnet TREASURY/LAUNCH_HEIGHT may be set freely for dry runs and are not
gated here. Matching mainnet placeholders still fail.

    python web/test_owner_constants.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEXER = ROOT / "zcash" / "indexer.py"
CONFIG = ROOT / "web" / "js" / "config.js"

PLACEHOLDER_TREASURY_MAINNET = "t1ZVaultTreasuryAddressGoesHere00000"


def _py_str(name: str, text: str) -> str | None:
    m = re.search(rf'^{name}\s*=\s*"([^"]+)"', text, re.M)
    return m.group(1) if m else None


def _py_int(name: str, text: str) -> int | None:
    m = re.search(rf'^{name}\s*=\s*([0-9_]+)', text, re.M)
    if not m:
        return None
    return int(m.group(1).replace("_", ""))


def _js_str(name: str, text: str) -> str | None:
    m = re.search(rf'export const {name}\s*=\s*"([^"]+)"', text)
    return m.group(1) if m else None


def _js_num(name: str, text: str) -> int | None:
    m = re.search(rf'export const {name}\s*=\s*([0-9_]+)', text)
    if not m:
        return None
    return int(m.group(1).replace("_", ""))


def main() -> int:
    fails = []
    py = INDEXER.read_text(encoding="utf-8")
    js = CONFIG.read_text(encoding="utf-8")

    py_t = _py_str("TREASURY_MAINNET", py)
    js_t = _js_str("TREASURY_MAINNET", js)
    if py_t is None:
        fails.append("indexer.py missing TREASURY_MAINNET")
    if js_t is None:
        fails.append("config.js missing TREASURY_MAINNET")
    if py_t is not None and js_t is not None:
        if py_t != js_t:
            fails.append(
                f"TREASURY_MAINNET mismatch: indexer={py_t!r} config.js={js_t!r}"
            )
        if py_t == PLACEHOLDER_TREASURY_MAINNET or js_t == PLACEHOLDER_TREASURY_MAINNET:
            fails.append(
                "TREASURY_MAINNET is still the placeholder "
                f"({PLACEHOLDER_TREASURY_MAINNET!r}). Owner must set the real "
                "mainnet transparent address in BOTH files before launch. "
                "Matching placeholders do not pass. Testnet is gated separately."
            )

    py_h = _py_int("LAUNCH_HEIGHT_MAINNET", py)
    js_h = _js_num("LAUNCH_HEIGHT_MAINNET", js)
    if py_h is None:
        fails.append("indexer.py missing LAUNCH_HEIGHT_MAINNET")
    if js_h is None:
        fails.append("config.js missing LAUNCH_HEIGHT_MAINNET")
    if py_h is not None and js_h is not None and py_h != js_h:
        fails.append(
            f"LAUNCH_HEIGHT_MAINNET mismatch: indexer={py_h} config.js={js_h}"
        )

    # Cross-file testnet pair should also match when both present (no placeholder gate).
    py_tt = _py_str("TREASURY_TESTNET", py)
    js_tt = _js_str("TREASURY_TESTNET", js)
    if py_tt and js_tt and py_tt != js_tt:
        fails.append(f"TREASURY_TESTNET mismatch: indexer={py_tt!r} config={js_tt!r}")

    if fails:
        print("FAIL owner-constant consistency (mainnet gate):")
        for f in fails:
            print(f"  - {f}")
        return 1

    print(f"ok  TREASURY_MAINNET matches ({py_t[:8]}…) — still placeholder (expected pre-launch)")
    print(f"ok  LAUNCH_HEIGHT_MAINNET matches ({py_h})")
    return 0


if __name__ == "__main__":
    # Pre-launch: we EXPECT failure while mainnet treasury is placeholder.
    # Exit 1 is the green "gate is armed" signal — document that.
    code = main()
    sys.exit(code)
