/**
 * X1: testnet constants must never apply on mainnet.
 * Run: node js/tx/test_network_constants.mjs
 */
import {
  TREASURY_MAINNET,
  TREASURY_TESTNET,
  assertTreasuryForNetwork,
  constantsForNetwork,
} from "../config.js";

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
  assert(err, `expected throw (${needle})`);
  assert(String(err.message).includes(needle), err.message);
}

assert(constantsForNetwork("main").treasury === TREASURY_MAINNET);
assert(constantsForNetwork("test").treasury === TREASURY_TESTNET);
assert(constantsForNetwork("test").treasury.startsWith("tm"));
assert(constantsForNetwork("main").treasury.startsWith("t1"));

throws(() => assertTreasuryForNetwork(TREASURY_TESTNET, "main"), "testnet treasury");
throws(() => assertTreasuryForNetwork(TREASURY_MAINNET, "test"), "mainnet treasury");
throws(() => constantsForNetwork(""), "network required");
throws(() => constantsForNetwork("bogus"), "unknown network");

assertTreasuryForNetwork(TREASURY_TESTNET, "test");
assertTreasuryForNetwork(TREASURY_MAINNET, "main");

console.log("X1 network constants OK — testnet treasury blocked on mainnet");
