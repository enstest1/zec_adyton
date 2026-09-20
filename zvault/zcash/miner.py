#!/usr/bin/env python3
"""
ZVAULT miner — protocol v2.

Grinds blake2b nonces against a recent block's challenge and emits a
ready-to-broadcast OP_RETURN record. It does not broadcast — that is
deliberate. Submission spends money and should be a separate, deliberate act,
not something a long-running search process does on its own at 4am.

    python3 miner.py bench
    python3 indexer.py --blocks blocks.json --epoch-json table.json
    python3 miner.py mine --table table.json --tag <20-byte-hex> --work 3 --patience 4
    python3 miner.py verify --record <hex> --block-hash <hex> --minted <n>

v2: the commitment is built BEFORE mining and is part of the hash, so the
solution only works for your commitment. Anyone copying your nonce out of the
mempool gets nothing. The challenge is a recent block hash; your record must
land within CHALLENGE_WINDOW blocks of it. Price and difficulty are quoted
from that block, and the miner prints both before it starts.

The opening material is written to a local keyfile. THAT FILE IS THE ASSET.
Lose it and the mint is unopenable forever — there is no recovery path, by
design, because a recovery path is a backdoor.
"""

import argparse
import hashlib
import json
import multiprocessing as mp
import os
import secrets
import struct
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
# One definition of every rule, shared with the indexer, so they cannot drift.
from indexer import (blake, target_for, build_commitment, build_record,  # noqa: E402
                     challenge_for, pow_hash, base_difficulty, floor_price_epoch,
                     score_of, CHALLENGE_WINDOW, BASE_DIFFICULTY_BITS,
                     MAX_WORK_BITS, MAX_PATIENCE, MAX_BURN, MAX_MONEY,
                     PATIENCE_UNIT, MAGIC)


# ----------------------------------------------------------------------- mine

def _worker(challenge, commitment, tag, bits, start, stride, found, out):
    tgt = target_for(bits)
    nonce = start
    prefix = hashlib.blake2b(digest_size=32)
    prefix.update(challenge)          # same order as indexer.pow_hash
    prefix.update(commitment)
    prefix.update(tag)
    count = 0
    while not found.is_set():
        h = prefix.copy()
        h.update(struct.pack(">Q", nonce))
        if int.from_bytes(h.digest(), "big") < tgt:
            found.set()
            out.put((nonce, count))
            return
        nonce += stride
        count += 1
        if count % 200000 == 0:
            out.put(("progress", count))


def mine(challenge: bytes, commitment: bytes, tag: bytes, bits: int, procs: int = 0):
    procs = procs or mp.cpu_count()
    found = mp.Event()
    out = mp.Queue()
    workers = [
        mp.Process(target=_worker, args=(challenge, commitment, tag, bits, i, procs, found, out))
        for i in range(procs)
    ]
    t0 = time.time()
    for w in workers:
        w.start()

    hashes = 0
    result = None
    while result is None:
        item = out.get()
        if item[0] == "progress":
            hashes += item[1]
            el = time.time() - t0
            print(f"\r  {hashes/1e6:.1f}M hashes  {hashes/max(el,1e-9)/1000:.0f} kH/s",
                  end="", file=sys.stderr)
        else:
            result = item
    for w in workers:
        w.terminate()
        w.join()
    print(file=sys.stderr)
    return result[0], time.time() - t0


# ----------------------------------------------------------------------- bench

def bench(seconds=3):
    tgt = target_for(256)  # unreachable, so it just counts
    h0 = hashlib.blake2b(digest_size=32)
    h0.update(b"bench")
    t0 = time.time()
    n = 0
    while time.time() - t0 < seconds:
        for _ in range(20000):
            h = h0.copy()
            h.update(struct.pack(">Q", n))
            h.digest()
            n += 1
    rate = n / (time.time() - t0)
    cores = mp.cpu_count()
    print(f"single core : {rate/1000:.0f} kH/s")
    print(f"{cores} cores    : ~{rate*cores/1e6:.2f} MH/s")
    print()
    for bits in (16, 20, 22, 24, 26, 28):
        exp = (1 << bits) / (rate * cores)
        unit = f"{exp:.1f}s" if exp < 120 else (
            f"{exp/60:.1f}m" if exp < 7200 else f"{exp/3600:.1f}h")
        print(f"  {bits} bits -> 2^{bits} expected, ~{unit}")
    print("\nPython is 50-200x slower than a C or CUDA miner. Treat these as a")
    print("floor on cost, never as what a competitive miner will manage.")


# ------------------------------------------------------------------------ cli

def show_table(t: dict):
    ep = t.get("epoch") or {}
    print(f"  tip {t['tip_height']}   minted {t['minted']}/{t['supply_cap']}"
          f"   base {t['base_bits']} bits   floor {t['floor_price_zat'] / 1e8:.4f} ZEC",
          file=sys.stderr)
    if not ep.get("open"):
        print(f"  epoch {ep.get('number')}: not open yet — your mint opens it", file=sys.stderr)
        return
    print(f"  epoch {ep['number']}: {ep['filled']}/{ep['seats']} seats,"
          f" seals by timeout at height {ep['timeout_height']}", file=sys.stderr)
    last = {}
    for b in ep["bids"]:
        last[b["if_full_now"]] = b["score"]
    for name in ("oracle", "cipher", "warden", "runner", "drone"):
        if name in last:
            print(f"    lowest {name:<7} so far: score {last[name]:>9,}", file=sys.stderr)
    print("  (seats are rank-based: later bids can still push you down)", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("bench")
    b.add_argument("--seconds", type=int, default=3)

    m = sub.add_parser("mine")
    m.add_argument("--tag", required=True, help="20-byte hex, e.g. of your paying t-address")
    m.add_argument("--table", help="indexer --epoch-json output; supplies everything below")
    m.add_argument("--block-hash", help="hex hash of the block to mine against (usually the tip)")
    m.add_argument("--block-height", type=int)
    m.add_argument("--minted", type=int, help="mint count as of that block")
    m.add_argument("--work", type=int, default=0)
    m.add_argument("--patience", type=int, default=0)
    m.add_argument("--burn", type=int, default=0)
    m.add_argument("--money", type=int, default=0)
    m.add_argument("--procs", type=int, default=0)
    m.add_argument("--keyfile", default="zvault-keys.json")

    v = sub.add_parser("verify")
    v.add_argument("--record", required=True)
    v.add_argument("--block-hash", required=True)
    v.add_argument("--minted", type=int, required=True)

    a = ap.parse_args()

    if a.cmd == "bench":
        return bench(a.seconds)

    if a.cmd == "verify":
        rec = bytes.fromhex(a.record)
        if len(rec) != 74 or rec[:4] != MAGIC:
            return print("invalid: bad magic or length")
        chk = 0
        for x in rec[:73]:
            chk ^= x
        if chk != rec[73]:
            return print("invalid: checksum")
        commitment, nonce = rec[6:38], struct.unpack(">Q", rec[38:46])[0]
        work, tag = rec[46], rec[53:73]
        bits = base_difficulty(a.minted) + work
        h = pow_hash(challenge_for(bytes.fromhex(a.block_hash)), commitment, tag, nonce)
        ok = int.from_bytes(h, "big") < target_for(bits)
        print(f"  commitment {commitment.hex()}")
        print(f"  nonce      {nonce}")
        print(f"  difficulty {bits} bits")
        print(f"  proof      {'VALID' if ok else 'INVALID'} against that block")
        return

    if a.table:
        t = json.loads(Path(a.table).read_text())
        show_table(t)
        a.block_hash = a.block_hash or t["tip_hash"]
        a.block_height = a.block_height if a.block_height is not None else t["tip_height"]
        a.minted = a.minted if a.minted is not None else t["minted"]
        floor_zat = t["floor_price_zat"]
    else:
        floor_zat = None
    if not a.block_hash or a.block_height is None or a.minted is None:
        return print("need --table, or all of --block-hash --block-height --minted")

    tag = bytes.fromhex(a.tag)
    if len(tag) != 20:
        return print("--tag must be 20 bytes of hex")
    for name, val, mx in (("work", a.work, MAX_WORK_BITS), ("patience", a.patience, MAX_PATIENCE),
                          ("burn", a.burn, MAX_BURN), ("money", a.money, MAX_MONEY)):
        if not 0 <= val <= mx:
            return print(f"--{name} must be 0..{mx}")

    secret, seed, salt = secrets.token_bytes(32), secrets.token_bytes(32), secrets.token_bytes(32)
    commitment = build_commitment(secret, seed, salt, a.work, a.patience, a.burn, a.money)
    challenge = challenge_for(bytes.fromhex(a.block_hash))

    bits = base_difficulty(a.minted) + a.work
    if floor_zat is None:
        floor_zat = floor_price_epoch(a.minted // 128)
    owe = floor_zat * (1 + a.money)
    last_ok = a.block_height + CHALLENGE_WINDOW
    print(f"\n  score {score_of(a.work, a.patience, a.burn, a.money):,}"
          f"   patience {a.patience} x {PATIENCE_UNIT} blocks", file=sys.stderr)
    print(f"  mining at {bits} bits against block {a.block_height}", file=sys.stderr)
    print(f"  valid if included in blocks {a.block_height + 1}..{last_ok}", file=sys.stderr)
    print(f"  pay exactly {owe} zat ({owe / 1e8:.4f} ZEC) to the treasury, transparent output",
          file=sys.stderr)
    nonce, elapsed = mine(challenge, commitment, tag, bits, a.procs)

    record = build_record(commitment, nonce, a.work, a.patience, a.burn, a.money, tag)

    # Write the opening material BEFORE printing the record, so a user who
    # broadcasts immediately cannot end up with a mint they cannot open.
    kf = Path(a.keyfile)
    keys = json.loads(kf.read_text()) if kf.exists() else []
    keys.append({
        "commitment": commitment.hex(),
        "secret": secret.hex(), "seed": seed.hex(), "salt": salt.hex(),
        "work": a.work, "patience": a.patience, "burn": a.burn, "money": a.money,
        "nonce": nonce, "tag": tag.hex(), "challenge_height": a.block_height,
        "mined_at": int(time.time()),
    })
    kf.write_text(json.dumps(keys, indent=2))
    os.chmod(kf, 0o600)

    print(f"\nfound in {elapsed:.1f}s", file=sys.stderr)
    print(f"\n  OP_RETURN  {record.hex()}")
    print(f"  broadcast before block {last_ok}, paying {owe} zat")
    print(f"  keys saved to {kf}  (chmod 600)")
    print("\n  BACK UP THAT KEYFILE. Without it this mint can never be opened.")


if __name__ == "__main__":
    main()
