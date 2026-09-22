/**
 * T1 tests: consensus branch id is runtime-only; missing fields fail loudly.
 * Run: node js/tx/test_consensus.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  consensusBranchIdForNextBlock,
  fetchConsensusBranchId,
  parseBranchId,
} from "./consensus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function throws(fn, needle) {
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert(err, `expected throw: ${needle}`);
  assert(
    String(err.message).includes(needle),
    `expected message to include "${needle}", got: ${err.message}`
  );
}

// --- parse ---
assert(parseBranchId("c2d6d0b4") === 0xc2d6d0b4, "hex");
assert(parseBranchId("0xC2D6D0B4") === 0xc2d6d0b4, "0x hex");
assert(parseBranchId(0xc2d6d0b4) === 0xc2d6d0b4, "number");
throws(() => parseBranchId(""), "empty");
throws(() => parseBranchId("zz"), "not hex");
throws(() => parseBranchId(-1), "u32");

// --- nextblock extraction ---
assert(
  consensusBranchIdForNextBlock({
    consensus: { chaintip: "aaaaaaaa", nextblock: "c2d6d0b4" },
  }) === 0xc2d6d0b4,
  "nextblock"
);

throws(() => consensusBranchIdForNextBlock(null), "missing");
throws(() => consensusBranchIdForNextBlock({}), "consensus missing");
throws(
  () => consensusBranchIdForNextBlock({ consensus: { chaintip: "c2d6d0b4" } }),
  "nextblock missing"
);
throws(
  () =>
    consensusBranchIdForNextBlock({
      consensus: { nextblock: null },
    }),
  "empty"
);
throws(
  () =>
    consensusBranchIdForNextBlock({
      consensus: { nextblock: "" },
    }),
  "empty"
);

// Unknown / garbage nextblock must not silently become a default
throws(
  () =>
    consensusBranchIdForNextBlock({
      consensus: { nextblock: "not-a-branch" },
    }),
  "not hex"
);

// --- fetch path requires injected RPC (no hardcoded URL / constant) ---
{
  let err;
  try {
    await fetchConsensusBranchId(null);
  } catch (e) {
    err = e;
  }
  assert(err && String(err.message).includes("rpcCall"), "rpcCall required");
}

let called = false;
const id = await fetchConsensusBranchId(async (method) => {
  called = true;
  assert(method === "getblockchaininfo", "method");
  return { consensus: { nextblock: "0xefc52e66" } };
});
assert(called, "rpc was invoked");
assert(id === 0xefc52e66, "fetched id");

// Structural: this module must not embed a fallback branch constant.
const src = readFileSync(join(__dirname, "consensus.js"), "utf8");
assert(!/0xc2d6d0b4/i.test(src), "no hardcoded NU5 id in consensus.js");
assert(!/DEFAULT_.*BRANCH/i.test(src), "no DEFAULT_BRANCH");

console.log("T1 consensus OK — runtime nextblock only; missing/unknown fail loud");
