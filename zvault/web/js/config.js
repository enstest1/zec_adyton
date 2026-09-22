/**
 * Network-scoped owner constants (X1).
 *
 * Mainnet pair is launch-gated (placeholder fails owner-constants test).
 * Testnet pair is free for dry runs. Selected by PAGE_NETWORK / node chain —
 * NEVER from table.json / query string alone without a network check.
 *
 * A testnet treasury must never be used when the node reports mainnet.
 */
export const TREASURY_MAINNET = "t1ZVaultTreasuryAddressGoesHere00000";
export const LAUNCH_HEIGHT_MAINNET = 2_900_000;

/** Testnet dry-run treasury (operator-controlled tm…). Privkey not in-repo. */
export const TREASURY_TESTNET = "tmBsjJiZN4MJMPirvpRb6r53MrJTAZ9Fur7";
export const LAUNCH_HEIGHT_TESTNET = 4_377_000;

/** Page network for this build — "test" until mainnet launch. */
export const PAGE_NETWORK = "test";

/**
 * @param {string} network  getblockchaininfo().chain — "main" | "test" | "regtest"
 * @returns {{ treasury: string, launchHeight: number, network: string }}
 */
export function constantsForNetwork(network) {
  if (network == null || !String(network).trim()) {
    throw new Error("network required — refuse to default treasury/launch height");
  }
  const n = String(network).trim().toLowerCase();
  if (n === "main" || n === "mainnet") {
    return {
      treasury: TREASURY_MAINNET,
      launchHeight: LAUNCH_HEIGHT_MAINNET,
      network: "main",
    };
  }
  if (n === "test" || n === "testnet") {
    return {
      treasury: TREASURY_TESTNET,
      launchHeight: LAUNCH_HEIGHT_TESTNET,
      network: "test",
    };
  }
  if (n === "regtest" || n === "reg") {
    return {
      treasury: TREASURY_TESTNET,
      launchHeight: LAUNCH_HEIGHT_TESTNET,
      network: "regtest",
    };
  }
  throw new Error(`unknown network ${network} — refuse to pick treasury`);
}

/**
 * Refuse cross-network treasury use (test address must never reach mainnet).
 * @param {string} treasury
 * @param {string} network
 */
export function assertTreasuryForNetwork(treasury, network) {
  constantsForNetwork(network); // validate network first
  const n = String(network).trim().toLowerCase();
  if (n === "main" || n === "mainnet") {
    if (treasury.startsWith("tm") || treasury === TREASURY_TESTNET) {
      throw new Error("testnet treasury cannot be used when node reports mainnet");
    }
    if (!treasury.startsWith("t1")) {
      throw new Error(`mainnet treasury must be t1… (got ${treasury.slice(0, 8)})`);
    }
  }
  if (n === "test" || n === "testnet" || n === "regtest" || n === "reg") {
    if (treasury.startsWith("t1") || treasury === TREASURY_MAINNET) {
      throw new Error("mainnet treasury cannot be used when node reports testnet");
    }
    if (!treasury.startsWith("tm")) {
      throw new Error(`testnet treasury must be tm… (got ${treasury.slice(0, 8)})`);
    }
  }
  return constantsForNetwork(network).treasury;
}

/** Active page treasury — follows PAGE_NETWORK (testnet dry-run builds). */
export const TREASURY = constantsForNetwork(PAGE_NETWORK).treasury;

/** Default same-origin pub paths (relative to the page). */
export const DEFAULT_TABLE_URL = "./pub/table.json";
export const DEFAULT_STATE_URL = "./pub/state.json";

/**
 * When false (published build), any ?table= / ?state= query override is
 * refused. Flip to true only for local fixture work — still same-origin only.
 */
export const ALLOW_QUERY_PUB_OVERRIDE = false;
