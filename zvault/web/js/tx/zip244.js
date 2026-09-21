/**
 * ZIP 244 signature digests (NU5 / v5).
 *
 * Algorithm mirrors zcash/zcash-test-vectors zip_0244.py exactly.
 * Validated against the official published vectors — do not "fix" against
 * a second home-grown implementation.
 */
import { blake2b } from "../vendor/blake2b.js";
import { encodeScript, isCoinbase } from "./v5.js";

export const SIGHASH_ALL = 1;
export const SIGHASH_NONE = 2;
export const SIGHASH_SINGLE = 3;
export const SIGHASH_ANYONECANPAY = 0x80;

const te = new TextEncoder();

/** @param {string} s 16-byte ASCII personalization tag */
function person(s) {
  const b = te.encode(s);
  if (b.length !== 16) throw new Error(`person len ${b.length}: ${s}`);
  return b;
}

/** ZcashTxHash_ / ZTxAuthHash_ + little-endian consensus branch id. */
function personBranch(prefix12, branchId) {
  const out = new Uint8Array(16);
  out.set(te.encode(prefix12), 0);
  new DataView(out.buffer).setUint32(12, branchId >>> 0, true);
  return out;
}

/**
 * Blake2b-256 with personalization; absorb zero or more chunks.
 * @param {Uint8Array} pers
 * @param {...Uint8Array} parts
 */
function b2b(pers, ...parts) {
  const h = blake2b.create({ dkLen: 32, personalization: pers });
  for (const p of parts) if (p && p.length) h.update(p);
  return h.digest();
}

function u32le(n) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, true);
  return out;
}

function u8(n) {
  return Uint8Array.of(n & 0xff);
}

// --- ZIP 143-style helpers with ZIP 244 person tags ---

function getHashPrevouts(tx, pers) {
  const h = blake2b.create({ dkLen: 32, personalization: pers });
  for (const x of tx.vin) h.update(x.prevout);
  return h.digest();
}

function getHashSequence(tx, pers) {
  const h = blake2b.create({ dkLen: 32, personalization: pers });
  for (const x of tx.vin) h.update(u32le(x.nSequence));
  return h.digest();
}

function getHashOutputs(tx, pers) {
  const h = blake2b.create({ dkLen: 32, personalization: pers });
  for (const x of tx.vout) h.update(x.encoded);
  return h.digest();
}

// --- Transparent ---

export function transparentDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdTranspaHash"),
  });
  if (tx.vin.length + tx.vout.length > 0) {
    h.update(getHashPrevouts(tx, person("ZTxIdPrevoutHash")));
    h.update(getHashSequence(tx, person("ZTxIdSequencHash")));
    h.update(getHashOutputs(tx, person("ZTxIdOutputsHash")));
  }
  return h.digest();
}

function transparentScriptsDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxAuthTransHash"),
  });
  for (const x of tx.vin) h.update(encodeScript(x.scriptSig));
  return h.digest();
}

// --- Sapling ---

function saplingSpendsCompactDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdSSpendCHash"),
  });
  for (const d of tx.vSpendsSapling) h.update(d.nullifier);
  return h.digest();
}

function saplingSpendsNoncompactDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdSSpendNHash"),
  });
  for (const d of tx.vSpendsSapling) {
    h.update(d.cv);
    h.update(d.anchor);
    h.update(d.rk);
  }
  return h.digest();
}

function saplingSpendsDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdSSpendsHash"),
  });
  if (tx.vSpendsSapling.length > 0) {
    h.update(saplingSpendsCompactDigest(tx));
    h.update(saplingSpendsNoncompactDigest(tx));
  }
  return h.digest();
}

function saplingOutputsCompactDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdSOutC__Hash"),
  });
  for (const d of tx.vOutputsSapling) {
    h.update(d.cmu);
    h.update(d.ephemeralKey);
    h.update(d.encCiphertext.subarray(0, 52));
  }
  return h.digest();
}

function saplingOutputsMemosDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdSOutM__Hash"),
  });
  for (const d of tx.vOutputsSapling) {
    h.update(d.encCiphertext.subarray(52, 564));
  }
  return h.digest();
}

function saplingOutputsNoncompactDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdSOutN__Hash"),
  });
  for (const d of tx.vOutputsSapling) {
    h.update(d.cv);
    h.update(d.encCiphertext.subarray(564));
    h.update(d.outCipherText);
  }
  return h.digest();
}

function saplingOutputsDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdSOutputHash"),
  });
  if (tx.vOutputsSapling.length > 0) {
    h.update(saplingOutputsCompactDigest(tx));
    h.update(saplingOutputsMemosDigest(tx));
    h.update(saplingOutputsNoncompactDigest(tx));
  }
  return h.digest();
}

export function saplingDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdSaplingHash"),
  });
  if (tx.vSpendsSapling.length + tx.vOutputsSapling.length > 0) {
    h.update(saplingSpendsDigest(tx));
    h.update(saplingOutputsDigest(tx));
    h.update(tx.valueBalanceSapling);
  }
  return h.digest();
}

function saplingAuthDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxAuthSapliHash"),
  });
  if (tx.vSpendsSapling.length + tx.vOutputsSapling.length > 0) {
    for (const d of tx.vSpendsSapling) h.update(d.proof);
    for (const d of tx.vSpendsSapling) h.update(d.spendAuthSig);
    for (const d of tx.vOutputsSapling) h.update(d.proof);
    h.update(tx.bindingSigSapling);
  }
  return h.digest();
}

// --- Orchard ---

function orchardActionsCompactDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdOrcActCHash"),
  });
  for (const d of tx.vActionsOrchard) {
    h.update(d.nullifier);
    h.update(d.cmx);
    h.update(d.ephemeralKey);
    h.update(d.encCiphertext.subarray(0, 52));
  }
  return h.digest();
}

function orchardActionsMemosDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdOrcActMHash"),
  });
  for (const d of tx.vActionsOrchard) {
    h.update(d.encCiphertext.subarray(52, 564));
  }
  return h.digest();
}

function orchardActionsNoncompactDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdOrcActNHash"),
  });
  for (const d of tx.vActionsOrchard) {
    h.update(d.cv);
    h.update(d.rk);
    h.update(d.encCiphertext.subarray(564));
    h.update(d.outCiphertext);
  }
  return h.digest();
}

export function orchardDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdOrchardHash"),
  });
  if (tx.vActionsOrchard.length > 0) {
    h.update(orchardActionsCompactDigest(tx));
    h.update(orchardActionsMemosDigest(tx));
    h.update(orchardActionsNoncompactDigest(tx));
    h.update(u8(tx.flagsOrchard));
    h.update(tx.valueBalanceOrchard);
    h.update(tx.anchorOrchard);
  }
  return h.digest();
}

function orchardAuthDigest(tx) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxAuthOrchaHash"),
  });
  if (tx.vActionsOrchard.length > 0) {
    h.update(tx.proofsOrchard);
    for (const d of tx.vActionsOrchard) h.update(d.spendAuthSig);
    h.update(tx.bindingSigOrchard);
  }
  return h.digest();
}

// --- Header / txid / auth ---

export function headerDigest(tx) {
  return b2b(
    person("ZTxIdHeadersHash"),
    u32le(tx.versionBytes),
    u32le(tx.nVersionGroupId),
    u32le(tx.nConsensusBranchId),
    u32le(tx.nLockTime),
    u32le(tx.nExpiryHeight)
  );
}

export function txidDigest(tx) {
  return b2b(
    personBranch("ZcashTxHash_", tx.nConsensusBranchId),
    headerDigest(tx),
    transparentDigest(tx),
    saplingDigest(tx),
    orchardDigest(tx)
  );
}

export function authDigest(tx) {
  return b2b(
    personBranch("ZTxAuthHash_", tx.nConsensusBranchId),
    transparentScriptsDigest(tx),
    saplingAuthDigest(tx),
    orchardAuthDigest(tx)
  );
}

// --- Transparent sighash components ---

function prevoutsSigDigest(tx, nHashType) {
  if (!(nHashType & SIGHASH_ANYONECANPAY)) {
    return getHashPrevouts(tx, person("ZTxIdPrevoutHash"));
  }
  return b2b(person("ZTxIdPrevoutHash"));
}

/**
 * @param {{ amount: bigint|number, scriptPubKey: Uint8Array }[]} tInputs
 */
function amountsSigDigest(tInputs, nHashType) {
  if (!(nHashType & SIGHASH_ANYONECANPAY)) {
    const h = blake2b.create({
      dkLen: 32,
      personalization: person("ZTxTrAmountsHash"),
    });
    for (const x of tInputs) {
      const out = new Uint8Array(8);
      // amounts are unsigned satoshis in the official vectors
      const v = BigInt(x.amount);
      new DataView(out.buffer).setBigUint64(0, v, true);
      h.update(out);
    }
    return h.digest();
  }
  return b2b(person("ZTxTrAmountsHash"));
}

function scriptpubkeysSigDigest(tInputs, nHashType) {
  if (!(nHashType & SIGHASH_ANYONECANPAY)) {
    const h = blake2b.create({
      dkLen: 32,
      personalization: person("ZTxTrScriptsHash"),
    });
    for (const x of tInputs) h.update(encodeScript(x.scriptPubKey));
    return h.digest();
  }
  return b2b(person("ZTxTrScriptsHash"));
}

function sequenceSigDigest(tx, nHashType) {
  if (!(nHashType & SIGHASH_ANYONECANPAY)) {
    return getHashSequence(tx, person("ZTxIdSequencHash"));
  }
  return b2b(person("ZTxIdSequencHash"));
}

/**
 * @param {{ nIn: number } | null} txin
 */
function outputsSigDigest(tx, nHashType, txin) {
  const base = nHashType & 0x1f;
  if (base !== SIGHASH_SINGLE && base !== SIGHASH_NONE) {
    return getHashOutputs(tx, person("ZTxIdOutputsHash"));
  }
  if (base === SIGHASH_SINGLE && txin && txin.nIn >= 0 && txin.nIn < tx.vout.length) {
    return b2b(person("ZTxIdOutputsHash"), tx.vout[txin.nIn].encoded);
  }
  return b2b(person("ZTxIdOutputsHash"));
}

/**
 * @param {{ nIn: number, amount: bigint|number, scriptPubKey: Uint8Array } | null} txin
 */
function txinSigDigest(tx, txin) {
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("Zcash___TxInHash"),
  });
  if (txin != null) {
    h.update(tx.vin[txin.nIn].prevout);
    const amt = new Uint8Array(8);
    new DataView(amt.buffer).setBigUint64(0, BigInt(txin.amount), true);
    h.update(amt);
    h.update(encodeScript(txin.scriptPubKey));
    h.update(u32le(tx.vin[txin.nIn].nSequence));
  }
  return h.digest();
}

/**
 * @param {{ amount: bigint|number, scriptPubKey: Uint8Array }[]} tInputs
 * @param {{ nIn: number, amount: bigint|number, scriptPubKey: Uint8Array } | null} txin
 */
export function transparentSigDigest(tx, tInputs, nHashType, txin) {
  if (isCoinbase(tx) || tx.vin.length === 0) {
    return transparentDigest(tx);
  }
  const h = blake2b.create({
    dkLen: 32,
    personalization: person("ZTxIdTranspaHash"),
  });
  h.update(u8(nHashType));
  h.update(prevoutsSigDigest(tx, nHashType));
  h.update(amountsSigDigest(tInputs, nHashType));
  h.update(scriptpubkeysSigDigest(tInputs, nHashType));
  h.update(sequenceSigDigest(tx, nHashType));
  h.update(outputsSigDigest(tx, nHashType, txin));
  h.update(txinSigDigest(tx, txin));
  return h.digest();
}

/**
 * Full ZIP 244 signature digest for one sighash type.
 * @param {{ amount: bigint|number, scriptPubKey: Uint8Array }[]} tInputs
 *   Parallel to tx.vin (empty for coinbase).
 * @param {{ nIn: number, amount: bigint|number, scriptPubKey: Uint8Array } | null} txin
 *   Null → shielded SIGHASH_ALL digest.
 */
export function signatureDigest(tx, tInputs, nHashType, txin) {
  return b2b(
    personBranch("ZcashTxHash_", tx.nConsensusBranchId),
    headerDigest(tx),
    transparentSigDigest(tx, tInputs, nHashType, txin),
    saplingDigest(tx),
    orchardDigest(tx)
  );
}
