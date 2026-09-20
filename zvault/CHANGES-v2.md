# CHANGES-v2 — what was built from GAME.md

Zcash track only. EVM track and art pixels untouched.

**Provenance:** this v2 tree was implemented by a **Claude Opus 5** session
from Fable's `GAME.md` plan. Fable wrote the plan and did **not** write or
run this code. The self-test was written by the same session — it is a
regression harness for that build, not an independent audit.

Run `python zcash/indexer.py`: it prints one line per property below and
"all checks passed".

## Built (Opus 5 session from Fable's plan)

| # | change | origin | files |
|---|---|---|---|
| 1 | **Epoch seal in the trait hash.** | Fable plan | indexer, SPEC |
| 2 | **Patience in blocks.** 1 point = 1152 blocks (~1 day). | Fable plan | indexer, SPEC, HANDOFF |
| 3 | **Block-hash challenge.** Window of recent blocks; many mints per block. | Fable plan | indexer, miner, chain, SPEC |
| 4 | **Rank-based tiers** (with score floor — see follow-up). | Fable plan + follow-up | indexer, generate, SPEC |
| 0 | **PoW commits to the commitment.** | **Opus 5** (Fable's tag claim was wrong) | indexer, miner, SPEC |
| 5 | **Seal timeout.** Epoch seals at 128, supply cap, or timeout. | **Opus 5** | indexer, SPEC |
| 6 | **Price/difficulty quoted from the challenge block.** | **Opus 5** | indexer, miner, SPEC |
| 7 | **`--blocks` accepts chain.py hex JSON**, refuses gaps. | Opus 5 | indexer, chain |
| 8 | **Live table.** `--epoch-json` / `miner --table`. | Opus 5 | indexer, miner |
| — | Wire version `0x02`; commitments dedup dict. | Opus 5 | indexer |

## Why items 0, 5 and 6 are not in GAME.md as coded

**0.** GAME.md said "the miner tag still stops anyone stealing a solution."
That was false — nothing checked the tag against the payer, and `chain.py`
does not read it. Binding the commitment into the PoW is the fix. Fable
found the paid-loser race; Opus 5 found that the tag does not already solve
mempool theft.

**5.** GAME.md's seal only at the 128th mint leaves a stalled mid-epoch with
no traits. Timeout seal closes that gap.

**6.** Many mints per block can cross a staircase step mid-block; quoting
from the challenge block stops a correct grind becoming a paid reject.

## Follow-up blocking fixes (this workspace)

| # | change | why |
|---|---|---|
| A | `MAX_BURN = 0` until burn is defined | else burn>0 → "burn short" after payment |
| B | `tier = min(rank_tier, score_tier + 1)` | else solo timeout epochs mint free oracles |
| C | `MAX_WORK_BITS = 4` | top base 28 + 95% land rate ≈ 7 MH/s; see DECISIONS.md |

See `REVIEW.md`.

## Still open — launch blockers

- **Reveal and transfer records have no wire format.**
- **Burn is undefined** — axis capped at 0 until it isn't.
- **Memo is a receipt** (index/epoch/seal_height); miner owns keys.
- **`LAUNCH_HEIGHT` and `TREASURY` are placeholders.**
- `sim.py` still models v1 cutoffs for some commands; `epoch` models rank.
