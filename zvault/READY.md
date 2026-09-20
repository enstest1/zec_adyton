# READY.md — ZVAULT v1 protocol status

Verified against the commit that ships this file. Do not trust a report that
does not include a git hash you can `git checkout` yourself.

## Ships in v1

- Auditable mint indexer (`zcash/indexer.py`) over public Zcash blocks
- Block-hash challenge, commitment-bound PoW, flat base difficulty 22
- `MAX_WORK_BITS = 4` (hardest mint = 26 bits; ~17s on two Python cores)
- Epoch seal + rank tiers with live score floors (`score_floors()` → 150/315/480/630k)
- Seal lottery tiebreak: `blake2b(epochSeal || commitment)`
- Floor price by **challenge-block epoch**; epoch created only after accept
- On-chain reveal: two OP_RETURN chunks + `minerTag` binding
- `CONFIRMATION_DEPTH = 10` (shallow blocks buffered, not indexed)
- `MAX_MONEY = 12`, `MAX_BURN = 0` (burn axis stubbed; max live score 750,000)
- No on-chain transfer; ownership is the minting address
- Static mint page (`web/`) + epoch publisher (`zcash/publisher.py`)
- Cross-language vectors (`web/vectors.json`) — Python + JS must match

## Deferred (explicit)

- Burn mechanism — next version / next collection only; cannot activate mid-mint
- On-chain transfer wire format
- Selective-disclosure / threshold circuits as product claims
- Memo receipt delivery path (no return UA in the mint record)
- Royalties (none on Zcash; primary mint = lifetime revenue)
- Custodial / in-wallet OP_RETURN broadcast (see DECISIONS.md)
- (Blake2b in the browser is intentionally `@noble/hashes`, not WASM — decision)

## Owner actions before launch (placeholders — do not invent values)

1. **Set `LAUNCH_HEIGHT`** in `zcash/indexer.py` (imported by `chain.py`) to the
   real activation height and publish it.
2. **Set `TREASURY`** to the real transparent treasury address and publish it.

Both must match exactly across every indexer. Hardware GPU bench is **not** a
blocker — 26-bit mints do not require special hardware.

## Gate

```bash
cd zvault
python zcash/indexer.py    # must print all checks passed + state digest
python verify.py           # smoke only — not sufficient alone
python sim.py all          # exit 0
python web/test_vectors.py
node web/test_vectors_js.mjs
```

Run the indexer self-test three times; the state digest must be identical.
Current green digest (protocol freeze 494dfcc):

`8610526427bb0463e04bee22ee40765e8b04affee66f042fb11d50d5ac905e86`
