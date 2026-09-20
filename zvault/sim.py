#!/usr/bin/env python3
"""
ZVAULT game model.

Dependency-free. Reuses the real scoring from zcash/indexer.py and the real
trait derivation from art/generate.py, so nothing here is a re-implementation
that can drift.

    python3 sim.py grind    # holder picks their exact punk before paying (v1 flaw)
    python3 sim.py strand   # (epoch, patience) combos that can never reveal (v1 flaw)
    python3 sim.py solve    # the one spreadsheet that solves v1 fixed-cutoff tiers
    python3 sim.py epoch    # v2: rank-based tiers, best response moves with the field
    python3 sim.py all

Read GAME.md for what each of these is arguing.
"""

import random
import struct
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE / "zcash"))
sys.path.insert(0, str(HERE / "art"))

from indexer import (score_of, blake, EPOCH_SIZE, SUPPLY_CAP, MAX_PATIENCE,  # noqa: E402
                     MAX_WORK_BITS, MAX_BURN, MAX_MONEY)
from generate import derive, tier_of, POOLS, reach, TIER_NAMES              # noqa: E402


# ------------------------------------------------------------------ cost model
#
# Everything in ZEC so the four axes are comparable. These are agent TYPES:
# the whole point of v2 is that the best bid depends on who else is at the
# table, and who else is at the table is a mix of these.

FLOOR = 0.025            # ZEC, first price step
BURN_PRICE = 0.00002     # ZEC per burn token; 5000 tokens = 0.1 ZEC. A guess.

TYPES = {
    #  name          ZEC per base solution   ZEC per patience-day   budget
    "gpu_farm":     dict(hash=0.0005,         time=0.002,            budget=3.0),
    "hobbyist":     dict(hash=0.004,          time=0.001,            budget=0.6),
    "cpu_renter":   dict(hash=0.03,           time=0.004,            budget=0.8),
    "whale":        dict(hash=0.01,           time=0.010,            budget=10.0),
    "tourist":      dict(hash=0.05,           time=0.020,            budget=0.15),
}

BURN_GRID = (0, 250, 1000, 2500, 5000)


def cost(t: dict, w: int, p: int, b: int, m: int) -> float:
    """ZEC to place this bid, for an agent of type t. Work is exponential in
    bits, everything else linear. Patience is days in v2 (blocks / 1152)."""
    return (t["hash"] * (2 ** w)
            + t["time"] * p
            + BURN_PRICE * b
            + FLOOR * (1 + m))


def _grid():
    for w in range(MAX_WORK_BITS + 1):
        for p in range(MAX_PATIENCE + 1):
            for b in BURN_GRID:
                for m in range(MAX_MONEY + 1):
                    yield w, p, b, m


# (bid, score) for every bid on the grid, scored once with the real formula.
GRID = [((w, p, b, m), score_of(w, p, b, m)) for w, p, b, m in _grid()]


def bid_grid():
    return (bid for bid, _ in GRID)


# ----------------------------------------------------------------------- grind

def cmd_grind():
    print("v1: traitHash = blake(seed, secret, score). The miner chooses seed")
    print("and secret, so they can iterate seeds locally until derive() returns")
    print("the punk they want, then mine and pay for exactly that one.\n")
    want = dict(chassis="spired", palette="ultra", visor="gold", hood="haloed",
                vent="sealed", mark="crown", aura="burning")
    score = 900_000
    secret = b"\x01" * 32
    n = 0
    while True:
        seed = n.to_bytes(32, "big")
        th = int.from_bytes(blake(seed, secret, struct.pack(">I", score)), "big")
        t = derive(th, score)
        n += 1
        if all(t[k] == v for k, v in want.items()):
            break
    combos = 1
    for pool in POOLS.values():
        combos *= reach(pool, 4)
    print(f"  target: rarest entry in all seven pools")
    print(f"  reachable combos at tier 4: {combos:,}")
    print(f"  found after {n:,} seeds  (a few seconds of one CPU core)\n")
    print("  'You bid on a distribution, never a result' is false in v1.")
    print("  Fix: traitHash must include entropy fixed AFTER the commitment is")
    print("  on chain. v2 uses the epoch seal. See GAME.md.")


# ---------------------------------------------------------------------- strand

def cmd_strand():
    epochs = SUPPLY_CAP // EPOCH_SIZE
    print(f"v1: patience is counted in epochs of {EPOCH_SIZE} mints. Supply cap")
    print(f"{SUPPLY_CAP} means exactly {epochs} epochs will ever exist, and reveal")
    print(f"requires current_epoch >= mint_epoch + patience.\n")
    stranded = [(e, p) for e in range(epochs) for p in range(MAX_PATIENCE + 1)
                if e + p > epochs]
    total = epochs * (MAX_PATIENCE + 1)
    print(f"  {len(stranded)} of {total} (mint epoch, patience) combos can never reveal.")
    print(f"  Any mint in epoch >= {epochs - MAX_PATIENCE + 1} with patience {MAX_PATIENCE} is sealed forever.")
    print(f"  If minting stalls at 2000 (Hashcats did), epoch 15 never comes and")
    print(f"  every patience>=1 mint from epoch 14 on is stranded too.\n")
    print("  Also: patience costs nothing if mints are fast and everything if")
    print("  they stall. Neither is 'time'. v2 counts patience in blocks.")


# ----------------------------------------------------------------------- solve

def cmd_solve():
    # Historical v1 cutoff solver. Floors match indexer.score_floors() at the
    # current live max (burn stubbed → 750k → 150/315/480/630).
    from indexer import score_floors
    cuts = score_floors()[1:]
    print("v1: tier = fixed cutoff on your own score. Your tier does not depend")
    print("on anyone else, so the game is a one-time optimisation per agent type.")
    print("This is that spreadsheet. Once posted, there is nothing left to figure out.\n")
    print(f"  (floors from live max: {cuts})\n")
    for name, t in TYPES.items():
        print(f"  {name:<11}", end="")
        for tier, cut in enumerate(cuts, start=1):
            best = None
            for (w, p, b, m), sc in GRID:
                if sc >= cut:
                    c = cost(t, w, p, b, m)
                    if best is None or c < best[0]:
                        best = (c, w, p, b, m)
            if best is None:
                print(f"  T{tier}: unreachable   ", end="")
            else:
                c, w, p, b, m = best
                print(f"  T{tier}: {c:5.3f}Z w{w:<2}p{p:<2}b{b:<4}m{m}", end="")
        print()
    print("\n  Cheapest path to each tier, per agent type, forever. Note the dead")
    print("  zones: a score of 419,999 and a score of 200,000 are the same punk.")
    print("  Also note burn is a stub on Zcash today, which makes tier 4 unreachable.")


# ----------------------------------------------------------------------- epoch

def best_response(t: dict, field: list, rank_wanted: int, tiebreak_margin=1):
    """Cheapest bid for type t that would sit at rank `rank_wanted` (1 = top)
    given the scores already on the table. Returns (cost, bid, score) or None."""
    scores = sorted(field, reverse=True)
    need = scores[rank_wanted - 1] + tiebreak_margin if len(scores) >= rank_wanted else 0
    best = None
    for bid, s in GRID:
        if s >= need:
            c = cost(t, *bid)
            if c <= t["budget"] and (best is None or c < best[0]):
                best = (c, bid, s)
    return best


def simulate_epoch(rng, mix, prev_cutoffs=None):
    """128 sequential public bids. Each agent targets the cheapest tier it can
    afford, aiming at last epoch's cutoff for that tier plus what it can see
    on the table so far. Returns rows of (type, bid, score, aimed_tier)."""
    table = []
    tiers = TIER_SIZES
    for slot in range(EPOCH_SIZE):
        name = rng.choice(mix)
        t = TYPES[name]
        seen = [r[2] for r in table]
        chosen, aimed = None, len(tiers) - 1
        # Try for the best tier first; fall through to cheaper ones.
        for tier_idx, size in enumerate(tiers):
            rank_wanted = sum(tiers[:tier_idx + 1])
            target = seen + ([prev_cutoffs[tier_idx]] if prev_cutoffs else [])
            br = best_response(t, target, rank_wanted)
            if br is not None:
                chosen, aimed = br, tier_idx
                break
        if chosen is None:
            chosen = (cost(t, 0, 0, 0, 0), (0, 0, 0, 0), 0)
        table.append((name, chosen[1], chosen[2], aimed))
    return table


TIER_SIZES = (8, 16, 32, 32, 40)   # oracle, cipher, warden, runner, drone = 128


def cutoffs(table):
    scores = sorted((r[2] for r in table), reverse=True)
    out, acc = [], 0
    for size in TIER_SIZES:
        acc += size
        out.append(scores[min(acc, len(scores)) - 1])
    return out


def achieved_tier(table):
    """Final tier index (0 = oracle) of every row once the epoch seals."""
    order = sorted(range(len(table)), key=lambda i: -table[i][2])
    out = [None] * len(table)
    rank = 0
    for tier_idx, size in enumerate(TIER_SIZES):
        for i in order[rank:rank + size]:
            out[i] = tier_idx
        rank += size
    return out


def cmd_epoch(seed=7, epochs=12):
    rng = random.Random(seed)
    names_desc = list(reversed(TIER_NAMES))
    print("v2: tier = rank of your score within your epoch of 128.")
    print(f"tier sizes {TIER_SIZES} = {names_desc}.")
    print("Bids are public and sequential. Every agent best-responds to what is")
    print("already on the table plus last epoch's cutoffs. Watch the cutoffs move.\n")

    mixes = {
        "quiet":    ["hobbyist"] * 5 + ["tourist"] * 4 + ["cpu_renter"],
        "crowded":  ["hobbyist"] * 3 + ["gpu_farm"] * 3 + ["whale", "cpu_renter", "tourist", "tourist"],
    }
    print(f"  {'epoch':<6}{'mix':<9}{'oracle':>9}{'cipher':>9}{'warden':>9}{'runner':>9}  top bid (w,p,b,m)")
    prev = None
    pushed = {"early": [0, 0], "late": [0, 0]}     # [pushed below aim, total]
    by_mix = {"quiet": [], "crowded": []}
    for e in range(epochs):
        mix_name = "quiet" if (e // 3) % 2 == 0 else "crowded"
        table = simulate_epoch(rng, mixes[mix_name], prev)
        cuts = cutoffs(table)
        by_mix[mix_name].append(cuts)
        prev = cuts
        top = max(table, key=lambda r: r[2])
        print(f"  {e:<6}{mix_name:<9}" + "".join(f"{c:>9,}" for c in cuts[:4])
              + f"  {top[1]}  ({top[0]})")
        got = achieved_tier(table)
        for i, row in enumerate(table):
            bucket = "early" if i < 32 else ("late" if i >= 96 else None)
            if bucket:
                pushed[bucket][1] += 1
                if got[i] > row[3]:
                    pushed[bucket][0] += 1

    print("\n  What an oracle seat costs, by who you are and who else showed up:")
    print(f"  {'type':<11}{'quiet epoch':>14}{'crowded epoch':>16}")
    for name, t in TYPES.items():
        row = []
        for mix_name in ("quiet", "crowded"):
            c = statistics_mean(cuts[0] for cuts in by_mix[mix_name])
            br = best_response(t, [c] * 8, 1)
            row.append(f"{br[0]:.3f} ZEC" if br else "over budget")
        print(f"  {name:<11}{row[0]:>14}{row[1]:>16}")

    e_p, e_n = pushed["early"]
    l_p, l_n = pushed["late"]
    print(f"\n  Bidders pushed below the tier they aimed for by later bids:")
    print(f"    slots 1-32   : {e_p}/{e_n}  ({100 * e_p / max(e_n, 1):.0f}%)")
    print(f"    slots 97-128 : {l_p}/{l_n}  ({100 * l_p / max(l_n, 1):.0f}%)")
    print("  Early movers bid blind and get pushed. Late movers see the table.")
    print("  The last slot is worth the most, and the PoW race decides who gets it.")
    print("\n  This is fictitious play, not an equilibrium solver. Agents here shade")
    print("  to the minimum and never anticipate being pushed. The first quant to")
    print("  model that properly has an edge. That is the point.")


def statistics_mean(xs):
    xs = list(xs)
    return sum(xs) / len(xs)


# ------------------------------------------------------------------------- cli

if __name__ == "__main__":
    cmds = {"grind": cmd_grind, "strand": cmd_strand, "solve": cmd_solve, "epoch": cmd_epoch}
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which == "all":
        for i, (k, f) in enumerate(cmds.items()):
            print(f"{'=' * 72}\n{k.upper()}\n{'=' * 72}")
            f()
            print()
    elif which in cmds:
        cmds[which]()
    else:
        print(__doc__)
