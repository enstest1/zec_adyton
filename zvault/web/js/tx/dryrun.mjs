#!/usr/bin/env node
/**
 * Operator N3 helpers — validate addresses against the node (S3).
 * Secrets: zvault/.dryrun-keys.json (gitignored).
 *
 *   node js/tx/dryrun.mjs validate
 *   node js/tx/dryrun.mjs gen-burner
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivKey } from "./keys.js";
import { addressFromPriv, confirmAddressWithNode } from "./address.js";
import { bytesToHex } from "./serialize.js";
import { TREASURY_TESTNET, constantsForNetwork } from "../config.js";
import { consensusBranchIdForNextBlock } from "./consensus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KEYPATH = join(__dirname, "../../../.dryrun-keys.json");
const RPC =
  process.env.ZCASH_RPC_URL || "https://zcash-testnet-zebrad.gateway.tatum.io";

async function rpc(method, params = []) {
  const body = JSON.stringify({ jsonrpc: "1.0", id: "dryrun", method, params });
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const j = await res.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return j.result;
}

const cmd = process.argv[2] || "validate";

if (cmd === "gen-burner") {
  const priv = generatePrivKey();
  const a = addressFromPriv(priv, "test");
  console.log(
    JSON.stringify(
      { address: a.address, priv_hex: bytesToHex(priv), tag: a.tagHex },
      null,
      2
    )
  );
  process.exit(0);
}

if (cmd === "validate") {
  const info = await rpc("getblockchaininfo");
  console.log("chain", info.chain, "height", info.blocks);
  console.log("constants", constantsForNetwork(info.chain));
  console.log(
    "nextblock branch",
    "0x" + consensusBranchIdForNextBlock(info).toString(16)
  );

  const keys = existsSync(KEYPATH)
    ? JSON.parse(readFileSync(KEYPATH, "utf8"))
    : null;
  try {
    console.log(
      "treasury validateaddress",
      await confirmAddressWithNode(TREASURY_TESTNET, rpc)
    );
  } catch (e) {
    console.log("treasury validateaddress FAILED", e.message);
  }
  if (keys?.burner?.address) {
    try {
      console.log(
        "burner validateaddress",
        await confirmAddressWithNode(keys.burner.address, rpc)
      );
    } catch (e) {
      console.log("burner validateaddress FAILED", e.message);
    }
  } else {
    console.log("no .dryrun-keys.json burner — skip");
  }
  process.exit(0);
}

console.error("usage: dryrun.mjs validate|gen-burner");
process.exit(1);
