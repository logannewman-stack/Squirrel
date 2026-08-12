# Purpose

The whole of somebody's work, drawn as one oak.

Every other screen in Squirrel is a slice — a day, a week, one project's
list. Purpose is the only place the entire thing is visible at once, and it is
deliberately a *place*, not a report: a dark room with one living thing in it.
Wind moves through the crown; dragging feeds the gust. You tap a branch and
that project comes forward while the rest of a life steps back into the dark.

## The name

The tab is **Purpose**. The thing inside it is your **oak**.

The app is called Squirrel, and the sentence writes itself: **every project is
a branch; every task is an acorn; everything you finish is stored away.**
"Stored away" is what a squirrel does and what the app has promised since its
name — finished acorns glow gold on the branch instead of vanishing, because
the point of this screen is that done work is *kept*, not deleted. Unfiled
tasks lie fallen at the roots until they are put on a branch. The proverb is
the product: *mighty oaks from little acorns grow.*

The vocabulary holds all the way down — branch, acorn, stored away, fallen,
bare — which is the test of a metaphor you can build UI on rather than just
marketing.

## Two shapes died first

**The brain** was parked because a neuron cloud has no origin and no
direction, so the one question Purpose exists to answer — *is this going
somewhere?* — has nowhere to live in it. (And a brain on a screen reads as
*being measured*, which is the wrong feeling.)

**The DNA helix** shipped first and was retired within the day. It was
honest — projects as genes, tasks as base pairs, time along the axis — and it
looked the part. But the shape belonged to biology, not to the brand: nothing
about a helix says *Squirrel*, and the user's own read confirmed it. The oak
keeps everything the helix proved out (time on the vertical, discrete bounded
projects, size from work, the reading panel, the meaning field) and gives the
shape to the animal the app is named after. A tree also puts the squirrel
*in the picture* — which the helix never could.

What survives from the brain idea: a future **constellation mode** — the same
layout data drawn as bright nodes linked by who-works-on-what, an alternate
renderer behind the same panel. Worth doing only after the oak has earned its
keep.

## One ink, one clean line

The first oak gave every branch its own colour, plus glow underlays,
fireflies, twigs and acorn caps — and it read as somebody else's app.
Squirrel is monochrome and flat everywhere, so the tree is too: a flat paper
background, one tapered line of ink per bough (white in the dark, black in
the light), and acorns drawn as the app's own checkbox hung on wood — a
filled dot when stored away, an outline while it ripens. Colour is spent
only where the rest of the app spends it, on overdue acorns (`--alert`).
`PALETTE` in `lib/oak.js` is a single ink, kept as a list in case a second
ink ever earns its place.

## Sub-branches, and growing the tree in place

A project can grow off another project: `parentId` on the project (one
nullable field, invisible to the planner, search and quotas) makes it a
**sub-branch** — a side shoot socketed on its parent's wood, riding the
parent's sway in the wind, one level deep by design. The rule is written to
never hide work: a sub whose parent is archived, missing, or itself a sub
climbs back to the trunk.

The tree is grown here too, not just read: the **+** beside the theme toggle
plants a new branch; a branch's card grows **＋ Sub-branch** and **＋ Acorn**
in place; and every acorn — tapped on the canvas, in a branch card's list,
or found by the squirrel — opens into its own small card, where it can be
stored away or put back without leaving the room.

Labels place themselves: the tree claims its own space (acorns, tips, the
length of each shoot, measured without wind so nothing flickers) and every
name slides up until its air is clear — which is what keeps a phone-width
crown readable once shoots start growing into their parents' sky.

## The squirrel works here

The squirrel perches at the crown, keeping lookout — and wonders out loud:
a thought bubble over its head asks *"Looking for something?"*, so the finder
advertises itself instead of waiting to be discovered. Tapping the thought is
tapping the squirrel. Select a branch and it runs to perch on that branch.
Tap it — or press **/** — and it finds things:
type a few letters and the branches and acorns that answer stay lit while the
rest of the tree dims, with a result list naming each acorn's branch. Enter
carries you to the best match, fallen acorns included. The finder is the same
token-match spirit as `lib/search.js`: every typed word must answer.

The tree reads the same truth as everywhere else: oldest project lowest on the
trunk and thickest, the way wood works; branch length grows with √(work);
overdue acorns pulse red; delegated ones hang by a dashed stem; an archived
project leaves the tree without dumping its acorns at the roots — it is
shelved, not fallen.

## The search bar

The same session added the app-wide search bar: `ui/Find.jsx` stopped being a
magnifier chip and became a real input-shaped bar in the header of Today,
Projects and Insights — full-width under the large title on a phone, the way
iOS does it, with the shortcut printed in it on desktop. It opens the command
palette (⌘K / Ctrl+K / "/"), which searches everything: tasks, done work, past
meetings, notes, people, and the app's own views and actions. One search, many
doors.

## How it is built

- `src/lib/oak.js` — pure arithmetic. Projects → branches (ordered by
  `createdAt`, alternating sides, length from √(work)), tasks → acorns strung
  mid-branch to tip, unfiled → fallen at the roots, plus `hitTest`, the
  squirrel's `perchFor`, and the finder's `findOnTree`. No canvas, no DOM;
  fully unit-tested (`test/oak.test.mjs`).
- `src/lib/oak-draw.js` — one canvas, no libraries. Cubic-bezier boughs (wood
  has two bends in it), painter's algorithm, additive glow in the dark and
  soft ink on paper in the light, wind as rotation about each branch's socket
  scaled t² so sway reads as weight. The squirrel is two `Path2D`s, flipped to
  face its branch.
- `src/components/Purpose.jsx` — the hand holding it: drag→gust, tap→select,
  arrows walk the branches, "/" summons the squirrel, Escape lets go. The
  reading panel writes one field — a project's **meaning** — and everything
  else it shows comes from the same `whenProject` blocks the calendar draws,
  so the tree can never promise a different week than the planner.

Respect for the machine: frames stop when the tab is hidden, sway honours
`prefers-reduced-motion`, and the whole thing is a few hundred primitives a
frame — no engine, no dependency, nothing to download, works offline like
everything else.
