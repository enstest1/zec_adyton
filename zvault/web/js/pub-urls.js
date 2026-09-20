/**
 * Same-origin gate for ?table= / ?state= overrides.
 *
 * A hostile link on our origin with ?table=https://evil.com/... must not
 * silently fetch attacker floor_price / tip_hash. Cross-origin is refused
 * loudly — never fall back to defaults after a bad override.
 */
import {
  ALLOW_QUERY_PUB_OVERRIDE,
  DEFAULT_STATE_URL,
  DEFAULT_TABLE_URL,
} from "./config.js";

/**
 * Resolve one pub path. `raw` is the query value (or null).
 * @param {string|null} raw
 * @param {string} pageHref  document / location href used as base
 * @param {string} defaultPath
 * @returns {string} absolute same-origin href
 */
export function resolvePubUrl(raw, pageHref, defaultPath) {
  const page = new URL(pageHref);
  if (raw == null || raw === "") {
    return new URL(defaultPath, page).href;
  }
  let target;
  try {
    target = new URL(raw, page);
  } catch {
    throw new Error(`REFUSED invalid pub URL: ${raw}`);
  }
  // data:, blob:, file: etc. have opaque / non-matching origins
  if (target.origin !== page.origin) {
    throw new Error(
      `REFUSED cross-origin pub URL override: ${target.origin} ≠ ${page.origin}. ` +
        `?table= / ?state= may only point at same-origin paths.`,
    );
  }
  return target.href;
}

/**
 * Resolve table + state URLs from search params.
 * @param {URLSearchParams|Map|object} params
 * @param {string} pageHref
 * @param {{ allowOverride?: boolean }} [opts]  tests may force the flag
 */
export function resolveTableStateUrls(params, pageHref, opts = {}) {
  const get = (k) => {
    if (typeof params.get === "function") return params.get(k);
    return params[k] ?? null;
  };
  const tableRaw = get("table");
  const stateRaw = get("state");
  const allow =
    opts.allowOverride !== undefined
      ? opts.allowOverride
      : ALLOW_QUERY_PUB_OVERRIDE;

  if ((tableRaw || stateRaw) && !allow) {
    throw new Error(
      "REFUSED: ?table= / ?state= overrides are disabled in this build " +
        "(ALLOW_QUERY_PUB_OVERRIDE=false). Use same-origin defaults only.",
    );
  }

  return {
    table: resolvePubUrl(tableRaw, pageHref, DEFAULT_TABLE_URL),
    state: resolvePubUrl(stateRaw, pageHref, DEFAULT_STATE_URL),
  };
}
