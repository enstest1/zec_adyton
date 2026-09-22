/**
 * Transparent P2PKH address derivation — network-scoped Base58Check (S3).
 *
 * Prefixes from zcash/zcash src/chainparams.cpp (verified, not memorized):
 *   mainnet PUBKEY_ADDRESS = {0x1C, 0xB8} → "t1…"
 *   testnet PUBKEY_ADDRESS = {0x1D, 0x25} → "tm…"
 *
 * Always confirm derived addresses with the node's validateaddress before funding.
 */
import { hash160, privToPub, sha256d } from "./keys.js";

/** @type {Record<string, Uint8Array>} */
export const P2PKH_PREFIX = {
  main: Uint8Array.of(0x1c, 0xb8),
  test: Uint8Array.of(0x1d, 0x25),
  regtest: Uint8Array.of(0x1d, 0x25),
};

const B58 =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

export function base58Decode(str) {
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") zeros++;
  const bytes = [0];
  for (let i = zeros; i < str.length; i++) {
    const v = B58.indexOf(str[i]);
    if (v < 0) throw new Error(`invalid base58 char ${str[i]}`);
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[out.length - 1 - i] = bytes[i];
  return out;
}

export function base58CheckEncode(payload) {
  const checksum = sha256d(payload).subarray(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload, 0);
  full.set(checksum, payload.length);
  return base58Encode(full);
}

export function base58CheckDecode(addr) {
  const raw = base58Decode(addr);
  if (raw.length < 5) throw new Error("address too short");
  const payload = raw.subarray(0, raw.length - 4);
  const checksum = raw.subarray(raw.length - 4);
  const expect = sha256d(payload).subarray(0, 4);
  for (let i = 0; i < 4; i++) {
    if (checksum[i] !== expect[i]) throw new Error("bad address checksum");
  }
  return payload;
}

/**
 * @param {string} network  "main" | "test" | "regtest"
 */
export function p2pkhPrefix(network) {
  const n = String(network).toLowerCase();
  const key = n === "mainnet" ? "main" : n === "testnet" ? "test" : n;
  const p = P2PKH_PREFIX[key];
  if (!p) throw new Error(`no P2PKH prefix for network ${network}`);
  return p;
}

/** 20-byte hash160 (minerTag) from compressed pubkey. */
export function pubKeyHash(pubCompressed) {
  return hash160(pubCompressed);
}

/**
 * Derive transparent P2PKH address for network.
 * @param {Uint8Array} priv
 * @param {string} network
 */
export function addressFromPriv(priv, network) {
  const pub = privToPub(priv);
  const h160 = pubKeyHash(pub);
  const prefix = p2pkhPrefix(network);
  const payload = new Uint8Array(prefix.length + 20);
  payload.set(prefix, 0);
  payload.set(h160, prefix.length);
  return {
    address: base58CheckEncode(payload),
    pub,
    hash160: h160,
    tagHex: [...h160].map((b) => b.toString(16).padStart(2, "0")).join(""),
  };
}

/** P2PKH scriptPubKey: OP_DUP OP_HASH160 OP_PUSH20 <h160> OP_EQUALVERIFY OP_CHECKSIG */
export function p2pkhScriptPubKey(h160) {
  if (h160.length !== 20) throw new Error("hash160 must be 20 bytes");
  const out = new Uint8Array(25);
  out[0] = 0x76;
  out[1] = 0xa9;
  out[2] = 0x14;
  out.set(h160, 3);
  out[23] = 0x88;
  out[24] = 0xac;
  return out;
}

/** OP_RETURN script: OP_RETURN <push data> */
export function opReturnScript(data) {
  if (data.length < 1 || data.length > 75) {
    throw new Error(`OP_RETURN data length ${data.length} (need 1..75)`);
  }
  const out = new Uint8Array(2 + data.length);
  out[0] = 0x6a;
  out[1] = data.length;
  out.set(data, 2);
  return out;
}

/**
 * Round-trip address through node validateaddress (S3).
 * @param {string} address
 * @param {(method: string, params?: unknown[]) => Promise<object>} rpcCall
 */
export async function confirmAddressWithNode(address, rpcCall) {
  const info = await rpcCall("validateaddress", [address]);
  if (!info || info.isvalid !== true) {
    throw new Error(`node rejected address ${address}: ${JSON.stringify(info)}`);
  }
  return info;
}
