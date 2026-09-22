#!/usr/bin/env python3
"""
Transparent P2PKH UTXO index built from blocks the publisher already fetches.

B0 (2026-09-22): Tatum zebrad has no getaddressutxos / getaddressbalance
(Method not found). Zebrad needs an address index we do not have on the
hosted endpoint. So the publisher maintains this index while applying the
same getblock(verbosity=2) stream it already uses for mint indexing —
**zero extra RPC calls** against the 5 rpm free-tier budget.

Serves GET /utxos/<address> for the mint page balance poll.
"""

from __future__ import annotations

import json
from pathlib import Path


def _value_zat(vout: dict) -> int:
    if "valueZat" in vout:
        return int(vout["valueZat"])
    if "valueSat" in vout:
        return int(vout["valueSat"])
    return int(round(float(vout.get("value", 0)) * 1e8))


def _addrs(vout: dict) -> list[str]:
    spk = vout.get("scriptPubKey") or {}
    addrs = list(spk.get("addresses") or [])
    if spk.get("address"):
        addrs.append(spk["address"])
    # Fallback: decode P2PKH script hex when RPC omits addresses[]
    if not addrs:
        hx = spk.get("hex") or ""
        if hx.startswith("76a914") and len(hx) >= 50:
            # Cannot base58 here without network prefix — skip; Tatum provides addresses[]
            pass
    return addrs


def _is_p2pkh(vout: dict) -> bool:
    hx = (vout.get("scriptPubKey") or {}).get("hex") or ""
    return hx.startswith("76a914") and len(hx) >= 50


class UtxoIndex:
    """Address → unspent P2PKH outs, updated per block."""

    def __init__(self):
        # key "txid:vout" → {txidHex, vout, valueZat, address, height, scriptPubKey}
        self.by_out: dict[str, dict] = {}
        # address → set of out keys
        self.by_addr: dict[str, set[str]] = {}
        self.height: int | None = None

    @staticmethod
    def _key(txid: str, vout: int) -> str:
        return f"{txid}:{vout}"

    def apply_rpc_block(self, height: int, blk: dict) -> set[str]:
        """Apply a getblock(..., 2) result. Returns addresses touched this block."""
        touched: set[str] = set()
        if self.height is not None and height <= self.height:
            return touched
        for tx in blk.get("tx") or []:
            if isinstance(tx, str):
                continue
            txid = tx.get("txid")
            if not txid:
                continue
            for vin in tx.get("vin") or []:
                if "coinbase" in vin:
                    continue
                prev = vin.get("txid")
                n = vin.get("vout")
                if prev is None or n is None:
                    continue
                addr = self._spend(prev, int(n))
                if addr:
                    touched.add(addr)
            for i, vout in enumerate(tx.get("vout") or []):
                if not _is_p2pkh(vout):
                    continue
                addrs = _addrs(vout)
                if not addrs:
                    continue
                addr = addrs[0]
                spk = (vout.get("scriptPubKey") or {}).get("hex") or ""
                self._add(
                    txid,
                    i,
                    {
                        "txidHex": txid,
                        "vout": i,
                        "valueZat": _value_zat(vout),
                        "address": addr,
                        "height": height,
                        "scriptPubKey": spk,
                    },
                )
                touched.add(addr)
        self.height = height
        return touched

    def _add(self, txid: str, vout: int, row: dict) -> None:
        k = self._key(txid, vout)
        if k in self.by_out:
            return
        self.by_out[k] = row
        self.by_addr.setdefault(row["address"], set()).add(k)

    def _spend(self, txid: str, vout: int) -> str | None:
        k = self._key(txid, vout)
        row = self.by_out.pop(k, None)
        if not row:
            return None
        addr = row["address"]
        s = self.by_addr.get(addr)
        if s:
            s.discard(k)
            if not s:
                del self.by_addr[addr]
        return addr

    def lookup(self, address: str) -> list[dict]:
        keys = self.by_addr.get(address) or set()
        rows = [self.by_out[k] for k in keys if k in self.by_out]
        rows.sort(key=lambda r: (r["height"], r["vout"]))
        return rows

    def to_snapshot(self) -> dict:
        return {
            "height": self.height,
            "outs": list(self.by_out.values()),
        }

    @classmethod
    def from_snapshot(cls, snap: dict | None) -> "UtxoIndex":
        idx = cls()
        if not snap:
            return idx
        idx.height = snap.get("height")
        for row in snap.get("outs") or []:
            idx._add(row["txidHex"], int(row["vout"]), dict(row))
        return idx

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.to_snapshot()) + "\n", encoding="utf-8")
        tmp.replace(path)

    @classmethod
    def load(cls, path: Path) -> "UtxoIndex":
        if not path.exists():
            return cls()
        return cls.from_snapshot(json.loads(path.read_text(encoding="utf-8")))
