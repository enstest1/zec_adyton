/**
 * Transaction planning at signing time (C2, C3, T5).
 *
 * Fees are computed from real UTXO sets — never assumed 1-input at sign.
 * Reveal change goes to a user-nominated address (main path). Standalone
 * sweep is abandon-only (funded, never minted).
 */

import {
  P2PKH_OUTPUT_SIZE,
  abandonSweepFeeFromTxInBytes,
  conventionalFeeZat,
  mintFeeFromTxInBytes,
  opReturnOutputSize,
  revealFeeFromTxInBytes,
  shouldIncludeChangeOutput,
} from "./zip317.js";

/**
 * @typedef {{ valueZat: number, txInSize?: number }} TransparentUtxo
 */

export function totalTxInBytes(utxos) {
  return utxos.reduce((s, u) => s + (u.txInSize ?? 150), 0);
}

export function sumUtxoValues(utxos) {
  return utxos.reduce((s, u) => s + u.valueZat, 0);
}

/**
 * Plan a mint sign: treasury + OP_RETURN(74) + optional change to burner.
 * Recomputes fee when change is dropped as dust (C3 dust rule).
 *
 * @param {object} p
 * @param {TransparentUtxo[]} p.utxos
 * @param {number} p.payZat
 */
export function planMintSign({ utxos, payZat }) {
  if (!utxos?.length) throw new Error("mint: no UTXOs selected");
  const tin = totalTxInBytes(utxos);
  const inputSum = sumUtxoValues(utxos);

  let txOutTotalSize =
    P2PKH_OUTPUT_SIZE + opReturnOutputSize(74) + P2PKH_OUTPUT_SIZE;
  let feeZat = conventionalFeeZat({ txInTotalSize: tin, txOutTotalSize });
  let changeZat = inputSum - payZat - feeZat;
  let includeChange = shouldIncludeChangeOutput(changeZat, P2PKH_OUTPUT_SIZE);

  if (!includeChange && changeZat > 0) {
    txOutTotalSize = P2PKH_OUTPUT_SIZE + opReturnOutputSize(74);
    feeZat = conventionalFeeZat({ txInTotalSize: tin, txOutTotalSize });
    changeZat = inputSum - payZat - feeZat;
    if (changeZat < 0) {
      throw new Error(
        `mint: short ${-changeZat} zat after dropping dust change ` +
          `(need pay ${payZat} + fee ${feeZat}, have ${inputSum} zat from ${utxos.length} input(s))`
      );
    }
    changeZat = 0;
  } else if (changeZat < 0) {
    throw new Error(
      `mint: short ${-changeZat} zat ` +
        `(need pay ${payZat} + fee ${feeZat}, have ${inputSum} zat from ${utxos.length} input(s))`
    );
  }

  return {
    feeZat,
    changeZat: includeChange ? changeZat : 0,
    includeChange,
    inputSum,
    payZat,
    nIn: utxos.length,
    txInTotalSize: tin,
  };
}

/**
 * Plan reveal: two OP_RETURNs; change to user address (not burner) when above dust.
 *
 * @param {object} p
 * @param {TransparentUtxo[]} p.utxos
 */
export function planRevealSign({ utxos }) {
  if (!utxos?.length) throw new Error("reveal: no UTXOs selected");
  const tin = totalTxInBytes(utxos);
  const inputSum = sumUtxoValues(utxos);

  let txOutTotalSize =
    opReturnOutputSize(74) + opReturnOutputSize(42) + P2PKH_OUTPUT_SIZE;
  let feeZat = conventionalFeeZat({ txInTotalSize: tin, txOutTotalSize });
  let changeZat = inputSum - feeZat;
  let includeChange = shouldIncludeChangeOutput(changeZat, P2PKH_OUTPUT_SIZE);

  if (!includeChange && changeZat > 0) {
    txOutTotalSize = opReturnOutputSize(74) + opReturnOutputSize(42);
    feeZat = conventionalFeeZat({ txInTotalSize: tin, txOutTotalSize });
    changeZat = inputSum - feeZat;
    if (changeZat < 0) {
      throw new Error(
        `reveal: short ${-changeZat} zat after dropping dust change ` +
          `(need fee ${feeZat}, have ${inputSum} zat)`
      );
    }
    changeZat = 0;
  } else if (changeZat < 0) {
    throw new Error(
      `reveal: short ${-changeZat} zat (need fee ${feeZat}, have ${inputSum} zat from ${utxos.length} input(s))`
    );
  }

  return {
    feeZat,
    changeZat: includeChange ? changeZat : 0,
    includeChange,
    changeToUser: includeChange,
    inputSum,
    nIn: utxos.length,
    txInTotalSize: tin,
  };
}

/**
 * Abandon path: user funded burner but never minted — sweep all inputs to `dest`.
 */
export function planAbandonSweep({ utxos }) {
  if (!utxos?.length) throw new Error("abandon sweep: no UTXOs");
  const tin = totalTxInBytes(utxos);
  const inputSum = sumUtxoValues(utxos);
  const feeZat = abandonSweepFeeFromTxInBytes(tin);
  const sendZat = inputSum - feeZat;
  if (sendZat <= 0) {
    throw new Error(
      `abandon sweep: ${inputSum} zat insufficient for fee ${feeZat} (${utxos.length} inputs)`
    );
  }
  if (!shouldIncludeChangeOutput(sendZat, P2PKH_OUTPUT_SIZE)) {
    throw new Error(
      `abandon sweep: remainder ${sendZat} zat below dust — cannot create output`
    );
  }
  return { feeZat, sendZat, inputSum, nIn: utxos.length, txInTotalSize: tin };
}

/** C2: refuse mint sign if real UTXO set cannot cover pay + recomputed fee. */
export function assertMintSignAffordable(utxos, payZat) {
  return planMintSign({ utxos, payZat });
}

/** After mint, reveal spends burner change; verify one-input reveal is affordable. */
export function assertRevealAffordableFromBurnerChange(mintPlan) {
  if (!mintPlan.includeChange || mintPlan.changeZat <= 0) {
    throw new Error(
      "reveal: no spendable change left on burner after mint (dust absorbed into fee)"
    );
  }
  const utxos = [{ valueZat: mintPlan.changeZat, txInSize: 150 }];
  return planRevealSign({ utxos });
}
