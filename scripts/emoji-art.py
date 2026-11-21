#!/usr/bin/env python3
"""Download the Apple emoji artwork and convert it to WebP, for the font build.

This is step 1 of two:

    python scripts/emoji-art.py     # Apple 64 px PNGs -> .cache/emoji-art/*.webp
    python scripts/emoji-font.py    # those WebP files -> the colour font

The artwork is not committed. `scripts/emoji-font.py` reads
`.cache/emoji-art`, and the app ships only the font — that is why the
repository carries one 25 MB file instead of 3 787 images.

Requirements: Python 3 with Pillow, and network access to a registry.

Licensing: the npm package's LICENSE is MIT for Cal Henderson's data and code;
the PNGs are Apple's artwork and Apple has not licensed them for redistribution.
This script is how this repository builds the font, not a grant of rights. See
apps/desktop/src/renderer/src/assets/fonts/NOTICE.md.
"""

import io
import os
import sys
import tarfile
import tempfile
import urllib.request

from PIL import Image

PACKAGE = "emoji-datasource-apple"
VERSION = "16.0.0"
REGISTRIES = (
    "https://registry.npmmirror.com",
    "https://registry.npmjs.org",
)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", ".cache", "emoji-art")


def art_name(stem):
    parts = [part.lower() for part in stem.split("-")]
    parts = [part for part in parts if part not in ("fe0f", "fe0e")]
    return "-".join(parts)


def download(destination):
    last = None
    for registry in REGISTRIES:
        url = "%s/%s/-/%s-%s.tgz" % (registry, PACKAGE, PACKAGE, VERSION)
        try:
            print("downloading", url)
            with urllib.request.urlopen(url, timeout=180) as response:
                with open(destination, "wb") as handle:
                    while True:
                        chunk = response.read(1 << 20)
                        if not chunk:
                            break
                        handle.write(chunk)
            return
        except Exception as error:  # noqa: BLE001 - try the next registry
            last = error
            print("  failed:", error)
    raise SystemExit("could not download %s: %s" % (PACKAGE, last))


def main():
    os.makedirs(OUT, exist_ok=True)
    workdir = tempfile.mkdtemp(prefix="emoji-art-")
    tarball = os.path.join(workdir, PACKAGE + ".tgz")
    download(tarball)

    written = 0
    with tarfile.open(tarball, "r:gz") as archive:
        for member in archive.getmembers():
            if not member.name.startswith("package/img/apple/64/"):
                continue
            if not member.name.endswith(".png"):
                continue
            name = art_name(os.path.splitext(os.path.basename(member.name))[0])
            target = os.path.join(OUT, name + ".webp")
            if os.path.exists(target):
                continue
            data = archive.extractfile(member).read()
            image = Image.open(io.BytesIO(data)).convert("RGBA")
            image.save(target, "WEBP", quality=95, method=6)
            written += 1

    total = len([name for name in os.listdir(OUT) if name.endswith(".webp")])
    print("artwork:", total, "files,", written, "newly written, in", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
