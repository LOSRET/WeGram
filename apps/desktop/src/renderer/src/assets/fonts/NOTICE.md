# WeGram Emoji font

The glyphs are Apple Color Emoji artwork, built by `scripts/emoji-font.py` from
the 64 px images in the npm package `emoji-datasource-apple` 16.0.0
(github.com/iamcal/emoji-data) and packed as a CBDT/CBLC colour font.

Format notes: Apple's own `AppleColorEmoji.ttf` is an sbix font and Chromium on
Windows does not paint sbix (verified: it silently falls back to Segoe UI Emoji).
CBDT is painted, so the font is built in that format. Sequences that need GSUB
(skin tones, flags, keycaps, ZWJ families) are `ccmp` ligatures; FE0F is
absorbed by a one-rule-per-glyph ligature.

**Licensing.** The npm package's LICENSE is MIT for Cal Henderson's data and
code; the images themselves are Apple's artwork and Apple has not licensed them
for redistribution. Telegram's clients ship the same artwork without an Apple
licence — a risk they carry, not one they pass on. This build ships the font
because the product decision was "look like Telegram". Removing the `@font-face`
in `styles/font.css` restores the system emoji font.

Known delta: ASCII digits, `#` and `*` are deliberately absent from the font's
cmap, so keycap emoji (1️⃣, #️⃣ …) fall back to the system emoji font instead of
Apple's artwork. Without that exclusion a number in a message would resolve to
the font's blank keycap component and disappear.

Regenerate:

    python scripts/emoji-art.py     # downloads Apple PNGs into .cache/emoji-art
    python scripts/emoji-font.py    # builds this file (needs Pillow + fontTools)
