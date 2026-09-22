/**
 * S1–S4 tests: low-S, address prefixes, serialize round-trip, builder smoke.
 * Run: node js/tx/test_builder.mjs
 */
import { generatePrivKey, signSighashLowS, forceHighSCompact, secp } from "./keys.js";
import { addressFromPriv, confirmAddressWithNode, P2PKH_PREFIX } from "./address.js";
import { serializeTxV5Transparent, makePrevout, bytesToHex, hexToBytes } from "./serialize.js";
import { parseTxV5 } from "./v5.js";
import { buildSignMint, buildSignAbandonSweep } from "./builder.js";
import { SIGHASH_ALL } from "./zip244.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert");
}

// --- S1 low-S ---
const priv = generatePrivKey();
const msg = new Uint8Array(32).fill(7);
const compact = signSighashLowS(msg, priv);
const sig = secp.Signature.fromCompact(compact);
assert(!sig.hasHighS(), "sign must produce low-S");
const high = forceHighSCompact(compact);
assert(secp.Signature.fromCompact(high).hasHighS(), "forceHighS");
assert(secp.etc.bytesToHex(compact) !== secp.etc.bytesToHex(high), "high≠low");

// --- S3 address network prefixes (from chainparams.cpp) ---
assert(P2PKH_PREFIX.main[0] === 0x1c && P2PKH_PREFIX.main[1] === 0xb8);
assert(P2PKH_PREFIX.test[0] === 0x1d && P2PKH_PREFIX.test[1] === 0x25);
const tm = addressFromPriv(priv, "test");
assert(tm.address.startsWith("tm"), tm.address);
const t1 = addressFromPriv(priv, "main");
assert(t1.address.startsWith("t1"), t1.address);

// Mock validateaddress
await confirmAddressWithNode(tm.address, async (m, p) => {
  assert(m === "validateaddress" && p[0] === tm.address);
  return { isvalid: true, address: tm.address };
});

// --- S4 serialize ↔ parse round-trip ---
const prev = makePrevout(new Uint8Array(32).fill(1), 0);
const raw = serializeTxV5Transparent({
  nConsensusBranchId: 0x37a5165b,
  nLockTime: 0,
  nExpiryHeight: 100,
  vin: [{ prevout: prev, scriptSig: new Uint8Array(0), nSequence: 0xffffffff }],
  vout: [
    {
      valueZat: 200_000,
      scriptPubKey: new Uint8Array(25).fill(0x76),
    },
  ],
});
const parsed = parseTxV5(raw);
assert(parsed.nConsensusBranchId === 0x37a5165b);
assert(parsed.vin.length === 1 && parsed.vout.length === 1);
assert(parsed.vSpendsSapling.length === 0);

// --- S5 builder smoke (mint) ---
const fakeTxid = bytesToHex(new Uint8Array(32).fill(9));
const built = buildSignMint({
  utxos: [{ txidHex: fakeTxid, vout: 0, valueZat: 300_000 }],
  payZat: 200_000,
  treasuryAddress: tm.address,
  opReturnPayload: new Uint8Array(74).fill(0x5a),
  changeAddress: tm.address,
  network: "test",
  consensusBranchId: 0x37a5165b,
  nExpiryHeight: 50,
  priv,
});
assert(built.hex.length > 100);
assert(built.feeZat === 25_000);
parseTxV5(hexToBytes(built.hex));

const abandon = buildSignAbandonSweep({
  utxos: [{ txidHex: fakeTxid, vout: 0, valueZat: 300_000 }],
  destAddress: tm.address,
  network: "test",
  consensusBranchId: 0x37a5165b,
  priv,
});
assert(abandon.sendZat > 0);

console.log(
  "S1–S5 builder OK — low-S, tm/t1 prefixes, v5 round-trip, mint+abandon signed;",
  "testnet addr",
  tm.address
);
