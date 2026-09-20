#!/usr/bin/env python3
"""
Generate web/vectors.json from zcash/indexer.py — the cross-language contract.

    python web/gen_vectors.py          # write web/vectors.json
    python web/test_vectors.py         # regen + diff (CI gate)

Do not edit vectors.json by hand. Do not change indexer rules to make vectors
pass — if they drift, the protocol moved and the fixture must be regenerated
deliberately after a version bump.
"""

from __future__ import annotations

import hashlib
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ZCASH = ROOT.parent / "zcash"
sys.path.insert(0, str(ZCASH))

import indexer as ix  # noqa: E402

OUT = ROOT / "vectors.json"
PROTOCOL_COMMIT = "494dfcc5aba6bc4335bdcd38b58524c02dc5e3f6"
# Frozen self-test digest at protocol freeze — vectors must not require
# changing indexer.py. Documented for operators; not re-run here.
FROZEN_DIGEST = "8610526427bb0463e04bee22ee40765e8b04affee66f042fb11d50d5ac905e86"


def _h(b: bytes) -> str:
    return b.hex()


def _det_bytes(label: str, n: int) -> bytes:
    """Deterministic n-byte material from a label (no RNG in the fixture)."""
    out = b""
    counter = 0
    while len(out) < n:
        out += hashlib.sha256(f"{label}:{counter}".encode()).digest()
        counter += 1
    return out[:n]


def build_fixture() -> dict:
    cases = {
        "meta": {
            "protocol_commit": PROTOCOL_COMMIT,
            "frozen_digest": FROZEN_DIGEST,
            "version": ix.VERSION,
            "magic": ix.MAGIC.hex(),
            "max_work_bits": ix.MAX_WORK_BITS,
            "max_patience": ix.MAX_PATIENCE,
            "max_burn": ix.MAX_BURN,
            "max_money": ix.MAX_MONEY,
            "weights": dict(ix.WEIGHTS),
            "note": "Generated from indexer.py. JS must match byte-for-byte.",
        },
        "build_commitment": [],
        "challenge_for": [],
        "pow_hash": [],
        "target_for": [],
        "build_record": [],
        "build_reveal_chunks": [],
        "score_of": [],
    }

    # --- build_commitment: edges + grid (≥50 with other sections) ----------
    bid_grid = [
        (0, 0, 0, 0),
        (ix.MAX_WORK_BITS, ix.MAX_PATIENCE, 0, ix.MAX_MONEY),
        (1, 1, 0, 1),
        (2, 4, 0, 3),
        (3, 8, 0, 6),
        (4, 16, 0, 12),
        (0, 16, 0, 0),
        (4, 0, 0, 0),
        (0, 0, 0, 12),
        (2, 8, 0, 4),
    ]
    for i, (w, p, b, m) in enumerate(bid_grid):
        for variant in range(3):
            secret = _det_bytes(f"secret-{i}-{variant}", 32)
            seed = _det_bytes(f"seed-{i}-{variant}", 32)
            salt = _det_bytes(f"salt-{i}-{variant}", 32)
            # All-zero / all-ff material on first two cells
            if i == 0 and variant == 0:
                secret = seed = salt = b"\x00" * 32
            if i == 1 and variant == 0:
                secret = seed = salt = b"\xff" * 32
            c = ix.build_commitment(secret, seed, salt, w, p, b, m)
            cases["build_commitment"].append({
                "secret": _h(secret), "seed": _h(seed), "salt": _h(salt),
                "work": w, "patience": p, "burn": b, "money": m,
                "commitment": _h(c),
            })

    # --- challenge_for -------------------------------------------------------
    for i in range(8):
        bh = _det_bytes(f"blockhash-{i}", 32)
        cases["challenge_for"].append({
            "block_hash": _h(bh),
            "challenge": _h(ix.challenge_for(bh)),
        })
    cases["challenge_for"].append({
        "block_hash": "00" * 32,
        "challenge": _h(ix.challenge_for(b"\x00" * 32)),
    })
    cases["challenge_for"].append({
        "block_hash": "ff" * 32,
        "challenge": _h(ix.challenge_for(b"\xff" * 32)),
    })

    # --- pow_hash ------------------------------------------------------------
    for i in range(12):
        chal = ix.challenge_for(_det_bytes(f"pow-chal-{i}", 32))
        commit = _det_bytes(f"pow-commit-{i}", 32)
        tag = _det_bytes(f"pow-tag-{i}", 20)
        nonce = (i * 1_000_003) & 0xFFFFFFFFFFFFFFFF
        cases["pow_hash"].append({
            "challenge": _h(chal),
            "commitment": _h(commit),
            "miner_tag": _h(tag),
            "nonce": nonce,
            "pow": _h(ix.pow_hash(chal, commit, tag, nonce)),
        })

    # --- target_for bits 20..30 ----------------------------------------------
    for bits in range(20, 31):
        t = ix.target_for(bits)
        cases["target_for"].append({
            "bits": bits,
            "target_hex": f"{t:064x}",
        })

    # --- build_record --------------------------------------------------------
    for i in range(10):
        commit = _det_bytes(f"rec-commit-{i}", 32)
        tag = _det_bytes(f"rec-tag-{i}", 20)
        nonce = i * 99991
        w, p, b, m = bid_grid[i % len(bid_grid)]
        rec = ix.build_record(commit, nonce, w, p, b, m, tag)
        cases["build_record"].append({
            "commitment": _h(commit), "nonce": nonce,
            "work": w, "patience": p, "burn": b, "money": m,
            "miner_tag": _h(tag),
            "record": _h(rec),
            "len": len(rec),
        })

    # --- build_reveal_chunks -------------------------------------------------
    for i in range(8):
        secret = _det_bytes(f"rev-secret-{i}", 32)
        seed = _det_bytes(f"rev-seed-{i}", 32)
        salt = _det_bytes(f"rev-salt-{i}", 32)
        index = i * 17
        a, b = ix.build_reveal_chunks(index, secret, seed, salt)
        cases["build_reveal_chunks"].append({
            "index": index,
            "secret": _h(secret), "seed": _h(seed), "salt": _h(salt),
            "chunk_a": _h(a), "chunk_b": _h(b),
            "len_a": len(a), "len_b": len(b),
        })

    # --- score_of across bid space -------------------------------------------
    for w in range(ix.MAX_WORK_BITS + 1):
        for p in (0, 1, 4, 8, 16):
            for m in (0, 1, 4, 8, 12):
                if p > ix.MAX_PATIENCE or m > ix.MAX_MONEY:
                    continue
                sc = ix.score_of(w, p, 0, m)
                cases["score_of"].append({
                    "work": w, "patience": p, "burn": 0, "money": m,
                    "score": sc,
                })

    total = sum(len(v) for k, v in cases.items() if k != "meta")
    cases["meta"]["case_count"] = total
    if total < 50:
        raise SystemExit(f"need ≥50 cases, got {total}")
    return cases


def main():
    fixture = build_fixture()
    text = json.dumps(fixture, indent=2, sort_keys=True) + "\n"
    OUT.write_text(text, encoding="utf-8")
    print(f"wrote {OUT} ({fixture['meta']['case_count']} cases)")


if __name__ == "__main__":
    main()
