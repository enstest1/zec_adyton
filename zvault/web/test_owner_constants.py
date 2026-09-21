#!/usr/bin/env python3
"""
Owner-constant consistency — TREASURY (and LAUNCH_HEIGHT if the page sets it)
must match between zcash/indexer.py and web/js/config.js.

Fails if they differ. Also fails while either still holds the known
placeholder, so a matching placeholder cannot accidentally satisfy the gate.

    python web/test_owner_constants.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEXER = ROOT / "zcash" / "indexer.py"
CONFIG = ROOT / "web" / "js" / "config.js"

# Exact placeholder shipped until the owner sets a real address.
PLACEHOLDER_TREASURY = "t1ZVaultTreasuryAddressGoesHere00000"


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

    py_t = _py_str("TREASURY", py)
    js_t = _js_str("TREASURY", js)
    if py_t is None:
        fails.append("indexer.py missing TREASURY string")
    if js_t is None:
        fails.append("config.js missing TREASURY export")
    if py_t is not None and js_t is not None:
        if py_t != js_t:
            fails.append(
                f"TREASURY mismatch: indexer={py_t!r} config.js={js_t!r} "
                f"— every mint would be underpaid after the user paid"
            )
        if py_t == PLACEHOLDER_TREASURY or js_t == PLACEHOLDER_TREASURY:
            fails.append(
                "TREASURY is still the placeholder "
                f"({PLACEHOLDER_TREASURY!r}). Owner must set the real "
                "transparent address in BOTH indexer.py and web/js/config.js "
                "before launch. Matching placeholders do not pass this gate."
            )

    # LAUNCH_HEIGHT: only enforce cross-file match if the page exports it.
    py_h = _py_int("LAUNCH_HEIGHT", py)
    js_h = _js_num("LAUNCH_HEIGHT", js)
    if js_h is not None:
        if py_h is None:
            fails.append("config.js has LAUNCH_HEIGHT but indexer.py does not")
        elif py_h != js_h:
            fails.append(
                f"LAUNCH_HEIGHT mismatch: indexer={py_h} config.js={js_h}"
            )

    if fails:
        print("FAIL owner-constant consistency:")
        for f in fails:
            print(f"  - {f}")
        return 1

    print(f"ok  TREASURY matches and is set ({py_t[:8]}…)")
    if js_h is not None:
        print(f"ok  LAUNCH_HEIGHT matches ({py_h})")
    else:
        print("ok  LAUNCH_HEIGHT not referenced by page (indexer-only)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
