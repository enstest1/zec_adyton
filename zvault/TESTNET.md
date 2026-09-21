# TESTNET.md — real-node dry run status

**Status: BLOCKED — no live Zcash node reached in this session.**

Protocol digest (unchanged):  
`81508c848ed7511a5e018b5f7e47051ec260e72ac8b9e2329b25721343294635`

P0.3 requires a full cycle on a **real** node with **real txids**. That did
not happen here. Do not treat synthetic `indexer.py` self-tests as a substitute.

## What was attempted (2026-09-20)

| Probe | Result |
|---|---|
| Local RPC `127.0.0.1:8232` / `:18232` | No listener |
| `zcash-cli` / `zebrad` / `zainod` on PATH | Not installed |
| `docker pull electriccoinco/zcashd:v6.10.0` | Failed twice (CloudFront `EOF` mid-layer) |
| Public testnet sync | Not started (image unavailable) |

**No mint txid. No reveal txid. No PNG from a chain-sourced reveal.**

## Required cycle (run when a node is available)

```bash
# 1. Node (testnet preferred; regtest acceptable for RPC-shape rehearsal only)
docker run -d --name zvault-tn \
  -p 18232:18232 \
  -v zvault-zcash-data:/home/zcash/.zcash \
  electriccoinco/zcashd:v6.10.0 \
  -testnet -server -rpcuser=zvault -rpcpassword=CHANGE_ME \
  -rpcallowip=0.0.0.0/0 -rpcbind=0.0.0.0

# Wait until getblockchaininfo.blocks is current and verificationprogress ≈ 1

# 2. Probe + extract
cd zvault
python zcash/chain.py probe --url http://127.0.0.1:18232 --user zvault --password CHANGE_ME

# 3. Owner sets TREASURY + LAUNCH_HEIGHT in indexer.py AND web/js/config.js
#    (web/test_owner_constants.py must pass)

# 4. Publisher
python zcash/publisher.py --url http://127.0.0.1:18232 --user zvault --password CHANGE_ME \
  --out web/pub --bind 127.0.0.1:8080

# 5. Page: python -m http.server 5500 --directory web
# 6. Mine against live table, broadcast mint with OP_RETURN + treasury pay
# 7. Wait CONFIRMATION_DEPTH; confirm indexer credits mint
# 8. Wait seal (128 mints or SEAL_TIMEOUT); broadcast reveal
# 9. Confirm web/pub/punks/<index>.png exists and traits match derive_tier
```

Record in this file after a successful run:

- chain / height at start
- mint txid + height
- seal height + sealed_by
- reveal txid + height
- punk index + trait_hash
- digest after reveal
- every RPC shape surprise (fill the table below)

## Expected surprises vs fixtures (from RPC docs — unverified on a live node)

These are **hypotheses from published zcashd RPC docs / issues**, not live
observations. Mark each `confirmed` / `absent` / `different` during the dry run.

| Area | Fixture / code assumption | Real RPC risk |
|---|---|---|
| `getblock(h, 2)` | Full tx objects with `vout[].scriptPubKey.hex` | Still documented; confirm verbosity-2 objects include `hex` scriptPubKey |
| OP_RETURN push | Bare push for ≤75 bytes (`6a` + len + data) | 74-byte mint fits bare push; longer future payloads need `OP_PUSHDATA1` (already handled in `op_return_from`) |
| Treasury pay | `scriptPubKey.addresses[]` contains TREASURY | Docs still show `addresses` array; some proxies may emit singular `address` — `paid_to_treasury` now accepts both |
| Amount | `float(value) * 1e8` | Prefer `valueZat` / `valueSat` — **code updated** to prefer integer zat fields |
| Transparent tag | P2PKH `76a914…88ac` on vouts; optional vin scriptPubKey | Vin rarely carries prevout script without spentindex — reveal may need a change output to `minerTag`, not only an input |
| Address format | mainnet `t1…` | testnet transparent is `tm…` — TREASURY on testnet must be a testnet address |
| Confirmation depth | tip − 10 indexed | Confirm `getblockchaininfo.blocks` vs tip behaviour under reorgs |
| Zaino vs zcashd | Same JSON-RPC subset | Field names may differ; probe both if using Zaino |

## Preemptive code change (not a protocol rule)

`zcash/chain.py` `paid_to_treasury` now:

1. Matches `addresses[]` **or** singular `address`
2. Prefers `valueZat` / `valueSat` over float `value`

Indexer mint/seal/reveal rules untouched. Digest must remain
`81508c848ed7511a…`.

## Owner unblock

1. Provide a synced testnet (or regtest) RPC endpoint, **or** a machine that
   can finish `docker pull electriccoinco/zcashd`.
2. Set real `TREASURY` + `LAUNCH_HEIGHT` (testnet-appropriate).
3. Re-run the cycle above and paste txids into this file.

Until then, **mainnet is forbidden** by P0.3.
