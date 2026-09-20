# DECISIONS — closed and open

## Decision 1 — work score vs staircase compute — CLOSED

**Resolved by flattening `base_difficulty` to 22 for the whole collection.**

There is no longer a 4×/16×/64× late-mint compute multiplier. With
`MAX_WORK_BITS = 4`, every mint is at most 26 bits — well inside the
24-block window on modest hardware. The price staircase remains; the
difficulty staircase does not.

Stale-quote gaming is now bounded only by the **price** step size
(~$3–$15 depending on money multiple at ZEC $1,539), so it no longer
constrains `CHALLENGE_WINDOW`. Window stays **24**.

(The old A/B write-up — scale max work per step vs document 64× cost — is
deleted as stale.)

## Decision 2 — challenge window — HOLD

Keep `CHALLENGE_WINDOW = 24` and `MAX_WORK_BITS = 4` until a CPU/GPU bench.
See prior tables in git history / chat if needed; single-step stale-quote
savings remain the relevant bound, and they are price-only after the flatten.

## Tiebreak — CLOSED (see SPEC / GAME)

Equal scores break on `blake2b(epochSeal || commitment)`, not PoW hash.

## Price — EPOCH-indexed staircase

`floor_price_epoch(epoch)`:
  epochs 0–1 → 200_000 zat · 2–7 → 500_000 · 8–15 → 1_000_000 · 16–31 → 2_000_000
