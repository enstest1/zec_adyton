# Wallets, addresses, and the shielded requirement

## The address types

| prefix | pool | notes |
|---|---|---|
| `t1` / `t3` | transparent | Bitcoin-style. Public. **No memo field.** |
| `zs` | Sapling | shielded, older pool, still fine |
| `u1` | Unified Address | Orchard-preferring, current standard (ZIP-316) |

A Unified Address bundles several receivers behind one string, so the sender's
wallet picks the best pool both sides support. This is what you should ask for.

## Wallets that can actually receive a shielded mint

**Full shielded + Unified Address support:**
- **ZODL** — flagship, shielded-by-default, mobile, Orchard-preferring. Rebranded
  from Zashi on 16 February 2026; same wallet, same seed, same behaviour. If a
  user searches "Zashi" they land on ZODL, and that is correct.
- **Zingo!** — shielded-first, Orchard and UA
- **YWallet** — fast sync, deep shielded support
- **Unstoppable**, **Edge**, **Brave Wallet** — multi-asset with shielded ZEC
- **Keystone** — air-gapped hardware, shielded support

**Cannot receive a shielded mint — transparent ZEC only:**
- **Ledger** and **Trezor**
- **Trust Wallet**, **Guarda**, **Exodus**

That second list matters for support load. A user on Ledger physically cannot
receive a memo, and will not understand why. Say it on the mint page, not in
the FAQ.

---

## Yes, you can mandate shielded. Here is the part that makes it real.

**Memos only exist on shielded outputs.** A transparent output has no memo
field at all — that is a protocol fact, not a policy choice. So "shielded
address required" is not a rule you enforce with a checkbox. It is a rule the
chain enforces for you, because the delivery mechanism does not exist anywhere
else.

Every shielded output carries a 512-byte memo, encrypted to the recipient and
readable only by them or a holder of their viewing key.

### The sequence

1. Miner generates `secret`, `seed`, and `salt` locally, grinds against a
   recent block hash (commitment bound into the PoW), and broadcasts the mint.
   The public `OP_RETURN` carries a 32-byte commitment and nothing else. The
   keyfile is the asset — the treasury never invents opening material.
2. The treasury may reply with a shielded output to the miner's Unified
   Address. The memo is a **receipt**: `index`, `epoch`, `seal_height`. It is
   not a key delivery. Seed and salt stay with the miner (see `GAME.md` "The
   memo, honestly").
3. Traits are unknowable until the epoch seals. After seal, only the holder
   (who has the keyfile) can open. Rank/tier is public from the bids.
4. After patience (in blocks) is served and the epoch is sealed, they reveal.
   The sprite derives from `(seed, secret, score, epochSeal)`.

An observer sees: a hash went up, an encrypted receipt may have come back, and
later a punk existed. The seal — not the memo — is what keeps the punk secret.

**That is the "oh shit" beat, and none of it is theatre.** Encrypted memos are
a standard Zcash feature. You are using them as a wallet-native status
channel, not as a backdoor for the treasury to hold openings.

### Trust model (do not invert)

| who | generates seed/salt | can open the commitment |
|---|---|---|
| miner | yes | yes (owns the keyfile) |
| treasury | no | only if miner voluntarily shared a copy |
| observer | no | no |

v1 docs described the treasury as the source of seed/salt while `miner.py`
generated them locally. That contradiction is closed: memo is a receipt.

### One thing that will bite you

ZODL generates a **new shielded address every time the Receive screen opens**,
drawn from the unified address pool, specifically to prevent address reuse.

So **do not key ownership to an address string.** It rotates by design, and a
holder who reopens their wallet would appear to be someone else.

Key ownership to the `secret` inside the commitment instead. The address is a
delivery route, not an identity. Bind the UA into the commitment preimage if
you want it attested — the chain still only ever sees the hash.

### What mandating does and does not buy

**Enforced by the protocol:** no shielded receiver, no memo receipt. The mint
still exists on chain (public `OP_RETURN`); the holder simply does not get a
wallet-native status ping. Opening material was never in the memo on v2.

**Not enforced:** what the holder does afterward. They can deshield, sell the
opening in a Telegram DM, post their secret publicly. Privacy is offered, never
imposed — and claiming otherwise in marketing is the kind of thing that ages
badly.

## For the dev

Light wallets speak to **lightwalletd**, being superseded by **Zaino**, the Rust
indexer from the Zingo team. **Zallet** is the new wallet/RPC daemon succeeding
the zcashd wallet, and together with zebrad and Zaino forms the **Z3 stack**.
Target Zaino/Zallet for anything new rather than zcashd, which is being retired.

Sending a memo programmatically means building a shielded output with memo
bytes set — `librustzcash` / `zcash_client_backend` is the library, and the
wallet-format survey at `zingolabs/zcash-wallet-formats` is the best map of how
the key types line up across implementations.
