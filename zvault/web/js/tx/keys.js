/**
 * secp256k1 key helpers — compressed pubkeys, canonical LOW-S signatures (S1).
 */
import * as secp from "../vendor/noble/secp256k1.js";
import { hmac } from "../vendor/noble/hmac.js";
import { sha256 } from "../vendor/noble/sha256.js";
import { ripemd160 } from "../vendor/noble/ripemd160.js";

// Sync HMAC for deterministic signing (noble secp256k1 v2).
secp.etc.hmacSha256Sync = (key, ...msgs) =>
  hmac(sha256, key, secp.etc.concatBytes(...msgs));

export function sha256d(data) {
  return sha256(sha256(data));
}

export function hash160(data) {
  return ripemd160(sha256(data));
}

/** Generate a new burner private key (32 bytes). */
export function generatePrivKey() {
  return secp.utils.randomPrivateKey();
}

/** Compressed public key (33 bytes). */
export function privToPub(priv) {
  return secp.getPublicKey(priv, true);
}

/**
 * Sign sighash with low-S enforcement. Returns 64-byte compact r‖s (low-S).
 * @param {Uint8Array} sighash32
 * @param {Uint8Array} priv
 */
export function signSighashLowS(sighash32, priv) {
  const sig = secp.sign(sighash32, priv, { lowS: true });
  if (sig.hasHighS()) {
    throw new Error("signature still high-S after lowS sign — refuse");
  }
  // normalizeS is identity when already low; assert anyway
  const norm = sig.normalizeS();
  if (norm.hasHighS()) throw new Error("normalizeS failed to clear high-S");
  return norm.toCompactRawBytes();
}

/**
 * Convert compact r‖s to Bitcoin-style DER, then append hashtype byte.
 * @param {Uint8Array} compact64
 * @param {number} hashType  usually SIGHASH_ALL = 1
 */
export function compactToDerScriptSig(compact64, hashType = 1) {
  const r = compact64.subarray(0, 32);
  const s = compact64.subarray(32, 64);
  const rDer = encodeDerInt(r);
  const sDer = encodeDerInt(s);
  const body = new Uint8Array(2 + rDer.length + 2 + sDer.length);
  let o = 0;
  body[o++] = 0x02;
  body[o++] = rDer.length;
  body.set(rDer, o);
  o += rDer.length;
  body[o++] = 0x02;
  body[o++] = sDer.length;
  body.set(sDer, o);
  const der = new Uint8Array(2 + body.length);
  der[0] = 0x30;
  der[1] = body.length;
  der.set(body, 2);
  const out = new Uint8Array(der.length + 1);
  out.set(der, 0);
  out[der.length] = hashType & 0xff;
  return out;
}

/** DER integer: strip leading zeros; if high bit set, prepend 0x00. */
function encodeDerInt(be32) {
  let i = 0;
  while (i < be32.length - 1 && be32[i] === 0) i++;
  let v = be32.subarray(i);
  if (v[0] & 0x80) {
    const padded = new Uint8Array(v.length + 1);
    padded.set(v, 1);
    v = padded;
  }
  return v;
}

/**
 * Force a high-S signature for tests (flip s → n-s). Must NOT be used for broadcast.
 */
export function forceHighSCompact(compact64) {
  const sig = secp.Signature.fromCompact(compact64);
  if (sig.hasHighS()) return compact64;
  // s' = n - s
  const n = secp.CURVE.n;
  const s = BigInt("0x" + secp.etc.bytesToHex(compact64.subarray(32)));
  const sHigh = n - s;
  const out = new Uint8Array(64);
  out.set(compact64.subarray(0, 32), 0);
  out.set(secp.etc.numberToBytesBE(sHigh), 32);
  const check = secp.Signature.fromCompact(out);
  if (!check.hasHighS()) throw new Error("forceHighS failed");
  return out;
}

export { secp };
