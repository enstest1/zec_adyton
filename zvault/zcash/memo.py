#!/usr/bin/env python3
"""
ZVAULT memo delivery — protocol v2 receipt.

The epoch seal is what keeps the punk secret, not this memo. The miner already
generates secret/seed/salt into a local keyfile (miner.py). This module builds
the wallet-native *receipt* the treasury can send to a shielded UA:

    index · epoch · seal_height

so a holder opens ZODL and sees "ZVAULT #1337 · epoch 10 · seals at height …"
with no website. That is the only job the memo has left (GAME.md "The memo,
honestly"; CHANGES-v2.md still-open item).

    python3 memo.py build --index 7 --epoch 0 --seal-height 2900128
    python3 memo.py send  --index 7 --epoch 0 --seal-height 2900128 --to u1...
    python3 memo.py parse --hex <hex>

Delivery goes through the node's own `z_sendmany`. Transparent outputs have
no memo field — refusing t-addresses is enforced by the chain, not by policy.
"""

import argparse
import json
import subprocess
import struct
import sys

MAGIC = b"ZVLT"
VERSION = 2
KIND_RECEIPT = 0x11          # v2 receipt (was 0x10 opening material — retired)
MEMO_MAX = 512


def build_receipt(index: int, epoch: int, seal_height: int) -> bytes:
    """Compact public-state receipt. No seed, no salt — those stay with the miner."""
    if index < 0 or epoch < 0 or seal_height < 0:
        raise ValueError("index, epoch, seal_height must be non-negative")
    payload = (
        MAGIC
        + bytes([VERSION, KIND_RECEIPT])
        + struct.pack(">I", index)
        + struct.pack(">I", epoch)
        + struct.pack(">I", seal_height)
    )
    if len(payload) > MEMO_MAX:
        raise ValueError(f"payload {len(payload)} exceeds {MEMO_MAX}")
    return payload


def parse_receipt(payload: bytes):
    """Accept v2 receipts. Reject legacy 0x10 opening payloads that carried keys."""
    if len(payload) < 18 or payload[:4] != MAGIC:
        return None
    if payload[4] != VERSION:
        return None
    if payload[5] == KIND_RECEIPT:
        return {
            "kind": "receipt",
            "index": struct.unpack(">I", payload[6:10])[0],
            "epoch": struct.unpack(">I", payload[10:14])[0],
            "seal_height": struct.unpack(">I", payload[14:18])[0],
        }
    if payload[5] == 0x10:
        return {
            "kind": "legacy_opening",
            "warning": "v1 opening memo carried seed/salt — refuse; miner owns keys",
        }
    return None


# ------------------------------------------------------------------- delivery

def rpc(method: str, params: list, cli="zcash-cli"):
    """Shells to the node. Credentials stay in the node's own config."""
    cmd = [cli, method] + [json.dumps(p) if not isinstance(p, str) else p for p in params]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        raise SystemExit(f"{cli} not found — point --cli at your node's binary")
    if out.returncode != 0:
        raise SystemExit(f"rpc {method} failed:\n{out.stderr.strip()}")
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        return out.stdout.strip()


def send_receipt(from_addr, to_addr, index, epoch, seal_height,
                 amount="0.0001", cli="zcash-cli"):
    """z_sendmany with a hex memo. Dust payment required for a shielded output."""
    if not (to_addr.startswith("u1") or to_addr.startswith("zs")):
        raise SystemExit(
            f"refusing to send to {to_addr[:6]}...: not a shielded address.\n"
            "Transparent outputs have no memo field — the receipt would be lost."
        )

    memo_hex = build_receipt(index, epoch, seal_height).hex()
    recipients = [{"address": to_addr, "amount": float(amount), "memo": memo_hex}]
    return rpc("z_sendmany",
               [from_addr, json.dumps(recipients), "1", "null", "AllowRevealedAmounts"],
               cli=cli)


def poll(opid, cli="zcash-cli"):
    st = rpc("z_getoperationstatus", [json.dumps([opid])], cli=cli)
    return st[0] if isinstance(st, list) and st else st


# ------------------------------------------------------------------------ cli

def main():
    ap = argparse.ArgumentParser(
        description="Shielded mint receipt (index/epoch/seal_height). Not a key delivery.")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("build")
    b.add_argument("--index", type=int, required=True)
    b.add_argument("--epoch", type=int, required=True)
    b.add_argument("--seal-height", type=int, required=True)

    p = sub.add_parser("parse")
    p.add_argument("--hex", required=True)

    s = sub.add_parser("send")
    s.add_argument("--index", type=int, required=True)
    s.add_argument("--epoch", type=int, required=True)
    s.add_argument("--seal-height", type=int, required=True)
    s.add_argument("--to", required=True)
    s.add_argument("--from", dest="from_addr", required=True)
    s.add_argument("--amount", default="0.0001")
    s.add_argument("--cli", default="zcash-cli")

    st = sub.add_parser("status")
    st.add_argument("--opid", required=True)
    st.add_argument("--cli", default="zcash-cli")

    a = ap.parse_args()

    if a.cmd == "build":
        payload = build_receipt(a.index, a.epoch, a.seal_height)
        print(f"  {len(payload)} bytes of {MEMO_MAX}")
        print(f"  {payload.hex()}")
        print("  (receipt only — seed/salt stay in the miner's keyfile)")

    elif a.cmd == "parse":
        got = parse_receipt(bytes.fromhex(a.hex))
        print(json.dumps(got, indent=2) if got else "not a ZVLT receipt memo")

    elif a.cmd == "send":
        opid = send_receipt(a.from_addr, a.to, a.index, a.epoch, a.seal_height,
                            a.amount, a.cli)
        print(f"  operation {opid}")
        print(f"  poll: python3 memo.py status --opid {opid}")
        print("  do NOT mark delivered until this reports success")

    elif a.cmd == "status":
        print(json.dumps(poll(a.opid, a.cli), indent=2))


if __name__ == "__main__":
    main()
