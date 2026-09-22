/**
 * Funding the burner for mint + reveal + buffer.
 *
 * The displayed total is ALWAYS derived from live floor × (1 + money) — never
 * a hardcoded constant (265_000 is only epoch 0 / money 0).
 */

import {
  mintFeeZat,
  revealFeeZat,
  MARGINAL_FEE,
} from "./zip317.js";

/** Unrecoverable buffer (sweep costs ≥ one tx fee). */
export const FUNDING_BUFFER_ZAT = MARGINAL_FEE * 2; // 10_000

/**
 * Treasury payment from table floor and bid money multiple.
 * @param {number} floorPriceZat  live `floor_price_zat` from table.json
 * @param {number} moneyMultiple  0..12
 */
export function payZatFromBid(floorPriceZat, moneyMultiple) {
  if (!Number.isInteger(floorPriceZat) || floorPriceZat < 0) {
    throw new Error(`floorPriceZat invalid: ${floorPriceZat}`);
  }
  if (!Number.isInteger(moneyMultiple) || moneyMultiple < 0) {
    throw new Error(`moneyMultiple invalid: ${moneyMultiple}`);
  }
  return floorPriceZat * (1 + moneyMultiple);
}

/**
 * @param {object} opts
 * @param {number} opts.payZat
 * @param {number} [opts.nInMint=1]
 * @param {number} [opts.nInReveal=1]
 * @param {boolean} [opts.revealWithChange=true]  reveal change → user address (C3)
 */
export function fundingAmount(opts) {
  const {
    payZat,
    nInMint = 1,
    nInReveal = 1,
    revealWithChange = true,
    bufferZat = FUNDING_BUFFER_ZAT,
  } = opts;
  if (!Number.isInteger(payZat) || payZat < 0) {
    throw new Error(`payZat must be a non-negative integer (got ${payZat})`);
  }
  const mFee = mintFeeZat(nInMint);
  const rFee = revealFeeZat({ nIn: nInReveal, withChange: revealWithChange });
  const totalZat = payZat + mFee + rFee + bufferZat;
  return {
    totalZat,
    payZat,
    mintFeeZat: mFee,
    revealFeeZat: rFee,
    bufferZat,
    floorPriceZat: null,
    moneyMultiple: null,
  };
}

/** C1: one funding figure from live floor + money (page display). */
export function fundingFromBid(floorPriceZat, moneyMultiple, opts = {}) {
  const payZat = payZatFromBid(floorPriceZat, moneyMultiple);
  const f = fundingAmount({ payZat, ...opts });
  return { ...f, floorPriceZat, moneyMultiple };
}

/**
 * @param {number} burnerBalanceZat
 * @param {ReturnType<typeof fundingAmount>} funding
 */
export function assertBurnerFunded(burnerBalanceZat, funding) {
  if (!Number.isInteger(burnerBalanceZat) || burnerBalanceZat < 0) {
    throw new Error(`burner balance invalid: ${burnerBalanceZat}`);
  }
  if (burnerBalanceZat < funding.totalZat) {
    throw new Error(
      `burner underfunded: have ${burnerBalanceZat} zat, need ${funding.totalZat} zat ` +
        `(pay ${funding.payZat} + mint fee ${funding.mintFeeZat} + reveal fee ${funding.revealFeeZat} + buffer ${funding.bufferZat}). ` +
        `Minting now would risk a box that can never be revealed.`
    );
  }
  return true;
}

export function formatZec(zat) {
  return (zat / 1e8).toFixed(8);
}
