"""
Art rendering for revealed mints — Python only (generate.py).

Called by the publisher after each block that lands a reveal. Writes:
  pub/punks/{index}.png
  pub/punks/{index}.json   traits + verification one-liner
  pub/collection.json      index of all revealed punks

Does not change indexer rules or digests. Art is derived from public
(trait_hash, tier) already committed in vault.revealed.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# art/ sits next to zcash/
_ART = Path(__file__).resolve().parent.parent / "art"
if str(_ART) not in sys.path:
    sys.path.insert(0, str(_ART))
_ZCASH = Path(__file__).resolve().parent
if str(_ZCASH) not in sys.path:
    sys.path.insert(0, str(_ZCASH))

import generate as gen  # noqa: E402
import indexer as ix  # noqa: E402


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def punk_paths(out: Path, index: int) -> tuple[Path, Path]:
    d = out / "punks"
    return d / f"{index}.png", d / f"{index}.json"


def render_one(out: Path, index: int, trait_hash: int, tier: int, score: int) -> dict:
    """Derive traits, draw PNG, write JSON. Returns traits dict."""
    traits = gen.derive_tier(trait_hash, tier)
    traits["index"] = index
    traits["score"] = score
    traits["trait_hash"] = str(trait_hash)
    traits["tier_id"] = tier
    traits["tier_name"] = ix.TIER_NAMES[tier]
    # One-command verification — anyone can re-derive without trusting the PNG host.
    traits["verify"] = (
        f"cd zvault && python -c \"import sys; sys.path.insert(0,'art'); "
        f"from generate import derive_tier; "
        f"print(derive_tier({trait_hash}, {tier}))\""
    )

    png_path, json_path = punk_paths(out, index)
    img = gen.draw(traits)
    # Atomic PNG — PIL needs an explicit format when the temp suffix is not .png
    tmp_png = png_path.parent / f"{png_path.stem}.writing.png"
    png_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(tmp_png, format="PNG")
    tmp_png.replace(png_path)

    atomic_write_text(json_path, json.dumps(traits, indent=2) + "\n")
    return traits


def sync_art(out: Path, vault: ix.Vault) -> list[int]:
    """Render any revealed indices missing from pub/punks/. Returns new indices."""
    written = []
    for index, info in sorted(vault.revealed.items()):
        png_path, _ = punk_paths(out, index)
        if png_path.exists():
            continue
        render_one(
            out,
            index,
            int(info["trait_hash"]),
            int(info["tier"]),
            int(info["score"]),
        )
        written.append(index)
        sys.stderr.write(
            f"[art] rendered punk #{index} "
            f"{ix.TIER_NAMES[info['tier']]} score={info['score']}\n"
        )
    write_collection(out, vault)
    return written


def write_collection(out: Path, vault: ix.Vault) -> None:
    """collection.json — gallery index for the static collection view."""
    items = []
    for index, info in sorted(vault.revealed.items()):
        _, json_path = punk_paths(out, index)
        tier = int(info["tier"])
        row = {
            "index": index,
            "tier": tier,
            "tier_name": ix.TIER_NAMES[tier],
            "score": info["score"],
            "trait_hash": str(info["trait_hash"]),
            "png": f"punks/{index}.png",
            "traits": f"punks/{index}.json",
        }
        if json_path.exists():
            try:
                t = json.loads(json_path.read_text(encoding="utf-8"))
                row["traits_summary"] = {
                    k: t[k]
                    for k in (
                        "chassis", "palette", "visor", "hood",
                        "vent", "mark", "aura",
                    )
                    if k in t
                }
                row["verify"] = t.get("verify")
            except (OSError, json.JSONDecodeError):
                pass
        items.append(row)

    doc = {
        "revealed": len(items),
        "minted": vault.minted,
        "digest": vault.digest() if vault.height is not None else None,
        "punks": items,
    }
    atomic_write_text(out / "collection.json", json.dumps(doc, indent=2) + "\n")
