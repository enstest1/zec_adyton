#!/usr/bin/env python3
"""
HASHVAULT — deterministic sprite generator

The single rule that makes this work with a sealed mint:

    sprite = f(traitHash, score)

A pure function, nothing else. No pre-rendered set, no allowlist of images, no
metadata server that has to be trusted. The reveal proof emits traitHash and
score as public signals; anyone can run this function and get the identical
PNG, byte for byte.

Hashpunks assigns "one unused punk rendered in advance" — which means the
images exist before anyone mines them, and whoever holds that folder knows the
whole collection ahead of the market. With sealed commitments that model
collapses anyway: there is no mint-time index to assign against. Deriving the
art instead means nobody, including the deployer, can see a punk before its
owner opens it.

Score gates which trait pools are reachable. It does not pick a trait. A high
roll widens the shelf; the hash still chooses off it. That preserves the thing
that makes mining feel like mining — you bid on a distribution, never a result.
"""

import hashlib
import json
import sys
from pathlib import Path

try:
    from PIL import Image          # only needed to draw; derive() works without it
except ImportError:            # pragma: no cover
    Image = None

S = 24          # sprite is 24x24 logical pixels
SCALE = 16      # upscale factor for export


# --------------------------------------------------------------------- colour

PALETTES = {
    "slate":    ("#0b0e14", "#2d3a4d", "#5a7291", "#8fa6c2"),
    "oxide":    ("#140b0b", "#4a231b", "#8a4331", "#c2704f"),
    "moss":     ("#080f0b", "#1d3a28", "#3a7050", "#63a87a"),
    "ultra":    ("#0a0817", "#26194f", "#4d3391", "#8163cc"),
    "ash":      ("#0d0d0d", "#2e2e2e", "#5c5c5c", "#919191"),
    "brine":    ("#05121a", "#123a4e", "#22708f", "#4aa8c7"),
}

VISOR_COLORS = {
    "phosphor": "#4ef08a",
    "amber":    "#f0b64e",
    "cyan":     "#4ed9f0",
    "magenta":  "#f04ec8",
    "bone":     "#e8e4d8",
    "blood":    "#f0574e",
    "violet":   "#a34ef0",
    "gold":     "#ffd34e",
    "white":    "#ffffff",
}

# Trait pools, ordered common -> rare. The index a roll can reach is capped by
# the score tier, so rare entries are unreachable on a low bid but never
# guaranteed on a high one.
POOLS = {
    "chassis":  ["block", "block", "tapered", "domed", "narrow", "spired"],
    "palette":  ["slate", "ash", "oxide", "moss", "brine", "ultra"],
    "visor":    ["phosphor", "amber", "cyan", "bone", "magenta", "blood", "violet", "gold", "white"],
    "hood":     ["plain", "plain", "ridged", "peaked", "horned", "crowned", "haloed"],
    "vent":     ["grille", "grille", "slit", "none", "fanged", "sealed"],
    "mark":     ["none", "none", "none", "dot", "scar", "sigil", "triple", "crown"],
    "aura":     ["none", "none", "none", "none", "dim", "lit", "burning"],
}

TIER_NAMES = ["drone", "runner", "warden", "cipher", "oracle"]


def tier_of(score: int) -> int:
    """Score is 0..1_000_000 from the circuit. Five tiers, widening shelves."""
    for i, cut in enumerate((200_000, 420_000, 640_000, 840_000)):
        if score < cut:
            return i
    return 4


def reach(pool: list, tier: int) -> int:
    """How far up a pool this tier can reach. Tier 0 sees roughly the common
    half; tier 4 sees everything. Always at least two options so that even the
    cheapest mint has a real roll rather than a fixed outcome."""
    n = len(pool)
    frac = 0.45 + 0.1375 * tier
    return max(2, min(n, round(n * frac)))


class Roll:
    """Deterministic stream of values from traitHash. Drawing bytes in a fixed
    order means the mapping from hash to sprite is stable forever — changing
    the draw order would silently re-roll every punk in the collection."""

    def __init__(self, trait_hash: int):
        self.buf = hashlib.sha256(str(trait_hash).encode()).digest()
        self.pos = 0

    def byte(self) -> int:
        if self.pos >= len(self.buf):
            self.buf = hashlib.sha256(self.buf).digest()
            self.pos = 0
        b = self.buf[self.pos]
        self.pos += 1
        return b

    def pick(self, pool: list, tier: int):
        return pool[self.byte() % reach(pool, tier)]


# ---------------------------------------------------------------------- draw

def hexrgb(h: str):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class Canvas:
    def __init__(self, bg):
        self.px = [[bg for _ in range(S)] for _ in range(S)]

    def set(self, x, y, c):
        if 0 <= x < S and 0 <= y < S:
            self.px[y][x] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, c)

    def image(self):
        im = Image.new("RGB", (S, S))
        im.putdata([hexrgb(self.px[y][x]) for y in range(S) for x in range(S)])
        return im.resize((S * SCALE, S * SCALE), Image.NEAREST)


def profile(chassis: str, y: int):
    """Head silhouette as an x-extent per scanline.

    Silhouette is the strongest identity signal available at 24 pixels — far
    stronger than colour. Six chassis shapes means a punk is recognisable as a
    shape before any colour loads, which is what lets a collection read as a
    collection rather than a palette swap.
    """
    t = y - 4                      # 0 at crown, 14 at jaw
    if chassis == "block":
        return 6, 17
    if chassis == "tapered":
        inset = 0 if t < 6 else (t - 6) // 3
        return 6 + inset, 17 - inset
    if chassis == "domed":
        if t == 0:
            return 8, 15
        if t == 1:
            return 7, 16
        return 6, 17
    if chassis == "narrow":
        return 7, 16
    if chassis == "spired":
        if t == 0:
            return 10, 13
        if t == 1:
            return 9, 14
        if t == 2:
            return 8, 15
        return 7, 16
    return 6, 17


def draw(traits: dict) -> "Image.Image":
    bg, shade, body, light = PALETTES[traits["palette"]]
    visor = VISOR_COLORS[traits["visor"]]
    chassis = traits["chassis"]

    c = Canvas(bg)

    if traits["aura"] != "none":
        glow = {"dim": shade, "lit": body, "burning": visor}[traits["aura"]]
        for y in range(2, 23):
            x0, x1 = profile(chassis, max(4, min(18, y)))
            c.set(x0 - 2, y, glow)
            c.set(x1 + 2, y, glow)
        c.rect(7, 1, 16, 1, glow)

    # shoulders first, so the head overlaps them
    c.rect(3, 20, 20, 23, shade)
    c.rect(4, 21, 19, 23, body)
    c.set(4, 21, light)
    c.set(19, 21, light)

    # head, drawn scanline by scanline from the chassis profile
    for y in range(4, 20):
        x0, x1 = profile(chassis, min(y, 18))
        c.rect(x0, y, x1, y, body)
        c.set(x0, y, shade)          # left edge falls into shadow
        c.set(x1, y, light)          # right edge catches light
    x0, x1 = profile(chassis, 4)
    c.rect(x0, 4, x1, 4, light)      # crown highlight
    x0, x1 = profile(chassis, 18)
    c.rect(x0, 19, x1, 19, shade)    # jawline

    # ---- hood: must alter the silhouette, or it is not a trait
    hood = traits["hood"]
    hx0, hx1 = profile(chassis, 5)
    if hood in ("ridged", "peaked", "horned", "crowned", "haloed"):
        c.rect(hx0 - 1, 3, hx1 + 1, 7, shade)
        c.rect(hx0, 4, hx1, 7, body)
    if hood == "ridged":
        for x in range(hx0, hx1 + 1, 2):
            c.set(x, 2, light)
    elif hood == "peaked":
        mid = (hx0 + hx1) // 2
        c.rect(mid - 1, 0, mid + 1, 3, shade)
        c.rect(mid, 1, mid, 3, light)
    elif hood == "horned":
        c.rect(hx0 - 2, 0, hx0 - 1, 4, light)
        c.rect(hx1 + 1, 0, hx1 + 2, 4, light)
        c.set(hx0 - 2, 0, visor)
        c.set(hx1 + 2, 0, visor)
    elif hood == "crowned":
        for x in range(hx0, hx1 + 1, 3):
            c.rect(x, 0, x, 3, visor)
    elif hood == "haloed":
        c.rect(hx0 - 1, 1, hx1 + 1, 1, visor)
        c.set(hx0 - 2, 2, visor)
        c.set(hx1 + 2, 2, visor)

    # ---- visor: the one saturated element. Two eyes, not a slab, and no white
    # overline — that was washing every colour out to the same pale bar.
    vx0, vx1 = profile(chassis, 11)
    vx0 += 1
    vx1 -= 1
    c.rect(vx0, 9, vx1, 13, "#000000")
    mid = (vx0 + vx1) // 2
    c.rect(vx0 + 1, 10, mid - 1, 12, visor)
    c.rect(mid + 2, 10, vx1 - 1, 12, visor)
    # a single dark scanline through each lens gives it depth without dulling it
    c.rect(vx0 + 1, 12, mid - 1, 12, "#000000")
    c.rect(mid + 2, 12, vx1 - 1, 12, "#000000")

    # ---- vent
    jx0, jx1 = profile(chassis, 16)
    vent = traits["vent"]
    cx = (jx0 + jx1) // 2
    if vent == "grille":
        for x in range(cx - 3, cx + 4, 2):
            c.rect(x, 15, x, 17, shade)
    elif vent == "slit":
        c.rect(cx - 3, 16, cx + 3, 16, shade)
    elif vent == "fanged":
        c.rect(cx - 3, 15, cx + 3, 15, shade)
        c.set(cx - 2, 16, light)
        c.set(cx + 2, 16, light)
    elif vent == "sealed":
        c.rect(cx - 4, 14, cx + 4, 18, shade)
        c.rect(cx - 3, 15, cx + 3, 17, body)

    # ---- mark
    mark = traits["mark"]
    mx0, mx1 = profile(chassis, 7)
    if mark == "dot":
        c.set(mx0 + 2, 7, visor)
    elif mark == "scar":
        for i in range(4):
            c.set(mx1 - 1 - i, 6 + i, light)
    elif mark == "sigil":
        c.rect(mx0 + 1, 6, mx0 + 2, 7, visor)
        c.set(mx0 + 3, 8, visor)
    elif mark == "triple":
        for i in range(3):
            c.set(mx0 + 1 + i * 2, 7, visor)
    elif mark == "crown":
        c.rect(mx0 + 1, 6, mx1 - 1, 6, visor)
        c.set((mx0 + mx1) // 2, 7, visor)

    return c.image()


# --------------------------------------------------------------------- derive

def derive(trait_hash: int, score: int) -> dict:
    """v1 entry point: tier from a fixed score cutoff. Kept so sim.py can still
    demonstrate the v1 flaws. The v2 indexer assigns tier by rank within the
    epoch and calls derive_tier() directly."""
    t = derive_tier(trait_hash, tier_of(score))
    t["score"] = score
    return t


def derive_tier(trait_hash: int, tier: int) -> dict:
    """v2 entry point. Tier comes from the indexer (rank within a sealed
    epoch), not from the score. Same Roll, same draw order, same pools."""
    r = Roll(trait_hash)
    # Fixed draw order. Never reorder this.
    t = {
        "chassis": r.pick(POOLS["chassis"], tier),
        "palette": r.pick(POOLS["palette"], tier),
        "visor":   r.pick(POOLS["visor"], tier),
        "hood":    r.pick(POOLS["hood"], tier),
        "vent":    r.pick(POOLS["vent"], tier),
        "mark":    r.pick(POOLS["mark"], tier),
        "aura":    r.pick(POOLS["aura"], tier),
    }
    t["tier"] = TIER_NAMES[tier]
    return t


def render(trait_hash: int, score: int, out: Path):
    t = derive(trait_hash, score)
    draw(t).save(out)
    return t


# ----------------------------------------------------------------------- main

if __name__ == "__main__":
    outdir = Path(sys.argv[1] if len(sys.argv) > 1 else "out")
    outdir.mkdir(parents=True, exist_ok=True)

    # A spread across the score range, to show what the tiers actually buy.
    samples = []
    for i in range(40):
        score = (i * 997_000 // 39)
        th = int(hashlib.sha256(f"sample-{i}".encode()).hexdigest(), 16) % (2 ** 128)
        t = render(th, score, outdir / f"punk-{i:03d}.png")
        samples.append(t)

    (outdir / "traits.json").write_text(json.dumps(samples, indent=2))

    # contact sheet
    cols, cell = 8, S * SCALE
    rows = (len(samples) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * cell), (7, 7, 10))
    for i in range(len(samples)):
        im = Image.open(outdir / f"punk-{i:03d}.png")
        sheet.paste(im, ((i % cols) * cell, (i // cols) * cell))
    sheet.save(outdir / "contact-sheet.png")
    print(f"wrote {len(samples)} sprites + contact-sheet.png to {outdir}")
