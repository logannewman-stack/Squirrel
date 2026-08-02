#!/usr/bin/env python3
"""Squirrel — logo system generator. Black and white.

The mark: a squirrel sitting upright at a desk, working at a monitor, its big
tail curling up and over behind it.

Two cuts of one identity:
  FULL    squirrel + desk + monitor  — 64px and up
  SIMPLE  squirrel + tail only       — below 64px, where the desk fills in

Two things govern the drawing and are easy to break:

1. The tail is a logarithmic spiral swept through a width profile. A curling
   tail only reads as a curl if its stroke width stays well under the radius it
   loses per turn — otherwise consecutive turns weld into a solid blob. At the
   current settings r drops 36 over the sweep against a 30-wide stroke.

2. Separation is carried entirely by white gaps, since monochrome has no colour
   contrast to lean on. `halo()` paints a merged group fat in the background
   colour and then again in black, so the gap wraps the combined silhouette
   rather than biting into each shape individually.

Edit the numbers here; never hand-edit the generated SVGs, which are
overwritten on every run.
"""
import os, sys, math, cairosvg

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geom import tapered_stroke, log_spiral, width_profile, circle, blob, path

OUT = os.environ.get("SQUIRREL_OUT", os.path.dirname(os.path.abspath(__file__)))
os.makedirs(OUT, exist_ok=True)
S = 140

# tail: (cx, cy, r_base, r_tip, start_deg, sweep_deg, w_base, w_peak, w_tip)
TAIL = (172, 130, 56, 20, 100, 290, 14, 15, 5)


def spiral_tail(cx, cy, r0, r1, th0_deg, sweep_deg, wb, wp, wt, peak_at=0.36):
    th0 = math.radians(th0_deg)
    th1 = th0 - math.radians(sweep_deg)
    b = math.log(r1 / r0) / (th1 - th0)
    a = r0 / math.exp(b * th0)
    return tapered_stroke(log_spiral(cx, cy, a, b, th0, th1, S),
                          width_profile(S, wb, wp, wt, peak_at))


def halo(shapes, bg, w=8):
    return (f'<g fill="{bg}" stroke="{bg}" stroke-width="{w * 2}" stroke-linejoin="round" '
            f'stroke-linecap="round">{shapes}</g><g>{shapes}</g>')


def figure(arm=True):
    # shoulders sit above the head's lower edge (y=141) so the neck stays solid;
    # drop them and Catmull-Rom sags a white notch between head and body.
    body = blob([
        (140, 136), (152, 148), (158, 165), (161, 181),
        (153, 195), (136, 201), (120, 201), (107, 194),
        (100, 181), (99, 166), (104, 150), (114, 138),
    ])
    head = circle(126, 120, 21)
    snout = path(tapered_stroke([(111, 126), (100, 130), (94, 132)], [12.5, 9.5, 7]))
    ear = path(tapered_stroke([(135, 105), (141, 92), (144, 83)], [9.5, 5.5, 2.5]))
    out = body + head + snout + ear
    if arm:
        out += path(tapered_stroke([(109, 150), (98, 157), (90, 161)], [9, 7.5, 6]))
    return out


MONITOR = ('<rect x="34" y="97" width="16" height="58" rx="7" '
           'transform="rotate(-10 42 126)"/>'
           '<rect x="40" y="149" width="26" height="8" rx="4" '
           'transform="rotate(-5 53 153)"/>')
DESK = ('<rect x="16" y="166" width="94" height="10" rx="5"/>'
        '<rect x="23" y="176" width="9" height="28" rx="4.5"/>'
        '<rect x="94" y="176" width="9" height="28" rx="4.5"/>')


def full(bg="#FFFFFF"):
    eye = f'<circle cx="119" cy="117" r="4.8" fill="{bg}"/>'
    return (path(spiral_tail(*TAIL)) + halo(figure(), bg) + eye
            + halo(MONITOR, bg, 6) + halo(DESK, bg, 6))


def simple(bg="#FFFFFF"):
    """Squirrel + tail, no desk — the desk fills in below ~64px."""
    eye = f'<circle cx="119" cy="117" r="5.2" fill="{bg}"/>'
    inner = path(spiral_tail(*TAIL)) + halo(figure(arm=False), bg, 9) + eye
    return (f'<g transform="translate(128,132) scale(1.12) translate(-132,-142)">'
            f'{inner}</g>')


# ------------------------------------------------------------------ wrappers
def mark(fn, fg="#000000", bg="#FFFFFF"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" '
            f'width="256" height="256"><g fill="{fg}">{fn(bg)}</g></svg>')


def squircle(fn, invert=False, k=0.86):
    bg, fg = ("#000000", "#FFFFFF") if invert else ("#FFFFFF", "#000000")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" '
            f'width="256" height="256"><rect width="256" height="256" rx="58" fill="{bg}"/>'
            f'<g fill="{fg}" transform="translate(128,130) scale({k}) translate(-128,-128)">'
            f'{fn(bg)}</g></svg>')


def lockup(invert=False):
    bg, fg = ("#000000", "#FFFFFF") if invert else ("#FFFFFF", "#000000")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 256" '
            f'width="1000" height="256"><rect width="1000" height="256" fill="{bg}"/>'
            f'<g fill="{fg}" transform="translate(6,12) scale(0.92)">{full(bg)}</g>'
            f'<text x="300" y="166" fill="{fg}" '
            f'font-family="Liberation Sans, Helvetica Neue, Arial, sans-serif" '
            f'font-size="122" font-weight="bold" letter-spacing="-5">Squirrel</text></svg>')


ASSETS = {
    "squirrel-logo":                mark(full),
    "squirrel-logo-white":          mark(full, "#FFFFFF", "#000000"),
    "squirrel-logo-simple":         mark(simple),
    "squirrel-logo-simple-white":   mark(simple, "#FFFFFF", "#000000"),
    "squirrel-appicon-light":       squircle(full),
    "squirrel-appicon-dark":        squircle(full, invert=True),
    "squirrel-appicon-small-light": squircle(simple, k=0.92),
    "squirrel-appicon-small-dark":  squircle(simple, invert=True, k=0.92),
    "squirrel-lockup":              lockup(),
    "squirrel-lockup-dark":         lockup(invert=True),
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
