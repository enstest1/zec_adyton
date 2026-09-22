#!/usr/bin/env python3
"""
ZVAULT chain source — the last gap.

Turns a Zcash node into the block stream `indexer.scan()` expects. Zaino is the
target: it serves a JSON-RPC API covering the subset of Zcash RPCs wallets and
explorers need, sitting between a Zebra or zcashd validator and this script.
The same calls work against zcashd, so either backend is fine.

    python3 chain.py probe
    python3 chain.py scan --to 2900500 --out blocks.json
    python3 chain.py watch

v2: every block is emitted, including blocks with no ZVLT records, because
the indexer needs every block hash (challenges come from recent block hashes,
and a stalled epoch seals on a block that may carry no mints). Scans start at
LAUNCH_HEIGHT - CHALLENGE_WINDOW by default; the indexer refuses any other
start, since a state built from a partial history cannot be trusted.

Everything here reads public data. No viewing key, no wallet, no credential
beyond RPC auth to your own node — which is the whole point. If verifying the
collection required a secret, it would not be verification.
"""

import argparse
import base64
import json
import sys
import time
import urllib.request
from pathlib import Path

# Single source of truth — must match indexer exactly.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import indexer as ix

MAGIC = ix.MAGIC
# Live paths must pass network from getblockchaininfo; default alias is mainnet.
TREASURY = ix.TREASURY
LAUNCH_HEIGHT = ix.LAUNCH_HEIGHT


def treasury_for_node(node: "Node") -> str:
    """Pick treasury from the node-reported chain (never mix test↔main)."""
    info = node.call("getblockchaininfo")
    chain = info.get("chain")
    treasury, _ = ix.constants_for_network(chain)
    ix.assert_treasury_matches_network(treasury, chain)
    return treasury


class Node:
    """Minimal JSON-RPC client. Works against zainod or zcashd."""

    def __init__(self, url="http://127.0.0.1:8232", user=None, password=None,
                 cookie=None):
        self.url = url
        self.auth = None
        if cookie:
            # Zallet writes a random credential to {datadir}/.cookie on startup.
            tok = open(cookie).read().strip()
            self.auth = base64.b64encode(tok.encode()).decode()
        elif user is not None:
            self.auth = base64.b64encode(f"{user}:{password or ''}".encode()).decode()

    def call(self, method, params=None):
        body = json.dumps({"jsonrpc": "1.0", "id": "zvault",
                           "method": method, "params": params or []}).encode()
        req = urllib.request.Request(self.url, data=body,
                                     headers={"Content-Type": "application/json"})
        if self.auth:
            req.add_header("Authorization", f"Basic {self.auth}")
        with urllib.request.urlopen(req, timeout=60) as r:
            out = json.loads(r.read())
        if out.get("error"):
            raise RuntimeError(f"{method}: {out['error']}")
        return out["result"]


# --------------------------------------------------------------- extraction

def op_return_from(vout) -> bytes | None:
    """Pull the pushed payload out of an OP_RETURN output.

    scriptPubKey hex looks like: 6a <pushop> <data>
      6a       OP_RETURN
      4c LL    OP_PUSHDATA1 + 1-byte length   (used for 76..255 bytes)
      LL       bare push                      (used for 1..75 bytes)

    A 74-byte record lands in the bare-push branch, but handle both — a future
    version bump past 75 bytes would silently stop parsing otherwise.
    """
    spk = vout.get("scriptPubKey", {})
    hexstr = spk.get("hex", "")
    if not hexstr.startswith("6a"):
        return None
    raw = bytes.fromhex(hexstr)
    if len(raw) < 2:
        return None
    if raw[1] == 0x4C:                       # OP_PUSHDATA1
        if len(raw) < 3:
            return None
        ln = raw[2]
        return raw[3:3 + ln]
    ln = raw[1]                              # bare push
    if ln > 75:
        return None
    return raw[2:2 + ln]


def paid_to_treasury(tx, treasury=TREASURY) -> int:
    """Sum transparent outputs to the treasury, in zatoshis.

    Only transparent outputs count, and that is deliberate: a shielded payment
    is invisible to everyone but the recipient, so an indexer could not confirm
    it and neither could anyone auditing the indexer. The mint payment is the
    one part of this protocol that must be public.

    Prefer `valueZat` when the RPC provides it — float `value` * 1e8 can
    round wrong on some amounts. Accept both `addresses` (array) and
    singular `address` (some lightwalletd / Zaino shapes).
    """
    total = 0
    for vout in tx.get("vout", []):
        spk = vout.get("scriptPubKey", {}) or {}
        addrs = list(spk.get("addresses") or [])
        if spk.get("address"):
            addrs.append(spk["address"])
        if treasury not in addrs:
            continue
        if "valueZat" in vout:
            total += int(vout["valueZat"])
        elif "valueSat" in vout:
            total += int(vout["valueSat"])
        else:
            total += int(round(float(vout.get("value", 0)) * 1e8))
    return total


def burned_in(tx) -> int:
    """Placeholder until the burn token exists.

    Zcash has no tokens, so 'burn' needs a concrete definition before launch:
    either ZEC to a provably-unspendable address, or a ZSA burn once ZIP 226
    ships. Returning 0 means burn contributes nothing to scoring today — the
    weight is live in the formula, the mechanism is not. Decide before you
    publish the weights, because changing them after launch re-prices every
    mint already made.
    """
    return 0


def transparent_tags(tx) -> list:
    """20-byte tags from transparent outputs (P2PKH scriptPubKey hash160).

    minerTag is matched against these. Inputs are included when the RPC
    exposes an address/script; verbosity-2 blocks usually have output scripts.
    """
    tags = []
    for vout in tx.get("vout", []):
        hexstr = vout.get("scriptPubKey", {}).get("hex", "")
        # P2PKH: OP_DUP OP_HASH160 0x14 <20> OP_EQUALVERIFY OP_CHECKSIG
        if hexstr.startswith("76a914") and len(hexstr) >= 50:
            tags.append(bytes.fromhex(hexstr[6:46]))
    for vin in tx.get("vin", []):
        # Some RPCs attach prevout scriptPubKey under vin["scriptPubKey"].
        hexstr = (vin.get("scriptPubKey") or {}).get("hex", "")
        if hexstr.startswith("76a914") and len(hexstr) >= 50:
            tags.append(bytes.fromhex(hexstr[6:46]))
    return tags


def extract_mint_txs_from_rpc_block(blk: dict) -> list:
    """Mint/reveal OP_RETURN txs from an already-fetched getblock(..., 2) result.

    Same filter as extract_block, without a second RPC round-trip.
    """
    txs = []
    for tx in blk.get("tx", []):
        if isinstance(tx, str):
            continue
        payloads = []
        for vout in tx.get("vout", []):
            got = op_return_from(vout)
            if got and got.startswith(MAGIC):
                payloads.append(got)
        if not payloads:
            continue
        entry = {
            "txid": tx.get("txid"),
            "paid_to_treasury": paid_to_treasury(tx),
            "burned": burned_in(tx),
            "transparent_tags": [t.hex() for t in transparent_tags(tx)],
        }
        if len(payloads) == 1:
            entry["op_return"] = payloads[0].hex()
        else:
            entry["op_returns"] = [p.hex() for p in payloads]
        txs.append(entry)
    return txs


def extract_block(node: Node, height: int) -> dict:
    blk = node.call("getblock", [str(height), 2])   # verbosity 2 = full txs
    return {
        "height": height,
        "hash": blk.get("hash"),
        "tx": extract_mint_txs_from_rpc_block(blk),
        "_raw": blk,  # optional; callers that need UTXOs keep the raw block
    }


def rehydrate(blocks):
    """JSON carries payloads as hex; indexer wants bytes."""
    for b in blocks:
        for tx in b["tx"]:
            if "op_return" in tx and isinstance(tx["op_return"], str):
                tx["op_return"] = bytes.fromhex(tx["op_return"])
            if "op_returns" in tx:
                tx["op_returns"] = [
                    bytes.fromhex(p) if isinstance(p, str) else p
                    for p in tx["op_returns"]
                ]
            if "transparent_tags" in tx:
                tx["transparent_tags"] = [
                    bytes.fromhex(t) if isinstance(t, str) else t
                    for t in tx["transparent_tags"]
                ]
    return blocks


# --------------------------------------------------------------------- cli

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8232")
    ap.add_argument("--user")
    ap.add_argument("--password")
    ap.add_argument("--cookie", help="path to {datadir}/.cookie (Zallet)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("probe")

    s = sub.add_parser("scan")
    s.add_argument("--from", dest="start", type=int, default=None,
                   help="default: LAUNCH_HEIGHT - CHALLENGE_WINDOW")
    s.add_argument("--to", dest="end", type=int)
    s.add_argument("--out", default="blocks.json")

    w = sub.add_parser("watch")
    w.add_argument("--from", dest="start", type=int, default=None)
    w.add_argument("--interval", type=int, default=75)   # Zcash targets 75s

    a = ap.parse_args()
    node = Node(a.url, a.user, a.password, a.cookie)
    if getattr(a, "start", None) is None and a.cmd in ("scan", "watch"):
        info = node.call("getblockchaininfo")
        _, launch = ix.constants_for_network(info["chain"])
        a.start = launch - ix.CHALLENGE_WINDOW

    if a.cmd == "probe":
        try:
            info = node.call("getblockchaininfo")
        except Exception as e:
            print(f"cannot reach node at {a.url}\n  {e}", file=sys.stderr)
            print("\n  zainod start --config zaino.toml", file=sys.stderr)
            print("  or point --url at your zcashd rpcbind", file=sys.stderr)
            raise SystemExit(1)
        print(f"  chain   {info.get('chain')}")
        print(f"  height  {info.get('blocks')}")
        print(f"  synced  {info.get('verificationprogress', 'n/a')}")
        try:
            treas = treasury_for_node(node)
            print(f"  treasury for chain: {treas}")
        except Exception as e:
            print(f"  treasury select: {e}")
        return

    if a.cmd == "scan":
        end = a.end or node.call("getblockchaininfo")["blocks"]
        blocks, found = [], 0
        for h in range(a.start, end + 1):
            blk = extract_block(node, h)
            blocks.append(blk)                   # every block: the hash matters
            found += len(blk["tx"])
            if (h - a.start) % 500 == 0:
                print(f"\r  {h}/{end}  {found} records", end="", file=sys.stderr)
        print(file=sys.stderr)
        json.dump(blocks, open(a.out, "w"), separators=(",", ":"))
        print(f"  {found} ZVLT records across {len(blocks)} blocks -> {a.out}")
        print(f"  python3 indexer.py --blocks {a.out}")
        return

    if a.cmd == "watch":
        import indexer as ix
        v, height = ix.Vault(), a.start
        while True:
            tip = node.call("getblockchaininfo")["blocks"]
            while height <= tip:
                blk = rehydrate([extract_block(node, height)])[0]
                for entry in v.apply_block(height, bytes.fromhex(blk["hash"]), blk["tx"]):
                    print(f"  {height}  {'OK ' if entry['ok'] else 'REJ'}  {entry['reason']}")
                height += 1
            print(f"\r  tip {tip}  minted {v.minted}  digest {v.digest()[:16]}…",
                  end="", file=sys.stderr)
            time.sleep(a.interval)


if __name__ == "__main__":
    main()
