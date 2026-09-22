/**
 * T4 + C1 funding tests.
 * Run: node js/tx/test_funding.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FUNDING_BUFFER_ZAT,
  assertBurnerFunded,
  formatZec,
  fundingAmount,
  fundingFromBid,
  payZatFromBid,
} from "./funding.js";
import { mintFeeZat, revealFeeZat } from "./zip317.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// --- C1: derived from floor + money, not constants ---
assert(payZatFromBid(200_000, 0) === 200_000);
assert(payZatFromBid(200_000, 12) === 200_000 * 13);

const f00 = fundingFromBid(200_000, 0);
assert(f00.totalZat === 265_000, `epoch0 money0=${f00.totalZat}`);
assert(fundingFromBid(200_000, 12).totalZat === 2_665_000, "money12");
assert(fundingFromBid(2_000_000, 0).totalZat === 2_065_000, "epoch16 floor");

assert(f00.totalZat !== fundingFromBid(500_000, 0).totalZat, "varies with floor");
assert(f00.totalZat !== fundingFromBid(200_000, 12).totalZat, "varies with money");

// Anti-hardcode: app.js must not embed 265000 as the funding total
const appSrc = readFileSync(join(__dirname, "../app.js"), "utf8");
assert(!/\b265_?000\b/.test(appSrc), "app.js must not hardcode 265000 funding");

const f = fundingAmount({ payZat: 200_000 });
assert(f.mintFeeZat === mintFeeZat(1));
assert(f.revealFeeZat === revealFeeZat({ withChange: true }));
assert(f.totalZat === 265_000);
assertBurnerFunded(265_000, f);
throws(() => assertBurnerFunded(200_000, f), "underfunded");

console.log(
  "T4/C1 funding OK —",
  `epoch0/m0 ${f00.totalZat}; m12 ${fundingFromBid(200_000, 12).totalZat};`,
  `epoch16 ${fundingFromBid(2_000_000, 0).totalZat}`
);
