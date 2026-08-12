# Go live: accounts, Mac ↔ iPhone sync, and the boost

This is the founder's runbook. Follow it top to bottom once and Squirrel goes
from local-only to: sign in on your Mac, sign in on your iPhone, and the same
tree, tasks, plan and calendar on both — plus the assistant's model boost with
**your** Anthropic key held on the server, never in anyone's browser.

Everything the app does offline keeps working exactly as before. Users who
never sign in never touch any of this — that *is* the free tier.

Time required: about 45 minutes. Cost to start: $0 (all three services have
free tiers that cover early usage).

---

## 1. Supabase — the users live here (~15 min)

1. Create an account at [supabase.com](https://supabase.com) → **New project**.
   Pick a strong database password and the region closest to your users.
2. When the project finishes provisioning, open **SQL Editor** → **New query**,
   paste the entire contents of `supabase/schema.sql` from this repo, and run
   it. One run creates every table, the row-level security that keeps each
   customer's data theirs, the plan limits, and the chat ceilings.
3. **Authentication → Providers**: make sure **Email** is enabled (it is by
   default). Squirrel signs people in with a magic link — no passwords to
   store, no reset flow to build.
4. **Authentication → URL Configuration**: set the Site URL to your deployed
   domain (you'll have it after step 2 — come back and fill it in; until then
   magic links point at localhost).
5. **Project Settings → API**: copy three values for the next step —
   - Project URL
   - `anon` public key
   - `service_role` key (server-only; treat like a password)

## 2. Vercel — the app and its API (~15 min)

1. [vercel.com](https://vercel.com) → **Add New → Project** → import the
   `squirrel` GitHub repo. The build is pinned by `vercel.json`; change
   nothing.
2. Before deploying, add Environment Variables (Project → Settings →
   Environment Variables). The minimum set for accounts + sync + boost:

   | Variable | Value | What it unlocks |
   | --- | --- | --- |
   | `VITE_SUPABASE_URL` | your Project URL | sign-in UI in the app |
   | `VITE_SUPABASE_ANON_KEY` | the `anon` key | same |
   | `SUPABASE_URL` | your Project URL | the API's own access |
   | `SUPABASE_ANON_KEY` | the `anon` key | same |
   | `SUPABASE_SERVICE_ROLE_KEY` | the `service_role` key | metering, webhooks |
   | `ANTHROPIC_API_KEY` | your `sk-ant-…` key | the assistant's boost |
   | `ANTHROPIC_MODEL` | `claude-haiku-4-5` | cheapest model that does this job well |
   | `PUBLIC_URL` | `https://your-domain` | correct redirects |

   The `VITE_` pair is inlined into the browser bundle — that is safe, the
   anon key is public by design and RLS is what protects the data. The
   Anthropic key has **no** `VITE_` prefix on purpose: it exists only on the
   server, users never see it, and `/api/interpret` spends it only for
   signed-in accounts inside their plan's ceiling.

3. **Deploy.** Then go back to Supabase step 4 and set the Site URL to the
   deployed domain.

## 3. Prove it works (~10 min)

1. Open `https://your-domain/api/setup-check` in a browser. It answers with a
   checklist of what is configured and what each missing variable would
   unlock. It reports booleans only — never key values. Supabase should read
   ready; Stripe/Google/email may be "not yet", which is fine.
2. Open the app, **Settings → Account**, enter your email, click the magic
   link from your inbox. You're signed in.
3. **The Mac ↔ iPhone moment**: sign in with the same email on your iPhone
   (Safari → your domain; then Share → **Add to Home Screen** to install it
   as an app — full screen, offline cache, its own icon). Add a task on the
   Mac. Watch it arrive on the phone, already routed into the plan. Sync is
   continuous while the app is open and catches up on next open — offline
   changes merge when the device comes back.
4. **The boost**: Settings → Assistant → turn on the boost, then "Test the
   boost". One real model call runs and reports what came back. After that,
   any sentence the built-in parser misses is quietly rewritten by the model
   and run down the same safe, confirmable, undoable path. Users never see a
   key, a model name, or a bill — it's just Squirrel getting smarter.

## 4. Later, when you want them (each optional)

- **Stripe (paid plans on the web):** set `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PLUS`, `STRIPE_PRICE_PRO`; point a
  Stripe webhook at `/api/stripe-webhook`. Upgrades then flow through
  checkout and the webhook writes the plan to the profile.
- **Google Calendar sync:** create a Google Cloud project with the Calendar
  API, set the four `GOOGLE_*` variables from `.env.example`. The cron in
  `vercel.json` already pulls changes every 15 minutes once connected.
- **Apple Calendar + App Store:** requires the native wrap (Capacitor) — on
  the roadmap. There is no server-side Apple Calendar API; it ships with the
  iOS app itself via EventKit. Until then, iPhone users get the installed
  web app above, which covers sync, notifications-while-open, and the full
  planner.

## What this costs you

- **Supabase / Vercel:** free tiers hold until you have real traffic.
- **The model:** only the boost costs per message, only on sentences the
  free deterministic parser misses, only for signed-in users, and every plan
  has a hard monthly ceiling enforced in the database (`plan_limit`), so one
  enthusiastic user can never run an unbounded bill. Real token counts land
  in `usage_counters` per user per month — read that table after your first
  hundred chats before setting prices (see DEPLOY.md for the margin math).

## If something doesn't work

`/api/setup-check` first — it answers "what did I forget" in one screen.
A magic link that lands on localhost means Supabase's Site URL (step 1.4)
wasn't updated. A boost that silently does nothing is by design a *fallback*:
run Settings → "Test the boost" to see the real error.
