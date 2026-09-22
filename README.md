# ZVAULT

Mine a sealed punk on **Zcash**. You grind a hash, pay a transparent mint, and
open a box whose art did not exist until reveal. Ownership in v1 is the
**minting address** tracked by an open-source indexer — not a smart contract
(Zcash has no VM) and not a transferable NFT yet.

Protocol is frozen. State digest must stay:

`81508c848ed7511a5e018b5f7e47051ec260e72ac8b9e2329b25721343294635`

## Layout

| Path | What |
|---|---|
| [`zvault/`](zvault/) | Product: indexer, mint page, art, docs |
| [`zvault.bak/`](zvault.bak/) | Historical backup — not current |

## One-command verification

```bash
cd zvault
python zcash/indexer.py
```

Digest printed must match the hash above. Fuller gate (vectors, publisher
snapshot, art pipeline, owner-constants check):

```bash
cd zvault
python verify.py && python sim.py all \
  && python web/test_vectors.py && node web/test_vectors_js.mjs \
  && node web/test_page_security.mjs \
  && python zcash/test_publisher_snapshot.py \
  && python zcash/test_art_pipeline.py \
  && python web/test_owner_constants.py   # exits 1 until mainnet treasury is set
```

## Docs

- [`zvault/zcash/SPEC.md`](zvault/zcash/SPEC.md) — wire format and rules
- [`zvault/READY.md`](zvault/READY.md) — what ships / what blocks launch
- [`zvault/TESTNET.md`](zvault/TESTNET.md) — real-node dry run + cycle script
- [`zvault/DEPLOY.md`](zvault/DEPLOY.md) — where node / publisher / page live
- [`zvault/LAUNCH.md`](zvault/LAUNCH.md) — launch copy (incl. “where do I trade”)
- [`zvault/RUNBOOK.md`](zvault/RUNBOOK.md) — operator commands

`zvault/evm/` is an **alternative not taken** — see banner there.
