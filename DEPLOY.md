# Deploying Squirrel

Stack: Vercel (static site + serverless API), Supabase (Postgres + auth),
Stripe (web billing), StoreKit (App Store billing).

**The web app itself needs none of them.** The assistant is ordinary code
running in the browser — no model, no API key, no network call — so the site is
a static bundle that works the moment it is served. Everything below is for
accounts, sync, and billing, which the client does not use yet. If the deployed
site is broken, a missing environment variable is not the reason.

---

## Two things that change the business, before any code

### 1. Apple requires In-App Purchase — Stripe is not allowed inside the app

App Store Guideline 3.1.1: digital subscriptions sold inside an iOS or Mac app
must use In-App Purchase. Routing an in-app upgrade to Stripe Checkout is a
rejection, not a grey area.

| Where they subscribe | Processor | Fee | You net on $20 | You net on $50 |
| --- | --- | --- | --- | --- |
| Inside the iOS/Mac app | StoreKit | 15%¹ | $17.00 | $42.50 |
| On the web | Stripe | ~2.9% + 30¢ | $19.12 | $48.05 |

¹ 15% under the Small Business Program (under $1M/yr — you qualify). It is 30%
above that threshold, so crossing $1M cuts subscription revenue by 15% overnight.
Budget for it before you get there.

`api/checkout.js` is therefore **web-only**. The native client needs StoreKit
plus a receipt-verification endpoint that writes `profiles.apple_transaction_id`
and `plan` — the column exists; the endpoint does not yet.

You may link out to web billing from the app, but the rules around wording and
placement are specific and have been litigated. Read the current guideline text
before relying on it.

### 2. Your assistant pricing has thin margins — measure before you launch

Per-chat cost with prompt caching on (the system prompt and tool definitions are
identical every request and dominate the input, so caching them is the single
biggest lever — cached reads bill at roughly a tenth):

| Effort | Rough cost/chat | 200 chats (Plus) | Margin on Plus (nets $17) |
| --- | --- | --- | --- |
| `low` | ~$0.02 | ~$4 | ~$13 |
| `medium` (default) | ~$0.05–0.08 | ~$10–16 | ~$1–7 |
| `high` | ~$0.12+ | ~$24+ | **negative** |

These are estimates from token shape, not measured traffic. The schema records
real `input_tokens` and `output_tokens` per user per month in `usage_counters` —
**run a hundred real chats and read that table before you commit to the price.**

Two consequences worth deciding on now:

- **`high` effort loses money on Plus.** `ASSISTANT_EFFORT` defaults to `medium`.
  Raise it only if the assistant starts mis-resolving requests, and re-check the
  numbers if you do.
- **"Unlimited" Pro needs a real ceiling.** At medium effort, $42.50 net breaks
  even somewhere around 600–800 chats/month. `FAIR_USE_CHATS` in
  `src/lib/plans.js` currently sits at 2000, which loses money on a heavy user.
  Either lower it to ~750 or accept the tail as a cost of acquisition — but pick
  deliberately rather than discovering it on a bill.

---

## Setup

### Supabase

```bash
supabase link --project-ref <ref>
supabase db push        # applies supabase/migrations/0001_init.sql
```

Enable the auth providers you want. **Sign in with Apple is mandatory** if you
offer any other third-party sign-in on iOS (Guideline 4.8).

The schema puts plan limits in database triggers, not the client, because the
client talks to Postgres directly — anything it enforces is a suggestion. RLS is
the only boundary between one customer's rows and another's, so review
`0001_init.sql` before trusting it with real data.

### Vercel

`vercel.json` pins the build so nothing depends on auto-detection:

| Setting | Value |
| --- | --- |
| Framework | Vite |
| Install | `npm ci` |
| Build | `npm run build` |
| Output | `dist` |
| Root directory | *(repository root — leave blank)* |

The rewrite sends every path except `/api/*` to `index.html`. The app keeps its
view in React state rather than the URL, so this only matters for reloads and
shared links, but without it a static host answers `/anything` with a 404.

If the project was created before this file existed, Vercel keeps whatever was
set in the dashboard — **dashboard settings override `vercel.json`**. Clear the
build and output overrides in Project Settings → Build & Development so they
fall back to this file, and confirm Production Branch is `main`.

```bash
vercel --prod
```

Deploying the site needs no environment variables at all. Set the ones in
`.env.example` when wiring up accounts and billing; the distinction that matters
then is that `VITE_*` variables are **inlined into the browser bundle**, so
`SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` must never carry that prefix.

The three functions in `api/` are for that future backend and are not called by
the client yet. They build fine without their variables set; they simply return
errors if requested.

### Stripe

Create two recurring prices ($20/mo, $50/mo) and point `STRIPE_PRICE_PLUS` and
`STRIPE_PRICE_PRO` at them. Add a webhook to `/api/stripe-webhook` subscribed to
`customer.subscription.*`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`.

Billing state is written only by the webhook under the service role. The client
cannot promote itself, and `profiles`' update policy does not cover those columns.

---

## iOS and Mac

The app is a React web build, so **Capacitor** wraps it for both stores without a
rewrite. Expo would mean rebuilding the UI in React Native — worth it only if you
need deep native integration beyond contacts and notifications.

```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init Squirrel app.squirrel.planner --web-dir=dist
npm run build && npx cap add ios && npx cap sync
```

Mac ships from the same iOS target via Mac Catalyst.

Still required before submission:

- StoreKit purchase flow and a receipt-verification endpoint
- `NSContactsUsageDescription` if contacts land, with a purpose string that
  matches actual behaviour — Apple rejects vague ones
- Privacy nutrition labels covering the data actually collected
- Account deletion in-app (Guideline 5.1.1(v)) — required, and easy to miss

---

## What the assistant can and cannot do with messaging

`draft_message` composes a text or email and hands it to the user's own Messages
or Mail app, where they tap send. It does not send anything, by design:

- **iOS never lets an app send an SMS silently.** `MFMessageComposeViewController`
  always requires the user to tap send. No entitlement changes this.
- **Android technically can**, but Google Play restricts `SEND_SMS` to default SMS
  handler apps — a planner would be rejected.
- **Automated texting to a user's contacts draws TCPA liability**, because consent
  must come from the recipient, not the sender. Several referral-text apps have
  been sued over exactly this pattern.

Server-sent messaging via Twilio is possible, but the text then comes from your
company's number rather than the user's, which is a different product decision
with its own consent requirements.
