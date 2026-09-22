# MARKETPLACE.md — UTXO-bound ownership research (no protocol change)

Research only. No indexer / wire / mint-page code was changed for this
document. The architectural choice is the owner's.

**Question.** Should a *revealed* ZVAULT punk conform to a UTXO-bound NFT
standard so existing Zcash marketplaces can list and settle it, while ZVAULT
still governs the mint game?

---

## B1 — Is there a stable ZRC-721 / zerdinals NFT spec?

### What exists today (public, readable)

**ZRC-721** is published as an open inscription standard:

- Spec: https://zatoshi.gitbook.io/zrc/721  
  (markdown mirror: https://zatoshi.gitbook.io/zrc/721.md)
- Stated model (quote):

  > "Each mint inscription *is* the NFT (supply is always 1), so there is no
  > transfer operation beyond moving the inscription itself."

  > "**Transfer model**: No `transfer` inscription is specified. The mint
  > inscription itself is the NFT; moving the inscription UTXO moves the NFT."

Ops are only `deploy` and `mint` (UTF-8 JSON, `p: "zrc-721"`). Metadata is
off-chain IPFS under a deploy-time `meta` CID. Optional `royalty` is a
**hint** for marketplaces, not consensus.

Related fungible sibling: **ZRC-20** at https://zatoshi.gitbook.io/zrc
(deploy / mint / transfer inscriptions; ownership also follows inscription
UTXOs).

### Zerdinals / bitcoinuniverse docs status

The repo the user named still exists:

- https://github.com/bitcoinuniverseio/docs-zerdinals-and-zrunes  
  Homepage: https://bitcoinuniverseio.github.io/docs-zerdinals-and-zrunes/

As of this research pass (2026-09-20):

- **0 open PRs**, 128 closed — the "open documentation PRs" era appears to
  have closed into a shipped docs site, not an unfinished PR queue.
- The docs site README / status page still describes product readiness in
  fail-closed terms (e.g. a September repair candidate marked **NO-GO**
  pending authority and user-journey validation). Treat that as *product*
  readiness, not as "the JSON envelope is undefined."
- Live explorers (zerdinals.com, zcashrocks.xyz, Zeccats press) already speak
  of Zerdinals / ZRC-721 collections in production language.

### Plain answer on "stable"

| Layer | Status |
|---|---|
| **ZRC-721 envelope text** (deploy/mint JSON, UTXO = ownership) | **Public and usable** via zatoshi.gitbook.io — enough to conform to or reject deliberately |
| **Single canonical "Zerdinals NFT ZIP"** with conformance vectors | **Not found** as a Final ZIP; ecosystem is gitbook + competing indexers |
| **Indexer interoperability** | Still fragmented (forum grants note bespoke indexers; ZPAD-20 grant argues there is no shared conformance-tested indexing standard for Zcash inscriptions) |

**Verdict for B1:** There *is* a published ZRC-721 spec you can point at.
There is *not* a single Final, ZIP-numbered, vector-locked NFT consensus the
way ZIP 244 is Final for sighash. Conforming means "match the gitbook +
whatever indexers zcash.ink / zerdinals actually run," which can still drift.
Conforming to an unwritten or multi-indexer standard is worse than not
conforming — but ZRC-721 itself is written enough that "we refuse it" or
"we emit it at reveal" are both real options.

---

## B2 — What do zcash.ink and zebra.family require?

### zcash.ink (https://zcash.ink)

Public site copy (fetched 2026-09-20):

- Indexes **zOrdinals**, **ZRC-20**, and **ZRC-721** from transparent chain
  data (OP_RETURN envelopes). Ownership = the output that carries the token.
- Marketplace claims **no off-chain order book / no custodial escrow**; sales
  settle as chain transactions; buyers pay a **2% marketplace fee** as an
  output in the purchase tx (sellers receive ask).
- **Launch a collection:** "Publish your own NFT collection for a **0.025 ZEC
  system fee** and mint items immediately."
- Spec link is advertised on-site ("Read the spec — envelope format, chunking
  rules, sale settlement"), but the crawled `/spec` and `/launch` paths were
  not separately fetchable in this pass — treat the homepage + ZRC-721 gitbook
  as the public surface.

**Third-party collections:** Site language is permissionless indexing of
on-chain ZRC-721 deploys/mints, plus a paid launch flow. There is **no public
"submit your foreign protocol for review" form** documented. A ZVAULT-native
`ZVLT` OP_RETURN will **not** appear unless they add a custom indexer adapter.
To list *as them*, the asset almost certainly must be a recognizable ZRC-721
(or zOrdinal) inscription UTXO.

**Caveat:** Homepage also showed `indexed to block 0 / tip 0` at fetch time —
indexer health / completeness is not assumed here.

### zebra.family (https://zebra.family)

Public site copy:

- Browser wallet, local keys, IPFS CID + media type inscribed in a Zcash tx.
- **Trade peer-to-peer:** "Listings are **partially signed offers**. The buyer
  completes and broadcasts — no escrow contract."
- No public developer doc path (`/docs` not found). No statement that arbitrary
  third-party protocols can be submitted. Inscription = their envelope on a
  UTXO they understand.

**B2 summary:** Both venues are built around **inscription UTXO ownership**
(ZRC-721 / ordinal-style), not address-bound indexer state. Neither publishes
a clear "bring your own meta-protocol" API. Liquidity for a foreign `ZVLT`
record is approximately zero on these sites today.

---

## B3 — Cost of conformance for ZVAULT

### Reveal authority today

ZVAULT reveal requires a transparent in/out whose hash160 matches the mint's
**`minerTag`** (original minting tag). Buyer ≠ minter ⇒ buyer cannot reveal
under current rules.

**If ownership becomes UTXO-bound after (or at) reveal:**

1. **Reveal must authorize the current holder of the inscription UTXO**, not
   the historical minter address alone.
2. Exact change set (conceptual — not implemented here):
   - At mint: either (i) keep ZVAULT mint wire as-is and **emit a separate
     ZRC-721 mint inscription UTXO** only at reveal, or (ii) dual-write at mint
     time (harder: art/traits unknown pre-seal).
   - At reveal: indexer checks that the reveal tx **spends or is signed by the
     current owner of the bound UTXO** (or that minerTag was updated by UTXO
     lineage). Tag-witness = "holder of this outpoint," not "hash160 equals
     mint-time tag."
   - Sealed-but-unrevealed secondary sales need a defined object: either the
     sealed box is non-transferable until reveal (v1 today), or a sealed
     commitment UTXO exists that can move before open.

### Can the 74-byte mint ride a UTXO without changing wire / PoW?

**PoW and the 74-byte `ZVLT` mint record can stay byte-identical.** UTXO binding
is a property of *which output carries which bytes*, not of the PoW fields.

Practical options:

| Approach | Wire / PoW | Notes |
|---|---|---|
| Keep ZVAULT mint; at reveal also inscribe ZRC-721 `mint` JSON on a dust UTXO | Unchanged mint | Dual artifact: game state in ZVAULT indexer, tradeable NFT is the inscription |
| Put ZVAULT payload *inside* an inscription envelope the marketplaces already parse | Likely format change | Loses "our" 74-byte discipline unless envelope wraps it |
| Only ZRC-721 after reveal; ZVAULT indexer forgets ownership | Mint unchanged | Marketplaces never see sealed boxes |

None of these require altering the PoW equation. They *do* require a second
on-chain object marketplaces can see.

### Do we still need a transfer wire format?

Under pure UTXO-bound ZRC-721: **no `KIND_TRANSFER` wire** — ownership follows
inscription spends (lineage). That can **remove a launch blocker** for
*post-reveal* liquidity.

It does **not** automatically give sealed-box trading. Sealed ZVAULT state is
still address/tag-bound unless you also invent a sealed-box UTXO.

### Seal / rank / tier logic

**Expected unbroken:** epochs, seals, scores, ranks, tiers, traitHash all key
off commitment + seal + bid fields. Ownership transfer is orthogonal if it
happens after seal (and especially after reveal).

**Must not break:** reveal timing (`patience`, seal-before-reveal). Only the
*who may reveal* check changes.

### Sighash / atomic PSBT-style swaps (load-bearing)

**Status (2026-09-22): DIGEST VERIFIED, MEMPOOL UNVERIFIED.**

Verified against **ZIP 244** (Final; NU5+ v5 transparent sighash) and
**ZIP 243** (Sapling-era):

- Transparent sighash types include `SIGHASH_SINGLE` (`0x03`) and
  `SIGHASH_SINGLE | SIGHASH_ANYONECANPAY` (`0x83`), same family as Bitcoin's
  script flags: https://zips.z.cash/zip-0244
- ZIP 244 **reuses** those encodings and documents ANYONECANPAY / SINGLE
  digest construction for transparent inputs.
- Our JS implementation matches the official `zcash-test-vectors` zip_0244
  cases for `sighash_single_anyone` (digest only) — see
  `web/js/tx/test_zip244.mjs`.
- Important Zcash-specific tightening: for v5, `SIGHASH_SINGLE` **without a
  corresponding transparent output at the same index must fail validation**
  (not silently hash empty outputs). See ZIP 244 and Zebra advisory
  GHSA-pvmv-cwg8-v6c8.

**Not yet proven on a live mempool:** broadcasting a real funded transaction
signed with `0x83` and recording a txid. Until that txid exists in
`TESTNET.md`, do **not** treat "PSBT-style buyer-completes works on Zcash v5"
as an operational fact — only as a documented digest algorithm that our
vectors pass. Wallet and marketplace tooling still have to implement the
flags correctly.

**Conclusion (downgraded):** ZIP 244 **defines** `SIGHASH_SINGLE|ANYONECANPAY`
(`0x83`) and our vectors match that digest construction. That is **not** the
same as "PSBT-style buyer-completes works on live Zcash v5." **Live mempool
acceptance of `0x83` spends is unverified** until a testnet txid is recorded
in `TESTNET.md`. Do not build a launch or marketplace recommendation on the
unverified half.

---

## B4 — Paths and recommendation

### (a) Conform to a UTXO-bound standard (ZRC-721 at reveal)

**Gain:** Existing marketplace indexers can list/settle; secondary floor can
exist without building escrow; transfer wire may be unnecessary post-reveal.

**Cost:** Reveal authority must follow **current UTXO owner**; dual artifact or
reveal-time inscription; ZVAULT sealed game stays custom; royalty still only a
hint; you inherit indexer fragmentation and inscription-wallet footguns
(spending the dust UTXO burns the NFT).

### (b) Build our own marketplace

**Gain:** Settlement fee = only realistic **recurring** revenue (Zcash cannot
enforce royalties). Full control of sealed + revealed UX.

**Cost:** Larger product than the mint; you become the liquidity venue and
the trust surface. Competing with sites that already speak ZRC-721.
**Do not** plan (b) around `SIGHASH_SINGLE|ANYONECANPAY` / partial-sign
offers until a live `0x83` txid exists — that path is digest-verified only.

### (c) Ship v1 as-is (no transfers) — current READY posture

**Gain:** Protocol stays honest and small; launch blockers remain owner
constants only (`LAUNCH_HEIGHT`, `TREASURY`); no half-compatible NFT.

**Cost:** No secondary floor; marketplaces cannot read `ZVLT`; patience/money
story has no exit liquidity until a later decision.

### Recommendation (research stance, not a commit)

Recommendations below rest only on **verified** facts (published ZRC-721
text, ZVAULT ownership = minting address, no v1 transfer). They do **not**
assume live partial-sign / `0x83` mempool acceptance.

1. **Do not pretend ZVAULT mints are ZRC-721 today** — they are not; listing
   will fail silently on those indexers.
2. **Do not block v1 launch on marketplace conformance** — the published
   ZRC-721 text is enough to *plan* against, but dual-write + reveal rework is
   a product cut, not a one-line switch.
3. If secondary liquidity is a near-term goal after mint: prefer **(a) emit
   ZRC-721 at reveal** (mint game stays ZVAULT; tradeable object is standard)
   over building (b) first — unless the settlement fee thesis is the business.
   Treat zebra.family-style partially signed offers as a **later** option after
   a live `0x83` proof, not as a reason to choose (b) now.
4. Keep **(c) for the immediate launch** if the only remaining blockers are
   owner constants; revisit (a) as an explicit version once reveal UX is real.

The owner decides. This file is the brief; it is not a protocol change.
