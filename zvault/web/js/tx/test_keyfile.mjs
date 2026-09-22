/**
 * T8 keyfile funds warning + fresh-session recovery.
 * Run: node js/tx/test_keyfile.mjs
 */
import {
  KEYFILE_FUNDS_WARNING,
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

const kf = buildKeyfile({
  commitment: "aa".repeat(32),
  secret: "bb".repeat(32),
  seed: "cc".repeat(32),
  salt: "dd".repeat(32),
  tag: "ee".repeat(20),
  burner: {
    priv_hex: "11".repeat(32),
    address: "tmTestBurnerAddress000000000000000",
  },
  reveal_return_address: "tmReturnAddress0000000000000000000",
});
assert(/FUNDS/i.test(kf.warning));

// Fresh session: only the JSON blob — no tab state.
const rec = recoverFromKeyfile(JSON.parse(JSON.stringify([kf])));
assert(rec.canAbandonSweep, "abandon from keyfile alone");
assert(rec.canReveal, "reveal openability from keyfile alone");
assert(rec.canRevealWithChange, "reveal+change destination from keyfile alone");
assert(rec.revealReturnAddress.startsWith("tm"));
assert(rec.burnerPrivHex.length === 64);

throws(() => recoverFromKeyfile({ secret: "x" }), "FUNDS");
throws(
  () =>
    recoverFromKeyfile({
      warning: KEYFILE_FUNDS_WARNING,
      secret: "x",
      seed: "y",
    }),
  "openability"
);

console.log("T8 keyfile OK — funds warning + fresh-session abandon/reveal recovery");
