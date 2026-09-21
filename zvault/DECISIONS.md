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

Keep `CHALLENGE_WINDOW = 24` and `MAX_WORK_BITS = 4`. Hardest mint is 26 bits
(~17s on two Python cores); no GPU calibration gate. Stale-quote savings are
price-step only after the flatten.

## Tiebreak — CLOSED (see SPEC / GAME)

Equal scores break on `blake2b(epochSeal || commitment)`, not PoW hash.

## Price — EPOCH-indexed staircase

`floor_price_epoch(epoch)`:
  epochs 0–1 → 200_000 zat · 2–7 → 500_000 · 8–15 → 1_000_000 · 16–31 → 2_000_000

## Burn — next version only — CLOSED for v1

`MAX_BURN = 0` for this collection. `score_floors()` is derived from
`max_live_score()`, so turning burn on mid-mint would raise the live maximum
and move every absolute floor — re-tiering sealed epochs. **Do not activate
burn under a live supply.** It is a next-version / next-collection parameter
only; weights stay as published so a future version can enable it without
re-pricing the formula shape.

## Patience — MAX_PATIENCE = 7 — CLOSED

Two weeks was too long for this audience. Cap is **7 days** (`MAX_PATIENCE = 7`,
`PATIENCE_UNIT` still 1152 blocks). Maxing patience still saturates the
patience weight, so `max_live_score()` stays **750,000** and
`score_floors()` stay 150/315/480/630k — asserted in the indexer self-test.

Money must **not** buy earlier reveal. Patience stays the odds/time lever;
money stays a weak score lever. Anyone who wants to open fast picks patience 0.

## Wallet / OP_RETURN broadcast — v1 handoff only

Zashi and current mobile Zcash wallets cannot attach arbitrary `OP_RETURN`
outputs. v1 therefore ships a **copyable CLI handoff** (zcash-cli / zallet
notes + exact payment + deadline height), not an in-page broadcast.

**Do not build a custodial broadcast path.** Taking the user's payment and
broadcasting on their behalf puts the operator in the trust seat the whole
auditable-indexer design was meant to avoid.

A real wallet integration later needs at least:

1. A wallet (or SDK) that can construct a transparent transaction with
   **custom OP_RETURN** (74-byte mint, or two OP_RETURNs for reveal) plus a
   transparent treasury output for the exact zatoshi amount.
2. For reveals: the same tx must also expose a transparent input or output
   matching the mint's `minerTag` (usually the payer's hash160).
3. UX that never asks the user to paste `secret` / `seed` / `salt` into a
   web form — keyfile stays local; the wallet only sees the already-built
   OP_RETURN hex.
4. Preferably a ZIP or wallet-standard for "data carrier + payment" so
   mobile can do it without raw hex.

Until that exists, the mint page stops at: mine → force keyfile download →
show hex + payment + deadline → user broadcasts with their own node/CLI.

## Browser blake2b — noble, not WASM — CLOSED

The mint page vendors `@noble/hashes` blake2b (MIT, audited) in Web Workers.
Correctness is guaranteed by `web/vectors.json` matching `indexer.py`, not by
the hash backend. Do **not** switch to WASM for speed: `MAX_WORK_BITS = 4` caps
work so speed stops mattering. A hand-rolled WASM build would add risk without
improving the product. Keep noble; keep the vector gate.

## Mint page treasury + pub URLs — CLOSED

`TREASURY` is hardcoded in `web/js/config.js` (must match `indexer.py`). It must
never be read from `table.json`, `state.json`, or any fetch / query value — that
would turn `?state=` into a payment-redirection attack.

`?table=` / `?state=` overrides are off in the published build
(`ALLOW_QUERY_PUB_OVERRIDE = false`) and, when enabled for local fixtures, are
restricted to same-origin URLs. Cross-origin overrides are refused loudly with
no silent fallback. Gated by `web/test_page_security.mjs`.
