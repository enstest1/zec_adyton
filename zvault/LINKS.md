# LINKS

## Zcash — the track this project is on

- **Zcash docs** — https://zcash.readthedocs.io
- **ZIPs (protocol specs)** — https://zips.z.cash
  - ZIP 316 — Unified Addresses
  - ZIP 226 / 227 — Shielded Assets (audited, testnet, NU7 candidate)
  - ZIP 231 — memo bundles
  - ZIP 307 — light client protocol
  - ZIP 312 — FROST threshold signatures
- **zcashd** — https://github.com/zcash/zcash (being retired)
- **Zebra** — https://github.com/ZcashFoundation/zebra
- **librustzcash** — https://github.com/zcash/librustzcash
- **Wallet format survey** — https://github.com/zingolabs/zcash-wallet-formats
- **Zingo / Zaino** — https://zingolabs.org
- **ZODL** (ex-Zashi) — https://zodl.com
- **zcash.school** — https://zcash.school — clearest plain-language explainer
- **ZecHub** — community wiki

**Z3 stack:** zebrad + Zaino + Zallet. Target these, not zcashd.

## ZK tooling — only needed for selective disclosure

- **Circom** — https://docs.circom.io — mind `<--` vs `<==`, that distinction
  is how circuits end up under-constrained
- **snarkjs** — https://github.com/iden3/snarkjs
- **circomlib** — https://github.com/iden3/circomlib

## EVM track — only if you take the ZKsync route

- **ZKsync docs** — https://docs.zksync.io
- **zksolc** — plain solc will not work; Era compiles to EraVM, not EVM
- **hardhat-zksync** — `@matterlabs/hardhat-zksync`
- **foundry-zksync** — separate fork
- **Explorer** — https://explorer.zksync.io
- **Foundry book** — https://book.getfoundry.sh

ecPairing is available on Era alongside ecAdd and ecMul at `0x06`/`0x07`/`0x08`,
so Groth16 verification works. Era has native account abstraction and a
different gas schedule — read "EVM differences" first.

## Front end

- **viem** — https://viem.sh
- **wagmi** — https://wagmi.sh

## The meta — worth reading as case studies

- **Hashcats** — https://hashcats.fun (Robinhood Chain, fully on-chain art,
  reflexive token loop, currently stalled)
- **Hashpunks** — https://hashpunks.fun (Arc, fixed difficulty staircase,
  simplest design in the meta)
- **DefiLlama: Hashcats** — https://defillama.com/protocol/hashcats — watch the
  mint rate against the buyback

Read Hashcats' stall before setting your own price curve. Its price climbs
forever by construction; ours tops out on purpose.
