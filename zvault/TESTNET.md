# TESTNET.md — real-node dry run status

**Status: P0.3 still OPEN — reads unblocked on hosted zebrad; no mint/reveal txids yet.**

Protocol digest (unchanged):  
`81508c848ed7511a5e018b5f7e47051ec260e72ac8b9e2329b25721343294635`

## Do NOT use zcashd

**zcashd is end-of-life.** The ecosystem has moved to **zebrad**. Do **not**
retry `electriccoinco/zcashd` (Docker Hub / CloudFront) — that image is a dead
end even if the pull succeeds. Wallet work that depended on zcashd's built-in
wallet is also gone; next options are **Zallet** or our own transparent signer
(P1.1).

## N1 endpoint probe — Tatum hosted zebrad (2026-09-20 / 21)

**URL:** `https://zcash-testnet-zebrad.gateway.tatum.io`

### What it supports (measured)

| Check | Result |
|---|---|
| `chain.py --url … probe` | **OK** — `chain=test`, height ≈ **4,373,065**, synced ≈ 1.0 |
| API key required for basic reads? | **No** (unauthenticated JSON-RPC returned `getblockchaininfo` / `getblockcount` / `getbestblockhash`) |
| Fake `x-api-key: test` | **401** — “Authentication required… Tatum API key” (bad key ≠ no key) |
| Free-tier rate limit | **5 requests / minute** without a paid plan (HTTP 429). Unusable for publisher follow-loop without a key / paid plan or self-hosted node |
| `getblock(hash\|height, 1)` | **OK** — full header object |
| `getblock(…, 2)` | **OK** — `tx[]` are **full transaction objects** (dicts), not bare txids. `chain.py` depends on this and it matches |
| Tx shape | Includes `vin`/`vout`, `hex`, `value` + **`valueZat`**, `scriptPubKey.hex`, **`scriptPubKey.addresses[]`** (testnet `tm…`). No singular `address` field on samples |
| `sendrawtransaction` | **Method is present** — garbage hex returned JSON-RPC **`-22`** (`io error: failed to fill whole buffer` = deserialize fail), **not** method-not-found / HTTP 403. So this gateway is **not read-only at the method layer**. Whether a *valid* tx is actually relayed to peers is **unverified** until we broadcast one (rate limits blocked further probes in-session) |

### What this unblocks vs what it does not

**Unblocks (indexer / publisher / page half):**

- Live tip + block hashes for challenges
- Full verbosity-2 extraction for OP_RETURN / P2PKH tags / treasury amounts
  via `valueZat` + `addresses[]`
- Exercising `chain.py` + publisher against real testnet blocks (slowly, or
  with a Tatum API key / paid plan to raise the 5 rpm cap)

**Launch decision — Tatum free tier is not production:**

Free tier is **5 requests / minute**. That is adequate for **steady-state**
indexing (~1 `getblock` per ~75s block), but **NOT** for:

- initial backfill from `LAUNCH_HEIGHT` (thousands of heights → days at 5/min)
- resync after the publisher dies mid-epoch

**Production must use a paid Tatum key or self-hosted Zebra.** Treat this as an
owner launch decision, not an implementation detail. See RUNBOOK.md.

**Does not finish P0.3 alone:**

- Still need a **wallet/signer** to build mint + reveal txs (zebrad has no
  wallet; zcashd wallet is gone)
- Still need confirmed **broadcast** of a valid tx and recorded **txids**
- Free tier 5 rpm cannot run a continuous publisher without throttling or a key

### Next cheapest paths (only if Tatum is insufficient)

**(b)** Self-host Zebra from GHCR (not Docker Hub):  
`ghcr.io/zcashfoundation/zebra` — record disk / sync time / peak RAM for RUNBOOK.

**(c)** Zebra from source or GitHub release binary.

## Recommended re-sequence (owner decision)

**Agree: build P1.1 transparent builder/signer first, then use it for the
testnet mint/reveal.** That validates NU5 sighash against a real chain and
removes dependence on zcashd's dead wallet. Hold implementation until the
owner confirms this report.

## Real txids (fill when dry run completes)

| Step | txid / height | notes |
|---|---|---|
| mint | _pending_ | |
| indexer credit | _pending_ | |
| epoch seal | _pending_ | |
| reveal | _pending_ | |
| PNG rendered | _pending_ | |

## RPC vs fixtures (live observations so far)

| Area | Fixture assumption | Live Tatum/zebrad |
|---|---|---|
| `getblock(..., 2)` | full tx objects | **Confirmed** |
| Amounts | float `value` | **`valueZat` present** — prefer it (`chain.py` already does) |
| Addresses | `addresses[]` | **Confirmed** (`tm…` on testnet) |
| OP_RETURN | `6a` + push in `scriptPubKey.hex` | Shape compatible; no ZVLT MAGIC on recent tip (expected) |
| Transparent tags | P2PKH `76a914…88ac` | **Confirmed** on coinbase/outs |
| Broadcast | n/a | `sendrawtransaction` exists; valid relay **TBD** |

## Owner unblock checklist

1. Confirm P1.1-before-dry-run re-sequence (recommended: yes).
2. Optional: Tatum API key / paid plan so publisher is not stuck at 5 rpm.
3. Or stand up `ghcr.io/zcashfoundation/zebra` on testnet and point chain.py at it.
4. After signer exists: mint → credit → seal → reveal → PNG; paste txids above.
