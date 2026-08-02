# Squirrel — brand marks

Logo system for **Squirrel**, an ADHD focus app. Black and white.

The mark is a squirrel sitting at a desk at a monitor, its tail curling up
behind it. Drawn by Logan; everything in this folder is derived from that
artwork by `build-assets.py`. **Nothing here is redrawn.**

## Files

Source of truth: `source/logo_black_on_white_4k.png`.

| File | Use |
| --- | --- |
| `squirrel-logo.svg` | Black art, **transparent** background. The default. |
| `squirrel-logo-white.svg` | White art, transparent. For dark backgrounds. |
| `squirrel-logo-on-white.svg` | Black art, white background baked in. |
| `squirrel-logo-on-black.svg` | White art, black background baked in. |
| `squirrel-appicon-{light,dark}.svg` | Rounded-square app icon. |
| `squirrel-lockup{,-dark}.svg` | Mark + wordmark, horizontal. |
| `favicon-32.png` | Favicon. |

PNG exports: app icons at 1024/512/180/120/60/32, logos at 1024/512/256,
lockup at 2400 wide.

Reach for a **transparent** variant by default. The `-on-white` / `-on-black`
files have the background painted in, so they show as a hard rectangle over any
other colour — which is exactly what the raw source PNG does too.

## Why the artwork is traced

The source is a 3840×3860 PNG, but the artwork only occupies 1408×1375 of it —
the rest is white margin. So it is not really a 4K logo, and anything built
straight from it would sit in a field of dead space.

It is also pure two-value black and white, which vectorises almost exactly:
there is no colour quantisation to fight. Tracing gives the same shapes as clean
paths that stay sharp at any size, cropped to the real ink bounds with
consistent padding. The trace agrees with the source to ~97% pixel-for-pixel;
the residual is antialiasing along edges.

## The polarity trap

`potracer` fills where its mask is **False**, so `trace_source()` passes `True`
for the *light* pixels. Get this backwards and it emits a filled rectangle with
the squirrel punched out of it.

That failure is easy to ship by accident, because this artwork is close to 50/50
black and white — so an inverted trace has almost the same ink fraction as a
correct one, and any coverage or ink-percentage check waves it through. `verify()`
therefore rasterises the trace and compares it to the source pixel-for-pixel,
failing the build below 95% agreement. Don't replace it with a cheaper check.

## Rules

- Prefer transparent variants; only use the baked-background ones deliberately.
- Don't recolour, rotate, stretch, or add effects.
- Don't rebuild assets by editing the SVGs — they are overwritten on every run.

## Regenerating

```bash
pip install cairosvg pillow numpy potracer
python3 brand/build-assets.py
```

Replace `source/logo_black_on_white_4k.png` and re-run to update everything.
Layout constants live at the top of the script: `CANVAS`, `ART_FRACTION`,
`ICON_FRACTION`, `CORNER`.

## Typography — not final

The lockup sets its wordmark in Liberation Sans Bold, an Arial metric clone —
a placeholder. Choose a real typeface, set the wordmark, convert it to outlines,
and replace the `<text>` element. Live text in a logo renders differently on any
machine missing the font.
