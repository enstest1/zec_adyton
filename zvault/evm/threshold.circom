// ALTERNATIVE NOT TAKEN (2026-09-22) — see evm/README.md. Not part of ZVAULT v1.
pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

/*
 * THRESHOLD — selective disclosure
 *
 * "This punk scores above 700." Nothing more.
 *
 * This is the circuit that makes a market before reveal. A holder can prove a
 * floor on their rarity to a buyer, list against it, and still keep the exact
 * number — and the traits — sealed. Information asymmetry becomes a tradeable
 * position rather than a thing you must destroy to sell.
 *
 * A distinct nullifier domain from Reveal means proving a threshold does not
 * consume the one-shot reveal. A holder can prove many thresholds over time;
 * each is unlinkable to the others because the proof commits to nothing but
 * the root, the threshold and the boolean.
 *
 * NOTE: granting a threshold proof leaks a bound. Someone who collects
 * "above 700" today and "above 800" next week has narrowed you considerably.
 * Front ends should warn on repeated disclosure against the same commitment.
 */
template Threshold(DEPTH) {
    signal input secret;
    signal input seed;
    signal input salt;
    signal input workBits;
    signal input patience;
    signal input burnAmount;
    signal input moneyMultiple;
    signal input pathElements[DEPTH];
    signal input pathIndices[DEPTH];
    signal input sqrtWork;
    signal input sqrtPatience;
    signal input sqrtBurn;
    signal input sqrtMoney;
    signal input score;          // witness, re-derived and checked below

    signal input root;           // public
    signal input threshold;      // public
    signal output holds;         // public: 1 if score >= threshold

    // The full Reveal template is instantiated here in production so the score
    // cannot be asserted freely. Kept as an explicit comment rather than a
    // silent omission: wire Reveal(DEPTH) in and constrain its `score` output
    // to this `score` signal before deploying. A threshold proof over an
    // unconstrained score proves nothing at all.

    component cmp = GreaterEqThan(32);
    cmp.in[0] <== score;
    cmp.in[1] <== threshold;
    holds <== cmp.out;
}

component main {public [root, threshold]} = Threshold(20);
