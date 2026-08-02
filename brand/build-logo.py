#!/usr/bin/env python3
"""Squirrel — logo system generator.

The mark: a squirrel hunched at a screen, wrapped in its own tail. The tail
forms a focus ring — the app's core mechanic — so the mark carries an idea
rather than just depicting an animal.

Two cuts of one identity:
  FULL    squirrel + screen inside the ring   — >=64px
  SIMPLE  squirrel inside the ring, no screen — <64px, where the screen fills in

Geometry is parametric, not hand-drawn: the ring is a log spiral swept through
a smooth width profile, so curvature is continuous. Edit the numbers here, never
the generated SVGs — they are overwritten on every run.
"""
import os, sys, math, cairosvg
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geom import tapered_stroke, log_spiral, width_profile, circle, blob, path

OUT = os.environ.get("SQUIRREL_OUT", os.path.dirname(os.path.abspath(__file__)))
os.makedirs(OUT, exist_ok=True)
S = 100

# ring: ~300 degrees, opening at the lower left, tapering to a fine tip
RING = (128, 128, 99, 0.030, 1.05, -4.10, 9, 13, 4)


def ring():
    cx, cy, a, b, t0, t1, w0, w1, w2 = RING
    return path(tapered_stroke(log_spiral(cx, cy, a, b, t0, t1, S),
                               width_profile(S, w0, w1, w2)))


def squirrel(hx, hy, hr, k=1.0, ox=0.0, oy=0.0, paw=True):
    """Sitting squirrel facing left: chest tucked, haunch full, ear pointed."""
    def P(x, y):
        return (ox + x * k, oy + y * k)
    out = blob([
        P(hx + 47, hy + 20), P(hx + 30, hy + 4), P(hx + 8, hy + 4),
        P(hx - 10, hy + 26), P(hx - 16, hy + 52),
        P(hx - 10, hy + 78), P(hx + 4, hy + 95),
        P(hx + 32, hy + 101), P(hx + 58, hy + 92),
        P(hx + 66, hy + 66), P(hx + 60, hy + 40),
    ])
    out += circle(ox + hx * k, oy + hy * k, hr * k)
    out += path(tapered_stroke(
        [P(hx - 13, hy + 6), P(hx - 28, hy + 14), P(hx - 38, hy + 19)],
        [13 * k, 9.5 * k, 6 * k]))
    out += path(tapered_stroke(
        [P(hx + 8, hy - 20), P(hx + 15, hy - 36), P(hx + 19, hy - 48)],
        [12 * k, 7 * k, 3 * k]))
    if paw:
        out += circle(ox + (hx - 16) * k, oy + (hy + 78) * k, 9.5 * k)
    return out


def full():
    sq = squirrel(118, 110, 24, k=0.78, ox=16, oy=18, paw=False)
    screen = ('<g stroke="{BG}" stroke-width="8" stroke-linejoin="round" '
              'paint-order="stroke fill">'
              '<path d="M71 134 L104 141 L107 179 L68 179 Z"/></g>')
    return ring() + sq + screen + '<rect x="60" y="181" width="106" height="10" rx="5"/>'


def simple():
    return ring() + squirrel(110, 112, 24, k=0.80, ox=18, oy=14)


# ------------------------------------------------------------------ wrappers
def mark(fn, fg="#000000", bg="#FFFFFF"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" '
            f'width="256" height="256"><g fill="{fg}">{fn().replace("{BG}", bg)}</g></svg>')


def squircle(fn, invert=False, k=0.84):
    bg, fg = ("#000000", "#FFFFFF") if invert else ("#FFFFFF", "#000000")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" '
            f'width="256" height="256"><rect width="256" height="256" rx="58" fill="{bg}"/>'
            f'<g fill="{fg}" transform="translate(128,128) scale({k}) translate(-128,-128)">'
            f'{fn().replace("{BG}", bg)}</g></svg>')


def lockup(invert=False):
    bg, fg = ("#000000", "#FFFFFF") if invert else ("#FFFFFF", "#000000")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 980 256" '
            f'width="980" height="256"><rect width="980" height="256" fill="{bg}"/>'
            f'<g fill="{fg}" transform="translate(8,10) scale(0.92)">'
            f'{full().replace("{BG}", bg)}</g>'
            f'<text x="288" y="166" fill="{fg}" '
            f'font-family="Liberation Sans, Helvetica Neue, Arial, sans-serif" '
            f'font-size="122" font-weight="bold" letter-spacing="-5">Squirrel</text></svg>')


ASSETS = {
    "squirrel-logo":              mark(full),
    "squirrel-logo-white":        mark(full, "#FFFFFF", "#000000"),
    "squirrel-logo-simple":       mark(simple),
    "squirrel-logo-simple-white": mark(simple, "#FFFFFF", "#000000"),
    "squirrel-appicon-light":     squircle(full),
    "squirrel-appicon-dark":      squircle(full, invert=True),
    "squirrel-appicon-small-light": squircle(simple),
    "squirrel-appicon-small-dark":  squircle(simple, invert=True),
    "squirrel-lockup":            lockup(),
    "squirrel-lockup-dark":       lockup(invert=True),
}

if __name__ == "__main__":
    for n, s in ASSETS.items():
        open(os.path.join(OUT, f"{n}.svg"), "w").write(s)
    for n in ("squirrel-appicon-light", "squirrel-appicon-dark"):
        for px in (1024, 512, 180, 120):
            cairosvg.svg2png(bytestring=ASSETS[n].encode(),
                             write_to=os.path.join(OUT, f"{n}-{px}.png"),
                             output_width=px, output_height=px)
    for n in ("squirrel-appicon-small-light", "squirrel-appicon-small-dark"):
        for px in (60, 48, 32):
            cairosvg.svg2png(bytestring=ASSETS[n].encode(),
                             write_to=os.path.join(OUT, f"{n}-{px}.png"),
                             output_width=px, output_height=px)
    for n in ("squirrel-logo", "squirrel-logo-simple"):
        cairosvg.svg2png(bytestring=ASSETS[n].encode(),
                         write_to=os.path.join(OUT, f"{n}-1024.png"),
                         output_width=1024, output_height=1024, background_color="white")
    cairosvg.svg2png(bytestring=ASSETS["squirrel-lockup"].encode(),
                     write_to=os.path.join(OUT, "squirrel-lockup-1800.png"), output_width=1800)
    print(f"wrote {len(ASSETS)} svg assets to {OUT}")
