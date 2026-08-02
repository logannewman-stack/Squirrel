# Squirrel

An ADHD focus app.

The hard part of ADHD is **starting**, not finishing. Squirrel is built around
task initiation and the focus session, not around task lists and guilt.

## Status

Working v1. Projects, tasks, per-project calendars, an AI-scheduled daily list,
and the focus timer all run. Local-first — no backend, no accounts.

```bash
npm install && npm run dev
```

## How it works

**Projects** hold tasks; each task carries a time estimate and an optional due
date, and each project gets its own calendar.

**Today** merges every project into one list. "Plan my day" orders it — by rules
always, and with AI when a key is set. The list is capped at 6 tasks and roughly
4 hours: a list you can finish beats a list you avoid.

**Focus** is a blank screen, a countdown, and one way out.

## The lockdown is partial, and that is a browser limit

No web API can block an app switch or a home swipe. What the focus screen does
use: fullscreen, screen wake lock, a trapped back button, and a confirm on
close — which removes every accidental exit. Installed to the home screen as a
PWA there is no browser chrome either. Real lockdown needs a native app (iOS
Screen Time API, Android kiosk mode) and is not achievable on the web.

## AI scheduling is optional

Days are planned by deterministic rules with no key and no network. Adding an
Anthropic key in settings swaps in a model that reads task titles and orders
with more judgement; every failure path falls back to the rules. The key is
stored in the browser and sent straight to Anthropic — fine for a personal tool
on your own machine, not fine for a hosted multi-user product. If Squirrel gets
a server, that call moves behind it.

## Brand

Logo system lives in [`brand/`](brand/) — a squirrel sitting at a desk at a
monitor, tail curling up behind it. Black and white, because the audience is
people whose attention is the scarce resource.

See [`brand/README.md`](brand/README.md) for usage rules and how to regenerate
the marks.

## Design principles

1. **No shame.** Nothing in the product implies the user needs more willpower.
   No streak guilt, no red, no scolding copy.
2. **Starting is the feature.** Optimise the first 10 seconds of a session.
   Everything else is secondary.
3. **Low sensory load.** Monochrome, generous space, motion only where it
   communicates state.
