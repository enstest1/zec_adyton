# web/ — static mint page

Protocol is frozen at commit `494dfcc`. Do not change `zcash/indexer.py` rules
to make this page work.

## Gates

```bash
# from zvault/
python web/gen_vectors.py          # regenerate fixture from indexer.py
python web/test_vectors.py         # fail if vectors.json drifts
node web/test_vectors_js.mjs       # fail if JS disagrees with fixture
node web/test_page_security.mjs    # treasury hardcoded; cross-origin ?table= refused
python zcash/indexer.py            # must keep digest 86105264…
```

## Run locally

Serve the page and `pub/` from **one origin**. Query overrides (`?table=` /
`?state=`) are disabled in the published build; cross-origin overrides are
always refused.

```bash
# terminal A — publisher writes web/pub/table.json + state.json
python zcash/publisher.py --url http://127.0.0.1:8232 --out web/pub --bind 127.0.0.1:8080

# terminal B — static page (no secrets on this server)
python -m http.server 5500 --directory web
# open http://127.0.0.1:5500/   ← fetches ./pub/*.json same-origin
```

For live publisher output without copying files, point `--out` at `web/pub` and
refresh; do not pass a second-origin URL via the query string.

`web/pub/table.json` ships a **demo** tip with `base_bits: 12` so browser mining
is usable offline. Live publisher overwrites it with real base 22.

## Trust

- After load, the page only fetches **same-origin** `table.json` / `state.json`.
- `TREASURY` is a build-time constant in `js/config.js` (must match
  `zcash/indexer.py`). It is never taken from fetched JSON or the query string.
- Mining and keyfile generation stay in the browser. Keyfile download is forced
  before OP_RETURN hex is shown.
