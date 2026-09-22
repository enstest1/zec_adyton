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

**Done:** P1.1 T1–T8 + ECDSA burner/builder (S1–S5). Network-scoped
`TREASURY_*` / `LAUNCH_HEIGHT_*` (X1). N3 waits on **operator deshield** of
faucet TAZ into the transparent burner (X2 — not a user requirement).

### Testnet constants (live-validated 2026-09-22)

| Constant | Value |
|---|---|
| `TREASURY_TESTNET` | `tmBsjJiZN4MJMPirvpRb6r53MrJTAZ9Fur7` |
| `LAUNCH_HEIGHT_TESTNET` | `4377000` |
| Node `validateaddress` (treasury) | **isvalid: true** (Tatum zebrad) |
| Node `validateaddress` (burner sample) | **isvalid: true** |
| Mainnet treasury | still placeholder — owner-constants gate **fails** (armed) |

Operator secrets for the dry-run burner/treasury live in
`zvault/.dryrun-keys.json` (**gitignored**).

## Testnet faucets (N3 — researched 2026-09-21 / 22)

| Faucet | URL | Transparent `tm…`? | Notes |
|---|---|---|---|
| **jinolabs** (live) | https://zcashfaucet.jinolabs.xyz/ | **Shielded drip** (0.1 TAZ) | `/api/status` OK; PoW-gated browser claim |
| **Fauzec** | https://fauzec.com/ | **No** (roadmap) | UA / Sapling only; 1 TAZ / 24h |

### Faucet is an OPERATOR step, not a user requirement (X2)

jinolabs sends **0.1 TAZ shielded**. Our burner is **transparent**, so the
**operator** deshields once with **Zallet** (or equivalent) into the dry-run
`tm…` burner before exercising mint/reveal.

That does **not** change the product: end users still never need a wallet or
a node — the page generates the burner, signs in-browser, and relays
already-signed bytes. Deshielding faucet TAZ is only how the *operator*
funds the P0.3 dry run. Do not read a shielded faucet as a failure of the
burner design.

0.1 TAZ = **10,000,000 zat** ≈ **37** funded epoch-0 / money-0 mints at the
265,000 zat funding figure.

**Dust threshold (policy, not consensus):** code uses zcashd-style
`3 * (300 * (34+148) / 1000) = 162` zat for P2PKH. **Confirm against live
mempool** when broadcasting a near-dust change — if rejected, record the real
number here.

## Real txids (fill when dry run completes)

| Step | txid / height | notes |
|---|---|---|
| mint | _pending_ | |
| indexer credit | _pending_ | |
| epoch seal | _pending_ | |
| reveal | _pending_ | change → return address |
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
| Dust (P2PKH) | 162 zat | **unconfirmed on live mempool** |

## One-command cycle (R1 — operator)

After the burner is funded and the keyfile has a mined solution +
`reveal_return_address`:

```bash
cd zvault
# Publisher must be running against the same pub/ dir (see DEPLOY.md).
node web/js/tx/cycle.mjs --keyfile /path/to/zvault-keys.json \
  --rpc "$ZCASH_RPC_URL" \
  [--relay http://127.0.0.1:8091]
```

Progress lands in `web/pub/dryrun-progress.json`. Re-run the same command after
any failure — completed steps (`funded`, `mint_broadcast`, `mint_credited`,
`epoch_sealed`, `reveal_broadcast`, `reveal_indexed`, `collection`) are skipped.
Exit codes 10–15 mean "WAIT" (operator/publisher action), not a hard crash.
Paste printed txids into the table above when the cycle finishes.

If the RPC has no `getaddressutxos`, seed `progress.utxos` manually once:

```json
{ "utxos": [{ "txidHex": "…", "vout": 0, "valueZat": 10000000 }] }
```

## Alternative funding routes (if jinolabs/Zallet is painful)

| Route | Transparent `tm…`? | Notes |
|---|---|---|
| **jinolabs** → Zallet deshield | After deshield | Primary path; faucet itself is shielded |
| **Fauzec** (https://fauzec.com/) | **No today** | UA / Sapling only; transparent "on the roadmap" — do not wait on it |
| **Ask the community** | Maybe | Post on [forum.zcashcommunity.com](https://forum.zcashcommunity.com/) (Apps / General) for a small testnet transparent send to your burner; historically people help with TAZ for builders |
| Manual UTXO seed | Yes | Someone else sends TAZ to your `tm…`; put the outpoint in `progress.utxos` |

There is **no** currently reliable public faucet that pays transparent `tm…`
directly. Treat deshield-or-community-send as the operator funding step.

## Owner unblock checklist

1. **Operator:** claim jinolabs faucet → deshield with Zallet → fund burner
   `tm…` in **one send** (≥ 265_000 zat for epoch-0 money-0). Or use an
   alternative funding route above.
2. Run `node web/js/tx/cycle.mjs --keyfile …` (re-run until complete); paste txids.
3. Confirm dust threshold against a rejected/accepted near-dust change.
4. Optional: Tatum API key / paid plan so publisher is not stuck at 5 rpm —
   **recommendation: self-hosted Zebra for production** (see `DEPLOY.md`).
5. Before mainnet: set `TREASURY_MAINNET` + `LAUNCH_HEIGHT_MAINNET` (gate armed).
