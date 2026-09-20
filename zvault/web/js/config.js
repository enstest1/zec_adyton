/**
 * Build-time page constants. Owner sets TREASURY before launch.
 *
 * TREASURY must match zcash/indexer.py exactly. It must NEVER be read from
 * table.json, state.json, the query string, or any other fetched / user value.
 */
export const TREASURY = "t1ZVaultTreasuryAddressGoesHere00000";

/** Default same-origin pub paths (relative to the page). */
export const DEFAULT_TABLE_URL = "./pub/table.json";
export const DEFAULT_STATE_URL = "./pub/state.json";

/**
 * When false (published build), any ?table= / ?state= query override is
 * refused. Flip to true only for local fixture work — still same-origin only.
 */
export const ALLOW_QUERY_PUB_OVERRIDE = false;
