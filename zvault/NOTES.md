# NOTES — why it is built this way

Design decisions with the reasoning attached, including the ones we got wrong
first. Mostly here so nobody re-litigates a settled question or reintroduces a
bug we already removed.

---

## Do not prove the proof of work

The first version of this design wrapped the PoW in a SNARK — mining by
generating a proof. **That was wrong.** Keccak and blake2b are brutally
expensive inside a circuit, and verifying a nonce directly costs almost
nothing. Wrapping it costs enormously and buys nothing.

The split that works:

| layer | hash | where |
|---|---|---|
| proof of work | blake2b | public, verified directly |
| commitments | blake2b / Poseidon | inside the seal |

Blake2b on the Zcash track because the chain already uses it throughout, so
miners and verifiers reuse primitives that ship with the network. Poseidon on
the EVM track because it is what circuits prove over cheaply.

## Opening a seal needs a hash, not a proof

The realisation that made the Zcash version possible. Publish the opening,
anyone recomputes `blake2b(secret, seed, inputHash, salt)` and compares. Local
computation on public data — no VM required.

ZK is only needed for *selective* disclosure: proving a score exceeds a
threshold without revealing it. That is optional, and on Zcash it is
client-side.

## Records are transparent, and that is deliberate

A shielded memo is readable only by its recipient. If mint records lived in
shielded memos, only the project could see the collection — a private database
with a Zcash logo, not privacy.

Public records mean anyone re-derives full state and catches a lying indexer.
Privacy comes from the commitment being sealed, not from the transaction being
hidden. This is the single most likely thing for someone to "fix" later without
understanding. Do not.

## Money is 10% on purpose

Pay-to-win kills what makes these work. Hashcats' pitch is explicitly no
allowlist, no auction, no team allocation — the moment the biggest wallet
reliably gets the best traits, you are an auction with extra steps and the
fair-race crowd leaves.

Four axes instead, money weakest and capped. Work is compute not capital.
Patience cannot be bought at any price. Burn is the sink.

**Concavity is doing real work here.** `sqrt` means 10x the spend buys ~3.16x
the edge, and past the cap it buys nothing. Whales advantaged, never decisive.
If someone proposes making it linear "so whales have a reason to participate,"
that is the proposal to make it an auction.

## Public formula, private state

Chess gets solved and then it is over. Poker does not, because the uncertainty
regenerates every round.

Publish every weight and cap. The complexity lives in four sealed axes
interacting, not in hidden rules. Complex *and* unknowable produces influencer
capture, not analysis — nobody researches a system they cannot model, they just
copy whoever sounds confident.

And design the gap so effort closes it. Informed players extracting from
uninformed ones is how all of these work, but if the gap is closeable by
reading the docs, the follower pool renews. If it is permanent, followers get
cleaned out, do not come back, and there is nobody left to sell to in two
months. That is a survival question, not a fairness one.

## Score gates, never picks

Higher score widens which trait pools are reachable. The hash still chooses off
the shelf. You bid on a distribution, never a result — which is what keeps
mining feeling like mining. See `art/tier-ladder.png`: each row one seed,
columns rising score.

## Art derives, never assigns

`sprite = f(traitHash, score)`. Hashpunks assigns one unused punk rendered in
advance, which means whoever holds that folder knows the collection before the
market does. With sealed commitments that model collapses anyway — there is no
mint-time index to assign against.

Deriving means no punk exists before its owner opens it, and anyone can verify
a sprite without trusting a metadata server.

**Never reorder the trait draw in `generate.py`.** The draw order is the
mapping from hash to sprite. Changing it silently re-rolls every punk in the
collection.

## Silhouette carries identity

First art pass was 40 near-identical blocks — it read as filing cabinets. Two
fixes: six chassis shapes, because at 24 pixels shape reads before colour; and
removing a white overline on the visor that was washing every colour into the
same pale bar. The visor must be the one saturated element on screen.

---

## Warnings

**`threshold.circom` does not constrain its score.** As written a prover
asserts any score and the proof means nothing. Left explicit rather than
quietly wrong. Wire in `Reveal(DEPTH)` and bind its output before this goes
near a testnet — and before publishing any marketing that describes selective
disclosure as working.

**The EVM `transfer()` is a stub.** Spends a nullifier without proving
ownership of what it spends.

**The incremental Merkle root is a sketch.** `filledSubtrees[DEPTH-1]` is not a
correct root for a partially-filled tree. Use a known-good implementation.

**Nothing here is audited or has been deployed.**

**Do not key ownership to a wallet address.** ZODL generates a new shielded
address every time Receive opens, drawn from the unified address pool, to
prevent reuse. Key to the secret inside the commitment; the address is a
delivery route, not an identity.

**Ledger, Trezor, Trust Wallet, Guarda and Exodus are transparent-only for
ZEC.** Those users cannot receive a memo and will not know why. Say it on the
mint page, not in the FAQ.

**State the trust model in public.** Run the indexer yourself and you trust
nobody. Use someone else's and you trust them to run the published rules. That
is weaker than a contract and much stronger than "the team says you own it."
Several projects in this meta present an indexer as onchain ownership; being
the one that says it plainly is a differentiator, not a weakness.

**Legal.** A staked or yield-bearing asset draws real securities scrutiny in
the US. A shielded pool moving arbitrary value is a mixer, with the regulatory
history that implies. Keep the shielded scope to "which punk you own" and get
counsel before adding any value-transfer path. Not legal advice.
