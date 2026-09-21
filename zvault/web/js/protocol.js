/**
 * ZVAULT protocol primitives — must match zcash/indexer.py byte-for-byte.
 * Validated against ../vectors.json on load / in CI.
 */
import { blake2b as nobleBlake2b } from "./vendor/blake2b.js";

export const MAGIC = new TextEncoder().encode("ZVLT");
export const VERSION = 2;
export const KIND_MINT = 1;
export const KIND_REVEAL = 2;
export const MAX_WORK_BITS = 4;
export const MAX_PATIENCE = 7;
export const MAX_BURN = 0;
export const MAX_MONEY = 12;
export const WEIGHTS = { work: 4000, patience: 2500, burn: 2500, money: 1000 };
export const CHALLENGE_WINDOW = 24;

/** Concatenate parts into one blake2b-256 digest (Python hashlib.blake2b). */
export function blake(...parts) {
  const h = nobleBlake2b.create({ dkLen: 32 });
  for (const p of parts) h.update(p instanceof Uint8Array ? p : new Uint8Array(p));
  return h.digest();
}

export function hexToBytes(hex) {
  if (hex.length % 2) throw new Error("odd hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(u8) {
  return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function u8(n) { return new Uint8Array([n & 0xff]); }

function packBBIB(work, patience, burn, money) {
  const out = new Uint8Array(7);
  out[0] = work; out[1] = patience;
  out[2] = (burn >>> 24) & 0xff;
  out[3] = (burn >>> 16) & 0xff;
  out[4] = (burn >>> 8) & 0xff;
  out[5] = burn & 0xff;
  out[6] = money;
  return out;
}

function packU64BE(n) {
  const out = new Uint8Array(8);
  // BigInt for full 64-bit range
  let x = BigInt(n);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function packU16BE(n) {
  return new Uint8Array([(n >>> 8) & 0xff, n & 0xff]);
}

function packU32BE(n) {
  return new Uint8Array([
    (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff,
  ]);
}

function xorChecksum(body) {
  let chk = 0;
  for (const b of body) chk ^= b;
  const out = new Uint8Array(body.length + 1);
  out.set(body);
  out[body.length] = chk;
  return out;
}

function require32(name, value) {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new Error(`${name} must be exactly 32 bytes`);
  }
  return value;
}

export function buildCommitment(secret, seed, salt, work, patience, burn, money) {
  secret = require32("secret", secret);
  seed = require32("seed", seed);
  salt = require32("salt", salt);
  const bid = packBBIB(work, patience, burn, money);
  return blake(
    new TextEncoder().encode("zvlt.commitment.v2"),
    new TextEncoder().encode("zvlt.secret.v2"), secret,
    new TextEncoder().encode("zvlt.seed.v2"), seed,
    new TextEncoder().encode("zvlt.bid.v2"), bid,
    new TextEncoder().encode("zvlt.salt.v2"), salt,
  );
}

export function challengeFor(blockHash) {
  return blake(new TextEncoder().encode("zvlt.challenge.v2"), blockHash);
}

export function powHash(challenge, commitment, minerTag, nonce) {
  return blake(challenge, commitment, minerTag, packU64BE(nonce));
}

/** Same shape as Bitcoin/Python target_for: (1<<256) >> bits */
export function targetFor(bits) {
  // Return as 32-byte big-endian Uint8Array for comparison
  if (bits <= 0) return new Uint8Array(32).fill(0xff);
  if (bits >= 256) return new Uint8Array(32);
  const full = bits >> 3;
  const rem = bits & 7;
  const out = new Uint8Array(32);
  let i = 0;
  for (; i < full; i++) out[i] = 0;
  if (i < 32) {
    out[i] = 0xff >>> rem;
    i++;
  }
  for (; i < 32; i++) out[i] = 0xff;
  return out;
}

export function targetHex(bits) {
  // Exact integer hex matching Python f"{t:064x}"
  // (1 << 256) >> bits
  let t = 1n << 256n;
  t >>= BigInt(bits);
  return t.toString(16).padStart(64, "0");
}

export function buildRecord(commitment, nonce, work, patience, burn, money, tag) {
  const body = new Uint8Array(73);
  let o = 0;
  body.set(MAGIC, o); o += 4;
  body[o++] = VERSION;
  body[o++] = KIND_MINT;
  body.set(commitment, o); o += 32;
  body.set(packU64BE(nonce), o); o += 8;
  body[o++] = work;
  body[o++] = patience;
  body.set(packU32BE(burn), o); o += 4;
  body[o++] = money;
  body.set(tag, o);
  return xorChecksum(body);
}

export function buildRevealChunks(index, secret, seed, salt) {
  secret = require32("secret", secret);
  seed = require32("seed", seed);
  salt = require32("salt", salt);
  const idx = packU16BE(index);
  const aBody = new Uint8Array(73);
  let o = 0;
  aBody.set(MAGIC, o); o += 4;
  aBody[o++] = VERSION;
  aBody[o++] = KIND_REVEAL;
  aBody[o++] = 0;
  aBody.set(idx, o); o += 2;
  aBody.set(secret, o); o += 32;
  aBody.set(seed, o);
  const bBody = new Uint8Array(41);
  o = 0;
  bBody.set(MAGIC, o); o += 4;
  bBody[o++] = VERSION;
  bBody[o++] = KIND_REVEAL;
  bBody[o++] = 1;
  bBody.set(idx, o); o += 2;
  bBody.set(salt, o);
  return [xorChecksum(aBody), xorChecksum(bBody)];
}

function isqrt(n) {
  if (n <= 0n) return 0n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

function sqrtRatio(x, mx) {
  if (x <= 0) return 0;
  if (x >= mx) return 1_000_000;
  return Number(isqrt(BigInt(x) * 10n ** 12n / BigInt(mx)));
}

/** Matches indexer.score_of with MAX_BURN stubbed. */
export function scoreOf(work, patience, burn, money) {
  let s =
    WEIGHTS.work * sqrtRatio(work, MAX_WORK_BITS) +
    WEIGHTS.patience * sqrtRatio(patience, MAX_PATIENCE) +
    WEIGHTS.money * sqrtRatio(money, MAX_MONEY);
  if (MAX_BURN > 0) s += WEIGHTS.burn * sqrtRatio(burn, MAX_BURN);
  return Math.floor(s / 10_000);
}

export function powBelowTarget(powBytes, bits) {
  const tgt = targetHex(bits);
  const pow = bytesToHex(powBytes);
  return pow < tgt; // hex compare works for equal-length big-endian
}

export function randomBytes32() {
  const u = new Uint8Array(32);
  crypto.getRandomValues(u);
  return u;
}
