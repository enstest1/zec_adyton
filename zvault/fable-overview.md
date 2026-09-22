# fable-overview — what was reviewed, what was changed, and what I actually think

> **SUPERSEDED (2026-09-22).** Written 2026-09-17 as a companion to `GAME.md`
> during the v2 redesign. The EVM track it mentions was **not taken**; burn
> remains inactive; launch copy must not promise a fully solvable strategic
> table. Prefer `READY.md`, `SPEC.md`, and `LAUNCH.md` accuracy notes. Kept
> for session history only.

Written 2026-09-17 by Claude Fable 5.1 at Josh's request, after a full read of
the repo. This is the plain-language companion to `GAME.md`. Where that doc
argues the design, this one accounts for the work: what was touched, what was
left alone, and why.

---

## 1. What I read

Everything. All seven top-level docs, both tracks, the art generator, and the
sample renders.

| area | files | verdict |
|---|---|---|
| docs | `HANDOFF` `DECIDE` `RUNBOOK` `NOTES` `LAUNCH` `LINKS` `MARKET` | unusually good; honest about what is not built |
| Zcash track | `SPEC.md` `WALLETS.md` `indexer.py` `chain.py` `miner.py` `memo.py` | rule logic works and self-tests; three protocol bugs (below) |
| EVM track | `HashVault.sol` `reveal.circom` `threshold.circom` | sketch quality, and the docs say so |
| art | `generate.py` + 40 samples + tier ladder | genuinely good; silhouette-first was the right call |

I ran the indexer self-test and got the documented output and digest. I did
not run anything against a live node, because there is no node here.

## 2. What I changed

Four files. Nothing else in the repo was modified.

**`GAME.md`** (new). The review and the redesign. Three bugs that break the
launch pitch, a v2 design that makes the mint an actual game, a per-file list
of code and spec changes, and a short list of things not to do.

**`sim.py`** (new). Dependency-free model that imports the repo's real
`score_of` and `derive`, so it cannot drift from the protocol. Four commands:

    python3 sim.py grind    # holder picks their exact punk before paying
    python3 sim.py strand   # (epoch, patience) combos that can never reveal
    python3 sim.py solve    # the one spreadsheet that solves v1
    python3 sim.py epoch    # v2: rank-based tiers, cutoffs move with the field

Runs in about ten seconds total. Every number in `GAME.md` comes from it.

**`art/generate.py`** (one edit). Pillow import is now lazy, so `derive()` is
importable on a machine without Pillow. `draw()` still needs it. No change to
any pixel or to the draw order.

**`HANDOFF.md`** (two lines). Points at the two new files and puts `GAME.md`
in the reading order after `DECIDE.md`.

## 3. What I found

Three bugs. Each is reproduced by `sim.py` and each one falsifies a line in
`LAUNCH.md`.

**The holder picks their punk before paying.** `traitHash` is a hash of the
seed, the secret, and the score. The miner chooses the seed and the secret and
knows the score from their own bid. So they iterate seeds locally until
`derive()` returns what they want, then mine and pay for exactly that. The sim
lands the rarest entry in all seven pools in about half a million tries, a few
seconds on one core. "You bid on a distribution, never a result" is false.
Fix: mix the epoch seal (all 128 commitments plus a block hash) into the trait
hash, so the roll happens after the commitment is on chain.

**Patience strands mints.** Patience is counted in epochs, an epoch is 128
mints, and 4096 supply means exactly 32 epochs ever exist. A mint in epoch 17
or later with patience 16 can never reveal. 120 of the 544 possible combos are
sealed forever. If minting stalls the way Hashcats did, it gets much worse.
Fix: count patience in blocks.

**Every slot is a race where the losers still pay.** The challenge rotates per
mint and is checked against the current one, so two miners who both solved
the same challenge produce one valid mint and one rejected one, and on Zcash
the rejected one already paid the treasury. At most one valid mint per block.
Fix: derive the challenge from the block hash instead, so any number of mints
per block are valid.

And one design gap, which is what the chat was really asking about:

**It is a spreadsheet, not a game.** Your tier depends only on your own bid.
That is an optimisation problem, solvable once per player type, and
`sim.py solve` prints the whole solution. `LAUNCH.md` says "chess gets solved,
poker doesn't." As built, this is chess.

## 4. What I proposed

The v2 design in `GAME.md`, summarised:

- **Tier is rank within your epoch**, not a fixed cutoff. 8 oracle seats, 16
  cipher, 32 warden, 32 runner, 40 drone out of 128. Ties break on the PoW
  hash.
- **Bids are public and sequential.** Slot 1 bids blind, slot 128 sees the
  whole table. The last seat of every epoch becomes the race worth winning,
  and PoW decides it.
- **The roll happens at the seal.** Nobody knows their traits until the epoch
  seals. After that only the holder does. That middle phase is a market for
  lemons with threshold proofs as the disclosure instrument, which is the
  poker the docs promised.
- **Same four axes, same weights, same sqrt.** No hidden rules. The weights
  stay the exchange rate between axes; the cap story gets stronger because
  overspending past the second-best bid buys nothing.

Why this answers "how do we feed the quants": it gives them state that
changes every epoch, a model to disagree with (the sim is deliberately not an
equilibrium solver), and problems with names they can search for. The people
who build the dashboards are the people who write the threads.

## 5. What I did not do, and why

**I did not change the protocol.** All three fixes alter what a mint record
means. Indexer, miner, spec, launch copy, and self-test all have to move
together. That is a rewrite of the Zcash track, and switching to rank-based
tiers is a design decision that belongs to the person whose project it is.
`GAME.md` lists the exact per-file changes so whoever does it is not guessing.

**I did not touch the EVM track.** It is explicitly a sketch, the docs say
which parts are wrong, and `DECIDE.md` argues the two tracks are alternatives.
Fixing `threshold.circom`, the transfer stub, and the Merkle root is real
work that only matters if they choose EVM.

**I did not define the burn.** Zcash has no tokens; the axis is a stub. This
is the one open decision the docs flag, and it is theirs. One note: under
rank-based scoring a stubbed burn drops out uniformly for everyone, so the
weights can be published before it is settled. It still needs a definition
before the axis means anything.

**I did not relitigate price or supply.** The chat floats "10k at a dollar."
The staircase in `indexer.py` was chosen against the Hashcats stall for
reasons `MARKET.md` lays out. That is a separate argument from mechanics.

**I did not publish anything or contact anyone.** Everything is in the repo
you were sent. Send it back.

## 6. My full take

The repo is much better than the meta it is competing in. The person who
wrote it understands why Hashcats stalled, why an indexer is not on-chain
ownership, and why money has to be the weakest axis. The docs are honest to
a degree that is rare in this space, and honesty about the trust model is the
right differentiator for a Zcash launch.

The weak point is that the mechanics were designed axis by axis and never
checked as a system. Each of the three bugs is obvious once you ask "what does
a rational player do here," and none of them shows up in a unit test because
the unit tests check rules, not incentives. That is the same reason the game
theory is thin: nobody sat down and played it.

The single most important change is the epoch seal in the trait roll. Without
it the sealed-box story is false and someone will demonstrate that publicly
within a day of launch. The single most valuable change is rank-based tiers,
because it is what turns a mint into a table. Everything else is plumbing.

The memo delivery is the thing the docs are proudest of and the thing that
does the least. With the seal providing entropy it has no cryptographic job.
It still has a good job as the wallet-native receipt, and that is the honest
version of the "private miners" pitch from the chat.

On the choice of chain: Zcash is right for this if the pitch is privacy as
aesthetic and the audience is already there. The auditable-indexer trust model
is a real step down from a contract, and being the one project that says so
plainly is worth more than pretending otherwise.

## 7. What should be done

In order. The first three are blockers; nothing should launch without them.

1. **Epoch seal in the trait hash.** Fixes grinding. Breaks nothing else.
2. **Patience in blocks.** Fixes stranding. Changes the meaning of one byte.
3. **Block-hash challenge.** Fixes paid losers. Removes the per-mint chain.
4. **Rank-based tiers.** The game. Move `tier_of` into the indexer, pass tier
   to `generate.py` instead of score.
5. **Update `SPEC.md`, `LAUNCH.md`, and the self-test** to match. Tweets 2
   and 7 become true; tweet 8 stays cut until the circuit works.
6. **Define the burn.** ZEC to an unspendable address works today. ZSA burn is
   cleaner but the timing is not yours.
7. **Calibrate against real hardware** before publishing any difficulty
   number. `RUNBOOK.md` already says this; it is still true.

## 8. What could be done

Worth it, not blocking.

- **Publish the epoch state as JSON at every block.** Every bid so far,
  seats remaining, live cutoffs. This is the order book the quants build on.
- **Trait-predicate proofs.** Swap `Roll` from SHA-256 to Poseidon so a
  circuit over `derive()` is cheap, then "visor is gold" becomes provable on
  a sealed box. On Zcash the buyer verifies client-side. Decide before launch;
  changing the hash later re-rolls the collection.
- **Miner shows the table before mining.** Fetch the epoch JSON, print the
  current cutoffs, let the miner see what they are bidding into.
- **Make `commitments` a dict.** The duplicate check is a list scan. Trivial.
- **A better sim.** The one shipped is fictitious play with agents that shade
  to the minimum. A version that models being pushed by later bids would be
  the first real edge, and it would be good if a community member wrote it
  rather than the project.

## 9. What should not be done

- Do not go back to fixed cutoffs "so people know what they're getting."
- Do not hide the epoch state to protect early bidders. Their disadvantage is
  what makes the last slot worth racing for.
- Do not add a token that pays on rank, or any yield. The legal note in
  `HANDOFF.md` applies twice as hard once there is a leaderboard.
- Do not let the treasury mint.
- Do not ship tweet 8 until `threshold.circom` constrains its score.

## 10. If you want me to build it

The scope is the Zcash track only: items 1 through 5 above, with the self-test
extended to cover the seal, the block-hash challenge, and rank assignment.
I would leave the EVM track and the burn decision alone. Say so and I'll do it.
