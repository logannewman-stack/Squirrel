# Squirrel — brand marks

Logo system for **Squirrel**, an ADHD focus app. Black and white only.

## The mark

A squirrel hunched at a screen, wrapped in its own tail. The tail closes into a
**focus ring** — the app's core mechanic — so the mark carries an idea instead of
just depicting an animal. The ring opens at the lower left and tapers to a fine
tip, which keeps it from reading as a plain circle.

| File | Use |
| --- | --- |
| `squirrel-logo.svg` | Full mark, with the screen. 64px and up. |
| `squirrel-logo-simple.svg` | No screen. Below 64px, where the screen fills in. |
| `squirrel-appicon-{light,dark}.svg` | Rounded-square app icon. |
| `squirrel-appicon-small-{light,dark}.svg` | App icon, simple cut, for 60px and below. |
| `squirrel-lockup{,-dark}.svg` | Mark + wordmark, horizontal. |

`-white` variants are the same geometry filled white, for dark backgrounds.

## Why black and white

The audience is people whose attention is the scarce resource. Colour is a claim
on attention, so the interface spends none of it on decoration — hierarchy and
motion carry meaning instead. It also means the mark has no colour-on-colour
failure case.

## Rules

- **Never use the full cut below 64px.** The screen fills into a black smear.
  Switch to `-simple`.
- Clear space: one ring-thickness on all sides.
- Don't recolour, rotate, add gradients, or outline it.
- Don't close the ring's gap — the opening and the tapered tip are what make it
  a tail rather than a circle.

## The knockout

The screen carries a background-coloured stroke (`paint-order: stroke fill`) so it
separates from the body instead of merging into one silhouette. On a background
that is not pure black or white, regenerate with a matching `bg` — the stroke must
equal the background or a halo appears.

## Regenerating

Geometry is **parametric, not hand-drawn**. The ring is a logarithmic spiral swept
through a smooth width profile (`geom.py`), so curvature is continuous — that is
what keeps the curve from reading lumpy. Edit the numbers in `build-logo.py`;
never hand-edit the generated SVGs, which are overwritten on every run.

```bash
pip install cairosvg pillow
python3 brand/build-logo.py
```

Key constants in `build-logo.py`:

- `RING` — `(cx, cy, a, b, t0, t1, w_base, w_peak, w_tip)`. `t0`/`t1` set how far
  the tail sweeps; the three widths set the taper.
- `squirrel()` — head radius, body outline points, snout and ear taper.

## Typography — not final

The lockup sets its wordmark in Liberation Sans Bold, an Arial metric clone. That
is a placeholder. Choose a real typeface, set the wordmark, convert to outlines,
and replace the `<text>` element — live text in a logo renders differently on any
machine missing the font.
