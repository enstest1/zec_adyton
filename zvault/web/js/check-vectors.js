/**
 * Validate JS protocol against web/vectors.json.
 * Throws on first mismatch — never silent.
 */
import {
  buildCommitment, challengeFor, powHash, targetHex, buildRecord,
  buildRevealChunks, scoreOf, hexToBytes, bytesToHex,
} from "./protocol.js";

function eq(a, b, label) {
  if (a !== b) throw new Error(`VECTOR MISMATCH ${label}:\n  got  ${a}\n  want ${b}`);
}

export async function checkVectors(vectorsUrl = "./vectors.json") {
  const res = await fetch(vectorsUrl);
  if (!res.ok) throw new Error(`cannot load ${vectorsUrl}: ${res.status}`);
  const v = await res.json();
  let n = 0;

  for (const c of v.build_commitment) {
    const got = bytesToHex(buildCommitment(
      hexToBytes(c.secret), hexToBytes(c.seed), hexToBytes(c.salt),
      c.work, c.patience, c.burn, c.money,
    ));
    eq(got, c.commitment, `build_commitment`);
    n++;
  }
  for (const c of v.challenge_for) {
    eq(bytesToHex(challengeFor(hexToBytes(c.block_hash))), c.challenge, "challenge_for");
    n++;
  }
  for (const c of v.pow_hash) {
    const got = bytesToHex(powHash(
      hexToBytes(c.challenge), hexToBytes(c.commitment),
      hexToBytes(c.miner_tag), c.nonce,
    ));
    eq(got, c.pow, "pow_hash");
    n++;
  }
  for (const c of v.target_for) {
    eq(targetHex(c.bits), c.target_hex, `target_for(${c.bits})`);
    n++;
  }
  for (const c of v.build_record) {
    const got = bytesToHex(buildRecord(
      hexToBytes(c.commitment), c.nonce, c.work, c.patience, c.burn, c.money,
      hexToBytes(c.miner_tag),
    ));
    eq(got, c.record, "build_record");
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

  return { ok: true, checked: n, case_count: v.meta.case_count };
}
