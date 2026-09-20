# REVIEW — zvault-v2.zip provenance and follow-up fixes

## Provenance (read this first)

**`zvault-v2.zip` is not Fable's official v2.** Fable wrote `GAME.md` (the
plan) and never wrote or ran v2 code. The zip was built by a **Claude Opus 5**
session that implemented that plan. Treat it as one agent's unreviewed build,
not an authoritative upstream drop.

Its self-test is **not** independent validation: the same agent wrote the
code and the tests, so it only covers properties that agent thought of.

### Who found what

| finding | who |
|---|---|
| Trait grinding (`traitHash` miner-controlled) | **Fable** (`GAME.md`) |
| Patience stranding (epoch-denominated lock) | **Fable** |
| Paid race losers (mint-chained challenge) | **Fable** |
| PoW must bind the commitment (tag does **not** stop theft; GAME.md §3 was wrong on that) | **Opus 5 session** (implementing the plan) |
| Partial-epoch seal gap (stall freezes traits without a timeout) | **Opus 5 session** |
| Staircase-boundary reject (quote price/difficulty from challenge block) | **Opus 5 session** |
| Memo vs miner key ownership contradiction | Independent verify (post-Fable) |
| `MAX_BURN>0` while `burned_in→0` recreates paid losers at parse-time miss | This follow-up |
| Pure rank mints oracles into empty/timeout epochs | This follow-up |
| `MAX_WORK_BITS` vs `CHALLENGE_WINDOW` infeasibility at 12 | This follow-up |

Do not credit v2 code, the PoW-commitment binding, seal timeout, or
challenge-block quoting to Fable.

---

## Blocking fixes applied in this follow-up

### (a) `MAX_BURN = 0` until burn is defined

With `burned_in()→0`, any `burnAmount > 0` failed in `apply_mint` as
"burn short" **after** the treasury payment landed — the paid-loser class v2
was built to remove. Cap burn at parse time so the record is discarded before
money moves.

### (b) Score floor on tier assignment

```
tier = min(tier_by_rank, tier_by_score + 1)
```

Rank still decides contested epochs. The floor stops a lone minimum bid in a
timeout-sealed epoch from manufacturing an oracle.

### (c) `MAX_WORK_BITS = 4` against `CHALLENGE_WINDOW = 24` (top of staircase)

Deriving from base **22** was wrong: at n ≥ 2048 base is **28**. With work 8
that is 36 bits → ~115 MH/s for a **95%** land rate in 24 blocks (λ≈3), worse
than the 34-bit case we were avoiding. Expected hashes (λ=1) is only ~63%.

**Decision:** `MAX_WORK_BITS = 4` → 32 bits at the top step → **~7.2 MH/s** for
95% landing. Provisional until a CPU/GPU bench. Full tables and the
window-vs-stale-quote analysis: `DECISIONS.md`. **Do not widen the window or
raise work further until those numbers are reviewed.**

---

## Still open

- Reveal / transfer OP_RETURN wire format
- Real burn mechanism (then raise `MAX_BURN` and restore the weight)
- `LAUNCH_HEIGHT` / `TREASURY` placeholders
- Hardware calibration before publishing base difficulty
