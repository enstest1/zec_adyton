// ALTERNATIVE NOT TAKEN (2026-09-22) — see evm/README.md. Not part of ZVAULT v1.
pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/mux1.circom";

/*
 * SQRT RATIO
 *
 * Computes floor(sqrt(x * 1e12 / max)) without dividing or rooting inside the
 * circuit. Both are expensive; verification is not.
 *
 * The prover supplies the answer as a witness and the circuit checks it is the
 * unique correct one by squaring:  s^2 <= v < (s+1)^2.
 * Two multiplications and two comparisons, instead of an iterative solver.
 *
 * This is the concavity that keeps whales advantaged but not decisive. Ten
 * times the input yields ~3.16x the contribution.
 */
template SqrtRatio(MAX) {
    signal input x;          // the miner's bid on this axis
    signal input sqrtHint;   // witness: claimed floor(sqrt(scaled))
    signal output out;       // 0 .. 1_000_000

    // Clamp: past the ceiling, extra spend buys literally nothing.
    component atCeiling = GreaterEqThan(64);
    atCeiling.in[0] <== x;
    atCeiling.in[1] <== MAX;

    // v = x * 1e12 / MAX, computed as a witness and checked by multiplication
    // so the circuit never performs a division.
    signal v;
    signal quotient;
    signal remainder;
    quotient <-- (x * 1000000000000) \ MAX;
    remainder <-- (x * 1000000000000) % MAX;
    x * 1000000000000 === quotient * MAX + remainder;

    component remOk = LessThan(64);
    remOk.in[0] <== remainder;
    remOk.in[1] <== MAX;
    remOk.out === 1;

    v <== quotient;

    // s^2 <= v
    signal sSquared;
    sSquared <== sqrtHint * sqrtHint;
    component lower = LessEqThan(128);
    lower.in[0] <== sSquared;
    lower.in[1] <== v;
    lower.out === 1;

    // v < (s+1)^2
    signal sPlus;
    sPlus <== sqrtHint + 1;
    signal sPlusSquared;
    sPlusSquared <== sPlus * sPlus;
    component upper = LessThan(128);
    upper.in[0] <== v;
    upper.in[1] <== sPlusSquared;
    upper.out === 1;

    // Select clamped value at the ceiling.
    component pick = Mux1();
    pick.c[0] <== sqrtHint;
    pick.c[1] <== 1000000000;
    pick.s <== atCeiling.out;

    out <== pick.out;
}

/*
 * MERKLE PROOF
 *
 * Standard Poseidon inclusion. The path indices are private, so the proof says
 * "a leaf I can open is in this tree" and never which one. That is the whole
 * anonymity set: an observer sees every mint's public inputs in the epoch log
 * but cannot bind any of them to the person revealing.
 */
template MerkleProof(DEPTH) {
    signal input leaf;
    signal input root;
    signal input pathElements[DEPTH];
    signal input pathIndices[DEPTH];

    component hashers[DEPTH];
    component leftMux[DEPTH];
    component rightMux[DEPTH];

    signal levelHash[DEPTH + 1];
    levelHash[0] <== leaf;

    for (var i = 0; i < DEPTH; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        leftMux[i] = Mux1();
        leftMux[i].c[0] <== levelHash[i];
        leftMux[i].c[1] <== pathElements[i];
        leftMux[i].s <== pathIndices[i];

        rightMux[i] = Mux1();
        rightMux[i].c[0] <== pathElements[i];
        rightMux[i].c[1] <== levelHash[i];
        rightMux[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== leftMux[i].out;
        hashers[i].inputs[1] <== rightMux[i].out;
        levelHash[i + 1] <== hashers[i].out;
    }

    root === levelHash[DEPTH];
}

/*
 * REVEAL
 *
 * Opens one sealed mint. Proves all of the following at once:
 *   - the commitment exists in the epoch's tree
 *   - the score is the correct weighted combination of the bound inputs
 *   - the traits derive deterministically from the sealed seed and the secret
 *   - the nullifier is bound to the secret, so a leaf opens exactly once
 *
 * Note what is NOT proven here: that the miner actually paid what they
 * committed to. That is enforced at mint, where the chain observed the payment
 * and the burn directly. The circuit only proves consistency with the leaf.
 */
template Reveal(DEPTH) {
    // ---- private
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

    // ---- public
    signal input root;
    signal output nullifier;
    signal output score;
    signal output traitHash;
    signal output patienceOut;

    // Rebuild the leaf exactly as the miner built it at mint time.
    component inputsA = Poseidon(2);
    inputsA.inputs[0] <== workBits;
    inputsA.inputs[1] <== patience;

    component inputsB = Poseidon(2);
    inputsB.inputs[0] <== burnAmount;
    inputsB.inputs[1] <== moneyMultiple;

    component inputHash = Poseidon(2);
    inputHash.inputs[0] <== inputsA.out;
    inputHash.inputs[1] <== inputsB.out;

    component ownerPart = Poseidon(2);
    ownerPart.inputs[0] <== secret;
    ownerPart.inputs[1] <== seed;

    component bidPart = Poseidon(2);
    bidPart.inputs[0] <== inputHash.out;
    bidPart.inputs[1] <== salt;

    component leaf = Poseidon(2);
    leaf.inputs[0] <== ownerPart.out;
    leaf.inputs[1] <== bidPart.out;

    component merkle = MerkleProof(DEPTH);
    merkle.leaf <== leaf.out;
    merkle.root <== root;
    for (var i = 0; i < DEPTH; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i] <== pathIndices[i];
    }

    // ---- scoring. Weights are compile-time constants, published and fixed.
    component sw = SqrtRatio(12);          // MAX_WORK_BITS
    sw.x <== workBits;
    sw.sqrtHint <== sqrtWork;

    component sp = SqrtRatio(16);          // MAX_PATIENCE
    sp.x <== patience;
    sp.sqrtHint <== sqrtPatience;

    component sb = SqrtRatio(5000);        // MAX_BURN, in whole tokens
    sb.x <== burnAmount;
    sb.sqrtHint <== sqrtBurn;

    component sm = SqrtRatio(4);           // MAX_MONEY
    sm.x <== moneyMultiple;
    sm.sqrtHint <== sqrtMoney;

    signal weighted;
    weighted <== 4000 * sw.out + 2500 * sp.out + 2500 * sb.out + 1000 * sm.out;

    // Divide by 10_000 by witness-and-check, as before.
    signal scoreQ;
    signal scoreR;
    scoreQ <-- weighted \ 10000;
    scoreR <-- weighted % 10000;
    weighted === scoreQ * 10000 + scoreR;

    component scoreRemOk = LessThan(32);
    scoreRemOk.in[0] <== scoreR;
    scoreRemOk.in[1] <== 10000;
    scoreRemOk.out === 1;

    score <== scoreQ;

    /*
     * Traits derive from the seed, the secret and the score together.
     *
     * Including the score means a higher bid genuinely shifts the distribution
     * rather than merely labelling the result. Including the secret means the
     * outcome was unknowable to everyone — including the miner — until this
     * proof was constructed. Nobody grinds for a specific punk.
     */
    component traits = Poseidon(3);
    traits.inputs[0] <== seed;
    traits.inputs[1] <== secret;
    traits.inputs[2] <== score;
    traitHash <== traits.out;

    component nul = Poseidon(2);
    nul.inputs[0] <== secret;
    nul.inputs[1] <== 1;     // domain separator: 1 = reveal, 2 = transfer
    nullifier <== nul.out;

    patienceOut <== patience;
}

component main {public [root]} = Reveal(20);
