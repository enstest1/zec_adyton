#!/usr/bin/env python3
"""Unit test for publisher UTXO index (B0)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import utxo_index as ux  # noqa: E402


def main() -> int:
    idx = ux.UtxoIndex()
    blk1 = {
        "tx": [
            {
                "txid": "aa" * 32,
                "vin": [{"coinbase": "01"}],
                "vout": [
                    {
                        "valueZat": 500_000,
                        "scriptPubKey": {
                            "hex": "76a914" + ("11" * 20) + "88ac",
                            "addresses": ["tmTestBurnerAddress111111111111111"],
                        },
                    }
                ],
            }
        ]
    }
    touched = idx.apply_rpc_block(100, blk1)
    assert "tmTestBurnerAddress111111111111111" in touched
    rows = idx.lookup("tmTestBurnerAddress111111111111111")
    assert len(rows) == 1 and rows[0]["valueZat"] == 500_000

    # Spend it
    blk2 = {
        "tx": [
            {
                "txid": "bb" * 32,
                "vin": [{"txid": "aa" * 32, "vout": 0}],
                "vout": [
                    {
                        "valueZat": 400_000,
                        "scriptPubKey": {
                            "hex": "76a914" + ("22" * 20) + "88ac",
                            "addresses": ["tmOther"],
                        },
                    }
                ],
            }
        ]
    }
    idx.apply_rpc_block(101, blk2)
    assert idx.lookup("tmTestBurnerAddress111111111111111") == []
    assert idx.lookup("tmOther")[0]["valueZat"] == 400_000

    snap = idx.to_snapshot()
    idx2 = ux.UtxoIndex.from_snapshot(snap)
    assert idx2.lookup("tmOther")[0]["valueZat"] == 400_000
    print("ok  utxo_index apply/spend/snapshot")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
