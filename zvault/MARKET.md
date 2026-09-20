# MARKET — what's already out there

Research behind the design decisions. Not deliverables, but it explains why the
project looks the way it does, and it will save your dev re-deriving it.

---

## The PoW-mint meta

### Hashcats — Robinhood Chain

The maximalist one. 16,384 pixel cats with image, traits and palette in
contract storage. Price is derived rather than chosen: cats minted so far times
a fixed step. Each mint is split between rent to every living cat and a hook
that spends 70% of receipts buying back and burning $HASH. Burning a cat mints
1,000 $HASH, halving each epoch. Uniswap V4 hook with a launch defence — swap
fee opens at 50% and decays to 2.5% over ten minutes.

**It stalled.** Roughly 9,100 of 16,384 with mints well below target pace, and
41% of $HASH supply burned but the buyback weakening as minting slowed.

**Why it matters:** the loop is reflexive. The token needs continuous mining to
hold value; mining needs the token to hold value. When one slows the other
follows. And price climbing linearly forever means it eventually prices out its
own miners — which is exactly what the mint-rate chart shows.

### Hashpunks — Arc Mainnet 5042

The clean one, and the closest reference for our build. Browser mines a
Keccak-256 proof tied to wallet and the latest onchain challenge; contract
verifies and assigns one unused punk. Difficulty is a fixed staircase — 31 bits
for #1–50, 32 for #51–100, 33 for #101–200, 34 for #201–500, 35 from #501 on.
Price staircases in parallel, 0.25 USDC to 48 USDC. No token, no rent, no hook.
Art off-chain on permanent links.

**Why it matters:** nothing to unwind. Fewer moving parts, less to break. But a
fixed staircase means a farm *can* blitz early supply — Hashcats retargets to
prevent that and pays for it with the stall dynamic. Pick your failure mode
deliberately.

Also: it renders punks in advance, so whoever holds that folder knows the
collection before the market does. Our generator derives instead, which removes
that entirely.

### Others in the meta

Hashfrogs, Hashbroker, Microhashers. Hashbroker blocks automated access;
Microhashers is JS-rendered and runs on fly.dev. Not reviewed in depth.

---

## On mining these yourself

Short version: don't, and definitely don't build the business case on it.

PoW mints arbitrage EV to zero by construction. Difficulty retargets on mint
rate, so any profitable gap pulls in hash until it closes. Anyone calling a
collection "EV+" is describing a window that already shut — and the Hashcats
slowdown *is* the market saying mining is unprofitable at current price.

Renting hash makes it worse. You pay retail spot; your competition owns
hardware and pays marginal electricity. You need the trade to clear a hurdle
they don't have.

This matters for **our** design too: it is the reason the price staircase tops
out instead of climbing forever, and the reason to benchmark real hashrate
against real difficulty before launch rather than after.

---

## Zcash context

### zkSNARKs (@zksnarks_)

8,000 encrypted identities on Zcash. Blind uniform-price auction cleared at
1.5 ZEC from 16,971 bids, 25,305 ZEC volume, closed 17 September 2026.
Bids and refunds ran through shielded transactions so neither amounts nor
identities were visible. 10,000 total: 8,000 auctioned, 1,000 SNARKLIST,
1,000 treasury. NEAR Intents integrated so bidders could settle in ZEC from
ETH, SOL or stablecoins. Marketplace is Zilkroad.

**Named after the cryptography, not a chain.** There is no "zkSNARKs chain" —
easy to misread, and we did at first.

### ZHash (@zec_hash)

"Proof of Work on Zcash // launch soon." Joined September 2026, ~190 followers,
pinned post is a terminal mockup. No contract, no docs, no repo, no mechanism
disclosed. Nothing has shipped.

Worth watching for exactly one thing: **how they handle the no-VM problem.** Is
there a contract address anywhere? Where do mint records live — chain, or their
database? Can a third party verify someone else's mint? Whatever they do
becomes the template for this meta on Zcash.

---

## The chain investigation

We went through three candidates before landing. Recording it so nobody repeats
the loop:

**Arc Mainnet (chain 5042)** — Circle's EVM L1, Malachite BFT, sub-second
finality. **Not a ZK chain at all.** USDC is the gas token, and native value
fields use 18 decimals while the ERC-20 interface at `0x3600…0000` uses 6 —
a real footgun. Public mainnet launched 16 September 2026; Circle's RPC
reference still lists mainnet endpoints as permissioned. Testnet chain ID is
5042002, not the 1516 several registries carry, and
`wallet_switchEthereumChain` fails silently in MetaMask — use
`wallet_addEthereumChain` for both add and switch.

**ZKsync Era (chain 324)** — viable for the EVM build. ecPairing is now
available alongside ecAdd and ecMul at `0x06`/`0x07`/`0x08`, so Groth16
verification works. But needs `zksolc` (plain solc won't do — Era compiles to
EraVM), has native account abstraction, a different gas schedule, and
`create`/`create2` requiring bytecode hashes known at compile time.

**Zcash** — where we landed. No VM, which is the entire reason the Zcash build
looks the way it does. See `DECIDE.md`.

**The naming trap:** "zk" means both the cryptography (what Zcash uses
internally, what our circuits do) and a family of unrelated chain names
(ZKsync, zkEVMs). They are not connected. zkSNARKs the collection is on Zcash.
