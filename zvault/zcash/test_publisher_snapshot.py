#!/usr/bin/env python3
"""
Assert vault.json snapshot round-trips to the same digest.

Builds a short vault (same shape as indexer self-test helpers), snapshots it,
rebuilds, and compares digests. No pickle.

    python zcash/test_publisher_snapshot.py
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import indexer as ix  # noqa: E402
import publisher as pub  # noqa: E402


def fake_hash(h: int) -> bytes:
    return ix.blake(b"fakeblock", struct.pack(">I", h))


def main() -> int:
    LAUNCH, BASE = 1000, 6
    v = ix.Vault(
        launch_height=LAUNCH,
        base_bits=BASE,
        seal_timeout=40,
        patience_unit=10,
        confirmation_depth=0,
    )
    h = LAUNCH - ix.CHALLENGE_WINDOW
    while h < LAUNCH:
        v.apply_block(h, fake_hash(h), [])
        h += 1

    # One real mint so digest is non-trivial.
    secret = b"\x11" * 32
    seed = b"\x22" * 32
    salt = b"\x33" * 32
    tag = b"\xaa" * 20
    commitment = ix.build_commitment(secret, seed, salt, 0, 0, 0, 0)
    chal = h - 1
    ch = ix.challenge_for(fake_hash(chal))
    bits = ix.base_difficulty(v.minted_at[chal], BASE)
    n = 0
    while int.from_bytes(ix.pow_hash(ch, commitment, tag, n), "big") >= ix.target_for(bits):
        n += 1
    rec = ix.build_record(commitment, n, 0, 0, 0, 0, tag)
    paid = ix.floor_price_epoch(v.epoch_quote_at[chal])
    v.apply_block(h, fake_hash(h), [{
        "txid": "snap1",
        "op_return": rec,
        "paid_to_treasury": paid,
        "burned": 0,
    }])

    d0 = v.digest()
    snap = pub.vault_to_snapshot(v)
    v2 = pub.vault_from_snapshot(snap)
    d1 = v2.digest()

    if d0 != d1:
        print(f"FAIL digest mismatch\n  before {d0}\n  after  {d1}", file=sys.stderr)
        return 1
    if v2.minted != v.minted or v2.height != v.height:
        print("FAIL minted/height drift", file=sys.stderr)
        return 1
    # Round-trip JSON text as well (what disk would hold).
    import json
    text = json.dumps(snap)
    v3 = pub.vault_from_snapshot(json.loads(text))
    if v3.digest() != d0:
        print("FAIL JSON text round-trip digest", file=sys.stderr)
        return 1

    print(f"ok  vault.json snapshot round-trips (digest {d0[:16]}…)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
