# ALTERNATIVE NOT TAKEN — EVM track

**Status: superseded / not shipping.** Dated 2026-09-22.

This directory (`HashVault.sol`, `reveal.circom`, `threshold.circom`) sketches
an EVM + zk circuit design that **does not match** the live Zcash indexer
protocol in `zcash/` and `web/`. ZVAULT v1 is transparent OP_RETURN + public
indexer on Zcash. There is no Solidity deployment path for the mint.

Kept only so history is not silently deleted. Do **not** treat these files as
current product, launch blockers, or a second protocol. A reviewer finding
contradictory Solidity here should read this banner first.

See `zcash/SPEC.md`, `READY.md`, and the repo root `README.md`.
