#!/usr/bin/env python3
"""
ZVAULT reference indexer — protocol v2.

The point of this file is that it is boring and that you can run it.

On an EVM chain the contract is the referee. Zcash has no referee, so the
replacement is that the rules are deterministic and the inputs are public:
anyone who runs this over the same blocks gets byte-identical state. An indexer
that lies is caught by a diff, not by a governance process.

    python3 indexer.py                        # self-test, no node needed
    python3 indexer.py --blocks blocks.json   # state from chain.py output
    python3 indexer.py --blocks blocks.json --epoch-json table.json

Deliberately dependency-free and single-file. If verifying the collection needs
a toolchain, nobody verifies the collection.

What changed from v1 (see GAME.md and SPEC.md):

  1. The proof of work commits to the commitment. A copied nonce is useless
     to anyone else, so nobody can lift a solution out of the mempool.
  2. The challenge comes from a recent block hash, not from the previous mint.
     Any number of mints per block are valid; racers no longer pay to lose.
     Difficulty and price are quoted from the challenge block, so a staircase
     step landing mid-flight cannot turn a correct mint into a paid reject.
  3. Traits are rolled from the epoch seal, which does not exist until the
     epoch closes. Nobody can grind for a punk before paying.
  4. Patience is counted in blocks, so no bid can be sealed forever.
  5. An epoch seals at 128 mints, at the supply cap, or after SEAL_TIMEOUT
     blocks — whichever comes first. A stalled mint cannot freeze an epoch.
  6. Tier is rank within the sealed epoch, not a fixed score cutoff.
"""

import argparse
import hashlib
import json
import struct
import sys
from dataclasses import dataclass, field

MAGIC = b"ZVLT"
VERSION = 2
KIND_MINT, KIND_REVEAL, KIND_TRANSFER = 1, 2, 3

SUPPLY_CAP = 4096
EPOCH_SIZE = 128
BASE_DIFFICULTY_BITS = 22
TREASURY = "t1ZVaultTreasuryAddressGoesHere00000"

# Placeholder. Must be fixed and published before launch; every indexer
# starts from LAUNCH_HEIGHT - CHALLENGE_WINDOW and must agree on it.
LAUNCH_HEIGHT = 2_900_000

CHALLENGE_WINDOW = 24     # a solution may use any of the last 24 block hashes (~30 min)
SEAL_TIMEOUT = 1152       # an epoch seals at most 1152 blocks (~1 day) after it opens
PATIENCE_UNIT = 1152      # one patience point = 1152 blocks (~1 day at 75s)

# Only index a block once it is this many blocks below the observed tip.
# Published constant — reorgs shorter than this cannot rewrite indexed state.
CONFIRMATION_DEPTH = 10

# Work cap is derived from the TOP of the difficulty staircase (base 28 at
# n >= 2048), not from the opening base 22. Target is ~95% chance of landing
# inside CHALLENGE_WINDOW (λ ≈ 3 expected hashes), not the 63% "expected"
# figure. At 28+4 = 32 bits and 24×75s: ~7 MH/s. Provisional until a bench.
MAX_WORK_BITS = 4
MAX_PATIENCE = 16
# Burn undefined on Zcash (burned_in→0). Cap at parse time so burn>0 never
# becomes a paid "burn short" reject after the treasury payment lands.
MAX_BURN = 0
# 12: ~95% of the money axis is reachable; max pay ~$40 at the opening floor
# and ~$400 at the top floor (ZEC $1,539). Still at most 10% of published score.
MAX_MONEY = 12
WEIGHTS = {"work": 4000, "patience": 2500, "burn": 2500, "money": 1000}

# Seats per 128, best first: oracle, cipher, warden, runner, drone.
# Tier numbers match art/generate.py TIER_NAMES (0 = drone .. 4 = oracle).
SEAT_BOUNDS = ((8, 4), (24, 3), (56, 2), (88, 1))
TIER_NAMES = ["drone", "runner", "warden", "cipher", "oracle"]
# Absolute score floors (same cuts as the old cutoff table). Used only as a
# ceiling on rank: tier = min(rank_tier, score_tier + 1).
SCORE_FLOORS = (0, 200_000, 420_000, 640_000, 840_000)


# ----------------------------------------------------------------- primitives

def blake(*parts: bytes) -> bytes:
    h = hashlib.blake2b(digest_size=32)
    for p in parts:
        h.update(p)
    return h.digest()


def target_for(bits: int) -> int:
    """A solution must hash below this. Same shape as Bitcoin's target."""
    return (1 << 256) >> bits


def _isqrt_exact(n: int) -> int:
    if n <= 0:
        return 0
    x = n
    y = (x + 1) // 2
    while y < x:
        x = y
        y = (x + n // x) // 2
    return x


def isqrt(n: int) -> int:
    return _isqrt_exact(n)


def sqrt_ratio(x: int, mx: int) -> int:
    """floor(sqrt(x/mx)) scaled to 1e6. Concave: 10x the input, ~3.16x out."""
    if x <= 0:
        return 0
    if x >= mx:
        return 1_000_000
    return _isqrt_exact((x * 10 ** 12) // mx)


def score_of(work: int, patience: int, burn: int, money: int) -> int:
    """0..1_000_000. Public: every input is in the mint record.

    When MAX_BURN is 0 the burn axis is stubbed out entirely — every live bid
    has burn=0, so including a zero term would only rescale via the weights.
    Skip it so a future MAX_BURN raise does not silently re-price old mints
    through a different code path than "burn was always zero contribution."
    """
    s = (
        WEIGHTS["work"] * sqrt_ratio(work, MAX_WORK_BITS)
        + WEIGHTS["patience"] * sqrt_ratio(patience, MAX_PATIENCE)
        + WEIGHTS["money"] * sqrt_ratio(money, MAX_MONEY)
    )
    if MAX_BURN > 0:
        s += WEIGHTS["burn"] * sqrt_ratio(burn, MAX_BURN)
    return s // 10_000


def floor_price(n: int) -> int:
    """Zatoshis by mint index (legacy step points). Prefer floor_price_epoch.

    Steps at 256 / 1024 / 2048: 0.002 / 0.005 / 0.01 / 0.02 ZEC
    (~$3.08 / $7.70 / $15.39 / $30.78 at ZEC $1,539).
    """
    if n < 256:
        return 200_000
    if n < 1024:
        return 500_000
    if n < 2048:
        return 1_000_000
    return 2_000_000


def floor_price_epoch(epoch: int) -> int:
    """Zatoshis by epoch number — keeps every rank table on one price.

    Full epochs map to the same published schedule as mint-index steps:
      epochs 0–1   (256 mints)  200_000
      epochs 2–7   (768)        500_000
      epochs 8–15  (1024)     1_000_000
      epochs 16–31 (2048)     2_000_000
    """
    if epoch < 2:
        return 200_000
    if epoch < 8:
        return 500_000
    if epoch < 16:
        return 1_000_000
    return 2_000_000


def base_difficulty(n: int, base: int = BASE_DIFFICULTY_BITS) -> int:
    """Flat base for the whole collection. Price staircases separately."""
    return base


def challenge_for(block_hash: bytes) -> bytes:
    """The puzzle for anyone mining against this block. `block_hash` is the
    bytes of the hex string the node's RPC reports as the block `hash`."""
    return blake(b"zvlt.challenge.v2", block_hash)


def pow_hash(challenge: bytes, commitment: bytes, miner_tag: bytes, nonce: int) -> bytes:
    """The commitment is inside the hash. Change one byte of it and the
    nonce stops working, so a solution cannot be copied onto someone else's
    commitment."""
    return blake(challenge, commitment, miner_tag, struct.pack(">Q", nonce))


def _require_32(name: str, value) -> bytes:
    """Reject anything that is not exactly 32 bytes — closes length-ambiguous
    secret||seed openings that could otherwise hash to the same commitment."""
    if not isinstance(value, (bytes, bytearray)) or len(value) != 32:
        raise ValueError(f"{name} must be exactly 32 bytes")
    return bytes(value)


def build_commitment(secret, seed, salt, work, patience, burn, money) -> bytes:
    """miner.py imports this. One definition, so they cannot drift.

    Domain tags on every input make concatenation unambiguous even if a future
    caller passed variable-length fields; lengths are also pinned to 32.
    """
    secret = _require_32("secret", secret)
    seed = _require_32("seed", seed)
    salt = _require_32("salt", salt)
    bid = struct.pack(">BBIB", work, patience, burn, money)
    return blake(
        b"zvlt.commitment.v2",
        b"zvlt.secret.v2", secret,
        b"zvlt.seed.v2", seed,
        b"zvlt.bid.v2", bid,
        b"zvlt.salt.v2", salt,
    )


def _xor_checksum(body: bytes) -> bytes:
    chk = 0
    for b in body:
        chk ^= b
    return body + bytes([chk])


def build_record(commitment, nonce, work, patience, burn, money, tag) -> bytes:
    body = (MAGIC + bytes([VERSION, KIND_MINT]) + commitment
            + struct.pack(">Q", nonce) + bytes([work, patience])
            + struct.pack(">I", burn) + bytes([money]) + tag)
    return _xor_checksum(body)


def build_reveal_chunks(index: int, secret, seed, salt):
    """Two OP_RETURN payloads that together open a mint. Bid fields are NOT
    repeated — the indexer already has them from the mint record.

        A (74): magic, ver, kind=0x02, seq=0, index, secret, seed, checksum
        B (42): magic, ver, kind=0x02, seq=1, index, salt, checksum

    Both must appear in the same transaction; a lone chunk is not a reveal.
    """
    secret = _require_32("secret", secret)
    seed = _require_32("seed", seed)
    salt = _require_32("salt", salt)
    idx = struct.pack(">H", index)
    a = _xor_checksum(
        MAGIC + bytes([VERSION, KIND_REVEAL, 0]) + idx + secret + seed)
    b = _xor_checksum(
        MAGIC + bytes([VERSION, KIND_REVEAL, 1]) + idx + salt)
    return a, b


def parse_reveal_chunk(payload: bytes):
    """Parse one reveal chunk. Returns (seq, index, body) or None."""
    if len(payload) not in (74, 42):
        return None
    if payload[:4] != MAGIC or payload[4] != VERSION or payload[5] != KIND_REVEAL:
        return None
    chk = 0
    for b in payload[:-1]:
        chk ^= b
    if chk != payload[-1]:
        return None
    seq = payload[6]
    index = struct.unpack(">H", payload[7:9])[0]
    if seq == 0 and len(payload) == 74:
        return seq, index, payload[9:73]          # secret||seed (checked later)
    if seq == 1 and len(payload) == 42:
        return seq, index, payload[9:41]          # salt
    return None


def assemble_reveal(payloads):
    """From a transaction's OP_RETURN list, build (index, secret, seed, salt)
    or None. Requires both seq 0 and seq 1 for the same index in this tx."""
    by_idx = {}
    for p in payloads:
        got = parse_reveal_chunk(p)
        if got is None:
            continue
        seq, index, body = got
        by_idx.setdefault(index, {})[seq] = body
    # One reveal per tx; pick the only complete pair if present.
    complete = []
    for index, parts in by_idx.items():
        if 0 in parts and 1 in parts:
            secret, seed = parts[0][:32], parts[0][32:64]
            salt = parts[1]
            if len(parts[0]) == 64 and len(salt) == 32:
                complete.append((index, secret, seed, salt))
    if len(complete) != 1:
        return None
    return complete[0]


def trait_hash_of(seed: bytes, secret: bytes, score: int, seal: bytes) -> int:
    return int.from_bytes(blake(seed, secret, struct.pack(">I", score), seal), "big")


def tiebreak_key(seal: bytes, commitment: bytes) -> bytes:
    """Seal-bound lottery. Nobody can grind this: the seal does not exist at
    commit time, and the commitment is already fixed. Replaces the old
    'lowest PoW hash' tiebreak, which was an uncapped hashrate contest."""
    return blake(seal, commitment)


def tier_for_rank(rank: int, n: int) -> int:
    """Rank 0 is best. Seats scale with epoch size, so a short epoch sealed by
    timeout keeps the same proportions as a full one."""
    pos = rank * EPOCH_SIZE // n
    for bound, tier in SEAT_BOUNDS:
        if pos < bound:
            return tier
    return 0


def tier_by_score(score: int) -> int:
    """Absolute floor lookup. Never assigns a tier by itself — see assign_tier."""
    for i, cut in enumerate(SCORE_FLOORS[1:], start=1):
        if score < cut:
            return i - 1
    return 4


def assign_tier(rank: int, n: int, score: int) -> int:
    """Rank decides the queue; score floor stops empty-room oracles.

        tier = min(tier_by_rank, tier_by_score + 1)

    A contested full epoch with competitive bids still fills 8/16/32/32/40.
    A solo minimum bid in a timeout epoch cannot clear oracle.
    """
    return min(tier_for_rank(rank, n), tier_by_score(score) + 1)


# --------------------------------------------------------------------- parse

@dataclass
class MintRecord:
    commitment: bytes
    nonce: int
    work_bits: int
    patience: int
    burn_amount: int
    money_multiple: int
    miner_tag: bytes


def parse_mint(payload: bytes):
    """Returns a MintRecord, or None. Never raises on malformed input — a bad
    record is not an error condition, it is simply not a mint."""
    if len(payload) != 74:
        return None
    if payload[:4] != MAGIC or payload[4] != VERSION or payload[5] != KIND_MINT:
        return None
    chk = 0
    for b in payload[:73]:
        chk ^= b
    if chk != payload[73]:
        return None

    commitment = payload[6:38]
    nonce = struct.unpack(">Q", payload[38:46])[0]
    work_bits = payload[46]
    patience = payload[47]
    burn_amount = struct.unpack(">I", payload[48:52])[0]
    money_multiple = payload[52]
    miner_tag = payload[53:73]

    if work_bits > MAX_WORK_BITS or patience > MAX_PATIENCE:
        return None
    if burn_amount > MAX_BURN or money_multiple > MAX_MONEY:
        return None

    return MintRecord(commitment, nonce, work_bits, patience,
                      burn_amount, money_multiple, miner_tag)


class InputError(Exception):
    """The block stream itself is wrong (gap, wrong start). This is never a
    property of a mint; it means this indexer cannot produce a trustworthy
    state and must stop rather than diverge silently."""


# --------------------------------------------------------------------- state

@dataclass
class Vault:
    launch_height: int = LAUNCH_HEIGHT
    base_bits: int = BASE_DIFFICULTY_BITS
    seal_timeout: int = SEAL_TIMEOUT
    patience_unit: int = PATIENCE_UNIT

    minted: int = 0
    commitments: list = field(default_factory=list)
    by_commitment: dict = field(default_factory=dict)
    epochs: list = field(default_factory=list)
    revealed: dict = field(default_factory=dict)
    rejected: int = 0

    hashes: dict = field(default_factory=dict)       # height -> block hash bytes
    minted_at: dict = field(default_factory=dict)    # height -> minted after block
    height: int = None                               # last block applied

    # --------------------------------------------------------------- blocks

    def first_height(self) -> int:
        return self.launch_height - CHALLENGE_WINDOW

    def open_epoch(self):
        if self.epochs and self.epochs[-1]["seal"] is None:
            return self.epochs[-1]
        return None

    def apply_block(self, height: int, block_hash: bytes, txs=()):
        """Feed every block, in order, with no gaps, starting at
        launch_height - CHALLENGE_WINDOW. Returns a log of mint results."""
        if self.height is None:
            if height < self.first_height():
                return []                                # pre-history, ignore
            if height != self.first_height():
                raise InputError(f"stream must start at {self.first_height()}, got {height}")
        elif height != self.height + 1:
            raise InputError(f"gap: expected block {self.height + 1}, got {height}")

        self.height = height
        self.hashes[height] = block_hash
        log = []

        # Timeout seal happens before this block's mints, using this block's
        # hash. Mints in this block go into the next epoch.
        ep = self.open_epoch()
        if ep and height >= ep["open_height"] + self.seal_timeout:
            self._seal(ep, height, "timeout")
            log.append({"height": height, "ok": True,
                        "reason": f"epoch {ep['number']} sealed by timeout ({len(ep['members'])} mints)"})

        if height >= self.launch_height:
            for pos, tx in enumerate(txs):
                payload = tx.get("op_return")
                if isinstance(payload, str):
                    payload = bytes.fromhex(payload)
                if not payload or not payload.startswith(MAGIC):
                    continue
                rec = parse_mint(payload)
                if rec is None:
                    ok, reason = False, "malformed"
                else:
                    ok, reason = self.apply_mint(
                        rec, paid=tx.get("paid_to_treasury", 0),
                        burned=tx.get("burned", 0), height=height,
                        txid=tx.get("txid", f"{height}:{pos}"))
                if not ok:
                    self.rejected += 1
                log.append({"height": height, "txid": tx.get("txid"),
                            "ok": ok, "reason": reason})

        self.minted_at[height] = self.minted
        # Only the last CHALLENGE_WINDOW blocks can ever be looked up again.
        old = height - CHALLENGE_WINDOW - 1
        self.minted_at.pop(old, None)
        return log

    # ---------------------------------------------------------------- mints

    def _find_challenge(self, rec: MintRecord, height: int):
        """Newest challenge first. Returns (challenge_height, quote, pow) or
        None. Quote is minted-at-challenge (diagnostics). Difficulty is flat
        base + workBits. Price is floor_price_epoch of the epoch the mint joins."""
        lo = max(height - CHALLENGE_WINDOW, self.launch_height - 1)
        for hc in range(height - 1, lo - 1, -1):
            if hc not in self.hashes or hc not in self.minted_at:
                raise InputError(f"missing block {hc} needed for a challenge")
            quote = self.minted_at[hc]
            bits = base_difficulty(quote, self.base_bits) + rec.work_bits
            h = pow_hash(challenge_for(self.hashes[hc]), rec.commitment,
                         rec.miner_tag, rec.nonce)
            if int.from_bytes(h, "big") < target_for(bits):
                return hc, quote, int.from_bytes(h, "big")
        return None

    def apply_mint(self, rec: MintRecord, paid: int, burned: int,
                   height: int, txid: str):
        """Every rejection path is explicit and returns a reason, so an
        audit produces a diffable log rather than a silent divergence."""
        if self.minted >= SUPPLY_CAP:
            return False, "supply exhausted"
        if rec.commitment in self.by_commitment:
            return False, "duplicate commitment"
        found = self._find_challenge(rec, height)
        if found is None:
            return False, "bad proof of work"
        hc, quote, pw = found

        # Epoch (hence price) is known before we accept payment.
        ep = self.open_epoch()
        if ep is None:
            ep = {"number": len(self.epochs), "open_height": height,
                  "members": [], "seal": None, "seal_height": None,
                  "sealed_by": None}
            self.epochs.append(ep)

        floor = floor_price_epoch(ep["number"])
        want = floor * (1 + rec.money_multiple)
        if paid < want:
            return False, f"underpaid: {paid} < {want}"
        if burned < rec.burn_amount:
            return False, f"burn short: {burned} < {rec.burn_amount}"

        index = self.minted
        self.commitments.append({
            "index": index,
            "epoch": ep["number"],
            "commitment": rec.commitment,
            "work_bits": rec.work_bits,
            "patience": rec.patience,
            "burn_amount": rec.burn_amount,
            "money_multiple": rec.money_multiple,
            "score": score_of(rec.work_bits, rec.patience,
                              rec.burn_amount, rec.money_multiple),
            "pow": pw,
            "challenge_height": hc,
            "quote_minted": quote,
            "floor_zat": floor,
            "height": height,
            "txid": txid,
            "tier": None,
        })
        self.by_commitment[rec.commitment] = index
        ep["members"].append(index)
        self.minted += 1

        if len(ep["members"]) >= EPOCH_SIZE:
            self._seal(ep, height, "full")
        elif self.minted >= SUPPLY_CAP:
            self._seal(ep, height, "supply")
        return True, f"mint #{index} epoch {ep['number']}"

    def _seal(self, ep, height: int, why: str):
        """Seal = every commitment in the epoch plus the hash of the block the
        seal happens in. The last minter cannot know that hash when they
        commit, so nobody in the epoch could have predicted their roll."""
        parts = [b"zvlt.seal.v2", struct.pack(">II", ep["number"], height),
                 self.hashes[height]]
        parts += [self.commitments[i]["commitment"] for i in ep["members"]]
        ep["seal"] = blake(*parts)
        ep["seal_height"] = height
        ep["sealed_by"] = why

        # Rank: higher score first. Ties break on blake(seal || commitment) —
        # a lottery fixed only when the epoch seals, not a post-solution grind.
        # Floor: cannot sit more than one tier above what absolute score clears.
        order = sorted(
            ep["members"],
            key=lambda i: (
                -self.commitments[i]["score"],
                tiebreak_key(ep["seal"], self.commitments[i]["commitment"]),
            ),
        )
        n = len(order)
        for rank, i in enumerate(order):
            sc = self.commitments[i]["score"]
            self.commitments[i]["tier"] = assign_tier(rank, n, sc)
            self.commitments[i]["rank"] = rank
            self.commitments[i]["tiebreak"] = tiebreak_key(
                ep["seal"], self.commitments[i]["commitment"]
            ).hex()

    # --------------------------------------------------------------- reveal

    def apply_reveal(self, index: int, secret: bytes, seed: bytes, salt: bytes,
                     work: int, patience: int, burn: int, money: int,
                     height: int):
        if index >= len(self.commitments):
            return False, "no such commitment"
        c = self.commitments[index]
        if index in self.revealed:
            return False, "already revealed"
        ep = self.epochs[c["epoch"]]
        if ep["seal"] is None or height <= ep["seal_height"]:
            return False, "epoch not sealed"
        if height < c["height"] + patience * self.patience_unit:
            return False, "patience not served"

        # The whole reveal check: recompute the hash. No verifier, no VM.
        if build_commitment(secret, seed, salt, work, patience, burn, money) != c["commitment"]:
            return False, "opening does not match commitment"
        if (work, patience, burn, money) != (
            c["work_bits"], c["patience"], c["burn_amount"], c["money_multiple"]
        ):
            return False, "opened inputs differ from recorded bid"

        th = trait_hash_of(seed, secret, c["score"], ep["seal"])
        self.revealed[index] = {"score": c["score"], "tier": c["tier"], "trait_hash": th}
        return True, f"revealed #{index} {TIER_NAMES[c['tier']]} (rank {c['rank']})"

    # ---------------------------------------------------------------- views

    def digest(self) -> str:
        """One hash over the whole state. Two indexers agreeing on this string
        agree on everything; disagreement points straight at the first
        divergent mint."""
        h = hashlib.blake2b(digest_size=32)
        h.update(struct.pack(">I", self.minted))
        for c in self.commitments:
            h.update(c["commitment"])
            h.update(struct.pack(">II", c["index"], c["height"]))
        for ep in self.epochs:
            h.update(struct.pack(">I", ep["number"]))
            if ep["seal"] is not None:
                h.update(ep["seal"])
                for i in ep["members"]:
                    h.update(struct.pack(">IB", i, self.commitments[i]["tier"]))
        for i in sorted(self.revealed):
            h.update(struct.pack(">II", i, self.revealed[i]["score"]))
            h.update(self.revealed[i]["trait_hash"].to_bytes(32, "big"))
        return h.hexdigest()

    def table(self) -> dict:
        """The public order book: what a miner is bidding into right now.
        Publish this at every block."""
        ep = self.open_epoch()
        tip_q = self.minted
        out = {
            "tip_height": self.height,
            "tip_hash": self.hashes[self.height].hex() if self.height is not None else None,
            "valid_through_height": (self.height or 0) + CHALLENGE_WINDOW,
            "minted": self.minted,
            "supply_cap": SUPPLY_CAP,
            "base_bits": base_difficulty(tip_q, self.base_bits),
            "floor_price_zat": floor_price_epoch(
                ep["number"] if ep is not None else len(self.epochs)),
            "epoch": None,
        }
        if ep is None:
            out["epoch"] = {"number": len(self.epochs), "open": False,
                            "note": "next mint opens a new epoch"}
            return out
        # Live table: seal may not exist yet. Commitment order is a stable
        # preview only — final ties break on blake(seal||commitment) at seal.
        if ep["seal"] is not None:
            members = sorted(
                ep["members"],
                key=lambda i: (
                    -self.commitments[i]["score"],
                    tiebreak_key(ep["seal"], self.commitments[i]["commitment"]),
                ),
            )
            tie_note = "blake(seal||commitment)"
        else:
            members = sorted(
                ep["members"],
                key=lambda i: (
                    -self.commitments[i]["score"],
                    self.commitments[i]["commitment"],
                ),
            )
            tie_note = "provisional (commitment); final = blake(seal||commitment)"
        bids = []
        for rank, i in enumerate(members):
            c = self.commitments[i]
            bids.append({"index": i, "score": c["score"],
                         "if_full_now": TIER_NAMES[assign_tier(rank, EPOCH_SIZE, c["score"])],
                         "if_timeout_now": TIER_NAMES[assign_tier(rank, len(members), c["score"])],
                         "work": c["work_bits"], "patience": c["patience"],
                         "burn": c["burn_amount"], "money": c["money_multiple"]})
        out["epoch"] = {"number": ep["number"], "open": ep["seal"] is None,
                        "filled": len(members), "seats": EPOCH_SIZE,
                        "opened_at": ep["open_height"],
                        "timeout_height": ep["open_height"] + self.seal_timeout,
                        "tiebreak": tie_note,
                        "bids": bids}
        return out


# ---------------------------------------------------------------------- main

def scan(blocks, vault=None):
    """`blocks` is chain.py's output: every block from LAUNCH_HEIGHT -
    CHALLENGE_WINDOW onward, in order, each with its hash and any ZVLT txs.
    op_return may be bytes or hex; JSON carries hex."""
    v = vault or Vault()
    log = []
    for blk in blocks:
        bh = blk["hash"]
        if isinstance(bh, str):
            bh = bytes.fromhex(bh)
        log += v.apply_block(blk["height"], bh, blk.get("tx", []))
    return v, log


# ------------------------------------------------------------------ self-test

def _selftest():
    """Mines real records against the real rules at low difficulty and checks
    every property v2 claims. Nothing here is mocked except the block hashes."""
    import random

    BASE, LAUNCH = 6, 1000
    rng = random.Random(7)
    fails = []

    def check(cond, msg):
        print(f"  {'ok  ' if cond else 'FAIL'}  {msg}")
        if not cond:
            fails.append(msg)

    def fake_hash(h):
        return blake(b"fakeblock", struct.pack(">I", h))

    def mine(vault, chal_height, commitment, tag, work):
        ch = challenge_for(fake_hash(chal_height))
        bits = base_difficulty(vault.minted_at[chal_height], BASE) + work
        n = 0
        while int.from_bytes(pow_hash(ch, commitment, tag, n), "big") >= target_for(bits):
            n += 1
        return n

    def new_bid(work, patience, burn=0, money=0):
        s = {"secret": rng.randbytes(32), "seed": rng.randbytes(32), "salt": rng.randbytes(32),
             "tag": rng.randbytes(20), "work": work, "patience": patience,
             "burn": burn, "money": money}
        s["commitment"] = build_commitment(s["secret"], s["seed"], s["salt"],
                                           work, patience, burn, money)
        return s

    def tx_for(v, s, nonce, paid=None):
        rec = build_record(s["commitment"], nonce, s["work"], s["patience"],
                           s["burn"], s["money"], s["tag"])
        if paid is None:
            ep = v.open_epoch()
            en = ep["number"] if ep else len(v.epochs)
            paid = floor_price_epoch(en) * (1 + s["money"])
        return {"txid": rng.randbytes(4).hex(), "op_return": rec.hex(),
                "paid_to_treasury": paid, "burned": s["burn"]}

    # -- build the chain block by block, mining against the live vault --------
    v = Vault(launch_height=LAUNCH, base_bits=BASE, seal_timeout=40, patience_unit=10)
    blocks = []

    def feed(h, txs):
        blocks.append({"height": h, "hash": fake_hash(h).hex(), "tx": txs})
        return v.apply_block(h, fake_hash(h), txs)

    h = LAUNCH - CHALLENGE_WINDOW
    while h < LAUNCH:
        feed(h, [])
        h += 1

    print("no --blocks given, running self-test\n")

    # 1. Two racers solve the same challenge and land in the same block.
    # a is scored high enough that rank+floor still allows oracle in a short epoch.
    a, b = new_bid(MAX_WORK_BITS, 8, money=4), new_bid(0, 0)
    na = mine(v, h - 1, a["commitment"], a["tag"], a["work"])
    nb = mine(v, h - 1, b["commitment"], b["tag"], b["work"])
    log = feed(h, [tx_for(v, a, na), tx_for(v, b, nb)])
    check(all(x["ok"] for x in log), "two mints on the same challenge in one block both count")
    h += 1

    # 1b. Burn > MAX_BURN (=0) is rejected at parse — before any payment logic.
    check(MAX_BURN == 0, "MAX_BURN is 0 until a real burn exists")
    burned_body = (MAGIC + bytes([VERSION, KIND_MINT]) + b"\x00" * 32
                   + struct.pack(">Q", 0) + bytes([0, 0])
                   + struct.pack(">I", 1) + bytes([0]) + b"\x11" * 20)
    chk = 0
    for byte in burned_body:
        chk ^= byte
    burned_rec = burned_body + bytes([chk])
    check(parse_mint(burned_rec) is None,
          "burnAmount > MAX_BURN is rejected by parse_mint (no paid burn-short)")
    log = feed(h, [{"txid": "burntrap", "op_return": burned_rec.hex(),
                    "paid_to_treasury": floor_price_epoch(0), "burned": 0}])
    check(log[0]["reason"] == "malformed",
          "a burn>0 record is malformed on the wire, never apply_mint")
    h += 1

    # 2. A thief copies a's nonce and tag onto their own commitment.
    thief = new_bid(a["work"], a["patience"])
    thief["tag"] = a["tag"]
    log = feed(h, [tx_for(v, thief, na)])
    check(log[0]["reason"] == "bad proof of work", "a copied nonce on another commitment is rejected")
    # ...or copies a's whole record. That mint is a's, not theirs.
    log = feed(h + 1, [tx_for(v, a, na)])
    check(log[0]["reason"] == "duplicate commitment", "replaying the exact record is rejected")
    h += 2

    # 3. Stale challenge outside the window.
    # Max work, so the stale nonce cannot pass a newer challenge by luck
    # (at this test's 6-bit base, a 0-work nonce would ~30% of the time).
    old = new_bid(MAX_WORK_BITS, 0)
    n_old = mine(v, LAUNCH - 1, old["commitment"], old["tag"], MAX_WORK_BITS)
    for _ in range(CHALLENGE_WINDOW):
        feed(h, [])
        h += 1
    log = feed(h, [tx_for(v, old, n_old)])
    check(log[0]["reason"] == "bad proof of work", "a challenge older than the window is rejected")
    h += 1

    # 4. Underpaying against the quoted price.
    cheap = new_bid(0, 0, money=2)
    nc = mine(v, h - 1, cheap["commitment"], cheap["tag"], 0)
    log = feed(h, [tx_for(v, cheap, nc, paid=floor_price_epoch(0) * 2)])
    check(log[0]["reason"].startswith("underpaid"), "paying less than floor x (1 + money) is rejected")
    h += 1

    # 5. Reveal before the epoch seals is impossible: the roll does not exist.
    ok, reason = v.apply_reveal(0, a["secret"], a["seed"], a["salt"], a["work"],
                                a["patience"], a["burn"], a["money"], height=h + 500)
    check(reason == "epoch not sealed", "no reveal while the epoch is open")

    # 6. Timeout seal of a short epoch (2 mints). Epoch 0 opened at LAUNCH.
    while v.open_epoch() is not None:
        feed(h, [])
        h += 1
    ep0 = v.epochs[0]
    check(ep0["sealed_by"] == "timeout" and len(ep0["members"]) == 2,
          f"stalled epoch sealed by timeout at {ep0['seal_height']} with 2 mints")
    # a bid MAX_WORK+patience clears the score floor for oracle; b does not need to.
    check(v.commitments[0]["tier"] == 4 and v.commitments[1]["tier"] < 4,
          "short contested epoch: top bid can still be oracle; weaker bid is not")

    # 6b. Solo minimum bid + timeout must NOT manufacture an oracle.
    solo_v = Vault(launch_height=LAUNCH, base_bits=BASE, seal_timeout=40, patience_unit=10)
    sh = LAUNCH - CHALLENGE_WINDOW
    while sh < LAUNCH:
        solo_v.apply_block(sh, fake_hash(sh), [])
        sh += 1
    solo = new_bid(0, 0)
    sn = mine(solo_v, sh - 1, solo["commitment"], solo["tag"], 0)
    solo_v.apply_block(sh, fake_hash(sh), [tx_for(solo_v, solo, sn)])
    sh += 1
    while solo_v.open_epoch() is not None:
        solo_v.apply_block(sh, fake_hash(sh), [])
        sh += 1
    solo_tier = solo_v.commitments[0]["tier"]
    check(solo_v.epochs[0]["sealed_by"] == "timeout" and solo_tier != 4,
          f"solo min-bid timeout epoch must not mint an oracle (got {TIER_NAMES[solo_tier]})")
    check(solo_tier == assign_tier(0, 1, solo_v.commitments[0]["score"]),
          "solo tier matches min(rank, score_tier+1)")

    # 7. Patience in blocks: a (patience 8 = 80 test-blocks) mined at LAUNCH.
    unlock_a = LAUNCH + a["patience"] * 10
    ok, reason = v.apply_reveal(0, a["secret"], a["seed"], a["salt"], a["work"],
                                a["patience"], a["burn"], a["money"],
                                height=ep0["seal_height"] + 1)
    check(reason == "patience not served",
          "reveal before patience unlock is rejected even if epoch is sealed")
    ok, reason = v.apply_reveal(0, a["secret"], a["seed"], a["salt"], a["work"],
                                a["patience"], a["burn"], a["money"],
                                height=max(unlock_a, ep0["seal_height"] + 1))
    check(ok, f"patience is blocks, not epochs: {reason}")
    ok, reason = v.apply_reveal(1, b["secret"], rng.randbytes(32), b["salt"], b["work"],
                                b["patience"], b["burn"], b["money"], height=h)
    check(reason == "opening does not match commitment", "wrong seed cannot open")
    ok, reason = v.apply_reveal(1, b["secret"], b["seed"], b["salt"], b["work"] + 1,
                                b["patience"], b["burn"], b["money"], height=h)
    check(not ok, "inflated bid cannot open")

    # patience-blocked case: a patience-16 bid is never stranded, just waits.
    slow = new_bid(0, 16)
    ns = mine(v, h - 1, slow["commitment"], slow["tag"], 0)
    feed(h, [tx_for(v, slow, ns)])
    slow_i, slow_h = v.minted - 1, h
    h += 1

    # 8. Fill a full epoch of 128 across many blocks with competitive bids so
    #    the score floor does not demote the rank table (8/16/32/32/40).
    bids = {}
    while v.open_epoch() is not None and len(v.open_epoch()["members"]) < EPOCH_SIZE:
        ep = v.open_epoch()
        en = ep["number"]
        need = EPOCH_SIZE - len(ep["members"])
        txs = []
        for _ in range(min(need, rng.randint(1, 12))):
            s = new_bid(rng.randint(2, MAX_WORK_BITS), rng.randint(10, 16),
                        0, rng.randint(2, MAX_MONEY))
            hc = h - rng.randint(1, 3)
            n = mine(v, hc, s["commitment"], s["tag"], s["work"])
            txs.append(tx_for(v, s, n,
                              paid=floor_price_epoch(en) * (1 + s["money"])))
            bids[s["commitment"]] = s
        feed(h, txs)
        h += 1
    ep = v.epochs[1]
    check(ep["sealed_by"] == "full" and len(ep["members"]) == EPOCH_SIZE,
          f"epoch 1 sealed full at 128 (height {ep['seal_height']})")
    counts = [0] * 5
    for i in ep["members"]:
        counts[v.commitments[i]["tier"]] += 1
    check(counts[::-1] == [8, 16, 32, 32, 40], f"seats oracle..drone = {counts[::-1]}")
    ranked = sorted(ep["members"], key=lambda i: v.commitments[i]["rank"])
    seal = ep["seal"]
    mono = True
    for x, y in zip(ranked, ranked[1:]):
        sx, sy = v.commitments[x]["score"], v.commitments[y]["score"]
        if sx < sy:
            mono = False
            break
        if sx == sy and (tiebreak_key(seal, v.commitments[x]["commitment"])
                         > tiebreak_key(seal, v.commitments[y]["commitment"])):
            mono = False
            break
    check(mono, "rank is score descending, ties to blake(seal||commitment)")

    # 8b. After an early timeout, no later epoch mixes two floor prices.
    floors_by_ep = {}
    for c in v.commitments:
        floors_by_ep.setdefault(c["epoch"], set()).add(c["floor_zat"])
    mixed = {e: fs for e, fs in floors_by_ep.items() if len(fs) > 1}
    check(not mixed, f"each epoch has one quoted floor (mixed={mixed})")

    # 9. Grinding is dead: same bid, same seed and secret, different seal ->
    #    different punk. The miner cannot know the seal when they commit.
    s0 = v.commitments[slow_i]
    t1 = trait_hash_of(slow["seed"], slow["secret"], s0["score"], v.epochs[1]["seal"])
    t2 = trait_hash_of(slow["seed"], slow["secret"], s0["score"], blake(b"another seal"))
    check(t1 != t2, "trait hash depends on the seal, which did not exist at commit time")

    ok, reason = v.apply_reveal(slow_i, slow["secret"], slow["seed"], slow["salt"],
                                0, 16, 0, 0, height=slow_h + 16 * 10 - 1)
    check(reason == "patience not served", "patience 16 waits 16 units")
    ok, reason = v.apply_reveal(slow_i, slow["secret"], slow["seed"], slow["salt"],
                                0, 16, 0, 0, height=slow_h + 16 * 10)
    check(ok, "...and then opens. No bid can be sealed forever")

    # 10. Epoch-priced staircase: after early timeout, fill later epochs and
    #     assert each epoch has exactly one floor_zat (no mixed quote table).
    u = Vault(launch_height=LAUNCH, base_bits=BASE, seal_timeout=40, patience_unit=10)
    uh = LAUNCH - CHALLENGE_WINDOW
    while uh < LAUNCH:
        u.apply_block(uh, fake_hash(uh), [])
        uh += 1
    s = new_bid(0, 0)
    u.apply_block(uh, fake_hash(uh),
                  [tx_for(u, s, mine(u, uh - 1, s["commitment"], s["tag"], 0))])
    uh += 1
    while u.open_epoch() is not None:
        u.apply_block(uh, fake_hash(uh), [])
        uh += 1
    check(u.epochs[0]["sealed_by"] == "timeout" and len(u.epochs[0]["members"]) == 1,
          "uniformity setup: early timeout with 1 mint")
    # Fill epochs 1 and 2 to completion (full 128 each).
    while len([e for e in u.epochs if e.get("seal")]) < 3:
        ep = u.open_epoch()
        if ep is None:
            s = new_bid(0, 0)
            u.apply_block(uh, fake_hash(uh),
                          [tx_for(u, s, mine(u, uh - 1, s["commitment"], s["tag"], 0))])
            uh += 1
            continue
        en = ep["number"]
        need = EPOCH_SIZE - len(ep["members"])
        txs = []
        for _ in range(min(need, 16)):
            s = new_bid(0, 0)
            txs.append(tx_for(u, s, mine(u, uh - 1, s["commitment"], s["tag"], 0),
                              paid=floor_price_epoch(en)))
        u.apply_block(uh, fake_hash(uh), txs)
        uh += 1
    bad = {}
    for c in u.commitments:
        bad.setdefault(c["epoch"], set()).add(c["floor_zat"])
    mixed = {e: sorted(fs) for e, fs in bad.items() if len(fs) > 1}
    check(not mixed,
          f"after short timeout, no later epoch mixes floors (mixed={mixed})")
    # Epoch 0 (short) and epoch 1 (full) both use epochs < 2 → same 200k floor;
    # epoch 2 is still < 8 → 500k. Spot-check schedule.
    check(floor_price_epoch(0) == floor_price_epoch(1) == 200_000, "epochs 0-1 floor")
    check(floor_price_epoch(2) == 500_000, "epoch 2 floor step")
    check(base_difficulty(0) == base_difficulty(3000) == BASE_DIFFICULTY_BITS,
          "base difficulty is flat at BASE_DIFFICULTY_BITS")

    # 11. Determinism, and the JSON path that chain.py actually produces.
    w, _ = scan(json.loads(json.dumps(blocks)),
                Vault(launch_height=LAUNCH, base_bits=BASE, seal_timeout=40, patience_unit=10))
    check(w.digest() == Vault.digest(_strip_reveals(v)),
          "replaying the chain from JSON (hex op_return) gives the same digest")

    try:
        Vault(launch_height=LAUNCH).apply_block(LAUNCH, b"x" * 32)
        check(False, "a stream with the wrong start is refused")
    except InputError:
        check(True, "a stream with the wrong start is refused, not silently indexed")

    print(f"\n  minted {v.minted}  rejected {v.rejected}  epochs {len(v.epochs)}")
    print(f"  state digest: {v.digest()}")
    if fails:
        print(f"\n  {len(fails)} FAILED")
        sys.exit(1)
    print("\n  all checks passed")


def _strip_reveals(v):
    """Reveals are applied through the API in the self-test, not from chain
    records, so compare the chain-derived part of the state."""
    import copy
    w = copy.copy(v)
    w.revealed = {}
    return w


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--blocks", help="JSON file from chain.py scan; omit for self-test")
    ap.add_argument("--epoch-json", help="also write the live table to this file")
    ap.add_argument("--log", action="store_true", help="print every record's result")
    args = ap.parse_args()

    if not args.blocks:
        _selftest()
        sys.exit(0)

    try:
        v, log = scan(json.load(open(args.blocks)))
    except InputError as e:
        print(f"refusing to produce a state: {e}", file=sys.stderr)
        sys.exit(2)
    if args.log:
        for entry in log:
            print(json.dumps(entry))
    if args.epoch_json:
        json.dump(v.table(), open(args.epoch_json, "w"), indent=2)
    print(json.dumps({"minted": v.minted, "rejected": v.rejected,
                      "epochs": len(v.epochs), "tip": v.height,
                      "digest": v.digest()}, indent=2))
