/**
 * T8 keyfile — two-stage funds then mint; fresh-session recovery.
 * Run: node js/tx/test_keyfile.mjs
 */
import {
  KEYFILE_FUNDS_WARNING,
  KEYFILE_STAGE_FUNDS,
  KEYFILE_STAGE_MINT,
  buildKeyfile,
  recoverFromKeyfile,
} from "./keyfile.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert");
}

function throws(fn, needle) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert(err && String(err.message).includes(needle), err?.message);
}

assert(/FUNDS/i.test(KEYFILE_FUNDS_WARNING));

// --- Stage 1: funds only (recover spend without tab state) ---
const fundsKf = buildKeyfile({
  stage: KEYFILE_STAGE_FUNDS,
  network: "test",
  burner: {
    priv_hex: "11".repeat(32),
    address: "tmTestBurnerAddress000000000000000",
    tag: "ee".repeat(20),
  },
  tag: "ee".repeat(20),
  reveal_return_address: "tmReturnAddress0000000000000000000",
  funding_zat: 265000,
});
const fundsRec = recoverFromKeyfile(JSON.parse(JSON.stringify([fundsKf])));
assert(fundsRec.stage === KEYFILE_STAGE_FUNDS);
assert(fundsRec.canAbandonSweep, "stage1 abandon from keyfile alone");
assert(!fundsRec.canReveal, "stage1 must not claim reveal");
assert(fundsRec.burnerPrivHex.length === 64);

// --- Stage 2: mint (replace stage1) ---
const mintKf = buildKeyfile({
  ...fundsKf,
  stage: KEYFILE_STAGE_MINT,
  commitment: "aa".repeat(32),
  secret: "bb".repeat(32),
  seed: "cc".repeat(32),
  salt: "dd".repeat(32),
  nonce: "12345",
  work: 4,
  patience: 0,
  burn: 0,
  money: 0,
});
const mintRec = recoverFromKeyfile(JSON.parse(JSON.stringify([mintKf])));
assert(mintRec.stage === KEYFILE_STAGE_MINT);
assert(mintRec.canAbandonSweep);
assert(mintRec.canReveal);
assert(mintRec.canRevealWithChange);
assert(mintRec.canMintSign);

throws(() => recoverFromKeyfile({ secret: "x" }), "FUNDS");
throws(
  () =>
    recoverFromKeyfile({
      warning: KEYFILE_FUNDS_WARNING,
      stage: KEYFILE_STAGE_MINT,
      secret: "x",
      seed: "y",
    }),
  "openability"
);

console.log(
  "T8 keyfile OK — funds warning + stage1/stage2 fresh-session recovery"
);
