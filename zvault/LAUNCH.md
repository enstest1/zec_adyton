# Launch copy

Draft thread, updated for protocol v2. **Read the accuracy notes at the
bottom before posting** — tweet 8 is still held.

---

**1/**
You don't mint a ZVAULT. You mine one.

Your machine hunts for a hash. Find one, submit it, and you win a sealed box.

You don't get to see what's inside.

**2/**
The box is sealed with math, not a promise.

Not the team, not the devs, not you. Nobody knows what's in it until you decide
to open it.

There's no folder of finished art sitting on a server. Your punk doesn't exist
until you open the box.

**3/**
Before you mine, you place a bid on three things:

⛏️ WORK — grind harder, better odds
⏳ PATIENCE — leave it sealed longer, better odds
💵 MONEY — pay more, slightly better odds

Burn is reserved for a later version. At launch it contributes nothing.

**4/**
Money is deliberately the weakest. It's 10% of the published four-axis weights
(work 40%, patience 25%, burn 25%, money 10%).

With burn inactive, the maximum live score is **750,000** — not 1,000,000.
The weights are unchanged so burn can activate in a later version without
re-pricing the formula shape.

You can buy an edge. You can't buy the outcome.

**5/**
Every lever has diminishing returns.

Spend 10x more, get about 3x the edge. Past a cap, more spending does literally
nothing.

Whales get an advantage. Whales don't get the collection.

**6/**
The formula is fully public. Every weight, every cap, every number.

Go model it. Go argue about it. There is no single optimal bid — your tier
is your rank against everyone else in your epoch.

The rules are open. Only everyone's cards are face down.

**7/**
That's the game.

You're not solving a puzzle with one right answer. You're reading a table where
you can see the rules and not the hands.

Chess gets solved. Poker doesn't.

**7b/**
Every epoch is 128 seats. Every bid is public the moment it lands.

The first miner bids blind. The last one sees the whole table.

That last seat is the race.

**8/**
Want to sell before opening?

Prove "this one scores above 700" without revealing the score or the traits.

Buyers get a floor. You keep the secret. The sealed box itself becomes
tradeable.

**9/**
v1 has no on-chain transfer.

Ownership is the minting address until a transfer format ships. The chain sees
the mint; it does not move the box.

**10/**
Open it, and the art generates from your own proof.

Same input, same picture, forever. Anyone can verify it. Nobody could have seen
it early.

You didn't get assigned a punk. You found one.

---

## Accuracy notes — fix or hold before posting

**Tweet 2 is now true, with one clarification.** Under v2 traits are rolled
from the epoch seal, which does not exist until the epoch closes, so nobody —
including the miner — can know or pick their punk before paying. Bids are
still public (the chain has to see the payment); what is hidden is what came
out. "Nobody knows what's in your box until you open it" is accurate.

**Tweets 5 and 6 are accurate** with rank-based tiers: overpaying past the
next-best bid buys nothing.

**Tweet 8 is still held.** Cut selective-disclosure claims until a working
circuit exists.

**Tweet 9 — in the thread, not the FAQ.** v1 has no on-chain transfer.
Ownership is the minting address until a transfer format ships. Say so plainly
— that is the honesty-about-trust positioning.

**No royalty path on Zcash.** Primary mint payments to the treasury are
lifetime protocol revenue unless a separate off-chain or future-ZSA mechanism
is designed. Do not imply secondary royalties.

**Memo receipt:** the shielded receipt has no delivery path yet (transparent
payment, no return address in the 74-byte record). Do not pitch wallet-native
receipts until that is designed — keyfile backup is the launch path.

**Add a tweet saying plainly that this is an indexer.** "Ownership is tracked
by an open-source indexer anyone can run and verify — not by a smart contract.
Zcash has no VM. Here's the code." The projects that skip this line are the
ones with a bad week coming.
