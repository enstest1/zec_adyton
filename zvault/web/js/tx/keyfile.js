/**
 * Keyfile helpers — funds + openability. Recoverable in a fresh session
 * from the keyfile alone (no tab state / localStorage).
 *
 * Two stages (B1):
 *   stage "funds" — burner privkey only; enough to sweep / top-up safety
 *   stage "mint"  — adds secret/seed/salt; enough to reveal
 */

export const KEYFILE_FUNDS_WARNING =
  "WARNING: This keyfile protects FUNDS as well as openability. " +
  "Losing it loses the mint, the ability to reveal, AND anything left in the burner. " +
  "There is no recovery path. Store offline. Never paste into a form.";

export const KEYFILE_STAGE_FUNDS = "funds";
export const KEYFILE_STAGE_MINT = "mint";

/**
 * Build the downloadable keyfile object. Always embeds the funds warning.
 * @param {object} fields
 */
export function buildKeyfile(fields) {
  const out = {
    warning: KEYFILE_FUNDS_WARNING,
    protocol: "zvault-v2",
    ...fields,
  };
  return out;
}

/**
 * Fresh-session recovery: given only keyfile JSON, return what abandon-sweep
 * and reveal need. No DOM / localStorage.
 *
 * Stage-1 (funds) files omit secret/seed/salt — canAbandonSweep only.
 * Stage-2 (mint) requires openability material.
 *
 * @param {object|object[]} raw
 */
export function recoverFromKeyfile(raw) {
  const entry = Array.isArray(raw) ? raw[0] : raw;
  if (!entry || typeof entry !== "object") {
    throw new Error("keyfile empty");
  }
  if (!entry.warning || !/FUNDS/i.test(entry.warning)) {
    throw new Error("keyfile missing FUNDS warning — refuse stale format");
  }
  const burner = entry.burner || null;
  const revealReturn =
    entry.reveal_return_address || entry.sweep_to || null;
  const hasOpen =
    Boolean(entry.secret) && Boolean(entry.seed) && Boolean(entry.salt);
  const stage =
    entry.stage ||
    (hasOpen ? KEYFILE_STAGE_MINT : KEYFILE_STAGE_FUNDS);

  if (stage === KEYFILE_STAGE_MINT && !hasOpen) {
    throw new Error("keyfile missing openability material (secret/seed/salt)");
  }
  // Legacy files without stage but with secrets: treat as mint.
  if (stage !== KEYFILE_STAGE_FUNDS && !hasOpen) {
    throw new Error("keyfile missing openability material (secret/seed/salt)");
  }

  const canAbandon = Boolean(burner?.priv_hex || burner?.privKeyHex);
  if (stage === KEYFILE_STAGE_FUNDS && !canAbandon) {
    throw new Error("funds-stage keyfile missing burner.priv_hex");
  }

  return {
    entry,
    stage,
    burnerPrivHex: burner?.priv_hex || burner?.privKeyHex || null,
    burnerAddress: burner?.address || null,
    minerTag: entry.tag || burner?.tag || null,
    revealReturnAddress: revealReturn,
    canAbandonSweep: canAbandon,
    canReveal: hasOpen,
    canRevealWithChange: Boolean(canAbandon && revealReturn && hasOpen),
    canMintSign: Boolean(canAbandon && hasOpen && entry.commitment && entry.nonce != null),
  };
}
