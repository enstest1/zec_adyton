/**
 * C2/C3/T5 planning tests.
 * Run: node js/tx/test_plan.mjs
 */
import {
  planMintSign,
  planRevealSign,
  planAbandonSweep,
  assertRevealAffordableFromBurnerChange,
} from "./plan.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert");
}

function throws(fn) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert(err, "expected throw");
}

const six = Array.from({ length: 6 }, () => ({ valueZat: 100_000, txInSize: 150 }));
const mint6 = planMintSign({ utxos: six, payZat: 200_000 });
assert(mint6.feeZat === 30_000, `6-in fee=${mint6.feeZat}`);
assert(mint6.inputSum === 600_000);

const one = [{ valueZat: 300_000, txInSize: 150 }];
const mint1 = planMintSign({ utxos: one, payZat: 200_000 });
assert(mint1.feeZat === 25_000);
assert(mint1.changeZat === 75_000);

throws(() => planMintSign({ utxos: one, payZat: 500_000 }));

const reveal = planRevealSign({ utxos: [{ valueZat: 80_000, txInSize: 150 }] });
assert(reveal.feeZat === 30_000);
assert(reveal.changeToUser === true);
assert(reveal.changeZat === 50_000);

const afterMint = assertRevealAffordableFromBurnerChange(mint1);
assert(afterMint.feeZat === 30_000);

const abandon = planAbandonSweep({
  utxos: [{ valueZat: 300_000, txInSize: 150 }],
});
assert(abandon.sendZat > 0 && abandon.feeZat === 10_000, `abandon 1-in fee=${abandon.feeZat}`);

console.log("C2/C3/T5 plan OK — 6-in mint 30k; reveal change to user; abandon sweep");
