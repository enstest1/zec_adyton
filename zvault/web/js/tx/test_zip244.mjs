/**
 * Unit test: ZIP 244 sighash against official zcash-test-vectors.
 *
 * Source: https://github.com/zcash/zcash-test-vectors
 * (zip_0244.py / published zip_0244.json). We do NOT compare against a
 * second JS reimplementation — only these vectors.
 *
 * Run: node js/tx/test_zip244.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTxV5 } from "./v5.js";
import {
  SIGHASH_ALL,
  SIGHASH_ANYONECANPAY,
  SIGHASH_NONE,
  SIGHASH_SINGLE,
  authDigest,
  signatureDigest,
  txidDigest,
} from "./zip244.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function hexToBytes(hex) {
  if (hex.length % 2) throw new Error("odd hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(u8) {
  return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function eqHex(label, got, want) {
  const g = bytesToHex(got);
  if (g !== want) {
    throw new Error(`${label}\n  got  ${g}\n  want ${want}`);
  }
}

function eqOptHex(label, got, want) {
  if (want == null) {
    if (got != null) throw new Error(`${label}: expected null`);
    return;
  }
  eqHex(label, got, want);
}

const raw = JSON.parse(readFileSync(join(__dirname, "zip244-vectors.json"), "utf8"));
// rows[0]=source comment, rows[1]=field names, rows[2..]=vectors
const vectors = raw.slice(2);

let n = 0;
for (const row of vectors) {
  const [
    txHex,
    txidWant,
    authWant,
    amounts,
    scriptPubkeysHex,
    transparentInput,
    sighashShielded,
    sighashAll,
    sighashNone,
    sighashSingle,
    sighashAllAnyone,
    sighashNoneAnyone,
    sighashSingleAnyone,
  ] = row;

  const txBytes = hexToBytes(txHex);
  const tx = parseTxV5(txBytes);

  eqHex(`vec${n} txid`, txidDigest(tx), txidWant);
  eqHex(`vec${n} auth`, authDigest(tx), authWant);

  // t_inputs parallel to vin (empty for coinbase — amounts[] is empty).
  const tInputs = amounts.map((amount, i) => ({
    amount,
    scriptPubKey: hexToBytes(scriptPubkeysHex[i]),
  }));

  // Shielded / SIGHASH_ALL with txin=null
  eqHex(
    `vec${n} sighash_shielded`,
    signatureDigest(tx, tInputs, SIGHASH_ALL, null),
    sighashShielded
  );

  /** @type {{ nIn: number, amount: number, scriptPubKey: Uint8Array } | null} */
  let txin = null;
  if (transparentInput != null) {
    txin = {
      nIn: transparentInput,
      amount: amounts[transparentInput],
      scriptPubKey: hexToBytes(scriptPubkeysHex[transparentInput]),
    };
  }

  const maybe = (hashType, want) => {
    if (want == null) return;
    if (txin == null) throw new Error(`vec${n}: sighash present but no transparent_input`);
    eqHex(
      `vec${n} sighash 0x${hashType.toString(16)}`,
      signatureDigest(tx, tInputs, hashType, txin),
      want
    );
  };

  maybe(SIGHASH_ALL, sighashAll);
  maybe(SIGHASH_NONE, sighashNone);
  maybe(SIGHASH_SINGLE, sighashSingle);
  maybe(SIGHASH_ALL | SIGHASH_ANYONECANPAY, sighashAllAnyone);
  maybe(SIGHASH_NONE | SIGHASH_ANYONECANPAY, sighashNoneAnyone);
  maybe(SIGHASH_SINGLE | SIGHASH_ANYONECANPAY, sighashSingleAnyone);

  // Also assert nulls stay null when no transparent input selected
  if (txin == null) {
    eqOptHex(`vec${n} sighash_all null`, null, sighashAll);
  }

  n++;
}

console.log(`ZIP 244 OK — ${n} official vectors passed (txid, auth, sighashes)`);
