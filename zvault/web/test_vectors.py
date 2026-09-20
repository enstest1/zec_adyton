#!/usr/bin/env python3
"""
CI gate: regenerate vectors from indexer.py and fail if web/vectors.json drifts.

    python web/test_vectors.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import gen_vectors  # noqa: E402


def main() -> int:
    expected_path = ROOT / "vectors.json"
    if not expected_path.exists():
        print("FAIL: web/vectors.json missing — run python web/gen_vectors.py",
              file=sys.stderr)
        return 1

    on_disk = expected_path.read_text(encoding="utf-8")
    fresh = json.dumps(gen_vectors.build_fixture(), indent=2, sort_keys=True) + "\n"

    if on_disk != fresh:
        print("FAIL: web/vectors.json is stale vs indexer.py", file=sys.stderr)
        print("  Re-run: python web/gen_vectors.py", file=sys.stderr)
        print("  Only after a deliberate protocol version bump.", file=sys.stderr)
        # Show a short hint of where it diverged
        a, b = on_disk.splitlines(), fresh.splitlines()
        for i, (x, y) in enumerate(zip(a, b)):
            if x != y:
                print(f"  first diff at line {i + 1}:", file=sys.stderr)
                print(f"    disk: {x[:120]}", file=sys.stderr)
                print(f"    regen:{y[:120]}", file=sys.stderr)
                break
        else:
            print(f"  length disk={len(a)} regen={len(b)}", file=sys.stderr)
        return 1

    n = json.loads(on_disk)["meta"]["case_count"]
    print(f"ok  vectors.json matches indexer.py ({n} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
