# Which target — read before writing code

The same product, two chains, one real difference: **who enforces the rules.**

|  | Zcash | EVM (ZKsync Era) |
|---|---|---|
| invalid mint | written to chain, ignored by indexers | rejected by the contract |
| who computes state | everyone, independently | the chain |
| what you trust | rules being deterministic and public | the code |
| selective disclosure | off-chain, buyer verifies in their client | enforced on-chain |
| transfer privacy | weak — old nullifier links to new commitment in public | strong |
| payment | not atomic — pay, then get credited | atomic |
| encrypted memo delivery | **native, 512 bytes** | nothing comparable |
| the audience | already there | elsewhere |

## Zcash

Zcash has no virtual machine. No contracts, no Solidity, no verifier. A
transaction claiming a hash nobody found gets written to the chain quite
happily, and the only thing that stops it counting is that every correct
indexer ignores it.

So enforcement is replaced by **auditability**. Rules are deterministic, records
are public, and anyone running `indexer.py` over the same blocks gets a
byte-identical state digest. An indexer that lies is caught by a diff. This is
how Ordinals and BRC-20 survive on a chain with no VM.

**Mint records must be transparent, not shielded.** A shielded memo is readable
only by its recipient, so if mints lived in shielded memos then only the project
could see the collection — that is not privacy, that is a private database with
a Zcash logo. Privacy comes from the commitment being sealed, not from the
transaction being hidden.

What Zcash gives you that no EVM chain can: the encrypted memo. The opening
material arrives in a 512-byte note only the holder's key decrypts. That is the
whole aesthetic of the project, native, not simulated.

## EVM

Everything is enforced. `threshold.circom` becomes real — a buyer cannot be
lied to about a score because the chain checked it. Transfers are genuinely
unlinkable. Payment and mint are one atomic transaction, so nobody pays for a
malformed record.

And you lose the memo. There is no encrypted-delivery primitive on an EVM
chain; you would be emailing people their seeds or posting ciphertext on IPFS.

## The third option

Contracts on Era, settlement in ZEC through NEAR Intents — which is exactly what
the zkSNARKs auction did so people could bid without holding ZEC. Real
enforcement, Zcash-denominated, Zcash audience. You lose the memo delivery and
gain everything else.

## Honest read

If the pitch is *privacy as aesthetic* and the audience is the Zcash crowd, go
Zcash and be loud that it is an auditable indexer rather than onchain
ownership. Several projects in this meta are quietly presenting an indexer as
onchain ownership, and that is a bad week waiting to happen. Being the one that
says it plainly is a differentiator.

If the pitch is *sealed mechanics that provably cannot be cheated*, go EVM.
The mechanism is the product there, and it needs to be enforced to mean
anything.

Do not try to do both at once. The trust models are different and the marketing
for one is a lie about the other.
