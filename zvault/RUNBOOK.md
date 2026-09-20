# RUNBOOK

Everything operational. If a step is not written down here, it was not tested.

---

## 1. Run the indexer self-test

    python zcash/indexer.py
    python verify.py
    python sim.py all

No arguments, no dependencies, no node. The indexer self-test mines ~260
records at reduced difficulty and prints `all checks passed` or exits
non-zero. See `CHANGES-v2.md` for the property list.

**Why low bits in the self-test.** Real base difficulty is 22–28. Pure-Python
blake2b at those bit depths does not finish in a useful time. The self-test
drops base bits deliberately. **Do not read the self-test nonces as any
indication of real mining cost.**

## 1b. Work cap is provisional — bench before raising it

`MAX_WORK_BITS = 4` is derived from the **top** of the difficulty staircase
(base 28 at n ≥ 2048), targeting ~95% chance of landing inside
`CHALLENGE_WINDOW` (24 blocks ≈ 30 min). That is ~**7 MH/s**, not the ~0.6 MH/s
figure that came from mistakenly anchoring on base 22 + expected (63%) hashes.

Until a CPU/GPU bench measures real blake2b hashrate against this PoW shape:

- leave `MAX_WORK_BITS` at 4
- leave `CHALLENGE_WINDOW` at 24
- read `DECISIONS.md` before widening the window (stale-quote savings tables)

Rent one box, run `miner.py bench`, then compare to the MH/s table in
`DECISIONS.md`. Raising work without a matching window (or vice versa) recreates
paid stale-challenge rejects at the top of the mint.

## 2. Connect to a node

    python3 zcash/chain.py probe
    python3 zcash/chain.py scan --from 2900000 --to 2900500 --out blocks.json
    python3 zcash/indexer.py --blocks blocks.json
    python3 zcash/chain.py watch --from 2900000     # live tail

`chain.py` is the bridge. Zaino (`zainod`) is the target — it serves a JSON-RPC
API covering the subset of Zcash RPCs wallets and explorers need, sitting
between a Zebra or zcashd validator and this script. The same calls work
against zcashd, so either backend is fine.

    zainod generate-config --output zaino.toml
    zainod start --config zaino.toml

Auth: `--user/--password`, or `--cookie {datadir}/.cookie` for Zallet, which
writes a random credential on startup.

**Everything it reads is public.** No viewing key, no wallet, no credential
beyond RPC access to your own node. If verifying the collection needed a
secret, it would not be verification.

Tested without a node: OP_RETURN extraction for both bare-push and
OP_PUSHDATA1 script forms, non-OP_RETURN outputs correctly ignored, treasury
zatoshi accounting, and extracted payloads parsing cleanly in the indexer. The
live RPC path has not been run against a real node.

### Block shape

`scan()` in `indexer.py` expects an iterable of blocks shaped like:

```python
{"height": 2900000, "tx": [
    {"txid": "...",
     "op_return": b"ZVLT\x01\x01...",   # raw bytes, or None
     "paid_to_treasury": 2500000,        # zatoshis to TREASURY
     "burned": 0}
]}
```

`chain.py scan` produces exactly this. Note it carries `op_return` as hex over
JSON and `rehydrate()` converts back to bytes — `parse_mint` wants bytes.

**Only transparent payments count toward a mint.** A shielded payment is
invisible to everyone but its recipient, so no indexer could confirm it and
nobody could audit the one that claimed to. The mint payment is the one part of
this protocol that has to be public.

### OPEN: the burn mechanism does not exist yet

`chain.py:burned_in()` returns 0. Zcash has no tokens, so "burn" has no
definition here — the weight is live in the scoring formula at 0.25 and the
mechanism behind it is a stub.

Two options, both needing a decision before launch:

- **ZEC to a provably-unspendable address.** Works today. Expensive for the
  miner, and genuinely destroys value.
- **A ZSA burn** once ZIP 226 ships. Audited and on testnet, NU7 candidate, so
  the timing is not yours to control.

**Decide before you publish the weights.** Changing them afterwards re-prices
every mint already made, and there is no way to make that fair.

## 3. Verify against someone else

    python3 zcash/indexer.py --blocks blocks.json

Prints `minted`, `rejected`, and a `digest`. **The digest is the whole trust
model.** Two people running the same rules over the same blocks get the same
string. If they differ, walk the log and the first divergent mint tells you
exactly where — and whether someone's indexer is lying or just stale.

Publish the digest at every epoch boundary. Make checking it one command. An
auditable system nobody audits is a trusted system with extra steps.

## 4. Mine

    python3 zcash/miner.py bench
    python3 zcash/miner.py mine --tag <20-byte-hex> --work 3 --patience 4 --burn 900
    python3 zcash/miner.py verify --record <hex> --base 22

Multiprocess, prints live hashrate, emits a 74-byte `OP_RETURN` record.

**It does not broadcast.** Submission spends money and should be a deliberate
act, not something a long-running search does on its own at 4am. Verify the
record, then broadcast yourself.

The opening material is written to `zvault-keys.json` at mode 600 **before**
the record is printed, so nobody can broadcast a mint they cannot open. That
file is the asset. Lose it and the mint is sealed forever — there is no
recovery path, deliberately, because a recovery path is a backdoor.

Benchmark from this container, single core: ~2.4 MH/s in pure Python. A C or
CUDA miner is 50–200x faster. Treat Python numbers as a floor on cost, never
as what a competitive miner manages.

## 5. Send the mint receipt memo (not keys)

The miner already generated seed/salt into the keyfile. The memo is a
wallet-native receipt only — see `GAME.md` and `REVIEW.md`.

    python zcash/memo.py build --index 7 --epoch 0 --seal-height 2900128
    python zcash/memo.py send  --index 7 --epoch 0 --seal-height 2900128 \
                               --to u1... --from <from>
    python zcash/memo.py status --opid <id>

Goes through the node's own `z_sendmany`. Refuses transparent recipients.
Do not mark delivered until `status` reports success.

## 6. Hosting — the thing that gets accounts banned

**Do not run miners on a PaaS.** Railway's acceptable use policy names
cryptocurrency mining as prohibited abuse, and their fair use page lists Crypto
Miners as a suspension category outright. Render, Heroku and Vercel are the
same. These platforms sell cheap compute assuming you will not peg a CPU; a
miner pegs it by definition, detection is trivial, and suspension is usually
account-level with the balance gone.

- **Miner** → a raw compute box. Vast.ai and TensorDock have historically been
  mining-tolerant. Check current ToS yourself, they tighten.
- **Indexer** → PaaS is fine. It is a read-only database job, not mining.
- **Web front end** → anywhere.

Keep those three on separate accounts. If the miner box gets flagged, it should
not take the indexer down with it.

## 7. Key safety

The miner needs a funded wallet on a machine you do not own. Treat it as
compromised from the start.

- Fresh wallet, funded only with what the miner needs for the session.
- Never the wallet holding the treasury or your own holdings.
- Rotate after each rental.
- If you use a third-party mining client, read its key handling first. A miner
  that ships with key management is the obvious place to hide exfiltration.

## 8. Calibrate before launch, not after

Difficulty and price are the two numbers that decide whether anyone mines at
all, and both are guesses right now.

Rent one GPU box for an hour. Measure real hashrate against `base_difficulty`
and `floor_price`. Then ask: at the top price step, does mining still clear
against a plausible floor?

**Hashcats is the cautionary case.** Its price is derived as supply times a
fixed step, which climbs forever. It stalled at roughly 9,100 of 16,384 with
mints well below target pace, and because 70% of protocol revenue funded the
$HASH buyback, the token sagged with the mining. A reflexive loop needs
continuous minting; when minting stops the whole thing unwinds.

Our staircase tops out deliberately. Keep it that way, and model the curve
before you write the front end.
