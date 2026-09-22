/**
 * ZIP 317 conventional fees (Revision 0 — transparent + Sapling + Orchard).
 *
 * conventional_fee = marginal_fee * max(grace_actions, logical_actions)
 * Transparent contribution uses serialized size, NOT bare input/output counts:
 *   max(ceil(tin_bytes/150), ceil(tout_bytes/34))
 *
 * https://zips.z.cash/zip-0317
 */

export const MARGINAL_FEE = 5000; // zatoshis per logical action
export const GRACE_ACTIONS = 2;
export const P2PKH_STANDARD_INPUT_SIZE = 150;
export const P2PKH_STANDARD_OUTPUT_SIZE = 34;

/** P2PKH scriptPubKey is 25 bytes → txout = 8 + 1 + 25 = 34. */
export const P2PKH_OUTPUT_SIZE = 34;

/** zcashd dust threshold rate (zatoshis per 1000 bytes), policy.h. */
export const DUST_THRESHOLD_RATE = 300;

/**
 * Serialized transparent TxOut size for an OP_RETURN carrying `dataLen` bytes.
 */
export function opReturnOutputSize(dataLen) {
  if (dataLen < 1 || dataLen > 80) {
    throw new Error(`OP_RETURN dataLen out of range: ${dataLen}`);
  }
  let scriptLen;
  if (dataLen <= 75) {
    scriptLen = 1 + 1 + dataLen;
  } else {
    scriptLen = 1 + 1 + 1 + dataLen;
  }
  return 8 + 1 + scriptLen;
}

/** Standard P2PKH input size used by ZIP 317 (signature + pubkey). */
export function p2pkhInputSize() {
  return P2PKH_STANDARD_INPUT_SIZE;
}

/**
 * Dust threshold for a serialized transparent txout (zcashd GetDustThreshold).
 * @param {number} serializedTxOutSize  typically 34 for P2PKH
 */
export function dustThresholdZat(serializedTxOutSize = P2PKH_OUTPUT_SIZE) {
  return (
    3 *
    Math.floor((DUST_THRESHOLD_RATE * (serializedTxOutSize + 148)) / 1000)
  );
}

/** If change is below dust, omit the output and let value go to the fee. */
export function shouldIncludeChangeOutput(changeZat, serializedTxOutSize = P2PKH_OUTPUT_SIZE) {
  if (changeZat <= 0) return false;
  return changeZat >= dustThresholdZat(serializedTxOutSize);
}

/**
 * @param {object} opts
 * @param {number} opts.txInTotalSize
 * @param {number} opts.txOutTotalSize
 */
export function conventionalFeeZat(opts) {
  const {
    txInTotalSize,
    txOutTotalSize,
    nJoinSplit = 0,
    nSpendsSapling = 0,
    nOutputsSapling = 0,
    nActionsOrchard = 0,
  } = opts;
  if (txInTotalSize < 0 || txOutTotalSize < 0) {
    throw new Error("tx sizes must be non-negative");
  }
  const transparent = Math.max(
    Math.ceil(txInTotalSize / P2PKH_STANDARD_INPUT_SIZE),
    Math.ceil(txOutTotalSize / P2PKH_STANDARD_OUTPUT_SIZE)
  );
  const logical =
    transparent +
    2 * nJoinSplit +
    Math.max(nSpendsSapling, nOutputsSapling) +
    nActionsOrchard;
  return MARGINAL_FEE * Math.max(GRACE_ACTIONS, logical);
}

/** Planned mint fee assuming `nIn` standard P2PKH inputs (150 bytes each). */
export function mintFeeZat(nIn = 1) {
  if (nIn < 1) throw new Error(`mint nIn must be >= 1 (got ${nIn})`);
  return mintFeeFromTxInBytes(nIn * p2pkhInputSize());
}

/** Mint fee from actual serialized transparent input bytes (C2). */
export function mintFeeFromTxInBytes(txInTotalSize, withChangeOutput = true) {
  let txOutTotalSize =
    P2PKH_OUTPUT_SIZE + opReturnOutputSize(74) + (withChangeOutput ? P2PKH_OUTPUT_SIZE : 0);
  return conventionalFeeZat({ txInTotalSize, txOutTotalSize });
}

/**
 * Reveal fee: two OP_RETURN (74 + 42). Optional P2PKH change (to user address
 * at reveal time — same size as burner change; still 30k at 1 input).
 */
export function revealFeeZat(opts = {}) {
  const { nIn = 1, withChange = true, chunkALen = 74, chunkBLen = 42 } = opts;
  if (nIn < 1) throw new Error(`reveal nIn must be >= 1 (got ${nIn})`);
  return revealFeeFromTxInBytes(nIn * p2pkhInputSize(), withChange, chunkALen, chunkBLen);
}

export function revealFeeFromTxInBytes(
  txInTotalSize,
  withChange = true,
  chunkALen = 74,
  chunkBLen = 42
) {
  let txOutTotalSize =
    opReturnOutputSize(chunkALen) + opReturnOutputSize(chunkBLen);
  if (withChange) txOutTotalSize += P2PKH_OUTPUT_SIZE;
  return conventionalFeeZat({ txInTotalSize, txOutTotalSize });
}

/** Abandon-only sweep: inputs → one P2PKH output (exception path). */
export function abandonSweepFeeFromTxInBytes(txInTotalSize) {
  return conventionalFeeZat({
    txInTotalSize,
    txOutTotalSize: P2PKH_OUTPUT_SIZE,
  });
}
