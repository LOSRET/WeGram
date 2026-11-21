#!/usr/bin/env python3
"""Build the WeGram emoji font from the Apple artwork in public/emoji.

Why a font: a textarea cannot contain an <img>, so a composer that paints emoji
as images has to be a contenteditable and rebuild its DOM on every insert (that
rebuild is the flash you see). A colour font solves it once, for the input, the
bubbles and the picker: the text stays plain Unicode and the platform renders
the artwork.

Format: CBDT/CBLC (bitmap colour glyphs), because that is the only colour format
Chromium on Windows actually paints — verified: Apple's own sbix font falls back
to Segoe, a CBDT font renders. Sequences that need GSUB (skin tones, flags,
keycaps, ZWJ families) are ligatures under `ccmp`, and FE0F is absorbed by a
one-rule-per-glyph ligature so the qualified and unqualified spellings share one
glyph.

Input: every .webp in .cache/emoji-art (scripts/emoji-art.py downloads and
converts them), named by lower-case hex code points with FE0F stripped.
Regenerate both together: emoji-art.py, then emoji-font.py.

Licensing: the glyphs are Apple's artwork (see public/emoji/NOTICE.md). This
script builds the file; it grants no rights.
"""

import io
import os
import re
import sys

from PIL import Image
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables.C_B_D_T_ import SmallGlyphMetrics, cbdt_bitmap_format_17
from fontTools.ttLib.tables.E_B_L_C_ import Strike, SbitLineMetrics, eblc_index_sub_table_1

HERE = os.path.dirname(os.path.abspath(__file__))
RENDERER = os.path.join(HERE, "..", "apps", "desktop", "src", "renderer")
ART = os.path.join(HERE, "..", ".cache", "emoji-art")
OUT = os.path.join(RENDERER, "src", "assets", "fonts", "WeGramEmoji.ttf")

# ASCII digits, # and * are keycap components, not emoji of their own. They are
# deliberately left out of the cmap: with the emoji font first in the stack a
# digit would otherwise resolve to its blank component glyph and vanish, which
# breaks every number in a message. Keycaps then fall back to the system emoji
# font (still a keycap, different artwork) — the one documented delta.

UPEM = 2048
# The bitmaps are 64 px; drawing them at a 56 px design size makes them 1.14 em,
# the size the bubbles used when they were <img>. The same number keeps the
# 64 px source sharp down to a 28 px glyph.
PPEM = 56
SIDE = 64
ADVANCE = int(round(UPEM * SIDE / PPEM))
BASELINE = 50           # px above the baseline, out of SIDE
FAMILY = "WeGram Emoji"

# ASCII digits, # and * are keycap components, not emoji of their own, and they
# stay out of the cmap: with the emoji font first in the stack a digit would
# otherwise resolve to its blank component glyph and vanish, breaking every
# number in a message. Keycaps then fall back to the system emoji font — still a
# keycap, different artwork (the one documented delta).
SKIP_CMAP = {0x23, 0x2A, *range(0x30, 0x3A)}


def glyph_name(cps):
    return "u" + "_".join("%04X" % code for code in cps)


def read_sequences():
    sequences = {}
    for entry in sorted(os.listdir(ART)):
        if not entry.endswith(".webp"):
            continue
        stem = entry[: -len(".webp")]
        cps = tuple(int(part, 16) for part in stem.split("-"))
        sequences[cps] = os.path.join(ART, entry)
    return sequences


def main():
    sequences = read_sequences()
    if not sequences:
        raise SystemExit("no artwork in %s" % ART)

    components = sorted({code for cps in sequences for code in cps})
    singles = [cps for cps in sequences if len(cps) == 1]
    multi = [cps for cps in sequences if len(cps) > 1]

    order = [".notdef", "uniFE0F"]
    cmap = {0xFE0F: "uniFE0F"}
    for cps in singles:
        name = glyph_name(cps)
        order.append(name)
        cmap[cps[0]] = name
    # A ligature target must be a real glyph, so every sequence gets one.
    for cps in multi:
        name = glyph_name(cps)
        if name not in order:
            order.append(name)
    for code in components:
        name = glyph_name((code,))
        if name not in order:
            order.append(name)
            if code not in SKIP_CMAP:
                cmap.setdefault(code, name)

    font = FontBuilder(UPEM, isTTF=True)
    font.setupGlyphOrder(order)
    pen = TTGlyphPen(None)
    blank = pen.glyph()
    font.setupGlyf({name: blank for name in order})

    art = {glyph_name(cps): path for cps, path in sequences.items()}
    metrics = {}
    for name in order:
        width = ADVANCE if name in art else 0
        metrics[name] = (width, 0)
    font.setupHorizontalMetrics(metrics)
    font.setupHorizontalHeader(ascent=1900, descent=-500)
    font.setupCharacterMap(cmap)
    font.setupNameTable({"familyName": FAMILY, "styleName": "Regular"})
    font.setupOS2(
        sTypoAscender=1900,
        sTypoDescender=-500,
        usWinAscent=1900,
        usWinDescent=500,
        fsSelection=0x40,
    )
    font.setupPost()
    font.setupMaxp()

    # GSUB. Longest first: HarfBuzz walks a ligature set in order, so a shorter
    # rule listed first would eat the prefix of a longer sequence.
    rules = []
    for cps in sorted(multi, key=len, reverse=True):
        rules.append(
            "  sub %s by %s;"
            % (" ".join(glyph_name((code,)) for code in cps), glyph_name(cps))
        )
    fe0f = []
    for name in order:
        if name in (".notdef", "uniFE0F"):
            continue
        fe0f.append("  sub %s uniFE0F by %s;" % (name, name))
    feature = "feature ccmp {\n" + "\n".join(fe0f + rules) + "\n} ccmp;"
    addOpenTypeFeaturesFromString(font.font, feature)

    bitmaps = {}
    for name, path in art.items():
        image = Image.open(path).convert("RGBA")
        if image.size != (SIDE, SIDE):
            image = image.resize((SIDE, SIDE), Image.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, "PNG", optimize=True)
        glyph = cbdt_bitmap_format_17(b"", None)
        metric = SmallGlyphMetrics()
        metric.height = SIDE
        metric.width = SIDE
        metric.BearingX = 0
        metric.BearingY = BASELINE
        metric.Advance = SIDE
        glyph.metrics = metric
        glyph.imageData = buffer.getvalue()
        bitmaps[name] = glyph

    strike = Strike()
    size = strike.bitmapSizeTable
    size.colorRef = 0
    size.ppemX = PPEM
    size.ppemY = PPEM
    size.bitDepth = 32
    size.flags = 1
    for direction in ("hori", "vert"):
        line = SbitLineMetrics()
        line.ascender = BASELINE
        line.descender = BASELINE - SIDE
        line.widthMax = SIDE
        for field in (
            "caretSlopeNumerator",
            "caretSlopeDenominator",
            "caretOffset",
            "minOriginSB",
            "minAdvanceSB",
            "maxBeforeBL",
            "minAfterBL",
            "pad1",
            "pad2",
        ):
            setattr(line, field, 0)
        setattr(size, direction, line)

    table = eblc_index_sub_table_1(None, None)
    table.indexFormat = 1
    table.imageFormat = 17
    table.imageDataOffset = 0
    table.names = [name for name in order if name in bitmaps]
    strike.indexSubTables = [table]

    cbdt = newTable("CBDT")
    cbdt.version = 3.0
    cbdt.strikeData = [bitmaps]
    cblc = newTable("CBLC")
    cblc.version = 3.0
    cblc.strikes = [strike]
    font.font["CBDT"] = cbdt
    font.font["CBLC"] = cblc

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    font.save(OUT)
    size_mb = os.path.getsize(OUT) / 1024 / 1024
    print("glyphs", len(order), "sequences", len(multi) + len(singles), "bitmaps", len(bitmaps))
    print("wrote", OUT, "%.1f MB" % size_mb)

    check = TTFont(OUT)
    print("tables", " ".join(sorted(check.keys())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
