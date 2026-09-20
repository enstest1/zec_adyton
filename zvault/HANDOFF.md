# ZVAULT — dev handoff

A sealed proof-of-work mint. You mine a hash, you win a commitment, and nobody —
including you and including us — knows what is inside until you open it.

Two build targets in here. **They are alternatives, not layers.** Read
`DECIDE.md` first.

```
DECIDE.md    read first: Zcash or EVM, and why they are alternatives
RUNBOOK.md   how to run everything, hosting (incl. Zcash node), key safety
NOTES.md     design reasoning, rejected approaches, all warnings
LAUNCH.md    thread draft + what in it is not true yet
LINKS.md     every doc reference in one place
MARKET.md    competitor teardowns, EV analysis, the chain investigation
GAME.md      Fable's plan: three protocol bugs + rank-based v2 design
CHANGES-v2.md  Opus 5 build from that plan (not Fable code) + follow-ups
REVIEW.md    provenance, who found what, blocking fixes A/B/C
DECISIONS.md work-vs-staircase + challenge-window stale-quote numbers
sim.py       reproduces every claim in GAME.md against the real scoring code
verify.py    smoke check: seal / PoW-bind / memo receipt / caps

zcash/       SPEC.md  indexer.py  chain.py  miner.py  memo.py  WALLETS.md
evm/         HashVault.sol  reveal.circom  threshold.circom
art/         generate.py  contact-sheet.png  tier-ladder.png  samples/
```

**Reading order:** `DECIDE.md` → `GAME.md` → `REVIEW.md` → `RUNBOOK.md` →
the track you picked. `GAME.md` is Fable's plan (trait grinding, stranded
patience, paid race losers). v2 code in this tree was built by an Opus 5
session from that plan — not by Fable. Run `python sim.py all` and
`python zcash/indexer.py` as regression checks, not as an independent audit.

## The one idea

Opening a sealed commitment needs a **hash**, not a proof system.

    commitment = blake2b(secret, seed, inputHash, salt)

Publish the opening, anyone recomputes and compares. That is a local
computation on public data — no verifier contract, no pairing precompile, no
VM. Which is why this design runs on Zcash at all.

ZK proofs are only needed for *selective* disclosure ("my score is above 700"
without saying what it is). That is optional and off-chain.

## The four inputs

| input | weight | bought with |
|---|---|---|
| work | 0.40 | difficulty bits above base — compute, not capital |
| patience | 0.25 | days (1152-block units) sealed before reveal — unbuyable |
| burn | 0.25 | tokens destroyed — the sink |
| money | 0.10 | premium over floor — capped, minor |

Each contributes `sqrt(x / x_max) * weight`. Ten times the spend buys about
3.16x the edge, and past `x_max` it buys nothing. Whales advantaged, never
decisive.

Weights are public and fixed. The complexity is four sealed axes interacting,
not hidden rules. See `tier-ladder.png` — each row is one seed, columns are
rising score. Higher score widens which trait pools are reachable; it never
picks a trait.

## Art

    python3 art/generate.py out

`sprite = derive_tier(traitHash, tier)` (v2; tier is rank in the sealed epoch). Pure function, chain-agnostic, works for either
target unchanged. Same input, same PNG, forever — anyone can verify a punk
without trusting a metadata server, and no punk exists before its owner opens
it.

## Run this first

    python3 zcash/indexer.py

Self-test (v2) mines ~260 real records at reduced difficulty across three
epochs and checks every protocol claim: same-block mints, stolen nonces,
stale challenges, underpayment, timeout seals, rank seats, patience in
blocks, the staircase step, and JSON replay determinism. Prints "all checks
passed" or exits non-zero.

---

## Status — nothing here has been deployed or audited

**Zcash track — protocol v2 (see REVIEW.md, DECISIONS.md)**
- Rules: seal lottery tiebreak, epoch-priced floors, flat base 22, work≤4,
  burn capped at 0, tier rank+floor
- `memo.py` — receipt encoder only; **no delivery path to learn the UA yet**

**Revenue:** Zcash has no NFT royalty primitive. **Primary mint revenue is
lifetime protocol revenue** unless something else is built later. Say that
plainly in go-to-market.

**Still open (blockers, not done):**
- Burn undefined (`MAX_BURN=0` is a stopgap)
- Reveal/transfer wire format — cut from v1 launch (SPEC/LAUNCH)
- `LAUNCH_HEIGHT` / `TREASURY` placeholders (must match chain.py ↔ indexer.py)
- Receipt memo delivery (no return address)

**EVM track**
- `HashVault.sol` — complete, unaudited, never deployed
- `reveal.circom` — complete, needs trusted setup
- `threshold.circom` — **deliberately incomplete.** Does not constrain its
  `score` input, so as written a prover can assert any score and the proof
  means nothing. Wire in `Reveal(DEPTH)` and bind its output. Left explicit so
  it cannot be missed.
- `transfer()` is a stub — spends a nullifier without proving ownership
- Incremental Merkle root is a sketch, not a correct implementation
- Groth16 needs a trusted setup ceremony, or switch to PLONK

If EVM: ecPairing is now available on ZKsync Era alongside ecAdd and ecMul at
the usual codes `0x06`/`0x07`/`0x08`, so Groth16 verification works there. But
Era needs `zksolc`, has native account abstraction, and a different gas
schedule. Deploy a snarkjs verifier to testnet and call it before anything
else — one hour, de-risks the whole build.

## Legal

A staked or yield-bearing asset draws real securities scrutiny in the US, and
a shielded pool that moves arbitrary value is a mixer with the regulatory
history that implies. Keep the shielded scope to "which punk you own" and get
counsel before adding any value-transfer path. Not legal advice.
