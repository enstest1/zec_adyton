# GAME — making it a game, not a spreadsheet

Outside review. Read after `DECIDE.md`, before touching weights or the wire
format. Everything claimed here is reproduced by `python3 sim.py all`, which
imports the real `score_of` and the real `derive` so it cannot drift from the
protocol.

---

## The problem in one sentence

In v1 your score depends only on your own bid, so it is an optimisation
problem, not a game. Someone solves it once, posts the table, and there is
nothing left to argue about.

`LAUNCH.md` tweet 7 says "chess gets solved, poker doesn't." As built, this
is chess. `sim.py solve` prints the whole solution in a few seconds: the
cheapest bid to every tier for every kind of player. Once that is on a
timeline the quants leave, and the docs already say what happens when the
informed players leave.

Poker is poker because your hand's value depends on the other hands, and
because there are betting rounds where private information gets priced.
v2 below adds both, without adding a single hidden rule.

---

## Three things that break the pitch before the game even starts

These are bugs, not design debates. Each has a one-line proof in `sim.py`.

### 1. The holder picks their punk before paying

`traitHash = blake(seed, secret, score)`. The miner chooses `seed` and
`secret` in `miner.py`, and knows `score` from their own bid. So they can
iterate seeds locally, run `derive()`, and keep going until it returns the
punk they want. Then mine, then pay.

`sim.py grind` finds the rarest entry in all seven pools in about half a
million seeds, a few seconds on one core. "You bid on a distribution, never a
result" is false, and "nobody, including you, knows what's inside" is false.

**Fix.** The roll must include entropy that is fixed *after* the commitment
is on chain and that no participant controls. Use the epoch seal:

    epochSeal = blake(commitment_0 ‖ … ‖ commitment_127 ‖ blockhash(seal_height))
    traitHash = blake(seed, secret, score, epochSeal)

Now nobody knows the traits until the epoch seals, and after it seals only
the holder does. That second half is what makes a market (see below).

### 2. Patience strands mints

Patience is counted in epochs, an epoch is 128 mints, and the supply cap is
4096. So exactly 32 epochs will ever exist. A mint in epoch 17 or later with
patience 16 can never satisfy `current_epoch >= mint_epoch + patience`.
`sim.py strand`: 120 of the 544 possible (epoch, patience) pairs are sealed
forever. If minting stalls at 2000 the way Hashcats did, everything with
patience ≥ 1 from epoch 14 onward is stranded too.

Separately, patience measured in mints is free when the mint is hot and
infinite when it stalls. Neither is "time," which is what the axis is
supposed to sell.

**Fix.** Count patience in blocks. One patience unit = 1152 blocks, about a
day at 75s. Reveal is valid at `height >= mint_height + patience * 1152`.
Never strands, and it costs what it says it costs.

### 3. Every slot is a race where the losers still pay

The challenge rotates on every mint. `check_pow` verifies against the
*current* challenge, so if two miners both solve challenge C₀ and both land
in block h, the second one by tx index is "bad proof of work." Same if it
lands in h+1. On EVM the tx reverts and nothing is lost. On Zcash the
payment already went to the treasury. `SPEC.md` already says refunds are
"policy, not code."

At most one valid mint per 75-second block, so 4096 mints is 3.5 days
minimum even with zero contention, and under any real contention most
attempts are paid losers. That is not a game, it is a tax.

**Fix.** Rotate the challenge per *block*, not per mint:

    challenge(h) = blake("zvlt.challenge", blockhash(h - 1))

A mint in block h is valid against `challenge(h)` or the previous two, to
survive propagation. Any number of mints per block, slots ordered by
(height, tx index) as now. Pre-computation is still impossible because block
hashes are unknowable ahead.

**Correction (do not trust the next sentence as written in the first draft of
this file):** the claim that "the miner tag still stops anyone stealing a
solution" is **false**. Nothing in v1 (or in this plan's sketch) checked the
tag against the payer, and `chain.py` does not read the paying address.
A watcher can copy a nonce onto their own commitment. Closing that gap needs
the PoW to bind the commitment (or an equivalent). That binding is **not**
part of this plan — it was found later when the plan was implemented. The
per-mint chaining was solving a problem the tag does *not* already solve.

---

## v2: the table

Same four axes, same weights, same sqrt, same caps. What changes is how a
score becomes a tier, and when the roll happens.

### Rank, not cutoff

    tier = your score's rank within your epoch

| tier | seats of 128 | |
|---|---|---|
| oracle | 8 | top 1/16 |
| cipher | 16 | next 1/8 |
| warden | 32 | next 1/4 |
| runner | 32 | next 1/4 |
| drone | 40 | the rest |

Ties break on `blake2b(epochSeal || commitment)`, lower digest wins. That is a
lottery fixed at seal time — not a hashrate contest. (An earlier draft said
"work is always the tiebreak" via the PoW hash; that was wrong once every
axis is cheap to max, because equal scores then collapse into an uncapped
grind for a lower PoW digest.)

Now your tier depends on who else sat at your table. A bid that buys oracle
in a quiet epoch buys warden in a crowded one. The cheapest bid to a tier
has to be re-solved every epoch against a field that is visible and still
filling. `sim.py epoch` runs twelve epochs with a changing mix of player
types and prints the cutoffs moving.

The sqrt still does its job: it is the exchange rate between axes. But the
cap story gets stronger. In v1 "past the cap it buys nothing" meant the axis
ceiling. In v2 it also means "past the second-best bid it buys nothing." A
whale who overspends by 10x on the top seat gets the same seat. Whales can
buy one epoch's oracles at an exorbitant price. They cannot buy all 32, and
buying one is a public signal that sends everyone else to the next epoch.

### Bids are public, the table is sequential, and that is the game

Bids sit in `OP_RETURN` in the clear (money and burn have to be, to be
verifiable; work is visible from the hash). So within an epoch everyone can
see every bid so far and how many seats remain. Slot 1 bids blind. Slot 128
sees everything.

`sim.py epoch` measures this: bidders in the first 32 slots are pushed below
the tier they aimed for far more often than bidders in the last 32. The last
slot of every epoch is the most valuable position in the game, and the PoW
race decides who gets it. That is the climax of every epoch and it happens
32 times.

Strategies that fall out without anyone designing them:

- **Sandbag.** Wait for the table to fill, then bid exactly what clears.
- **Deter.** Bid big early to push the field to the next epoch, then fill
  the cheap seats behind yourself.
- **Epoch-hop.** Skip the crowded epoch. But the price staircase steps up
  with supply, so waiting is not free.
- **Close.** Race for slot 128 with a bid you only have to beat one number
  with.

None of these has a closed-form answer against heterogeneous opponents.
People will argue about them for the whole mint, which is the point.

### The roll happens at the seal

With `epochSeal` in the trait hash, there are three information states and
each one is a different game:

| phase | who knows the traits | what trades |
|---|---|---|
| epoch filling | nobody | nothing yet; this is the bidding round |
| sealed, unrevealed | the holder only | sealed boxes, priced on tier + belief |
| revealed | everyone | punks |

The middle phase is the poker. Tier is public (rank is computable from
public bids once the epoch seals), so a buyer knows the *size of the shelf*
a sealed box drew from. They do not know what came off it. The holder does.

That is a market for lemons. Holders of bad rolls want to sell sealed;
holders of good rolls want to prove something first. Unsigned sealed boxes
trade at a discount; the discount pushes good holders to disclose; every
disclosure narrows the remaining pool; the pool that stays silent gets worse.
Quants will recognise the unravelling argument by name and will model where
it stops. Let them.

`threshold.circom` is the disclosure instrument, and in v2 the interesting
predicates are over traits, not score, because score is already public.
"Aura is lit or burning." "Visor is gold." "Hood is not plain." A circuit
over `derive()` is a few hundred constraints if `Roll` hashes with Poseidon
instead of SHA-256. On Zcash the buyer verifies in their client. A
marketplace that checks proofs is a marketplace; one that does not is a
Telegram group.

Note the interaction with patience. A box committed to max patience cannot be
opened for sixteen days, but can be *proven against* on day one. A locked box
with a "visor is gold" proof on it is a new kind of asset: verifiable floor,
provably cannot be opened yet. Nobody else in the meta can make one.

---

## Why this feeds the people you want to feed

The chat says: quants want an edge, normies wait for the quants to post the
play. That loop needs three things and v1 has none of them.

1. **State that is legible and changes.** Publish the indexer's epoch view
   as JSON at every block: every bid so far, seats remaining, live cutoffs.
   That is the order book. The people building the dashboards are the
   people writing the threads.

2. **A model to disagree with.** Ship `sim.py`. It is deliberately a
   fictitious-play sketch, not an equilibrium solver: agents shade to the
   minimum and never anticipate being pushed. The first person who models
   that properly has an edge, and they will tell everyone, and then the
   next person will model *them*. Do not ship the solver. Ship the thing
   that makes people want to write one.

3. **Problems with names.** Sequential all-pay contest with heterogeneous
   costs. Akerlof lemons with voluntary disclosure. Optimal stopping on the
   epoch choice. Tullock-style rank contest on the burn axis. Quants search
   for the literature, find it, and post "here is what the theory says."
   Normies read that, not the formula.

What you have to give up: any hidden rule, ever. The moment the weights are
not what the docs say, the analysis stops and influencer capture starts.
`NOTES.md` already says this. It is more true in v2 than v1.

---

## Wire and code changes, concretely

For whoever picks this up. Nothing here changes the record size.

**`indexer.py`**
- `patience` in the record becomes units of 1152 blocks. `apply_reveal`
  compares `height >= c["height"] + patience * 1152` instead of epochs.
- `check_pow` verifies against `challenge(height)` derived from the block
  hash, accepting the previous two. Drop `self.challenge` chaining.
  `extract_block` in `chain.py` already has `blk["hash"]`; carry the previous
  hash through.
- On the 128th mint, compute `epochSeal` and store it on the epoch. Reveal
  is invalid until the epoch is sealed, regardless of patience.
- `apply_reveal` derives `trait_hash = blake(seed, secret, score, epochSeal)`.
- Add `tier_of(index)` computed from rank within epoch; `generate.py`
  takes tier, not score.
- Digest includes epoch seals.
- The duplicate-commitment check is a list scan; make `commitments` a dict.

**`miner.py`**
- `--challenge` becomes required and is the block hash; print which heights
  it is valid for.
- Print the table: fetch the epoch JSON and show current cutoffs before
  mining, so a miner sees what they are bidding into.

**`generate.py`**
- `derive(trait_hash, tier)` instead of score. `tier_of` moves to the
  indexer.
- If trait proofs are wanted, `Roll` should draw from Poseidon, not SHA-256.
  Decide before launch; changing it later re-rolls the collection.

**`SPEC.md`**
- Rule 2 becomes the block-hash challenge. Rule 3 goes away.
- Add: epoch seal definition, reveal requires sealed epoch, tier by rank.

**`LAUNCH.md`**
- Tweet 2 becomes true. Tweet 7 becomes true. Add one tweet that says the
  last slot of every epoch sees every other bid, and that's the race.

**Burn** is still undefined on Zcash. Rank-based scoring makes this less
urgent than `RUNBOOK.md` suggests: with burn stubbed to 0 for everyone, it
drops out of the ranking uniformly and nobody is mispriced relative to
anyone else. The weights can stay published. It still needs a definition
before the axis means anything.

---

## The memo, honestly

With the seal providing entropy, the encrypted memo has no cryptographic
job. The miner already holds seed and salt; `WALLETS.md` says the treasury
delivers them, `miner.py` generates them locally, and both cannot be true.

Give the memo a real job instead: it is the wallet-native receipt. The
treasury's shielded reply carries `index`, `epoch`, and `seal_height`, so a
holder opens ZODL and sees "ZVAULT #1337 · epoch 10 · seals in 41 blocks"
with no website involved. That is the "private-z-miners" integration from
the chat, and it is something only this chain can do. Say that instead of
implying the memo is what keeps the punk secret. It isn't; the seal is.

---

## What not to do

- Do not make the tiers a fixed cutoff again "so people know what they're
  getting." That is the whole v1 problem.
- Do not hide the epoch state to "keep it fair for early bidders." Early
  bidders are supposed to be at a disadvantage; that is what makes the
  last slot worth racing for.
- Do not add a token that pays out on rank, or any yield. The legal note in
  `HANDOFF.md` applies twice as hard once there is a leaderboard.
- Do not let the treasury mint. It sees nothing the public doesn't, but the
  optics of the house sitting at the table end the game.

## On the rest of the chat

Supply and price are a separate conversation from mechanics. The staircase
in `indexer.py` was chosen against the Hashcats stall for reasons
`MARKET.md` lays out; "10k at $1" is a different bet with a different
failure mode and should be argued there, not here.
