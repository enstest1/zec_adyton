#!/usr/bin/env python3
"""
Smoke checks for merge regressions — NOT a substitute for indexer.py.

    python verify.py

These checks catch constant drift and a few pure functions. They do NOT mine
records, seal epochs, or exercise assign_tier on real bids. A green verify.py
on a tree that fails indexer.py self-test means this file is too thin as a
gate. Prefer:

    python zcash/indexer.py && python verify.py && python sim.py all
"""

import struct
import sys

sys.path.insert(0, "zcash")
sys.path.insert(0, "art")
import indexer as ix          # noqa: E402
import generate as g          # noqa: E402
import memo as mo             # noqa: E402


def rule(title):
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def check_seal_blocks_grind():
    rule("1. Epoch seal entropy — same seed, different seals diverge")
    secret, seed = b"\x01" * 32, b"\x42" * 32
    score = 1_000_000
    th_a = ix.trait_hash_of(seed, secret, score, b"\xaa" * 32)
    th_b = ix.trait_hash_of(seed, secret, score, b"\xbb" * 32)
    a = g.derive_tier(th_a, 4)
    b = g.derive_tier(th_b, 4)
    ok = a != b
    print(f"  traits differ across seals: {ok}")
    return ok


def check_pow_binds_commitment():
    rule("2. PoW binds commitment — stolen nonce is useless")
    chal = ix.challenge_for(b"\x11" * 32)
    tag = b"\xaa" * 20
    c1, c2 = b"\x01" * 32, b"\x02" * 32
    nonce = 0
    while True:
        h = ix.pow_hash(chal, c1, tag, nonce)
        if int.from_bytes(h, "big") < ix.target_for(12):
            break
        nonce += 1
    h_stolen = ix.pow_hash(chal, c2, tag, nonce)
    ok = int.from_bytes(h_stolen, "big") >= ix.target_for(12)
    print(f"  nonce {nonce} valid for c1, invalid for c2: {ok}")
    return ok


def check_memo_is_receipt():
    rule("3. Memo is a receipt — no seed/salt cargo")
    payload = mo.build_receipt(1337, 10, 2_900_128)
    parsed = mo.parse_receipt(payload)
    legacy = (
        b"ZVLT" + bytes([2, 0x10]) + struct.pack(">I", 1)
        + b"\x11" * 32 + b"\x22" * 32
    )
    legacy_parsed = mo.parse_receipt(legacy)
    ok = (
        parsed and parsed.get("kind") == "receipt" and "seed" not in parsed
        and legacy_parsed and legacy_parsed.get("kind") == "legacy_opening"
    )
    print(f"  receipt ok={ok}")
    return ok


def check_caps_and_floors():
    """Constants + live score-floor calibration. Still not a protocol self-test."""
    rule("4. Caps, flat base, live score floors")
    window_sec = ix.CHALLENGE_WINDOW * 75
    max_bits = ix.BASE_DIFFICULTY_BITS + ix.MAX_WORK_BITS  # 22+4=26
    need_95 = 3 * (1 << max_bits) / window_sec
    live = ix.max_live_score()
    floors = ix.score_floors()
    expected = tuple((live * p) // 1000 for p in ix._SCORE_FLOOR_PERMILLE)
    # Max live bid must clear oracle on the score axis (tier_by_score == 4).
    score_oracle = ix.tier_by_score(live) == 4
    # Contested short-epoch: rank-0 at live max stays oracle under assign_tier.
    rank_oracle = ix.assign_tier(0, 2, live) == 4
    solo = ix.assign_tier(0, 1, 0)
    flat = ix.base_difficulty(0) == ix.base_difficulty(4000) == 22
    print(f"  MAX_BURN={ix.MAX_BURN}  MAX_WORK_BITS={ix.MAX_WORK_BITS}  "
          f"MAX_MONEY={ix.MAX_MONEY}  BASE={ix.BASE_DIFFICULTY_BITS}")
    print(f"  max {max_bits} bits -> ~{need_95/1e6:.3f} MH/s for 95% in window")
    print(f"  live_max={live}  floors={floors}")
    print(f"  score_oracle={score_oracle}  rank_oracle={rank_oracle}  "
          f"solo={ix.TIER_NAMES[solo]}  flat_base={flat}")
    return (
        ix.MAX_BURN == 0
        and ix.MAX_WORK_BITS == 4
        and ix.MAX_MONEY == 12
        and flat
        and solo != 4
        and ix.floor_price_epoch(0) == 200_000
        and live == 750_000
        and floors == expected == (0, 150_000, 315_000, 480_000, 630_000)
        and score_oracle
        and rank_oracle
        and g.tier_of(live) == 4
    )


if __name__ == "__main__":
    results = [
        ("seal blocks grind", check_seal_blocks_grind()),
        ("pow binds commitment", check_pow_binds_commitment()),
        ("memo is receipt", check_memo_is_receipt()),
        ("caps + live score floors", check_caps_and_floors()),
    ]
    rule("SUMMARY")
    for name, ok in results:
        print(f"  {'PASS' if ok else 'FAIL':<8} {name}")
    print("\nNOTE: verify.py is smoke only. indexer.py self-test is the gate.")
    if not all(ok for _, ok in results):
        sys.exit(1)
    print("Smoke checks passed. Full protocol: python zcash/indexer.py")
