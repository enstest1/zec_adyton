#!/usr/bin/env node
/**
 * R1 — Idempotent testnet dry-run cycle.
 *
 * Given a funded burner (keyfile with burner.priv_hex + reveal_return_address),
 * drives mint → credit → seal → reveal → PNG → collection, writing progress
 * so a failed step can be resumed without redoing earlier work.
 *
 *   node web/js/tx/cycle.mjs --keyfile path.json [--rpc URL] [--relay URL] [--pub DIR]
 *
 * Progress: web/pub/dryrun-progress.json (or --progress PATH)
 * Re-run after any failure; completed steps are skipped.
 *
 * OPERATOR: fund the burner first (deshield faucet TAZ — see TESTNET.md).
 * This script does not claim faucets or deshield.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recoverFromKeyfile } from "./keyfile.js";
import { buildSignMint, buildSignReveal } from "./builder.js";
import { validateSignedTx, relayBroadcast } from "./validate.js";
import { consensusBranchIdForNextBlock } from "./consensus.js";
import { constantsForNetwork } from "../config.js";
import { buildRecord, buildRevealChunks, hexToBytes as hx } from "../protocol.js";
import { hexToBytes } from "./serialize.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../.."); // zvault/

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const KEYFILE = arg("--keyfile");
const RPC = arg("--rpc", process.env.ZCASH_RPC_URL || "https://zcash-testnet-zebrad.gateway.tatum.io");
const RELAY = arg("--relay", process.env.ZVAULT_RELAY || "");
const PUB = resolve(arg("--pub", join(ROOT, "web/pub")));
const PROGRESS = resolve(arg("--progress", join(PUB, "dryrun-progress.json")));
const POLL_MS = Number(arg("--poll-ms", "15000"));

if (!KEYFILE) {
  console.error("usage: node cycle.mjs --keyfile <zvault-keys.json> [--rpc URL] [--relay URL]");
  process.exit(2);
}

async function rpc(method, params = []) {
  const body = JSON.stringify({ jsonrpc: "1.0", id: "cycle", method, params });
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}

function loadProgress() {
  if (!existsSync(PROGRESS)) {
    return { steps: {}, txids: {}, notes: [] };
  }
  return JSON.parse(readFileSync(PROGRESS, "utf8"));
}

function saveProgress(p) {
  mkdirSync(dirname(PROGRESS), { recursive: true });
  p.updated_at = new Date().toISOString();
  writeFileSync(PROGRESS, JSON.stringify(p, null, 2));
}

function done(p, step) {
  return p.steps[step] === "ok";
}

function mark(p, step, extra = {}) {
  p.steps[step] = "ok";
  Object.assign(p, extra);
  saveProgress(p);
  console.log(`✓ ${step}`, extra.txids ? JSON.stringify(extra.txids) : "");
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function broadcast(hex, p, label) {
  // Prefer relay if set; always keep hex in progress for manual retry.
  p.last_signed_hex = hex;
  p.last_label = label;
  saveProgress(p);
  if (RELAY) {
    const txid = await relayBroadcast(RELAY, hex);
    console.log(`  ${label} relayed txid=${txid}`);
    return txid;
  }
  const r = await validateSignedTx(hex, rpc, { broadcast: true });
  console.log(`  ${label} accepted txid=${r.txid}`);
  return r.txid;
}

/** List UTXOs for address — zebrad/Tatum may lack getaddressutxos; try several. */
async function utxosFor(address) {
  for (const [method, params] of [
    ["getaddressutxos", [{ addresses: [address] }]],
    ["getaddressutxos", [address]],
  ]) {
    try {
      const r = await rpc(method, params);
      const list = Array.isArray(r) ? r : r?.utxos || [];
      return list.map((u) => ({
        txidHex: u.txid || u.txId,
        vout: u.outputIndex ?? u.vout ?? u.n,
        valueZat: u.satoshis ?? u.valueZat ?? Math.round((u.value || 0) * 1e8),
      }));
    } catch {
      /* try next */
    }
  }
  throw new Error(
    "RPC has no getaddressutxos — set progress.utxos manually or use a Zaino/zcashd wallet RPC"
  );
}

async function main() {
  const raw = JSON.parse(readFileSync(KEYFILE, "utf8"));
  const rec = recoverFromKeyfile(raw);
  const entry = rec.entry;
  const privHex = rec.burnerPrivHex;
  if (!privHex) {
    throw new Error("keyfile missing burner.priv_hex — generate burner into keyfile first");
  }
  const priv = hexToBytes(privHex);
  const burnerAddr = rec.burnerAddress;
  if (!burnerAddr) throw new Error("keyfile missing burner.address");
  const returnAddr = rec.revealReturnAddress;
  if (!returnAddr) throw new Error("keyfile missing reveal_return_address");

  const p = loadProgress();
  p.keyfile = KEYFILE;
  p.burner = burnerAddr;
  saveProgress(p);

  const info = await rpc("getblockchaininfo");
  const net = constantsForNetwork(info.chain);
  const branchId = consensusBranchIdForNextBlock(info);
  console.log(
    `network=${info.chain} tip=${info.blocks} treasury=${net.treasury} branch=0x${branchId.toString(16)}`
  );

  // --- 1. funds ---
  if (!done(p, "funded")) {
    let utxos = p.utxos;
    if (!utxos?.length) {
      try {
        utxos = await utxosFor(burnerAddr);
      } catch (e) {
        console.log("WAIT funded:", e.message);
        console.log(`  Send ≥ ${entry.funding_zat || 265000} zat in ONE send to ${burnerAddr}`);
        console.log("  Or set progress.utxos = [{txidHex,vout,valueZat}] and re-run.");
        saveProgress(p);
        process.exit(10);
      }
    }
    const sum = utxos.reduce((s, u) => s + u.valueZat, 0);
    const need = entry.funding_zat || entry.pay_zat + 65000;
    if (sum < need) {
      console.log(`WAIT funded: have ${sum} zat, need ~${need}`);
      p.utxos = utxos;
      saveProgress(p);
      process.exit(10);
    }
    p.utxos = utxos;
    mark(p, "funded", { balance_zat: sum });
  }

  // --- 2. mint broadcast ---
  if (!done(p, "mint_broadcast")) {
    if (!entry.nonce || !entry.commitment) {
      throw new Error("keyfile has no mined solution (commitment/nonce) — mine on the page first");
    }
    const record = buildRecord(
      hx(entry.commitment),
      BigInt(entry.nonce),
      entry.work,
      entry.patience,
      entry.burn || 0,
      entry.money,
      hx(entry.tag)
    );
    const built = buildSignMint({
      utxos: p.utxos,
      payZat: entry.pay_zat,
      treasuryAddress: net.treasury,
      opReturnPayload: record,
      changeAddress: burnerAddr,
      network: info.chain === "main" ? "main" : "test",
      consensusBranchId: branchId,
      nExpiryHeight: entry.valid_through_height || info.blocks + 20,
      priv,
    });
    const txid = await broadcast(built.hex, p, "mint");
    p.txids.mint = txid;
    p.mint_change_zat = built.changeZat;
    // After mint: treasury=0, opreturn=1, change=2 (if included)
    if (built.includeChange) {
      p.utxos = [{ txidHex: txid, vout: 2, valueZat: built.changeZat }];
    } else {
      p.utxos = [];
    }
    mark(p, "mint_broadcast", { txids: { ...p.txids } });
  }

  // --- 3. indexer credit ---
  if (!done(p, "mint_credited")) {
    const statePath = join(PUB, "state.json");
    let credited = false;
    for (let i = 0; i < 40; i++) {
      if (existsSync(statePath)) {
        const st = JSON.parse(readFileSync(statePath, "utf8"));
        const hit = (st.commitments || []).some(
          (c) => (typeof c === "string" ? c : c.commitment) === entry.commitment
        );
        if (hit) {
          credited = true;
          break;
        }
      }
      console.log(`… waiting mint credit (${i + 1})`);
      await sleep(POLL_MS);
    }
    if (!credited) {
      console.log("WAIT mint_credited: publisher/indexer has not listed commitment yet");
      console.log(`  mint txid=${p.txids.mint} — ensure publisher follows tip`);
      process.exit(11);
    }
    mark(p, "mint_credited", { txids: p.txids });
  }

  // --- 4. epoch seal ---
  if (!done(p, "epoch_sealed")) {
    const statePath = join(PUB, "state.json");
    for (let i = 0; i < 80; i++) {
      if (existsSync(statePath)) {
        const st = JSON.parse(readFileSync(statePath, "utf8"));
        const epochs = st.epochs || [];
        const sealed = epochs.some((e) => e.seal);
        if (sealed || st.minted >= 128) {
          p.seal_note = "epoch seal observed in state.json";
          mark(p, "epoch_sealed", { txids: p.txids });
          break;
        }
      }
      console.log(`… waiting epoch seal (${i + 1})`);
      await sleep(POLL_MS);
    }
    if (!done(p, "epoch_sealed")) {
      console.log("WAIT epoch_sealed: no seal in state.json yet (timeout or fill)");
      process.exit(12);
    }
  }

  // --- 5. reveal ---
  if (!done(p, "reveal_broadcast")) {
    const index = p.mint_index ?? entry.mint_index ?? 0;
    const [a, b] = buildRevealChunks(
      index,
      hx(entry.secret),
      hx(entry.seed),
      hx(entry.salt)
    );
    if (!p.utxos?.length) {
      console.log("WAIT reveal: no change UTXO on burner after mint (dust?)");
      process.exit(13);
    }
    const info2 = await rpc("getblockchaininfo");
    const built = buildSignReveal({
      utxos: p.utxos,
      chunkA: a,
      chunkB: b,
      returnAddress: returnAddr,
      network: info2.chain === "main" ? "main" : "test",
      consensusBranchId: consensusBranchIdForNextBlock(info2),
      nExpiryHeight: info2.blocks + 20,
      priv,
    });
    const txid = await broadcast(built.hex, p, "reveal");
    p.txids.reveal = txid;
    mark(p, "reveal_broadcast", { txids: p.txids });
  }

  // --- 6. reveal indexed + PNG ---
  if (!done(p, "reveal_indexed")) {
    const index = p.mint_index ?? entry.mint_index ?? 0;
    const punk = join(PUB, "punks", `${index}.png`);
    for (let i = 0; i < 40; i++) {
      if (existsSync(punk)) {
        mark(p, "reveal_indexed", { txids: p.txids, png: punk });
        break;
      }
      console.log(`… waiting PNG punks/${index}.png (${i + 1})`);
      await sleep(POLL_MS);
    }
    if (!done(p, "reveal_indexed")) {
      console.log("WAIT reveal_indexed: PNG not written — is publisher art pipeline running?");
      process.exit(14);
    }
  }

  // --- 7. collection ---
  if (!done(p, "collection")) {
    const col = join(PUB, "collection.json");
    if (!existsSync(col)) {
      console.log("WAIT collection: collection.json missing");
      process.exit(15);
    }
    mark(p, "collection", { txids: p.txids });
  }

  console.log("\n=== DRY RUN COMPLETE ===");
  console.log(JSON.stringify(p.txids, null, 2));
  console.log(`progress: ${PROGRESS}`);
  console.log("Paste txids into TESTNET.md. Confirm dust threshold if a near-dust change was dropped.");
}

main().catch((e) => {
  console.error("FAIL", e.message || e);
  process.exit(1);
});
