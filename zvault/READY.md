# READY.md — ZVAULT v1 protocol status

Verified against the commit that ships this file. Do not trust a report that
does not include a git hash you can `git checkout` yourself.

## Ships in v1

- Auditable mint indexer (`zcash/indexer.py`) over public Zcash blocks
- Block-hash challenge, commitment-bound PoW, flat base difficulty 22
- `MAX_WORK_BITS = 4` (hardest mint = 26 bits; ~17s on two Python cores)
- `MAX_PATIENCE = 7` (0–7 days; `PATIENCE_UNIT` = 1152 blocks)
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

## Revenue (owner planning — not marketing)

Zcash cannot enforce secondary royalties. **The mint is lifetime protocol
revenue.** Numbers below are from `floor_price_epoch` × 128 seats × 32 epochs
(`SUPPLY_CAP = 4096`). USD moves with ZEC; do not quote dollars as fixed.

| Case | ZEC |
|---|---|
| Floor only (every mint pays exactly the epoch floor) | **55.552 ZEC** |
| All max money (every mint pays floor × (1 + 12) = ×13) | **722.176 ZEC** |

Anything between those bounds depends on how many people buy the money axis.
Patience and work do not change payment — only score.

## Owner actions before launch (placeholders — do not invent values)

1. **Set `LAUNCH_HEIGHT`** in `zcash/indexer.py` (imported by `chain.py`) to the
   real activation height and publish it.
2. **Set `TREASURY`** to the real transparent treasury address in
   `zcash/indexer.py` **and** `web/js/config.js` (must match exactly). The mint
   page hardcodes it — it never reads treasury from table/state JSON.

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
node web/test_page_security.mjs
python zcash/test_publisher_snapshot.py
```

Run the indexer self-test three times; the state digest must be identical.
Current green digest (`MAX_PATIENCE = 7`):

`81508c848ed7511a5e018b5f7e47051ec260e72ac8b9e2329b25721343294635`
