# Every key, in the order you'll add them

The one page to have open while you set this up. `GO-LIVE.md` explains *why*
each service is there; this is the click-by-click of getting the values out of
each dashboard and into Vercel without a typo.

Rules that apply to every key below, and are worth reading once:

- **`VITE_` means public.** Anything named `VITE_…` is compiled into the
  JavaScript every visitor downloads. Two keys below are *meant* to be public
  (the Supabase URL and anon key — the database's row-level security is what
  protects the data, not their secrecy). Every other key must never carry that
  prefix. A `VITE_ANTHROPIC_API_KEY` would put your billing key on the open
  internet; the boost diagnostic checks for exactly that mistake and refuses.
- **Set every variable for all three environments** (Production, Preview,
  Development) unless noted. A key missing in Preview means your test deploys
  fail in ways that look like code bugs.
- **Changing a variable does nothing until you redeploy.** Vercel bakes them
  in at build time.
- **Never paste a key into the app, a chat, a commit, or a screenshot.** If one
  leaks, roll it at its source (each section says where) — a leaked key that is
  rolled is an inconvenience; one that isn't is a bill.

---

## A. Anthropic — Squirrel's own key (~5 min)

A key dedicated to this app, so its spend is separate from anything else you
build and you can roll it without breaking them.

1. Sign in at [console.anthropic.com](https://console.anthropic.com).
2. **Settings → Workspaces → Create Workspace**. Name it `Squirrel`.
   *Why bother:* a workspace gets its own spend limit and its own reporting
   line, so "what did Squirrel cost me in March" is a number you can read
   rather than a number you have to derive. If you skip this, everything still
   works — it just all lands in one bucket.
3. In that workspace: **API keys → Create key**. Name it
   `squirrel-production`. Copy it — it starts `sk-ant-…` and the console will
   never show it to you again.
4. **Set a spend limit while you are there.** Workspace → Limits. Something
   like $50/month is far above what the arithmetic predicts (see below) and
   turns a runaway loop from a catastrophe into an email.
5. In Vercel → your project → **Settings → Environment Variables**:

   | Name | Value | Notes |
   | --- | --- | --- |
   | `ANTHROPIC_API_KEY` | `sk-ant-…` | **No `VITE_` prefix. Ever.** |
   | `ANTHROPIC_MODEL` | `claude-haiku-4-5` | Optional; this is the default |

**What this actually costs.** The fallback is one narrow call: a fixed
~1,000-token prompt in, at most 120 tokens out — one short command, never
prose. About **$0.0017 a call**. At the plan ceilings that is **$1.65/month**
for a Pro customer who exhausts their 1,000 assists and **$4.94** for a Studio
customer at 3,000 — against subscriptions netting ~$23.95 and ~$48.25. And
those are ceilings, not expectations: the built-in parser answers most
messages with no model call at all.

**Rolling it:** create a new key, update the variable, redeploy, then delete
the old key. In that order — deleting first means a few minutes where the
boost silently falls back to the rules.

---

## B. Stripe — taking the money (~20 min)

### B1. Get the account into test mode first

At [dashboard.stripe.com](https://dashboard.stripe.com), find the
**Test mode** toggle (top right) and turn it **on**. Everything below is done
twice: once in test mode to prove the flow, once in live mode when you're
happy. Test and live keys are different values and are not interchangeable —
this is the single most common way an evening disappears.

### B2. Create the two products

**Product catalogue → Add product**, once per tier:

| Product name | Price | Billing period | Env var for its price id |
| --- | --- | --- | --- |
| Squirrel Pro | 24.99 | **Recurring, Monthly** | `STRIPE_PRICE_PRO` |
| Squirrel Studio | 50.00 | **Recurring, Monthly** | `STRIPE_PRICE_STUDIO` |

These match `PLANS` in `src/lib/plans.js`. If you change one, change both — the
app quotes its own number on the upgrade sheet, and Stripe charges Stripe's.

After saving each product, open it and copy the **price** id. It begins
`price_…`. The `prod_…` id on the same page is the product, not the price, and
putting it in the variable produces a checkout that 400s.

### B2a. Seat pricing for companies — do this, or the invoice won't match

**The one setup step that can produce a billing dispute.**

The company screen quotes volume discounts: 12 Pro seats reads **$269.88/month**,
not 12 × $24.99 = $299.88. Those breaks live in `src/lib/seats.js`. Stripe knows
nothing about them — it charges what the price object says, times the quantity.
So a **flat** per-seat price bills $299.88 against a quote of $269.88, every
month, to a customer who can do the multiplication.

Configure each price with **graduated tiers** matching the app exactly. In the
price editor pick **per unit → Graduated pricing** (Stripe sometimes labels this
"tiered"), then enter:

**Squirrel Pro** — `STRIPE_PRICE_PRO`

| First unit | Last unit | Per unit |
| --- | --- | --- |
| 1 | 4 | 24.99 |
| 5 | 24 | 21.24 |
| 25 | 99 | 18.74 |
| 100 | ∞ | 16.24 |

**Squirrel Studio** — `STRIPE_PRICE_STUDIO`

| First unit | Last unit | Per unit |
| --- | --- | --- |
| 1 | 4 | 50.00 |
| 5 | 24 | 42.50 |
| 25 | 99 | 37.50 |
| 100 | ∞ | 32.50 |

**Graduated, not Volume.** Stripe offers both, and they are different: *Volume*
charges every unit at the rate the last one reached; *Graduated* charges each
unit at the rate of the band it falls in. The app computes graduated, and the
gap is not subtle — at 30 seats, graduated bills $637.20 and volume bills
$562.20.

Prove it once before you sell anything: buy 12 seats with a test card and check
the invoice says **$269.88**. $299.88 means the price is flat; anything lower
means it is on Volume rather than Graduated.

> Prefer no discounts at all? That is a legitimate choice — set every `off` in
> `BANDS` (`src/lib/seats.js`) to `0`, and the app quotes flat per-seat pricing
> that matches a flat Stripe price. The tests hold either way.

### B3. Get the secret key

**Developers → API keys → Secret key → Reveal.** Copy it.

- Test mode: `sk_test_…`
- Live mode: `sk_live_…`

This is the key that can move money. It is server-only; there is no version of
this that belongs in the browser.

### B4. Point the webhook at your app

**Developers → Webhooks → Add endpoint.**

- **Endpoint URL:** `https://your-domain.com/api/stripe-webhook`
- **Events to send** — exactly these six:

  | Event | What it does in Squirrel |
  | --- | --- |
  | `checkout.session.completed` | Links the Stripe customer to the account on first purchase |
  | `customer.subscription.created` | Grants the plan |
  | `customer.subscription.updated` | Upgrades, downgrades, renewals |
  | `customer.subscription.deleted` | Ends the plan at period end |
  | `invoice.payment_failed` | Raises the failing-card flag in your console |
  | `invoice.payment_succeeded` | Clears it when the card works again |

After saving, click into the endpoint and **Reveal** the **Signing secret**
(`whsec_…`). Without it every webhook is rejected as unsigned — which is
correct behaviour, and looks exactly like "payments don't work".

### B5. Put them in Vercel

| Name | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…` (then `sk_live_…` when you go live) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (**different in test and live**) |
| `STRIPE_PRICE_PRO` | `price_…` |
| `STRIPE_PRICE_STUDIO` | `price_…` |
| `PUBLIC_URL` | `https://your-domain.com` — no trailing slash |

`PUBLIC_URL` is where checkout sends people afterwards. Unset, they pay and
land nowhere.

### B6. Redeploy, then prove it

1. Vercel → Deployments → **Redeploy**.
2. Open `https://your-domain.com/api/setup-check`. Stripe should read ready.
   It reports only whether each variable is set, never any part of a value.
3. In the app: Settings → your plan → **Upgrade** → Pro. Pay with Stripe's
   test card:

   | Field | Value |
   | --- | --- |
   | Card | `4242 4242 4242 4242` |
   | Expiry | any future date |
   | CVC | any 3 digits |
   | Postcode | any |

4. Check all three agree: the app shows Pro, **Settings → Your people** shows
   that account as paying, and Stripe → Customers shows an active
   subscription. If the first two disagree with the third, the webhook is the
   suspect — Stripe's webhook page lists every delivery and its response.
5. Cancel from Settings → **Manage** (Stripe's own portal) and confirm the plan
   runs to the end of the paid period rather than ending instantly. That is
   deliberate: they bought the month.

### B7. Going live

Turn **Test mode** off and repeat B2–B5 — new products, new secret key, new
webhook, new signing secret. Then run B6 once with a real card and refund
yourself from the Stripe dashboard. Nothing proves a payment path like a
payment.

---

## C. The console — seeing your users (~1 min)

| Name | Value |
| --- | --- |
| `OWNER_EMAILS` | the email you sign into Squirrel with |

Comma-separated if there are two of you. This unlocks **Settings → Your
people** (the roster: accounts, plans, revenue, failing cards) and the boost
diagnostic. Unset means nobody — including you.

---

## The finished list

Everything, in one place, once you're live:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co     # public by design
VITE_SUPABASE_ANON_KEY=eyJ...                  # public by design
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...               # secret — bypasses all security
ANTHROPIC_API_KEY=sk-ant-...                   # secret
ANTHROPIC_MODEL=claude-haiku-4-5
STRIPE_SECRET_KEY=sk_live_...                  # secret — moves money
STRIPE_WEBHOOK_SECRET=whsec_...                # secret
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_STUDIO=price_...
PUBLIC_URL=https://your-domain.com
OWNER_EMAILS=you@yourdomain.com
```

Then: **redeploy**, open `/api/setup-check`, and everything you set should
read ready.

## When something doesn't work

| Symptom | Almost always |
| --- | --- |
| Magic link goes to localhost | Supabase → Authentication → URL Configuration still points there |
| Checkout 400s | The `prod_…` id got pasted where a `price_…` belongs |
| Paid, but the plan didn't change | Webhook secret wrong, or the endpoint URL has a typo. Stripe → Webhooks shows every attempt and the response it got |
| Landed on a broken page after paying | `PUBLIC_URL` unset or has a trailing slash |
| "Test the boost" isn't there | `OWNER_EMAILS` doesn't include the address you signed in with |
| Boost does nothing, no error | By design — it falls back silently. Use the diagnostic to see the real error |
| Everything reads ready, still broken | You changed variables and didn't redeploy |
