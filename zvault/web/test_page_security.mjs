/**
 * Page security gates — treasury is build-time; pub URLs are same-origin.
 *
 *   node web/test_page_security.mjs
 */
import { TREASURY, ALLOW_QUERY_PUB_OVERRIDE } from "./js/config.js";
import { resolvePubUrl, resolveTableStateUrls } from "./js/pub-urls.js";

const PAGE = "https://zvault.example/mint/index.html";
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error("FAIL", msg);
  } else {
    console.log("ok ", msg);
  }
}

function assertThrows(fn, needle, msg) {
  try {
    fn();
    failed += 1;
    console.error("FAIL", msg, "(no throw)");
  } catch (e) {
    const text = String(e && e.message ? e.message : e);
    if (!text.includes(needle)) {
      failed += 1;
      console.error("FAIL", msg, "threw but missing", needle, "→", text);
    } else {
      console.log("ok ", msg);
    }
  }
}

// Treasury must be a non-empty page constant — never empty / never "from state"
assert(typeof TREASURY === "string" && TREASURY.length > 8, "TREASURY is hardcoded");
assert(TREASURY.startsWith("t1") || TREASURY.startsWith("t3"),
  "TREASURY looks like a transparent Zcash address prefix");
assert(ALLOW_QUERY_PUB_OVERRIDE === false, "published build disables query overrides");

// Defaults resolve same-origin
{
  const u = resolveTableStateUrls(new URLSearchParams(""), PAGE);
  assert(u.table === "https://zvault.example/mint/pub/table.json", "default table same-origin");
  assert(u.state === "https://zvault.example/mint/pub/state.json", "default state same-origin");
}

// Published build: any override refused loudly (no silent fallback)
assertThrows(
  () => resolveTableStateUrls(new URLSearchParams("table=./pub/x.json"), PAGE),
  "REFUSED",
  "query override refused when ALLOW_QUERY_PUB_OVERRIDE=false",
);

// Dev mode (flag on): same-origin relative OK, cross-origin refused
{
  const u = resolveTableStateUrls(
    new URLSearchParams("table=./fixture/table.json&state=./fixture/state.json"),
    PAGE,
    { allowOverride: true },
  );
  assert(
    u.table === "https://zvault.example/mint/fixture/table.json",
    "dev same-origin relative table allowed",
  );
}

assertThrows(
  () =>
    resolvePubUrl(
      "https://evil.example/lie-table.json",
      PAGE,
      "./pub/table.json",
    ),
  "cross-origin",
  "cross-origin ?table= override is refused",
);

assertThrows(
  () =>
    resolveTableStateUrls(
      new URLSearchParams("table=https://evil.example/table.json"),
      PAGE,
      { allowOverride: true },
    ),
  "cross-origin",
  "cross-origin ?table= via resolveTableStateUrls is refused",
);

assertThrows(
  () =>
    resolveTableStateUrls(
      new URLSearchParams("state=https://evil.example/state.json"),
      PAGE,
      { allowOverride: true },
    ),
  "cross-origin",
  "cross-origin ?state= override is refused",
);

// Protocol-relative and data: also cross-origin / invalid for our gate
assertThrows(
  () => resolvePubUrl("//evil.example/t.json", PAGE, "./pub/table.json"),
  "cross-origin",
  "protocol-relative ?table= refused",
);

if (failed) {
  console.error(`\n${failed} page security check(s) failed`);
  process.exit(1);
}
console.log("\nok  page security gates");
