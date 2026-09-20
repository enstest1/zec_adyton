#!/usr/bin/env node
/**
 * CI: run JS protocol against web/vectors.json (Node, no browser).
 *    node web/test_vectors_js.mjs
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  buildCommitment, challengeFor, powHash, targetHex, buildRecord,
  buildRevealChunks, scoreOf, hexToBytes, bytesToHex,
} from "./js/protocol.js";

const root = dirname(fileURLToPath(import.meta.url));
const v = JSON.parse(readFileSync(join(root, "vectors.json"), "utf8"));

function eq(a, b, label) {
  if (a !== b) {
    console.error(`FAIL ${label}\n  got  ${a}\n  want ${b}`);
    process.exit(1);
  }
}

let n = 0;
for (const c of v.build_commitment) {
  eq(bytesToHex(buildCommitment(
    hexToBytes(c.secret), hexToBytes(c.seed), hexToBytes(c.salt),
    c.work, c.patience, c.burn, c.money,
  )), c.commitment, "build_commitment");
  n++;
}
for (const c of v.challenge_for) {
  eq(bytesToHex(challengeFor(hexToBytes(c.block_hash))), c.challenge, "challenge_for");
  n++;
}
for (const c of v.pow_hash) {
  eq(bytesToHex(powHash(
    hexToBytes(c.challenge), hexToBytes(c.commitment),
    hexToBytes(c.miner_tag), c.nonce,
  )), c.pow, "pow_hash");
  n++;
}
for (const c of v.target_for) {
  eq(targetHex(c.bits), c.target_hex, `target_for ${c.bits}`);
  n++;
}
for (const c of v.build_record) {
  eq(bytesToHex(buildRecord(
    hexToBytes(c.commitment), c.nonce, c.work, c.patience, c.burn, c.money,
    hexToBytes(c.miner_tag),
  )), c.record, "build_record");
  n++;
}
for (const c of v.build_reveal_chunks) {
  const [a, b] = buildRevealChunks(
    c.index, hexToBytes(c.secret), hexToBytes(c.seed), hexToBytes(c.salt),
  );
  eq(bytesToHex(a), c.chunk_a, "reveal A");
  eq(bytesToHex(b), c.chunk_b, "reveal B");
  n++;
}
for (const c of v.score_of) {
  eq(String(scoreOf(c.work, c.patience, c.burn, c.money)), String(c.score), "score_of");
  n++;
}
console.log(`ok  JS matches vectors.json (${n} checks)`);
