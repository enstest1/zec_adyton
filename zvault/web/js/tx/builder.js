/**
 * Transparent mint / reveal / abandon builders (S5).
 * Flow: plan → unsigned v5 → ZIP 244 sighash → low-S sign → scriptSig →
 * serialize → validate.js (decode + broadcast).
 */
import { planMintSign, planRevealSign, planAbandonSweep } from "./plan.js";
import { signatureDigest, SIGHASH_ALL } from "./zip244.js";
import { parseTxV5 } from "./v5.js";
import {
  serializeTxV5Transparent,
  makePrevout,
  p2pkhScriptSig,
  bytesToHex,
  hexToBytes,
} from "./serialize.js";
import { signSighashLowS, compactToDerScriptSig, privToPub } from "./keys.js";
import {
  p2pkhScriptPubKey,
  opReturnScript,
  base58CheckDecode,
  p2pkhPrefix,
  pubKeyHash,
} from "./address.js";

function txidToWire(txidHex) {
  const b = hexToBytes(txidHex);
  return b.reverse();
}

function hash160FromAddress(addr, network) {
  const payload = base58CheckDecode(addr);
  const prefix = p2pkhPrefix(network);
  if (payload.length !== prefix.length + 20) {
    throw new Error("unexpected address payload length");
  }
  for (let i = 0; i < prefix.length; i++) {
    if (payload[i] !== prefix[i]) throw new Error("address prefix mismatch for network");
  }
  return payload.subarray(prefix.length);
}

function emptySig() {
  return new Uint8Array(0);
}

function scriptForOurPub(pub) {
  return p2pkhScriptPubKey(pubKeyHash(pub));
}

/**
 * Sign all transparent inputs of a v5 tx skeleton.
 */
export function signTransparentInputs(skeleton, utxos, priv) {
  const pub = privToPub(priv);
  const tInputs = utxos.map((u) => ({
    amount: u.valueZat,
    scriptPubKey: u.scriptPubKey || scriptForOurPub(pub),
  }));

  const unsignedBytes = serializeTxV5Transparent(skeleton);
  const parsed = parseTxV5(unsignedBytes);

  const signedVin = [];
  for (let i = 0; i < utxos.length; i++) {
    const txin = {
      nIn: i,
      amount: tInputs[i].amount,
      scriptPubKey: tInputs[i].scriptPubKey,
    };
    const digest = signatureDigest(parsed, tInputs, SIGHASH_ALL, txin);
    const compact = signSighashLowS(digest, priv);
    const der = compactToDerScriptSig(compact, SIGHASH_ALL);
    signedVin.push({
      prevout: skeleton.vin[i].prevout,
      scriptSig: p2pkhScriptSig(der, pub),
      nSequence: skeleton.vin[i].nSequence ?? 0xffffffff,
    });
  }

  const signed = { ...skeleton, vin: signedVin };
  const raw = serializeTxV5Transparent(signed);
  parseTxV5(raw); // round-trip
  return { raw, hex: bytesToHex(raw), signed };
}

export function buildSignMint({
  utxos,
  payZat,
  treasuryAddress,
  opReturnPayload,
  changeAddress,
  network,
  consensusBranchId,
  nExpiryHeight = 0,
  priv,
}) {
  const pub = privToPub(priv);
  const enriched = utxos.map((u) => ({
    ...u,
    scriptPubKey: u.scriptPubKey || scriptForOurPub(pub),
  }));
  const plan = planMintSign({
    utxos: enriched.map((u) => ({ valueZat: u.valueZat, txInSize: 150 })),
    payZat,
  });

  const vout = [
    {
      valueZat: payZat,
      scriptPubKey: p2pkhScriptPubKey(hash160FromAddress(treasuryAddress, network)),
    },
    { valueZat: 0, scriptPubKey: opReturnScript(opReturnPayload) },
  ];
  if (plan.includeChange) {
    vout.push({
      valueZat: plan.changeZat,
      scriptPubKey: p2pkhScriptPubKey(hash160FromAddress(changeAddress, network)),
    });
  }

  const skeleton = {
    nConsensusBranchId: consensusBranchId,
    nLockTime: 0,
    nExpiryHeight,
    vin: enriched.map((u) => ({
      prevout: makePrevout(txidToWire(u.txidHex), u.vout),
      scriptSig: emptySig(),
      nSequence: 0xffffffff,
    })),
    vout,
  };

  const { raw, hex } = signTransparentInputs(skeleton, enriched, priv);
  return { ...plan, hex, raw };
}

export function buildSignReveal({
  utxos,
  chunkA,
  chunkB,
  returnAddress,
  network,
  consensusBranchId,
  nExpiryHeight = 0,
  priv,
}) {
  const pub = privToPub(priv);
  const enriched = utxos.map((u) => ({
    ...u,
    scriptPubKey: u.scriptPubKey || scriptForOurPub(pub),
  }));
  const plan = planRevealSign({
    utxos: enriched.map((u) => ({ valueZat: u.valueZat, txInSize: 150 })),
  });

  const vout = [
    { valueZat: 0, scriptPubKey: opReturnScript(chunkA) },
    { valueZat: 0, scriptPubKey: opReturnScript(chunkB) },
  ];
  if (plan.includeChange) {
    vout.push({
      valueZat: plan.changeZat,
      scriptPubKey: p2pkhScriptPubKey(hash160FromAddress(returnAddress, network)),
    });
  }

  const skeleton = {
    nConsensusBranchId: consensusBranchId,
    nLockTime: 0,
    nExpiryHeight,
    vin: enriched.map((u) => ({
      prevout: makePrevout(txidToWire(u.txidHex), u.vout),
      scriptSig: emptySig(),
      nSequence: 0xffffffff,
    })),
    vout,
  };

  const { hex, raw } = signTransparentInputs(skeleton, enriched, priv);
  return { ...plan, hex, raw };
}

export function buildSignAbandonSweep({
  utxos,
  destAddress,
  network,
  consensusBranchId,
  nExpiryHeight = 0,
  priv,
}) {
  const pub = privToPub(priv);
  const enriched = utxos.map((u) => ({
    ...u,
    scriptPubKey: u.scriptPubKey || scriptForOurPub(pub),
  }));
  const plan = planAbandonSweep({
    utxos: enriched.map((u) => ({ valueZat: u.valueZat, txInSize: 150 })),
  });

  const skeleton = {
    nConsensusBranchId: consensusBranchId,
    nLockTime: 0,
    nExpiryHeight,
    vin: enriched.map((u) => ({
      prevout: makePrevout(txidToWire(u.txidHex), u.vout),
      scriptSig: emptySig(),
      nSequence: 0xffffffff,
    })),
    vout: [
      {
        valueZat: plan.sendZat,
        scriptPubKey: p2pkhScriptPubKey(hash160FromAddress(destAddress, network)),
      },
    ],
  };

  const { hex, raw } = signTransparentInputs(skeleton, enriched, priv);
  return { ...plan, hex, raw };
}
