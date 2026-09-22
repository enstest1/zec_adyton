# DEPLOY.md — where things run (v1)

Dated **2026-09-22**. Protocol digest unchanged:
`81508c848ed7511a5e018b5f7e47051ec260e72ac8b9e2329b25721343294635`

Operational detail lives in `RUNBOOK.md`. This file is the **launch topology**:
what process lives where, what dies when something fails, and how a third
party checks the digest without trusting us.

## Topology

| Piece | Where it runs | What it does |
|---|---|---|
| **Zcash node** | Operator VPS (or paid RPC) | JSON-RPC source of truth for blocks |
| **Publisher** | Same host as node preferred (or same private network) | Follows tip → indexer → writes `web/pub/*` + serves CORS |
| **Mint page + PNGs** | Static host (Pages / S3 / nginx) that serves `web/` and reads `web/pub/` | Users mine/sign in-browser; art after reveal |
| **Broadcast relay** | Optional small process next to the node | `POST /broadcast` of already-signed hex only |
| **Miner (optional)** | Separate raw box | Parallel bids; keep off the indexer account |

Keep miner / indexer / front-end on **separate** accounts so a flagged miner
box cannot take the public table down.

## Domains (placeholders — owner fills before launch)

| Role | Example | Notes |
|---|---|---|
| Mint page | `https://mint.example` | Serves `web/index.html` + fetches same-origin or CORS `pub/` |
| Publisher / pub API | `https://pub.example` *or* same origin `/pub/` | Must expose `table.json`, `state.json`, `punks/`, `collection.json` |
| Relay (optional) | `https://relay.example` | Postbox only; never holds keys |

Record the real names here when registered. Until then, local bind:
`publisher.py --bind 127.0.0.1:8080`, page via `web/README.md`.

## Node: Tatum 5 rpm vs self-hosted Zebra

| Choice | Steady-state (~1 block / 75s) | Backfill / resync | Recommendation |
|---|---|---|---|
| Tatum free (5 req/min) | OK | **NO** (days for thousands of heights) | Dev tip probes only |
| Tatum **paid** key | OK | OK | Acceptable bridge |
| **Self-hosted Zebra** (`ghcr.io/zcashfoundation/zebra`) | OK | OK | **Recommend for production** |

**Recommendation:** run **self-hosted Zebra** for the operator indexer. Paid
Tatum is fine as a temporary bridge while Zebra syncs, or as a read replica
for monitors — not as the only production RPC if you expect resyncs. Free
tier is **not** production.

Do **not** use zcashd (EOL).

## Failure modes

### Node falls behind tip

- Publisher waits; `table.json` / digest **freeze** at last indexed height.
- Challengers mining against a lagging public tip disagree with real tip —
  always publish tip height next to the digest.
- Treat lag like an outage: alert on sync height, not only process uptime.
- When the node catches up, replay continuously — indexer refuses gaps.

### Publisher dies mid-epoch

- `web/pub/vault.json` is the resume snapshot (plain JSON, not pickle).
- Restart `publisher.py` against the same `--out`; it rebuilds Vault from
  `vault.json` and continues — **no genesis re-scan** unless you delete it.
- Static page keeps serving the last written `table.json` / `state.json`
  (stale but consistent). Users see a frozen table until restart.
- Art already written under `punks/` survives; in-flight reveals wait for
  the process to return.

### Static host dies

- Chain state and indexer are unaffected. Minting pauses for UX only.
- Restore from git + last `web/pub/` backup (or re-export from publisher).

### Relay dies

- Users still copy signed hex and broadcast via any node / explorer that
  accepts `sendrawtransaction`. Relay is convenience, not consensus.

## Third-party digest reproduction

Anyone can verify without trusting the operator host:

```bash
cd zvault
# 1) Offline smoke + indexer self-test
python verify.py
python zcash/indexer.py
# 2) Independent: run your own Zebra + publisher from LAUNCH_HEIGHT
python zcash/publisher.py --url http://127.0.0.1:8232 --out /tmp/zvault-pub
# Compare state.json "digest" to the published digest
```

Cross-language vectors: `python web/test_vectors.py` and
`node web/test_vectors_js.mjs` must agree with `web/vectors.json`.

Expected digest (protocol frozen):

`81508c848ed7511a5e018b5f7e47051ec260e72ac8b9e2329b25721343294635`

## Related

- `RUNBOOK.md` — commands, key safety, node sizing
- `TESTNET.md` — dry-run cycle + faucet funding
- `READY.md` — what ships / what blocks launch
- `zcash/SPEC.md` — wire format
