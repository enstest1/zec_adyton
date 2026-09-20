# ADVERSARIAL — independent review (findings only)

Reviewer: separate pentester session that did not author this tree.
Date: 2026-09-19. **No fixes applied from this review.**

## Critical

1. **Rejected underpaid mints can create and timeout-seal empty epochs.**
   `apply_mint` opens an epoch before the payment check. An underpaid but
   valid-PoW record leaves `members=[]`; timeout later seals it. That advances
   epoch numbering / pricing without a mint.
2. **Variable-length secret/seed partitions.** `build_commitment` concatenates
   without length prefixes; `apply_reveal` does not require 32-byte fields.
   Multiple (secret, seed) splits of the same 64 bytes can match one commitment
   and yield different `traitHash` values after seal — post-seal trait shopping.

## High

3. **Pay-then-reject remains possible** when the open epoch (hence floor)
   changes between grind and inclusion; also challenge expiry, supply cap,
   duplicate commitment, malformed records.
4. **Seal-block miner** can withhold a candidate block after computing
   seal/tiebreaks/own traits (cost: block reward). SPEC already notes this.
5. **No reorg handling** in `chain.py watch` / indexer height machine.
6. **Digest is not full-state:** reveals are off-chain; two indexers on the
   same blocks can diverge after local `apply_reveal`; digest omits much
   unsealed state.
7. **Opening not exclusive / not proven at mint:** anyone with the opening
   can reveal; lost keyfile ⇒ permanently sealed; no proof of opening at mint.

## Medium / info

8. Miner `verify` does not check version/kind/caps.
9. `chain.py` takes only the first ZVLT output per tx.
10. Placeholder `TREASURY` / `LAUNCH_HEIGHT` (now single-sourced from indexer
    into chain import — still placeholder values).

Self-test was green and does not cover empty-epoch mutation, variable-length
openings, or reorgs.
