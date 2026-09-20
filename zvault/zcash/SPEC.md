# ZVAULT — protocol spec (Zcash), v2

A sealed proof-of-work mint on a chain with no virtual machine.

---

## The move that makes this work

Opening a sealed commitment does not need a proof system. It needs a hash.

    commitment = blake2b(secret, seed, inputHash, salt)

To reveal, you publish the opening. Anyone recomputes the hash and checks it
matches what you inscribed at mint. That is a local computation on public data
— no verifier contract, no pairing precompile, no VM. It works on Zcash exactly
as well as it works on Ethereum.

So the entire sealed-mint mechanic survives the move. What does not survive is
**enforcement**. On an EVM chain the contract refuses an invalid mint. Zcash
cannot refuse anything; it will happily carry a transaction claiming a hash that
was never found.

The replacement for enforcement is **auditability**.

## Enforced vs auditable — read this part twice

| | EVM | Zcash |
|---|---|---|
| invalid mint | rejected by contract | written to chain, ignored by indexers |
| who computes state | the chain | everyone independently |
| what you trust | the code | the rules being deterministic and public |

Every mint record here is **public and transparent**, not shielded. That is a
deliberate and slightly painful choice. A shielded memo is readable only by its
recipient, so if mints went into shielded memos then only the project could see
the collection — that is not privacy, it is a private database with a Zcash
logo on it.

Public records instead mean anyone can re-derive the full state from chain data
and catch an indexer that lies. The indexer becomes a convenience rather than
an authority. This is how Ordinals and BRC-20 survive on a chain with no VM.

**Privacy comes from the commitment, not from hiding the transaction.** The
mint is visible; what you mined is not.

---

## Wire format

Mint records go in `OP_RETURN` on a transparent output. Zcash's standard
`OP_RETURN` limit is 80 bytes; a record is 74, so it fits with room to spare.

```
offset  len  field
0       4    magic          "ZVLT"
4       1    version        0x02
5       1    kind           0x01 mint | 0x02 reveal | 0x03 transfer
6       32   commitment     blake2b-256
38      8    nonce          the PoW solution
46      1    workBits       difficulty bid above base
47      1    patience       units of 1152 blocks (~1 day) sealed before reveal
48      4    burnAmount     whole token units, big-endian
52      1    moneyMultiple  premium paid over floor
53      20   minerTag       free-form 20 bytes (see below)
73      1    checksum       XOR of bytes 0..72
```

Total 74 bytes. The limit is 80, so there are 6 spare — do not spend them
without a version bump. Version 0x01 records are ignored by v2 indexers.

**Reveal and transfer are out of v1 launch scope.** `KIND_REVEAL` /
`KIND_TRANSFER` exist as constants only. There is no OP_RETURN wire format,
and the indexer does not parse chain reveals. Opening today is an off-chain /
API call to `apply_reveal` with the keyfile. Do not market on-chain reveal or
transfer until a format is specified and tested.

## Constants

| name | value | meaning |
|---|---|---|
| `LAUNCH_HEIGHT` | set before launch | first block a mint can land in |
| `CHALLENGE_WINDOW` | 24 blocks (~30 min) | how old a challenge block may be |
| `EPOCH_SIZE` | 128 | mints per full epoch |
| `SEAL_TIMEOUT` | 1152 blocks (~1 day) | max epoch length |
| `PATIENCE_UNIT` | 1152 blocks | one patience point |
| `MAX_WORK_BITS` | 4 | provisional; flat base 22 + 4 = 26 bits max |
| `BASE_DIFFICULTY_BITS` | 22 | flat for the whole collection |
| `MAX_BURN` | 0 | burn undefined — axis stubbed until defined |
| `SUPPLY_CAP` | 4096 | |

Indexers consume **every** block from `LAUNCH_HEIGHT - CHALLENGE_WINDOW`
onward, in order, with no gaps, including blocks with no ZVLT records. An
indexer given any other stream refuses to produce a state.

## Mint validity

A record in block `h` counts only if **all** of these hold. Any failure and
every correct indexer ignores it — the transaction still exists on chain, it
just isn't a mint.

1. `magic`, `version`, `checksum` correct, fields within caps
2. there is a **challenge block** `c` with `h - 24 <= c <= h - 1` and
   `c >= LAUNCH_HEIGHT - 1` such that

       challenge = blake2b("zvlt.challenge.v2" || blockhash(c))
       pow       = blake2b(challenge || commitment || minerTag || nonce)
       pow < target(baseDifficulty(q) + workBits)

   where `q` is the number of valid mints after block `c`. Indexers check
   the newest `c` first. `blockhash(c)` is the bytes of the hex `hash` the
   node's RPC reports.
3. the transaction pays at least `floorPrice(q) * (1 + moneyMultiple)` to the
   treasury in transparent outputs
4. `burnAmount` matches a burn in the same transaction
5. the commitment has not been minted before
6. fewer than `SUPPLY_CAP` mints exist

Valid mints are numbered by (block height, tx index). Any number per block.

**Why the commitment is in the PoW.** In v1 the hash covered only the
challenge, tag, and nonce, and nothing checked the tag, so anyone watching
the mempool could copy a nonce onto their own commitment and outbid the fee.
Now a nonce only works for the commitment it was mined with. Copying the
whole record mints the victim's commitment, which only the victim can open.
The tag is kept for miners' own bookkeeping and has no security role.

**Why price is by epoch, and difficulty is flat.** Floor price is
`floor_price_epoch(epoch)` (200k / 500k / 1M / 2M zat for epochs 0–1 / 2–7 /
8–15 / 16–31). That keeps every rank table on one price even after a
timeout-sealed short epoch shifts mint-index boundaries. Base difficulty is
**22 for the whole collection** — the old difficulty staircase is removed so
late mints are not a 64× compute tax. `MAX_WORK_BITS = 4` ⇒ hardest mint is
26 bits.

## Epochs and the seal

An epoch opens with its first mint at height `h0` and seals at the first of:

- its 128th mint (sealed in that mint's block, after that mint)
- the mint that reaches `SUPPLY_CAP`
- block `h0 + SEAL_TIMEOUT` (sealed before that block's mints, which go to
  the next epoch)

At the seal, in block `s`:

    epochSeal = blake2b("zvlt.seal.v2" || epoch || s || blockhash(s)
                        || commitment_1 || ... || commitment_n)

**Tier is rank, with a score floor.** Sort the epoch by score descending.
Equal scores break on `blake2b(epochSeal || commitment)` — lower digest wins.
That lottery is fixed only when the epoch seals; a miner cannot keep grinding
a valid PoW for a better tiebreak. Rank `r` of `n` maps to position
`p = r * 128 / n` (integer):

| p | tier_by_rank | seats in a full epoch |
|---|---|---|
| 0–7 | oracle | 8 |
| 8–23 | cipher | 16 |
| 24–55 | warden | 32 |
| 56–87 | runner | 32 |
| 88–127 | drone | 40 |

Absolute score floors are `score_floors()` — per-mille of `max_live_score()`
with shape 20/42/64/84%. Under `MAX_BURN = 0` (live max 750k) that is
150k / 315k / 480k / 630k. They define `tier_by_score`.

**Burn cannot be activated mid-collection.** Raising `MAX_BURN` raises
`max_live_score()` and therefore moves every floor. That would re-tier mints
already sealed under the 750k scale. Burn is a next-version parameter only —
ship a new collection (or a version bump with explicit migration rules), never
flip it on under a live `SUPPLY_CAP`.
Final assignment:

    tier = min(tier_by_rank, tier_by_score + 1)

Rank still decides contested epochs. The floor stops a lone minimum bid in a
timeout-sealed epoch from manufacturing an oracle. Contested full epochs with
competitive bids still fill 8/16/32/32/40.

`MAX_BURN` is 0 until a burn mechanism exists — records with `burnAmount > 0`
fail parse (before payment accounting), not `apply_mint`.

**Work is bits above a flat base (22).** With `MAX_WORK_BITS = 4` every mint
is at most 26 bits. Score still uses `sqrt(workBits / MAX_WORK_BITS)` — the
money axis scores `moneyMultiple`, never an absolute ZEC amount.

Residual trust: the Zcash miner who produces block `s` knows its hash before
publishing and could discard a block to re-roll the seal, at the cost of a
block reward. Using a hash a few blocks after `s` would narrow this; not done.

## Reveal

Publish `(secret, seed, salt, workBits, patience, burnAmount, moneyMultiple)`
in block `h`. Valid if the epoch sealed before `h`, if
`h >= mintHeight + patience * 1152`, and if the opening recomputes the
commitment with inputs equal to the recorded bid. Then:

    score     = floor(Σ weight_i * sqrt(x_i / max_i))     (public since mint)
    traitHash = blake2b(seed || secret || score || epochSeal)
    sprite    = generate.derive_tier(traitHash, tier)

Nobody, including the holder, can know `traitHash` before the seal. After
the seal only the holder can. Patience in blocks means no bid can be
stranded.

Weights: work 0.40, patience 0.25, burn 0.25, money 0.10.

## What you actually lose

**Selective disclosure is off-chain.** Score is public from the bid, so the
useful predicates are over traits ("visor is gold"). They work — Groth16 proof generated by the holder, verified by the buyer
in their own client. It just isn't enforced by consensus. A marketplace has to
choose to check it.

**Transfer privacy is weak.** A transfer record links the old nullifier to the
new commitment in public, so the chain of custody is visible even though
identities are not. Breaking that link needs a ZK proof the indexer verifies —
possible, but the indexer is then trusted to check it, which is a real step down
from a contract that cannot be bribed.

**No atomic payment.** You pay, then the indexer credits you. A malformed memo
means you paid for nothing. The client must validate before broadcasting, and
the treasury should refund malformed mints as policy, not as code.

**Nothing stops a fake.** Anyone can write a `ZVLT` record claiming a mint they
never earned. Correct indexers ignore it, but a buyer reading raw chain data
could be fooled. The only defence is publishing the indexer and making
verification one command.

## Trust, stated plainly

Run the indexer yourself and you trust nobody — you recompute the same state
from the same public data. Use someone else's and you trust them to run the
published rules.

That is a weaker guarantee than a contract and a much stronger one than "the
team says you own it." Say so in the docs. The projects in this meta that
quietly present an indexer as onchain ownership are storing up a bad week.
