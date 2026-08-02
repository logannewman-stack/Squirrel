#!/usr/bin/env python3
"""Squirrel — derive the full asset set from the source artwork.

Input:  brand/source/logo_black_on_white_4k.png (pure two-value black on white)
Output: vector trace + every packaged variant.

Nothing here redraws the mark. The artwork is traced as-is; all this script
does is vectorise, crop to the real ink bounds, and package. Re-run it after
replacing the source file and every derived asset updates.

Why trace rather than ship the PNG: the source is two-value, so it vectorises
almost exactly — no colour quantisation to fight — and the result is sharp at
any size instead of being a 1.4K bitmap sitting in a 4K frame.
"""
import os
import numpy as np
import potrace
import cairosvg
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source", "logo_black_on_white_4k.png")
OUT = os.environ.get("SQUIRREL_OUT", HERE)
os.makedirs(OUT, exist_ok=True)

CANVAS = 1024          # viewBox of the packaged marks
ART_FRACTION = 0.84    # how much of the canvas the artwork fills
ICON_FRACTION = 0.72   # tighter for app icons, which need optical margin
CORNER = 232           # squircle radius at 1024 (matches iOS proportions)


# --------------------------------------------------------------------- trace
def trace_source():
    im = Image.open(SRC).convert("L")
    box = ImageOps.invert(im).getbbox()          # tight bounds of the ink
    if box is None:
        raise SystemExit("source image is blank")
    art = im.crop(box)
    w, h = art.size
    # NOTE polarity: potracer fills where the mask is False, so this passes True
    # for the LIGHT pixels. Inverting it silently produces a filled rectangle
    # with the squirrel punched out — and because the artwork is close to 50/50
    # black/white, the ink fraction barely moves, so that failure does not show
    # up in a coverage check. verify() below compares pixel-for-pixel instead.
    bitmap = potrace.Bitmap(np.array(art) >= 128)
    path = bitmap.trace(turdsize=3, alphamax=1.0, opticurve=True, opttolerance=0.2)

    parts = []
    for curve in path:
        p = curve.start_point
        d = [f"M{p.x:.2f},{p.y:.2f}"]
        for seg in curve:
            e = seg.end_point
            if seg.is_corner:
                d.append(f"L{seg.c.x:.2f},{seg.c.y:.2f} L{e.x:.2f},{e.y:.2f}")
            else:
                d.append(f"C{seg.c1.x:.2f},{seg.c1.y:.2f} "
                         f"{seg.c2.x:.2f},{seg.c2.y:.2f} {e.x:.2f},{e.y:.2f}")
        d.append("Z")
        parts.append(" ".join(d))
    return " ".join(parts), w, h


PATH_D, ART_W, ART_H = trace_source()


def verify(n=500, floor=95.0):
    """Rasterise the trace and compare it pixel-for-pixel against the source.

    Guards the polarity trap above: a coverage or ink-fraction check passes just
    as happily on an inverted trace, so agreement is the only honest measure.
    """
    im = Image.open(SRC).convert("L")
    ref = np.array(im.crop(ImageOps.invert(im).getbbox()).resize((n, n))) < 128
    probe = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ART_W} {ART_H}" '
             f'width="{ART_W}" height="{ART_H}">'
             f'<path fill="black" fill-rule="evenodd" d="{PATH_D}"/></svg>')
    png = cairosvg.svg2png(bytestring=probe.encode(), output_width=n,
                           output_height=n, background_color="white")
    tmp = os.path.join(OUT, ".verify.png")
    open(tmp, "wb").write(png)
    got = np.array(Image.open(tmp).convert("L")) < 128
    os.remove(tmp)
    score = 100 * (got == ref).mean()
    if score < floor:
        raise SystemExit(f"trace disagrees with source ({score:.1f}% < {floor}%) — "
                         f"check bitmap polarity and fill-rule")
    return score


def placed(fraction=ART_FRACTION):
    """Artwork scaled to `fraction` of the canvas and optically centred."""
    s = fraction * CANVAS / max(ART_W, ART_H)
    tx = (CANVAS - ART_W * s) / 2
    ty = (CANVAS - ART_H * s) / 2
    return f'transform="translate({tx:.2f},{ty:.2f}) scale({s:.5f})"'


def svg(inner):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {CANVAS} {CANVAS}" '
            f'width="{CANVAS}" height="{CANVAS}">{inner}</svg>')


def art(fill, fraction=ART_FRACTION):
    # even-odd so the eye and the white channel through the tail stay open
    return (f'<g {placed(fraction)}><path fill="{fill}" fill-rule="evenodd" '
            f'd="{PATH_D}"/></g>')


def flat(fill, bg=None, fraction=ART_FRACTION):
    back = f'<rect width="{CANVAS}" height="{CANVAS}" fill="{bg}"/>' if bg else ""
    return svg(back + art(fill, fraction))


def icon(invert=False):
    bg, fg = ("#000000", "#FFFFFF") if invert else ("#FFFFFF", "#000000")
    return svg(f'<rect width="{CANVAS}" height="{CANVAS}" rx="{CORNER}" fill="{bg}"/>'
               + art(fg, ICON_FRACTION))


def lockup(invert=False):
    bg, fg = ("#000000", "#FFFFFF") if invert else ("#FFFFFF", "#000000")
    s = 0.78 * CANVAS / max(ART_W, ART_H)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3400 1024" '
            f'width="3400" height="1024"><rect width="3400" height="1024" fill="{bg}"/>'
            f'<g transform="translate(90,{(CANVAS - ART_H * s) / 2:.1f}) scale({s:.5f})">'
            f'<path fill="{fg}" fill-rule="evenodd" d="{PATH_D}"/></g>'
            f'<text x="1120" y="660" fill="{fg}" '
            f'font-family="Liberation Sans, Helvetica Neue, Arial, sans-serif" '
            f'font-size="470" font-weight="bold" letter-spacing="-20">Squirrel</text></svg>')


ASSETS = {
    # transparent background — the ones to reach for by default
    "squirrel-logo":              flat("#000000"),
    "squirrel-logo-white":        flat("#FFFFFF"),
    # baked backgrounds
    "squirrel-logo-on-white":     flat("#000000", "#FFFFFF"),
    "squirrel-logo-on-black":     flat("#FFFFFF", "#000000"),
    # app icons
    "squirrel-appicon-light":     icon(),
    "squirrel-appicon-dark":      icon(invert=True),
    # lockups
    "squirrel-lockup":            lockup(),
    "squirrel-lockup-dark":       lockup(invert=True),
}

if __name__ == "__main__":
    for name, s in ASSETS.items():
        open(os.path.join(OUT, f"{name}.svg"), "w").write(s)

    for name in ("squirrel-appicon-light", "squirrel-appicon-dark"):
        for px in (1024, 512, 180, 120, 60, 32):
            cairosvg.svg2png(bytestring=ASSETS[name].encode(),
                             write_to=os.path.join(OUT, f"{name}-{px}.png"),
                             output_width=px, output_height=px)

    for name in ("squirrel-logo", "squirrel-logo-white"):
        for px in (1024, 512, 256):
            cairosvg.svg2png(bytestring=ASSETS[name].encode(),
                             write_to=os.path.join(OUT, f"{name}-{px}.png"),
                             output_width=px, output_height=px)

    cairosvg.svg2png(bytestring=ASSETS["squirrel-lockup"].encode(),
                     write_to=os.path.join(OUT, "squirrel-lockup-2400.png"),
                     output_width=2400)
    cairosvg.svg2png(bytestring=ASSETS["squirrel-appicon-light"].encode(),
                     write_to=os.path.join(OUT, "favicon-32.png"),
                     output_width=32, output_height=32)

    print(f"traced {len(PATH_D):,} path chars from {ART_W}x{ART_H} ink bounds "
          f"({verify():.1f}% agreement with source)")
    print(f"wrote {len(ASSETS)} svg assets to {OUT}")
