# Purpose

The whole of somebody's work, drawn as one strand.

Every other screen in Squirrel is a slice — a day, a week, one project's
list. Purpose is the only place the entire thing is visible at once, and it is
deliberately a *place*, not a report: a dark room with one object floating in
it. You turn the object with your hand. You tap a strand and that project
comes forward while the rest of a life recedes.

## The name

The tab is **Purpose**. The object inside it is your **helix**.

"DNA strand" describes the shape; *helix* is a name. One word, scientific
without being clinical, and it gives the app a sentence it can say with a
straight face: **every project is a gene in your helix; every task is a base
pair.** Finished work is *woven in*. The vocabulary holds together all the way
down — gene, base pair, strand, weave — which is the test of a metaphor you
can build UI on rather than just marketing.

Names considered and set aside:

- **Thread / Weave / Loom** — warmer, but "thread" is taken by chat apps and
  the loom metaphor runs out at the second noun.
- **Genome** — accurate and cold; sounds like a lab report.
- **Strand** — fine, but generic; it names the geometry, not the thing.

## Why a helix and not a brain

The brain was explored and parked, for three reasons that are about the data,
not the drawing:

1. **A helix has an axis; a brain has none.** Projects enter a life in order,
   and the strand reads bottom-to-top as time — the oldest commitment at the
   origin, the newest still being written. A neuron cloud has no origin and no
   direction, so the one question Purpose exists to answer — *is this going
   somewhere?* — has nowhere to live in it.
2. **Genes are discrete; dendrites are not.** A project is a bounded thing
   with a start, an end and a meaning. Contiguous coloured segments say that.
   In every neural layout tried on paper, project boundaries dissolve into
   crossing edges — which is exactly the Obsidian graph-view problem this
   screen is meant to beat: impressive at a glance, unreadable as a record.
3. **The felt sense is wrong** — the user said it first: brainwaves give a
   weird feeling. A brain on a screen reads as *being measured*. A helix reads
   as *being made of something*. Purpose is the second feeling.

What survives from the brain idea: a future **constellation mode** — the same
layout data drawn as bright nodes (projects) with orbiting points (tasks),
linked by who-works-on-what. It would reuse `layoutHelix`'s grouping wholesale
and slot in as an alternate renderer behind the same panel. Worth doing only
after the helix has earned its keep.

## How it is built

- `src/lib/helix.js` — pure geometry. Projects → genes, tasks → base pairs,
  ordered by `createdAt`, sized by √(work), with the unfiled pile as a faint
  final stretch. No canvas, no DOM; fully unit-tested.
- `src/lib/helix-draw.js` — one canvas, no libraries. Hand-rolled 3D
  (rotate → tilt → perspective), painter's algorithm, additive neon in the
  dark and soft-halo ink on paper in the light. Real B-DNA proportions
  (pitch ≈ 3.4 × radius) — the first render used a turn per gene and read as
  a coiled spring; the molecule is much straighter than instinct draws it.
- `src/components/Purpose.jsx` — the hand holding it: pointer→spin with
  inertia, tap→select with a camera glide, arrows walk the strand, Escape
  lets go. The reading panel writes one field — a project's **meaning** —
  and everything else it shows comes from the same `whenProject` blocks the
  calendar draws, so the helix can never promise a different week than the
  planner.

Respect for the machine: frames stop when the tab is hidden, the idle drift
honours `prefers-reduced-motion`, and the whole thing is a few hundred
primitives a frame — no engine, no dependency, nothing to download, works
offline like everything else.
