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

Deterministic and coded — no model, no API call, no per-message cost. It runs in
the browser, answers instantly, and works offline.

```
Reschedule my 3pm Monday to Wednesday at 2
Block 2 hours Thursday morning for the board deck
Add a task to sign the Munich lease, high priority, due Friday
Mark the term sheet review as done
Delegate the vendor review to Priya
What does Friday look like?
When am I free tomorrow?
Cancel my 4pm
```

Three layers: `datetime.js` resolves times and dates, `parse.js` classifies
intent and pulls out slots, `resolve.js` matches a phrase like "my 3pm" to an
actual row by combining time reference with title overlap.

Two rules it follows, both deliberate:

- **Ambiguity asks, it never guesses.** If "my 3pm" matches two meetings, it
  shows both and waits. Moving the wrong meeting is far worse than one extra tap.
- **Missing information asks too.** "Move the exec staff meeting" with no target
  time gets a question, not an invented slot.

The honest limit: it understands the phrasings it was built for. Anything else
gets a plain "I didn't catch that" plus examples — never a wrong action. That
tradeoff is the point: it costs nothing to run, so chats are unlimited on every
plan, and its behaviour is pinned by 82 tests rather than hoped for.

```bash
npm test        # 63 language checks — dates, intents, slot extraction, matching
npm run test:e2e  # 19 end-to-end checks against the real store (needs npm run dev)
```

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
