/**
 * ZIP 225 v5 transparent transaction serialization (S4).
 * Mirrors parseTxV5 in v5.js — round-trip with the same field layout.
 */
import { writeCompactSize } from "./v5.js";

export const NU5_VERSION_GROUP_ID = 0x26a7270a;
export const NU5_TX_VERSION = 5;

function u32le(n) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n >>> 0, true);
  return out;
}

function u64le(n) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(n), true);
  return out;
}

function concat(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/**
 * Serialize a transparent-only v5 transaction.
 *
 * @param {object} tx
 * @param {number} tx.nConsensusBranchId
 * @param {number} [tx.nLockTime=0]
 * @param {number} [tx.nExpiryHeight=0]
 * @param {{ prevout: Uint8Array, scriptSig: Uint8Array, nSequence: number }[]} tx.vin
 * @param {{ valueZat: number|bigint, scriptPubKey: Uint8Array }[]} tx.vout
 */
export function serializeTxV5Transparent(tx) {
  const versionBytes = NU5_TX_VERSION | (1 << 31);
  const parts = [
    u32le(versionBytes),
    u32le(NU5_VERSION_GROUP_ID),
    u32le(tx.nConsensusBranchId),
    u32le(tx.nLockTime ?? 0),
    u32le(tx.nExpiryHeight ?? 0),
  ];

  parts.push(writeCompactSize(tx.vin.length));
  for (const vin of tx.vin) {
    if (vin.prevout.length !== 36) throw new Error("prevout must be 36 bytes");
    parts.push(vin.prevout);
    parts.push(writeCompactSize(vin.scriptSig.length));
    parts.push(vin.scriptSig);
    parts.push(u32le(vin.nSequence ?? 0xffffffff));
  }

  parts.push(writeCompactSize(tx.vout.length));
  for (const vout of tx.vout) {
    parts.push(u64le(vout.valueZat));
    parts.push(writeCompactSize(vout.scriptPubKey.length));
    parts.push(vout.scriptPubKey);
  }

  // Empty Sapling + Orchard (compact size 0 for spends, outputs, actions)
  parts.push(Uint8Array.of(0)); // nSpendsSapling
  parts.push(Uint8Array.of(0)); // nOutputsSapling
  parts.push(Uint8Array.of(0)); // nActionsOrchard

  return concat(parts);
}

/** Build 36-byte prevout: txid (32 LE as on wire) + vout index u32le. */
export function makePrevout(txidBytes32, voutIndex) {
  if (txidBytes32.length !== 32) throw new Error("txid 32 bytes");
  const out = new Uint8Array(36);
  out.set(txidBytes32, 0);
  new DataView(out.buffer).setUint32(32, voutIndex >>> 0, true);
  return out;
}

/** Push opcode for scriptSig element. */
export function pushData(data) {
  if (data.length < 76) {
    const out = new Uint8Array(1 + data.length);
    out[0] = data.length;
    out.set(data, 1);
    return out;
  }
  throw new Error("pushData: large pushes not needed for P2PKH");
}

/** P2PKH scriptSig = push(DER‖hashtype) ‖ push(pubkey) */
export function p2pkhScriptSig(derWithType, pubCompressed) {
  return concat([pushData(derWithType), pushData(pubCompressed)]);
}

export function bytesToHex(u8) {
  return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex) {
  const h = hex.replace(/^0x/, "");
  if (h.length % 2) throw new Error("odd hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
