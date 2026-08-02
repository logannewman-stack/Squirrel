#!/usr/bin/env python3
"""
Lift the squirrel out of the logo artwork, on her own.

The packaged logo is a scene — squirrel, desk, pencil — traced as one image.
The app needs just her, and it needs to be the *same* geometry, not a redraw
that resembles it: a hand-drawn copy drifts from the icon the moment either is
touched. So this re-traces the original source with the furniture erased and
writes the result straight into the component.

    python3 brand/extract-her.py

The desk is found rather than hard-coded — it is the only wide flat run of ink
reaching the left edge — so a re-export of the artwork at a different size or
crop still works.
"""
import re
from collections import deque
from pathlib import Path

import numpy as np
import potrace
from PIL import Image, ImageOps

HERE = Path(__file__).parent
SRC = HERE / "source/logo_black_on_white_4k.png"
OUT = HERE.parent / "src/components/Squirrel.jsx"


def isolate():
    im = Image.open(SRC).convert("L")
    a = np.array(im.crop(ImageOps.invert(im).getbbox()))
    ink = (a < 128).copy()
    h, w = ink.shape

    # The desk slab: a long horizontal run of ink against the left edge.
    rows = [y for y in range(h) if ink[y, : w // 3].sum() > w // 4]
    if not rows:
        raise SystemExit("no desk found — has the artwork changed?")
    ink[min(rows) : max(rows) + 1, : w // 3] = False

    # Whatever is left standing, biggest piece wins. That is her; the pencil
    # and the desk legs are their own islands.
    lab = np.zeros((h, w), np.int32)
    cur = 0
    best = (0, 0)
    for sy in range(0, h, 3):
        for sx in range(0, w, 3):
            if not ink[sy, sx] or lab[sy, sx]:
                continue
            cur += 1
            q = deque([(sy, sx)])
            lab[sy, sx] = cur
            n = 0
            while q:
                y, x = q.popleft()
                n += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and ink[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = cur
                        q.append((ny, nx))
            if n > best[0]:
                best = (n, cur)

    her = lab == best[1]
    ys, xs = np.where(her)
    return her[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]


def trace(mask):
    # Polarity: potracer fills where the mask is False, so the ink mask is
    # inverted here. Getting this backwards yields a filled rectangle with her
    # punched out of it, which is easy to miss in a thumbnail.
    path = potrace.Bitmap(~mask).trace(
        turdsize=3, alphamax=1.0, opticurve=True, opttolerance=0.2
    )
    parts = []
    for curve in path:
        p = curve.start_point
        d = [f"M{p.x:.1f},{p.y:.1f}"]
        for seg in curve:
            e = seg.end_point
            if seg.is_corner:
                d.append(f"L{seg.c.x:.1f},{seg.c.y:.1f} L{e.x:.1f},{e.y:.1f}")
            else:
                d.append(
                    f"C{seg.c1.x:.1f},{seg.c1.y:.1f} "
                    f"{seg.c2.x:.1f},{seg.c2.y:.1f} {e.x:.1f},{e.y:.1f}"
                )
        d.append("Z")
        parts.append(" ".join(d))
    return " ".join(parts)


def verify(mask, d, floor=97.0):
    """Rasterise the trace and compare it to the mask, pixel for pixel.

    An ink-coverage check is not enough — an inverted trace preserves the ink
    fraction almost exactly on artwork this close to half black. Only agreement
    catches it.
    """
    import cairosvg

    h, w = mask.shape
    png = HERE / "__verify.png"
    # An explicit white ground matters: cairosvg renders onto transparency, and
    # RGBA→L turns every transparent pixel black, which reads as 100% ink and
    # makes the comparison meaningless.
    cairosvg.svg2png(
        bytestring=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
        f'width="{w}" height="{h}"><rect width="{w}" height="{h}" fill="#fff"/>'
        f'<path fill="#000" fill-rule="evenodd" d="{d}"/></svg>'.encode(),
        write_to=str(png),
        background_color="white",
    )
    got = np.array(Image.open(png).convert("L")) < 128
    png.unlink()
    agree = (got == mask).mean() * 100
    print(f"trace agrees with the source on {agree:.1f}% of pixels")
    if agree < floor:
        raise SystemExit(f"below {floor}% — refusing to write a wrong squirrel")


def main():
    mask = isolate()
    h, w = mask.shape
    d = trace(mask)
    verify(mask, d)

    pad = (h - w) / 2
    src = OUT.read_text()
    src = re.sub(r'full: "[^"]*"', f'full: "{-pad:.1f} 0 {h} {h}"', src, count=1)
    src = re.sub(r'const D = "[^"]*";', f'const D = "{d}";', src, count=1)
    OUT.write_text(src)
    print(f"wrote {len(d)} chars to {OUT.relative_to(HERE.parent)}  (art {w}x{h})")


if __name__ == "__main__":
    main()
