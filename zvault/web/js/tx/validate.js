/**
 * T7 — validate before value.
 *
 * Never trust a locally signed transaction. Round-trip through the node
 * (decoderawtransaction and/or sendrawtransaction) before treating it as
 * correct. On testnet, prefer broadcasting and confirming acceptance.
 */

/**
 * @param {string} signedHex
 * @param {(method: string, params?: unknown[]) => Promise<unknown>} rpcCall
 * @param {{ broadcast?: boolean }} [opts]
 * @returns {Promise<{ decoded: object, txid?: string, accepted: boolean }>}
 */
export async function validateSignedTx(signedHex, rpcCall, opts = {}) {
  const { broadcast = true } = opts;
  if (typeof rpcCall !== "function") {
    throw new Error("rpcCall required — validation is against a live node");
  }
  const hx = String(signedHex || "")
    .trim()
    .toLowerCase()
    .replace(/^0x/, "");
  if (!hx || hx.length % 2 || /[^0-9a-f]/.test(hx)) {
    throw new Error("signed hex invalid");
  }

  let decoded;
  try {
    decoded = await rpcCall("decoderawtransaction", [hx]);
  } catch (e) {
    throw new Error(`decoderawtransaction rejected: ${e.message || e}`);
  }
  if (!decoded || typeof decoded !== "object") {
    throw new Error("decoderawtransaction returned empty");
  }

  if (!broadcast) {
    return { decoded, accepted: false };
  }

  // Testnet preference: acceptance by the mempool is the real check.
  const txid = await rpcCall("sendrawtransaction", [hx]);
  if (!txid || typeof txid !== "string") {
    throw new Error("sendrawtransaction returned no txid");
  }
  return { decoded, txid, accepted: true };
}

/**
 * Client helper: POST signed hex to the postbox relay.
 * The page MUST also display the hex so users can broadcast without the relay.
 *
 * @param {string} relayBase  e.g. http://127.0.0.1:8091
 * @param {string} signedHex
 */
export async function relayBroadcast(relayBase, signedHex) {
  const url = `${relayBase.replace(/\/$/, "")}/broadcast`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hex: signedHex }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `relay HTTP ${res.status}`);
  }
  if (!body.txid) throw new Error("relay returned no txid");
  return body.txid;
}
