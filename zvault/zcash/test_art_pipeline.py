#!/usr/bin/env python3
"""
Art pipeline self-test: mint -> seal -> reveal from blocks -> PNG exists
and traits match generate.derive_tier(trait_hash, tier).

Does not change protocol rules. Uses a disposable temp pub/ dir.

    python zcash/test_art_pipeline.py
"""

from __future__ import annotations

import json
import shutil
import struct
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "art"))

import indexer as ix  # noqa: E402
import art_render as art  # noqa: E402
import generate as gen  # noqa: E402
import publisher as pub  # noqa: E402


LAUNCH = 1000
BASE = 4


def fake_hash(h: int) -> bytes:
    return ix.blake(b"fakeblock", struct.pack(">I", h))


def mine(vault, chal_height, commitment, tag, work):
    ch = ix.challenge_for(fake_hash(chal_height))
    bits = ix.base_difficulty(vault.minted_at[chal_height], BASE) + work
    n = 0
    while int.from_bytes(ix.pow_hash(ch, commitment, tag, n), "big") >= ix.target_for(bits):
        n += 1
    return n


def main():
    fails = []

    def check(cond, msg):
        print(f"  {'ok  ' if cond else 'FAIL'}  {msg}")
        if not cond:
            fails.append(msg)

    rng = __import__("random").Random(7)
    out = Path(tempfile.mkdtemp(prefix="zvault-art-"))
    try:
        v = ix.Vault(
            launch_height=LAUNCH,
            base_bits=BASE,
            seal_timeout=8,
            patience_unit=1,
            confirmation_depth=0,
        )
        h = LAUNCH - ix.CHALLENGE_WINDOW
        while h < LAUNCH:
            v.apply_block(h, fake_hash(h), [])
            h += 1

        secret = rng.randbytes(32)
        seed = rng.randbytes(32)
        salt = rng.randbytes(32)
        tag = rng.randbytes(20)
        work, patience, burn, money = 0, 0, 0, 0
        commitment = ix.build_commitment(secret, seed, salt, work, patience, burn, money)
        chal = h - 1
        nonce = mine(v, chal, commitment, tag, work)
        rec = ix.build_record(commitment, nonce, work, patience, burn, money, tag)
        paid = ix.floor_price_epoch(v.epoch_quote_at[chal]) * (1 + money)
        v.apply_block(h, fake_hash(h), [{
            "txid": "mint0",
            "op_return": rec.hex(),
            "paid_to_treasury": paid,
            "burned": 0,
        }])
        h += 1
        while v.open_epoch() is not None:
            v.apply_block(h, fake_hash(h), [])
            h += 1

        check(0 not in v.revealed, "pre-reveal: not yet revealed")
        # Publisher write_public must not invent art before reveal.
        pub.write_public(out, v)
        check(not (out / "punks" / "0.png").exists(),
              "no PNG before on-chain reveal")

        ca, cb = ix.build_reveal_chunks(0, secret, seed, salt)
        log = v.apply_block(h, fake_hash(h), [{
            "txid": "reveal0",
            "op_returns": [ca.hex(), cb.hex()],
            "transparent_tags": [tag.hex()],
        }])
        check(log[0].get("ok") and 0 in v.revealed,
              f"on-chain reveal accepted: {log[0].get('reason')}")

        pub.write_public(out, v)
        png = out / "punks" / "0.png"
        meta = out / "punks" / "0.json"
        coll = out / "collection.json"
        check(png.exists() and png.stat().st_size > 100, "PNG written after reveal")
        check(meta.exists(), "traits JSON written after reveal")
        check(coll.exists(), "collection.json written")

        info = v.revealed[0]
        want = gen.derive_tier(int(info["trait_hash"]), int(info["tier"]))
        got = json.loads(meta.read_text(encoding="utf-8"))
        for k in ("chassis", "palette", "visor", "hood", "vent", "mark", "aura", "tier"):
            check(got.get(k) == want.get(k),
                  f"trait {k} matches derive_tier ({got.get(k)} == {want.get(k)})")

        coll_doc = json.loads(coll.read_text(encoding="utf-8"))
        check(coll_doc.get("revealed") == 1 and coll_doc["punks"][0]["index"] == 0,
              "collection lists the revealed punk")
        check("verify" in got and "derive_tier" in got["verify"],
              "traits JSON carries a verify one-liner")

        # Digest unchanged by art files (art is not in Vault.digest).
        d0 = v.digest()
        pub.write_public(out, v)
        check(v.digest() == d0 and len(d0) == 64,
              f"re-render does not change vault digest ({d0[:16]}…)")
    finally:
        shutil.rmtree(out, ignore_errors=True)

    if fails:
        print(f"\n{len(fails)} FAILED")
        sys.exit(1)
    print("\nok  art pipeline: mint->seal->reveal->PNG matches derive_tier")


if __name__ == "__main__":
    main()
