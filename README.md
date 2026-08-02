# Squirrel

An ADHD focus app.

The hard part of ADHD is **starting**, not finishing. Squirrel is built around
task initiation and the focus session, not around task lists and guilt.

## Status

Working. Projects, a week calendar with real events, task planning that fits
around meetings, a focus timer, insights, and a conversational assistant that
changes your schedule directly. Local-first — no backend, no accounts.

```bash
npm install && npm run dev
npm run verify   # tool-layer checks, needs the dev server running
```

## The assistant

Type "reschedule my 3pm Monday to Wednesday at 2" and it does it. Under the
hood it runs a tool-use loop: read the schedule, find the event by id, move it
preserving duration, and report what changed. It can also create and cancel
events, add and delegate tasks, find open gaps, plan a day, and start a focus
session.

Two rules the system prompt enforces, because they are what make it usable:
anything referring to an existing item requires a schedule lookup first — the
model cannot move what it has not addressed by id — and it acts rather than
proposing, asking only when a genuine ambiguity would send it to the wrong item.

Each tool call surfaces in the transcript as a one-line receipt before the
reply, so a change is never silent.

## How planning works

**Events** own a slot on the clock. **Tasks** are work with a duration and a
deadline but no fixed hour. Planning is the job of fitting the second around the
first: the planner ranks by priority, deadline, and age, then lays the winners
into the actual gaps between meetings.

Two deliberate constraints:

- The day is capped at 7 tasks and the lesser of 5 focused hours or the real
  free time on the calendar. A list that cannot be finished gets abandoned.
- The shortest task leads. The first item decides whether the list gets touched
  at all, so it should be the cheapest real win available.

## The focus lockdown is partial

No web API can block an app switch or a home swipe. The focus screen stacks what
the browser does allow — fullscreen, screen wake lock, a trapped back button, a
confirm on close — which removes every accidental exit. Installed to the home
screen as a PWA there is no browser chrome either. Genuine lockdown needs a
native app (iOS Screen Time API, Android kiosk mode).

## Keys and data

Everything lives in this browser. No sync, no accounts; clearing site data
erases it.

The assistant needs an Anthropic key, entered in Settings and sent straight from
the browser to the API — there is no server to hold it. Fine for a single
operator on a trusted machine, not fine for a hosted multi-tenant product. When
Squirrel grows a backend, `src/lib/assistant.js` is what moves behind it.
Planning itself works with no key and no network.

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
