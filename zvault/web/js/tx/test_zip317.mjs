/**
 * T3 + C2 fee tests.
 * Run: node js/tx/test_zip317.mjs
 */
import {
  MARGINAL_FEE,
  conventionalFeeZat,
  mintFeeZat,
  mintFeeFromTxInBytes,
  opReturnOutputSize,
  revealFeeZat,
  revealFeeFromTxInBytes,
  P2PKH_OUTPUT_SIZE,
  p2pkhInputSize,
  dustThresholdZat,
  shouldIncludeChangeOutput,
} from "./zip317.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert");
}

assert(opReturnOutputSize(74) === 85, "opret 74");
assert(opReturnOutputSize(42) === 53, "opret 42");
assert(mintFeeZat(1) === 25_000, `mint 1-in=${mintFeeZat(1)}`);
assert(mintFeeZat(2) === 25_000, "mint 2-in");
// C2: 6 inputs × 150 = 888 → 6 logical actions → 30_000
assert(mintFeeFromTxInBytes(888) === 30_000, `6-in mint fee=${mintFeeFromTxInBytes(888)}`);
assert(revealFeeZat({ withChange: true }) === 30_000, "reveal+change");
assert(revealFeeZat({ withChange: false }) === 25_000, "reveal no change");
assert(revealFeeFromTxInBytes(150, true) === 30_000, "reveal 1-in bytes");

const wrongCountFee = MARGINAL_FEE * 3;
assert(mintFeeZat(1) > wrongCountFee, "size-based > naive count");

assert(dustThresholdZat(P2PKH_OUTPUT_SIZE) === 162, `dust=${dustThresholdZat(34)}`);
assert(!shouldIncludeChangeOutput(100), "100 zat is dust");
assert(shouldIncludeChangeOutput(200), "200 zat ok");

console.log(
  "T3/C2 ZIP 317 OK —",
  `mint 1-2in=${mintFeeZat(1)}; mint 6in=${mintFeeFromTxInBytes(888)};`,
  `reveal+change=${revealFeeZat({ withChange: true })}`
);
