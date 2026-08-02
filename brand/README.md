# Squirrel — brand marks

Logo system for **Squirrel**, an ADHD focus app. Black and white only.

## The mark

A squirrel sitting upright at a desk, working at a monitor, its big tail curling
up and over behind it.

| File | Use |
| --- | --- |
| `squirrel-logo.svg` | Full mark, with desk and monitor. 64px and up. |
| `squirrel-logo-simple.svg` | Squirrel and tail only. Below 64px. |
| `squirrel-appicon-{light,dark}.svg` | Rounded-square app icon. |
| `squirrel-appicon-small-{light,dark}.svg` | App icon, simple cut, 60px and below. |
| `squirrel-lockup{,-dark}.svg` | Mark + wordmark, horizontal. |

`-white` variants are the same geometry filled white, for dark backgrounds.

## Why black and white

The audience is people whose attention is the scarce resource. Colour is a claim
on attention, so the interface spends none of it on decoration — hierarchy and
motion carry meaning instead. It also means the mark has no colour-on-colour
failure case.

Note that monochrome removes the tool a two-tone version would use to separate
the tail from the body. Here that separation is carried entirely by white gaps,
which is why the gap rules below matter more than they normally would.

## Rules

- **Never use the full cut below 64px.** The desk and monitor fill into a smear.
  Switch to `-simple`.
- Clear space: one desk-leg width on all sides.
- Don't recolour, rotate, add gradients, or outline it.
- Don't close the tail's curl. The white spiral inside it is what makes it read
  as a tail rather than a solid comma.

## Two things that break easily

**1. The tail welds shut.** The tail is a logarithmic spiral swept through a
width profile. A curl only reads as a curl while the stroke width stays well
under the radius the spiral loses per turn. At the current settings the radius
drops 36 across the sweep against a 30-wide stroke. Widen the stroke or extend
the sweep much past 290° and consecutive turns merge into one black blob.

**2. Gaps must halo the merged figure.** `halo()` paints a whole group fat in the
background colour, then paints it again in black. Applying a knockout stroke to
each shape individually instead makes neighbouring shapes bite chunks out of one
another. On a background that is not pure black or white, regenerate with a
matching `bg` — the halo colour must equal the background or a fringe appears.

A related trap: the body's shoulder points must sit above the head's lower edge
(y=141), or Catmull-Rom sags the outline into a white notch and the head reads
as detached from the body.

## Regenerating

Geometry is **parametric, not hand-drawn** — `geom.py` holds the curve
primitives, `build-logo.py` holds the mark. Edit the numbers there; never
hand-edit the generated SVGs, which are overwritten on every run.

```bash
pip install cairosvg pillow
python3 brand/build-logo.py
```

Key constants in `build-logo.py`:

- `TAIL` — `(cx, cy, r_base, r_tip, start_deg, sweep_deg, w_base, w_peak, w_tip)`
- `figure()` — body outline points, head radius, snout and ear taper
- `MONITOR` / `DESK` — furniture geometry

## Typography — not final

The lockup sets its wordmark in Liberation Sans Bold, an Arial metric clone. That
is a placeholder. Choose a real typeface, set the wordmark, convert to outlines,
and replace the `<text>` element — live text in a logo renders differently on any
machine missing the font.
