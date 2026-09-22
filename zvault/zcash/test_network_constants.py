#!/usr/bin/env python3
"""X1: testnet treasury must never be selected for mainnet."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import indexer as ix

t_main, h_main = ix.constants_for_network("main")
t_test, h_test = ix.constants_for_network("test")
assert t_main == ix.TREASURY_MAINNET and t_main.startswith("t1")
assert t_test == ix.TREASURY_TESTNET and t_test.startswith("tm")
assert t_main != t_test

try:
    ix.assert_treasury_matches_network(ix.TREASURY_TESTNET, "main")
    raise SystemExit("expected refusal of testnet treasury on mainnet")
except ValueError as e:
    assert "testnet treasury" in str(e)

try:
    ix.assert_treasury_matches_network(ix.TREASURY_MAINNET, "test")
    raise SystemExit("expected refusal of mainnet treasury on testnet")
except ValueError as e:
    assert "mainnet treasury" in str(e)

ix.assert_treasury_matches_network(ix.TREASURY_TESTNET, "test")
ix.assert_treasury_matches_network(ix.TREASURY_MAINNET, "main")
print("X1 python network constants OK")
