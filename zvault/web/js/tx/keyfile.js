/**
 * Keyfile helpers — funds + openability. Recoverable in a fresh session
 * from the keyfile alone (no tab state / localStorage).
 */

export const KEYFILE_FUNDS_WARNING =
  "WARNING: This keyfile protects FUNDS as well as openability. " +
  "Losing it loses the mint, the ability to reveal, AND anything left in the burner. " +
  "There is no recovery path. Store offline. Never paste into a form.";

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
  if (!entry.secret || !entry.seed || !entry.salt) {
    throw new Error("keyfile missing openability material (secret/seed/salt)");
  }
  return {
    entry,
    burnerPrivHex: burner?.priv_hex || burner?.privKeyHex || null,
    burnerAddress: burner?.address || null,
    minerTag: entry.tag || burner?.tag || null,
    revealReturnAddress: revealReturn,
    canAbandonSweep: Boolean(burner?.priv_hex || burner?.privKeyHex),
    canReveal: Boolean(entry.secret && entry.seed && entry.salt),
    canRevealWithChange: Boolean(
      (burner?.priv_hex || burner?.privKeyHex) && revealReturn
    ),
  };
}
