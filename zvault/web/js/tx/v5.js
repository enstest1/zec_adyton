/**
 * NU5 (v5) transparent+Sapling+Orchard transaction parser (ZIP 225 wire layout).
 * Field sizes match zcash-test-vectors TransactionV5 — used by ZIP 244 sighash.
 */

/** Sapling note ciphertext sizes (Zcash.h / ZIP 225). */
export const SAPLING_ENC_CIPHERTEXT = 580; // 564 plaintext + 16 auth
export const SAPLING_OUT_CIPHERTEXT = 80;  // 64 plaintext + 16 auth
export const GROTH_PROOF = 192;            // 48 + 96 + 48
export const SPEND_AUTH_SIG = 64;
export const BINDING_SIG = 64;
export const SPEND_V5 = 96;                // cv | nullifier | rk
export const OUTPUT_V5 = 32 + 32 + 32 + SAPLING_ENC_CIPHERTEXT + SAPLING_OUT_CIPHERTEXT; // 756
export const ORCHARD_ACTION = 32 * 5 + SAPLING_ENC_CIPHERTEXT + SAPLING_OUT_CIPHERTEXT; // 820

/**
 * @param {Uint8Array} buf
 * @param {number} off
 */
export function readCompactSize(buf, off) {
  if (off >= buf.length) throw new Error("compact size EOF");
  const b = buf[off];
  if (b < 253) return { n: b, off: off + 1 };
  if (b === 253) {
    if (off + 3 > buf.length) throw new Error("compact size EOF");
    const n = buf[off + 1] | (buf[off + 2] << 8);
    if (n < 253) throw new Error("non-canonical compact size");
    return { n, off: off + 3 };
  }
  if (b === 254) {
    if (off + 5 > buf.length) throw new Error("compact size EOF");
    const n =
      (buf[off + 1] |
        (buf[off + 2] << 8) |
        (buf[off + 3] << 16) |
        (buf[off + 4] << 24)) >>>
      0;
    if (n < 0x10000) throw new Error("non-canonical compact size");
    return { n, off: off + 5 };
  }
  throw new Error("compact size u64 not supported for tx fields");
}

/** Encode Bitcoin/Zcash compact size (for script prefixes in digests). */
export function writeCompactSize(n) {
  if (n < 253) return Uint8Array.of(n);
  if (n <= 0xffff) {
    const out = new Uint8Array(3);
    out[0] = 253;
    out[1] = n & 0xff;
    out[2] = (n >>> 8) & 0xff;
    return out;
  }
  if (n <= 0xffffffff) {
    const out = new Uint8Array(5);
    out[0] = 254;
    const dv = new DataView(out.buffer);
    dv.setUint32(1, n, true);
    return out;
  }
  throw new Error("compact size too large");
}

/**
 * Serialize a script with its compact-size length prefix (Script.__bytes__).
 * @param {Uint8Array} raw
 */
export function encodeScript(raw) {
  const pref = writeCompactSize(raw.length);
  const out = new Uint8Array(pref.length + raw.length);
  out.set(pref, 0);
  out.set(raw, pref.length);
  return out;
}

function slice(buf, off, len) {
  if (off + len > buf.length) throw new Error("slice EOF");
  return { bytes: buf.subarray(off, off + len), off: off + len };
}

function u32le(buf, off) {
  if (off + 4 > buf.length) throw new Error("u32 EOF");
  return {
    n:
      (buf[off] |
        (buf[off + 1] << 8) |
        (buf[off + 2] << 16) |
        (buf[off + 3] << 24)) >>>
      0,
    off: off + 4,
  };
}

function u64leBytes(buf, off) {
  return slice(buf, off, 8);
}

/**
 * Parse a ZIP 225 v5 transaction from wire bytes.
 * @param {Uint8Array} buf
 */
export function parseTxV5(buf) {
  let off = 0;
  let r;

  r = u32le(buf, off);
  const version = r.n;
  off = r.off;
  // Overwintered bit must be set; version field = 5 | (1<<31)
  if ((version & 0x7fffffff) !== 5) {
    throw new Error(`expected tx v5, got ${version & 0x7fffffff}`);
  }

  r = u32le(buf, off);
  const nVersionGroupId = r.n;
  off = r.off;
  r = u32le(buf, off);
  const nConsensusBranchId = r.n;
  off = r.off;
  r = u32le(buf, off);
  const nLockTime = r.n;
  off = r.off;
  r = u32le(buf, off);
  const nExpiryHeight = r.n;
  off = r.off;

  // --- transparent ---
  r = readCompactSize(buf, off);
  const nVin = r.n;
  off = r.off;
  /** @type {{ prevout: Uint8Array, scriptSig: Uint8Array, nSequence: number }[]} */
  const vin = [];
  for (let i = 0; i < nVin; i++) {
    const prev = slice(buf, off, 36);
    off = prev.off; // txid[32] + n[4]
    r = readCompactSize(buf, off);
    off = r.off;
    const sig = slice(buf, off, r.n);
    off = sig.off;
    r = u32le(buf, off);
    off = r.off;
    vin.push({ prevout: prev.bytes, scriptSig: sig.bytes, nSequence: r.n });
  }

  r = readCompactSize(buf, off);
  const nVout = r.n;
  off = r.off;
  /** @type {{ nValue: Uint8Array, scriptPubKey: Uint8Array, encoded: Uint8Array }[]} */
  const vout = [];
  for (let i = 0; i < nVout; i++) {
    const start = off;
    const val = u64leBytes(buf, off);
    off = val.off;
    r = readCompactSize(buf, off);
    off = r.off;
    const spk = slice(buf, off, r.n);
    off = spk.off;
    vout.push({
      nValue: val.bytes,
      scriptPubKey: spk.bytes,
      encoded: buf.subarray(start, off),
    });
  }

  // --- Sapling ---
  r = readCompactSize(buf, off);
  const nSpends = r.n;
  off = r.off;
  /** @type {{ cv: Uint8Array, nullifier: Uint8Array, rk: Uint8Array, proof?: Uint8Array, spendAuthSig?: Uint8Array, anchor?: Uint8Array }[]} */
  const vSpendsSapling = [];
  for (let i = 0; i < nSpends; i++) {
    const cv = slice(buf, off, 32);
    off = cv.off;
    const nf = slice(buf, off, 32);
    off = nf.off;
    const rk = slice(buf, off, 32);
    off = rk.off;
    vSpendsSapling.push({ cv: cv.bytes, nullifier: nf.bytes, rk: rk.bytes });
  }

  r = readCompactSize(buf, off);
  const nOutputs = r.n;
  off = r.off;
  /** @type {{ cv: Uint8Array, cmu: Uint8Array, ephemeralKey: Uint8Array, encCiphertext: Uint8Array, outCipherText: Uint8Array, proof?: Uint8Array }[]} */
  const vOutputsSapling = [];
  for (let i = 0; i < nOutputs; i++) {
    const cv = slice(buf, off, 32);
    off = cv.off;
    const cmu = slice(buf, off, 32);
    off = cmu.off;
    const epk = slice(buf, off, 32);
    off = epk.off;
    const enc = slice(buf, off, SAPLING_ENC_CIPHERTEXT);
    off = enc.off;
    const outC = slice(buf, off, SAPLING_OUT_CIPHERTEXT);
    off = outC.off;
    vOutputsSapling.push({
      cv: cv.bytes,
      cmu: cmu.bytes,
      ephemeralKey: epk.bytes,
      encCiphertext: enc.bytes,
      outCipherText: outC.bytes,
    });
  }

  const hasSapling = nSpends + nOutputs > 0;
  /** @type {Uint8Array} */
  let valueBalanceSapling = new Uint8Array(8); // zero if absent
  /** @type {Uint8Array | null} */
  let anchorSapling = null;
  /** @type {Uint8Array | null} */
  let bindingSigSapling = null;

  if (hasSapling) {
    const vb = u64leBytes(buf, off);
    off = vb.off;
    valueBalanceSapling = vb.bytes;
  }
  if (nSpends > 0) {
    const anc = slice(buf, off, 32);
    off = anc.off;
    anchorSapling = anc.bytes;
    for (const s of vSpendsSapling) {
      s.anchor = anchorSapling;
      const proof = slice(buf, off, GROTH_PROOF);
      off = proof.off;
      s.proof = proof.bytes;
    }
    for (const s of vSpendsSapling) {
      const sig = slice(buf, off, SPEND_AUTH_SIG);
      off = sig.off;
      s.spendAuthSig = sig.bytes;
    }
  }
  for (const o of vOutputsSapling) {
    const proof = slice(buf, off, GROTH_PROOF);
    off = proof.off;
    o.proof = proof.bytes;
  }
  if (hasSapling) {
    const bs = slice(buf, off, BINDING_SIG);
    off = bs.off;
    bindingSigSapling = bs.bytes;
  }

  // --- Orchard ---
  r = readCompactSize(buf, off);
  const nActions = r.n;
  off = r.off;
  /** @type {{ cv: Uint8Array, nullifier: Uint8Array, rk: Uint8Array, cmx: Uint8Array, ephemeralKey: Uint8Array, encCiphertext: Uint8Array, outCiphertext: Uint8Array, spendAuthSig?: Uint8Array }[]} */
  const vActionsOrchard = [];
  /** @type {number} */
  let flagsOrchard = 0;
  /** @type {Uint8Array} */
  let valueBalanceOrchard = new Uint8Array(8);
  /** @type {Uint8Array | null} */
  let anchorOrchard = null;
  /** @type {Uint8Array} */
  let proofsOrchard = new Uint8Array(0);
  /** @type {Uint8Array | null} */
  let bindingSigOrchard = null;

  if (nActions > 0) {
    for (let i = 0; i < nActions; i++) {
      const cv = slice(buf, off, 32);
      off = cv.off;
      const nf = slice(buf, off, 32);
      off = nf.off;
      const rk = slice(buf, off, 32);
      off = rk.off;
      const cmx = slice(buf, off, 32);
      off = cmx.off;
      const epk = slice(buf, off, 32);
      off = epk.off;
      const enc = slice(buf, off, SAPLING_ENC_CIPHERTEXT);
      off = enc.off;
      const outC = slice(buf, off, SAPLING_OUT_CIPHERTEXT);
      off = outC.off;
      vActionsOrchard.push({
        cv: cv.bytes,
        nullifier: nf.bytes,
        rk: rk.bytes,
        cmx: cmx.bytes,
        ephemeralKey: epk.bytes,
        encCiphertext: enc.bytes,
        outCiphertext: outC.bytes,
      });
    }
    if (off >= buf.length) throw new Error("orchard flags EOF");
    flagsOrchard = buf[off++];
    const vb = u64leBytes(buf, off);
    off = vb.off;
    valueBalanceOrchard = vb.bytes;
    const anc = slice(buf, off, 32);
    off = anc.off;
    anchorOrchard = anc.bytes;
    r = readCompactSize(buf, off);
    off = r.off;
    const pr = slice(buf, off, r.n);
    off = pr.off;
    proofsOrchard = pr.bytes;
    for (const a of vActionsOrchard) {
      const sig = slice(buf, off, SPEND_AUTH_SIG);
      off = sig.off;
      a.spendAuthSig = sig.bytes;
    }
    const bs = slice(buf, off, BINDING_SIG);
    off = bs.off;
    bindingSigOrchard = bs.bytes;
  }

  if (off !== buf.length) {
    throw new Error(`v5 parse leftover ${buf.length - off} bytes at off=${off}`);
  }

  return {
    versionBytes: version,
    nVersionGroupId,
    nConsensusBranchId,
    nLockTime,
    nExpiryHeight,
    vin,
    vout,
    vSpendsSapling,
    vOutputsSapling,
    valueBalanceSapling,
    anchorSapling,
    bindingSigSapling,
    vActionsOrchard,
    flagsOrchard,
    valueBalanceOrchard,
    anchorOrchard,
    proofsOrchard,
    bindingSigOrchard,
  };
}

/** Coinbase: single vin with null prevout (txid=0, n=0xffffffff). */
export function isCoinbase(tx) {
  if (tx.vin.length !== 1) return false;
  const p = tx.vin[0].prevout;
  for (let i = 0; i < 32; i++) if (p[i] !== 0) return false;
  const n = (p[32] | (p[33] << 8) | (p[34] << 16) | (p[35] << 24)) >>> 0;
  return n === 0xffffffff;
}
