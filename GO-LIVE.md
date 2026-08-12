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

   > `schema.sql` is generated from `supabase/migrations/` by
   > `npm run schema:bundle`, and it is a **first-run** script — it refuses to
   > run against a database that already has the tables. To apply a later
   > change to a live database, run that one numbered migration on its own.
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

## 4. Seeing your users (~2 min)

Add one variable and the console appears in the app itself:

| Variable | Value |
| --- | --- |
| `OWNER_EMAILS` | `you@yourdomain.com` (comma-separated for a partner) |

Redeploy, then open **Settings → Data → Your people**. You get every account,
newest and paying first: address, plan, when they joined, whether their card
is failing, and how much of the assistant they used this month — plus totals
across the top: people, paying, monthly revenue, assists.

Two things it deliberately will not do. It will not show anybody's tasks,
projects, notes or calendar — running the business needs to know someone is
on Pro and used 40 assists, not what they're working on. And it will not open
for anyone whose email is not in that list: not a customer, not a curious
signed-in stranger, not you before you set the variable. Unset means nobody.

## 5. Stripe monthly subscriptions (~20 min)

The code is written and tested — checkout, the customer portal, the webhook,
proration, failed cards, cancellations. What it needs is your Stripe account
and four ids.

1. **Create the products.** [dashboard.stripe.com](https://dashboard.stripe.com)
   → Product catalogue → **Add product**, one per tier you sell. For each,
   add a price: **Recurring**, **Monthly**, in your currency. The prices the
   app advertises live in `src/lib/plans.js` — set Stripe to match, or change
   both together.

   | Product | Price in `plans.js` | Env var to hold its price id |
   | --- | --- | --- |
   | Squirrel Pro | $24.99/mo | `STRIPE_PRICE_PRO` |
   | Squirrel Studio | $50/mo | `STRIPE_PRICE_STUDIO` |

   Copy each **price** id (`price_…`, not the `prod_…` product id).

   > `STRIPE_PRICE_PLUS` also exists in the code and the database's tier enum.
   > It is a legacy tier the pricing page no longer sells — leave it unset
   > unless you decide to bring a cheaper plan back, in which case add `plus`
   > to `PLANS` in `src/lib/plans.js` first, so the app can price and describe
   > what Stripe is charging for.

2. **Add the webhook.** Developers → Webhooks → **Add endpoint**, URL
   `https://your-domain/api/stripe-webhook`. Select exactly these events:

   - `checkout.session.completed` — first purchase; links the Stripe customer
     to the Supabase account
   - `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted` — the plan itself, including upgrades,
     downgrades and cancellations
   - `invoice.payment_failed` — raises the card-failing flag you see in your
     console
   - `invoice.payment_succeeded` — clears it when the card works again

   Copy the **signing secret** (`whsec_…`).

3. **Set the variables** in Vercel and redeploy:

   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`,
   `STRIPE_PRICE_STUDIO`, and `PUBLIC_URL` (checkout builds its return links
   from it — unset, customers land nowhere after paying).

4. **Test with a test-mode card.** Use Stripe's test keys first;
   `/api/setup-check` warns you when you're in test mode so you can't mistake
   it for live. In the app: Settings → Plan → upgrade → pay with `4242 4242
   4242 4242`, any future expiry, any CVC. Then check three things — the app
   shows the new plan, `Your people` shows them as paying, and Stripe shows
   an active subscription. Cancel from Settings → Manage (the Stripe portal)
   and watch the plan return to free at period end, not instantly: they
   bought the month.

Two behaviours worth knowing, because they're deliberate and unusual:

- **A failed card doesn't lock anyone out immediately.** Stripe retries for
  days; `past_due` keeps access and raises the flag in your console instead.
  Locking someone out over an expired card loses a customer to an
  inconvenience.
- **Cancelling runs to the end of the paid period.** Access ends at
  `plan_renews_at`, not at the click.

> **iPhone note:** Apple requires In-App Purchase for subscriptions bought
> *inside* an iOS app — Stripe is for the web. The App Store side is built
> (`api/apple/verify`) and switches on with the native wrap. Selling on the
> web meanwhile is both allowed and cheaper (≈2.9% vs 15%).

## 6. The data, in SQL

Once someone signs in, their work lives in Postgres and you can open the
Supabase **SQL Editor** and ask it anything. The tables:

| Table | One row per | Notable columns |
| --- | --- | --- |
| `profiles` | account | `plan`, `stripe_customer_id`, `billing_status`, `plan_renews_at` |
| `projects` | branch | `name`, `meaning`, `parent_id` (sub-project), `archived` |
| `tasks` | acorn | `estimate_mins`, `due`, `priority`, `pin_day`/`pin_time`, `repeat`, `done` |
| `events` | meeting | `starts_at`, `ends_at`, `attendees` |
| `focus_sessions` | sitting | `planned_ms`, `focused_ms`, `task_id` |
| `usage_counters` | account × month | `assistant_chats`, `input_tokens`, `output_tokens` |
| `chat_messages` | assistant turn | `role`, `text` |

Three things worth knowing before you write a query:

- **Every table is row-level secured to its owner.** The SQL Editor runs as a
  superuser so you see everything; the app's browser client never can. That
  boundary is the whole security model — don't disable RLS to "make a query
  work", write the query in the editor instead.
- **Nothing is hard-deleted.** Rows carry `deleted_at` (tombstones), because
  a delete on one device has to be able to travel to another. Add
  `where deleted_at is null` or your counts will include ghosts.
- **The plan is never computed in SQL.** `state.blocks` — what lands on which
  day — is derived on the device from tasks, meetings and working hours. The
  database holds the *inputs*; the schedule is the app's answer to them.

Four queries that earn their keep:

```sql
-- Signups by week, and how many turned into paying accounts
select date_trunc('week', created_at)::date as week,
       count(*) as signups,
       count(*) filter (where plan <> 'free') as paying
from profiles group by 1 order by 1 desc;

-- What the assistant actually cost you this month, per account
select p.email, u.assistant_chats, u.input_tokens, u.output_tokens
from usage_counters u join profiles p on p.id = u.user_id
where u.period = date_trunc('month', now())::date
order by u.input_tokens + u.output_tokens desc;

-- Are people's estimates honest? Planned vs actually focused, per account.
select p.email,
       round(sum(s.planned_ms) / 60000.0) as planned_mins,
       round(sum(s.focused_ms) / 60000.0) as focused_mins,
       round(100.0 * sum(s.focused_ms) / nullif(sum(s.planned_ms), 0)) as pct
from focus_sessions s join profiles p on p.id = s.user_id
where s.deleted_at is null group by 1 order by 4 desc nulls last;

-- Engagement: who has open work with a real deadline on it
select p.email,
       count(*) filter (where not t.done) as open_tasks,
       count(*) filter (where not t.done and t.due is not null) as dated,
       max(t.created_at) as last_added
from tasks t join profiles p on p.id = t.user_id
where t.deleted_at is null group by 1 order by last_added desc;
```

> **A word on reading it.** You can see everything in there — including task
> titles and notes people wrote for themselves. The app's own console
> deliberately shows you none of that (see §4), and it's worth holding the
> same line by hand: query aggregates, not contents. It's their diary, not
> your dashboard.

## 7. Later, when you want them (each optional)
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
