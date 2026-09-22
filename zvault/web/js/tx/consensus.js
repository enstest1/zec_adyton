/**
 * Consensus branch ID for the NEXT block — never hardcoded.
 *
 * Source: getblockchaininfo().consensus.nextblock (zcashd / zebrad / Zaino).
 * A hardcoded branch ID silently invalidates every signature at the next
 * network upgrade. Missing or unparseable values must throw, not default.
 */

/**
 * Parse a consensus branch id from RPC hex ("aabbccdd" or "0xaabbccdd")
 * or a non-negative integer. Returns unsigned 32-bit.
 * @param {string|number} raw
 * @returns {number}
 */
export function parseBranchId(raw) {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0 || raw > 0xffffffff) {
      throw new Error(`consensus branch id out of u32 range: ${raw}`);
    }
    return raw >>> 0;
  }
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("consensus branch id missing or empty");
  }
  const s = raw.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{1,8}$/.test(s)) {
    throw new Error(`consensus branch id not hex u32: ${raw}`);
  }
  const n = Number.parseInt(s, 16);
  if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) {
    throw new Error(`consensus branch id out of u32 range: ${raw}`);
  }
  return n >>> 0;
}

/**
 * Extract the branch ID that must be used when signing a tx that will land
 * in the next mined block.
 *
 * @param {object} blockchainInfo  result of getblockchaininfo
 * @returns {number} uint32 consensus branch id
 */
export function consensusBranchIdForNextBlock(blockchainInfo) {
  if (!blockchainInfo || typeof blockchainInfo !== "object") {
    throw new Error("getblockchaininfo result missing");
  }
  const consensus = blockchainInfo.consensus;
  if (consensus == null || typeof consensus !== "object") {
    throw new Error(
      "getblockchaininfo.consensus missing — refusing to default a branch id"
    );
  }
  if (!Object.prototype.hasOwnProperty.call(consensus, "nextblock")) {
    throw new Error(
      "getblockchaininfo.consensus.nextblock missing — refusing to default a branch id"
    );
  }
  const next = consensus.nextblock;
  if (next == null || next === "") {
    throw new Error(
      "getblockchaininfo.consensus.nextblock empty — refusing to default a branch id"
    );
  }
  return parseBranchId(next);
}

/**
 * Async helper: call getblockchaininfo via an injected RPC function and
 * return the next-block branch id. The fetcher is injected so this module
 * never embeds a URL or a standby branch-id constant.
 *
 * @param {(method: string, params?: unknown[]) => Promise<object>} rpcCall
 */
export async function fetchConsensusBranchId(rpcCall) {
  if (typeof rpcCall !== "function") {
    throw new Error("rpcCall function required — branch id is runtime-only");
  }
  const info = await rpcCall("getblockchaininfo", []);
  return consensusBranchIdForNextBlock(info);
}
