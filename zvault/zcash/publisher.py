#!/usr/bin/env python3
"""
Epoch JSON publisher — follows a Zcash node and writes the live table.

Does not change protocol rules. Wraps chain.py + indexer.py, respects
CONFIRMATION_DEPTH, persists vault state as plain JSON so restarts resume
without a genesis re-scan (no pickle).

    python zcash/publisher.py \\
        --url http://127.0.0.1:8232 \\
        --out web/pub \\
        --bind 127.0.0.1:8080

Writes (atomically) into --out:
  table.json     Vault.table()
  state.json     {minted, epochs, digest, tip_height, obs_height, ...}
  vault.json     full Vault snapshot for resume
  punks/N.png    rendered sprite for each revealed index (Python generate.py)
  punks/N.json   traits + verify one-liner
  collection.json gallery index of revealed punks

Serves those files with Access-Control-Allow-Origin: * and short cache.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chain as ch  # noqa: E402
import indexer as ix  # noqa: E402
import art_render as art  # noqa: E402

SNAPSHOT_VERSION = 1


def atomic_write(path: Path, text: str) -> None:
    """Write via temp + replace so readers never see a partial JSON file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def vault_snapshot_path(out: Path) -> Path:
    return out / "vault.json"


def _b2h(b) -> str | None:
    if b is None:
        return None
    if isinstance(b, str):
        return b
    return bytes(b).hex()


def _h2b(h):
    if h is None:
        return None
    return bytes.fromhex(h)


def _ser_tx(tx: dict) -> dict:
    """JSON-safe tx: payloads and tags as hex."""
    out = dict(tx)
    if "op_return" in out and isinstance(out["op_return"], (bytes, bytearray)):
        out["op_return"] = bytes(out["op_return"]).hex()
    if "op_returns" in out:
        out["op_returns"] = [
            p.hex() if isinstance(p, (bytes, bytearray)) else p
            for p in out["op_returns"]
        ]
    if "transparent_tags" in out:
        out["transparent_tags"] = [
            t.hex() if isinstance(t, (bytes, bytearray)) else t
            for t in out["transparent_tags"]
        ]
    return out


def _de_tx(tx: dict) -> dict:
    out = dict(tx)
    if isinstance(out.get("op_return"), str):
        out["op_return"] = bytes.fromhex(out["op_return"])
    if "op_returns" in out:
        out["op_returns"] = [
            bytes.fromhex(p) if isinstance(p, str) else p
            for p in out["op_returns"]
        ]
    if "transparent_tags" in out:
        out["transparent_tags"] = [
            bytes.fromhex(t) if isinstance(t, str) else t
            for t in out["transparent_tags"]
        ]
    return out


def vault_to_snapshot(vault: ix.Vault) -> dict:
    """Plain-JSON snapshot of Vault state. Rebuild with vault_from_snapshot."""
    commitments = []
    for c in vault.commitments:
        row = dict(c)
        row["commitment"] = _b2h(c["commitment"])
        if "miner_tag" in c and c["miner_tag"] is not None:
            row["miner_tag"] = _b2h(c["miner_tag"])
        commitments.append(row)

    epochs = []
    for ep in vault.epochs:
        e = dict(ep)
        e["seal"] = _b2h(ep.get("seal"))
        epochs.append(e)

    revealed = {}
    for k, v in vault.revealed.items():
        revealed[str(k)] = {
            "score": v["score"],
            "tier": v["tier"],
            "trait_hash": v["trait_hash"],  # int
        }

    buf = {}
    for h, (bh, txs) in vault._buf.items():
        buf[str(h)] = {"hash": _b2h(bh), "tx": [_ser_tx(t) for t in txs]}

    return {
        "snapshot_version": SNAPSHOT_VERSION,
        "launch_height": vault.launch_height,
        "base_bits": vault.base_bits,
        "seal_timeout": vault.seal_timeout,
        "patience_unit": vault.patience_unit,
        "confirmation_depth": vault.confirmation_depth,
        "minted": vault.minted,
        "rejected": vault.rejected,
        "height": vault.height,
        "obs_height": vault._obs_height,
        "commitments": commitments,
        "by_commitment": {_b2h(k): v for k, v in vault.by_commitment.items()},
        "epochs": epochs,
        "revealed": revealed,
        "hashes": {str(h): _b2h(bh) for h, bh in vault.hashes.items()},
        "minted_at": {str(h): n for h, n in vault.minted_at.items()},
        "epoch_quote_at": {str(h): n for h, n in vault.epoch_quote_at.items()},
        "buf": buf,
    }


def vault_from_snapshot(snap: dict) -> ix.Vault:
    """Rebuild a Vault from vault_to_snapshot output. No code execution."""
    if snap.get("snapshot_version") != SNAPSHOT_VERSION:
        raise ValueError(
            f"unsupported vault snapshot_version {snap.get('snapshot_version')}"
        )
    v = ix.Vault(
        launch_height=snap["launch_height"],
        base_bits=snap["base_bits"],
        seal_timeout=snap["seal_timeout"],
        patience_unit=snap["patience_unit"],
        confirmation_depth=snap["confirmation_depth"],
    )
    v.minted = snap["minted"]
    v.rejected = snap["rejected"]
    v.height = snap["height"]
    v._obs_height = snap["obs_height"]

    v.commitments = []
    for row in snap["commitments"]:
        c = dict(row)
        c["commitment"] = _h2b(row["commitment"])
        if "miner_tag" in row and row["miner_tag"] is not None:
            c["miner_tag"] = _h2b(row["miner_tag"])
        v.commitments.append(c)

    v.by_commitment = {_h2b(k): idx for k, idx in snap["by_commitment"].items()}

    v.epochs = []
    for ep in snap["epochs"]:
        e = dict(ep)
        e["seal"] = _h2b(ep["seal"]) if ep.get("seal") else None
        v.epochs.append(e)

    v.revealed = {}
    for k, val in snap.get("revealed", {}).items():
        v.revealed[int(k)] = {
            "score": val["score"],
            "tier": val["tier"],
            "trait_hash": val["trait_hash"],
        }

    v.hashes = {int(h): _h2b(bh) for h, bh in snap.get("hashes", {}).items()}
    v.minted_at = {int(h): n for h, n in snap.get("minted_at", {}).items()}
    v.epoch_quote_at = {int(h): n for h, n in snap.get("epoch_quote_at", {}).items()}

    v._buf = {}
    for h, entry in snap.get("buf", {}).items():
        v._buf[int(h)] = (
            _h2b(entry["hash"]),
            [_de_tx(t) for t in entry.get("tx", [])],
        )
    return v


def save_vault(out: Path, vault: ix.Vault) -> None:
    """Persist Vault as vault.json (plain JSON, not pickle)."""
    snap = vault_to_snapshot(vault)
    atomic_write(vault_snapshot_path(out), json.dumps(snap, indent=2) + "\n")


def load_vault(out: Path) -> ix.Vault | None:
    path = vault_snapshot_path(out)
    if not path.exists():
        return None
    snap = json.loads(path.read_text(encoding="utf-8"))
    return vault_from_snapshot(snap)


def write_public(out: Path, vault: ix.Vault) -> None:
    table = vault.table()
    tip = vault.height if vault.height is not None else vault._obs_height
    state = {
        "minted": vault.minted,
        "epochs": len(vault.epochs),
        "digest": vault.digest() if vault.height is not None else None,
        "tip_height": tip,
        "indexed_height": vault.height,
        "obs_height": vault._obs_height,
        "confirmation_depth": vault.confirmation_depth,
        "rejected": vault.rejected,
        "launch_height": vault.launch_height,
        "supply_cap": ix.SUPPLY_CAP,
        "max_live_score": ix.max_live_score(),
        "score_floors": list(ix.score_floors()),
        "revealed": len(vault.revealed),
        "revealed_indices": sorted(vault.revealed.keys()),
    }
    atomic_write(out / "table.json", json.dumps(table, indent=2) + "\n")
    atomic_write(out / "state.json", json.dumps(state, indent=2) + "\n")
    # PNG + traits for every reveal — product surface, still Python-only.
    art.sync_art(out, vault)


class CorsHandler(SimpleHTTPRequestHandler):
    """Static file server with permissive CORS and short cache."""

    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=directory, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "max-age=5, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[http] " + (fmt % args) + "\n")


def follow_loop(node: ch.Node, vault: ix.Vault, out: Path, interval: int) -> None:
    """Pull blocks from the node forever. Resume from obs/indexed tip."""
    if vault._obs_height is None:
        height = vault.first_height()
    else:
        height = vault._obs_height + 1

    sys.stderr.write(
        f"[publisher] resume at height {height} "
        f"(indexed={vault.height} obs={vault._obs_height} "
        f"depth={vault.confirmation_depth})\n"
    )

    while True:
        try:
            tip = node.call("getblockchaininfo")["blocks"]
        except Exception as e:
            sys.stderr.write(f"[publisher] node unreachable: {e}\n")
            time.sleep(interval)
            continue

        if tip < height:
            sys.stderr.write(
                f"[publisher] waiting: node tip {tip} < next {height}\n"
            )
            write_public(out, vault)
            time.sleep(interval)
            continue

        while height <= tip:
            try:
                blk = ch.rehydrate([ch.extract_block(node, height)])[0]
                bh = bytes.fromhex(blk["hash"]) if isinstance(blk["hash"], str) else blk["hash"]
                log = vault.apply_block(height, bh, blk.get("tx", []))
                for entry in log:
                    if entry.get("reason", "").startswith("mint") or entry.get("ok") is False:
                        sys.stderr.write(
                            f"  {height}  {'OK ' if entry.get('ok') else 'REJ'}  "
                            f"{entry.get('reason')}\n"
                        )
                save_vault(out, vault)
                write_public(out, vault)
            except ix.InputError as e:
                sys.stderr.write(f"[publisher] refusing block {height}: {e}\n")
                time.sleep(interval)
                break
            except Exception as e:
                sys.stderr.write(f"[publisher] block {height} error: {e}\n")
                time.sleep(interval)
                break
            height += 1

        tip_show = vault.height if vault.height is not None else "?"
        dig = vault.digest()[:16] if vault.height is not None else "—"
        sys.stderr.write(
            f"\r  tip {tip}  indexed {tip_show}  minted {vault.minted}  "
            f"digest {dig}…   "
        )
        time.sleep(interval)


def main():
    ap = argparse.ArgumentParser(description="ZVAULT epoch table publisher")
    ap.add_argument("--url", default="http://127.0.0.1:8232")
    ap.add_argument("--user")
    ap.add_argument("--password")
    ap.add_argument("--cookie")
    ap.add_argument("--out", default="web/pub", help="directory for table.json/state.json")
    ap.add_argument("--bind", default="127.0.0.1:8080", help="host:port for static serve")
    ap.add_argument("--interval", type=int, default=15)
    ap.add_argument("--no-http", action="store_true", help="write files only, no HTTP")
    ap.add_argument("--blocks", help="offline: ingest a chain.py blocks.json once, then serve")
    args = ap.parse_args()

    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    vault = load_vault(out)
    if vault is None:
        depth = 0 if args.blocks else ix.CONFIRMATION_DEPTH
        vault = ix.Vault(confirmation_depth=depth)
        sys.stderr.write(f"[publisher] fresh vault (confirmation_depth={depth})\n")
    else:
        sys.stderr.write(
            f"[publisher] loaded vault.json indexed={vault.height} "
            f"obs={vault._obs_height} minted={vault.minted}\n"
        )

    if args.blocks:
        raw = Path(args.blocks).read_text(encoding="utf-8").strip()
        if not raw:
            sys.stderr.write(f"[publisher] empty --blocks file: {args.blocks}\n")
            write_public(out, vault)
            if args.no_http:
                return
        else:
            blocks = json.loads(raw)
            start = (vault._obs_height + 1) if vault._obs_height is not None else None
            for blk in blocks:
                h = blk["height"]
                if start is not None and h < start:
                    continue
                bh = blk["hash"]
                if isinstance(bh, str):
                    bh = bytes.fromhex(bh)
                txs = blk.get("tx", [])
                for tx in txs:
                    if isinstance(tx.get("op_return"), str):
                        tx["op_return"] = bytes.fromhex(tx["op_return"])
                    if "op_returns" in tx:
                        tx["op_returns"] = [
                            bytes.fromhex(p) if isinstance(p, str) else p
                            for p in tx["op_returns"]
                        ]
                vault.apply_block(h, bh, txs)
            save_vault(out, vault)
            write_public(out, vault)
            sys.stderr.write(
                f"[publisher] ingested {args.blocks}: minted={vault.minted} "
                f"digest={(vault.digest()[:16] + '…') if vault.height is not None else '—'}\n"
            )
        if args.no_http:
            return
        host, _, port_s = args.bind.partition(":")
        port = int(port_s or "8080")

        def handler(*a, **k):
            return CorsHandler(*a, directory=str(out), **k)

        httpd = ThreadingHTTPServer((host, port), handler)
        sys.stderr.write(f"[publisher] serving {out} on http://{host}:{port}/\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            sys.stderr.write("\n[publisher] stopped\n")
        return

    write_public(out, vault)

    if not args.no_http:
        host, _, port_s = args.bind.partition(":")
        port = int(port_s or "8080")

        def handler(*a, **k):
            return CorsHandler(*a, directory=str(out), **k)

        httpd = ThreadingHTTPServer((host, port), handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        sys.stderr.write(f"[publisher] serving {out} on http://{host}:{port}/\n")

    node = ch.Node(args.url, args.user, args.password, args.cookie)
    try:
        follow_loop(node, vault, out, args.interval)
    except KeyboardInterrupt:
        sys.stderr.write("\n[publisher] stopped\n")
        save_vault(out, vault)
        write_public(out, vault)


if __name__ == "__main__":
    main()
