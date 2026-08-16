/**
 * What a company pays, and why that number.
 *
 * Per-seat pricing with volume breaks. The list price is what one person pays
 * for themselves; buying for a team earns a discount that grows with the
 * commitment, because a fifty-seat customer costs far less to sell to and to
 * serve than fifty individuals, and pricing that ignores this either
 * overcharges companies or undercharges individuals.
 *
 * ## Why the tiers are shaped like this
 *
 * The break points are where the buyer changes. One to four seats is a
 * founder buying for the people next to them and paying list. Five is a small
 * team with someone deciding on everybody's behalf. Twenty-five is a
 * department, and by then the conversation is a budget line rather than a
 * card. A hundred is a company-wide rollout, which is a negotiation — so the
 * schedule stops there and hands over to a person rather than pretending a
 * table can price it.
 *
 * ## Marginal, not cliff-edged
 *
 * The discount applies to the seats in each band, not to all of them at the
 * best rate reached. The alternative — every seat at the rate the last one
 * unlocked — means the 25th seat is cheaper than the 24th *and* drops the
 * price of the 24 before it, so a company is punished for growing to 24 and
 * rewarded for a number it did not need. Marginal pricing has no such cliff:
 * one more person always costs something, and always costs less than the last.
 *
 * Stripe is the authority on what is actually charged — these numbers exist to
 * quote a company honestly *before* they reach checkout, and to be the figures
 * a tiered price in Stripe is configured to match.
 */

import { PLANS } from "./plans.js";

/**
 * Seat bands, cheapest-per-seat last. `upTo` is inclusive; the final band is
 * open-ended. `off` is the discount applied to the seats falling in it.
 */
export const BANDS = [
  { upTo: 4, off: 0 },
  { upTo: 24, off: 0.15 },
  { upTo: 99, off: 0.25 },
  { upTo: Infinity, off: 0.35 },
];

/** Above this, a table stops being an honest answer and a person takes over. */
export const TALK_TO_US = 100;

const round = (n) => Math.round(n * 100) / 100;

/**
 * The monthly bill for `seats` of `plan`, and how it was arrived at.
 *
 * Returned as a breakdown rather than a number because a company deciding on
 * a budget line deserves to see the arithmetic, and because a total nobody
 * can reconstruct is a total somebody will dispute.
 */
export function quote(plan, seats) {
  const list = PLANS[plan]?.price || 0;
  const n = Math.max(0, Math.floor(Number(seats) || 0));
  if (!list || !n) return { seats: n, list, lines: [], total: 0, perSeat: 0, saved: 0 };

  const lines = [];
  let from = 0;
  for (const band of BANDS) {
    if (from >= n) break;
    const upTo = Math.min(n, band.upTo);
    const count = upTo - from;
    if (count > 0) {
      const rate = round(list * (1 - band.off));
      lines.push({ count, rate, off: band.off, subtotal: round(rate * count) });
    }
    from = upTo;
  }

  const total = round(lines.reduce((sum, l) => sum + l.subtotal, 0));
  return {
    seats: n,
    list,
    lines,
    total,
    perSeat: round(total / n),
    saved: round(list * n - total),
    // Past this the schedule is a starting point for a conversation, not a
    // price — said out loud rather than quietly extrapolated.
    negotiable: n >= TALK_TO_US,
  };
}

/**
 * The same schedule, in the shape Stripe wants it.
 *
 * Stripe calls this *graduated* tiered pricing, and the distinction from
 * *volume* pricing is the entire reason this function exists rather than a
 * table typed into a dashboard. Graduated charges each band's seats at that
 * band's rate — which is what `quote()` computes and what the button in the
 * app promises. Volume charges *every* seat at the rate the last one unlocked,
 * which is a different and much lower number.
 *
 * Choose the wrong one in the dashboard and nothing fails: checkout works, the
 * invoice is produced, and it quietly disagrees with the price the customer
 * was shown. That is a refund and an apology, found by a customer rather than
 * by a test. So the tiers are derived here from the same BANDS the quote uses
 * and sent by `scripts/stripe-setup.mjs`. The two cannot drift, because there
 * is only one of them.
 *
 * Amounts are in cents, which is Stripe's unit — and floating-point dollars
 * are how a price ends up a cent out.
 */
export function tiers(plan) {
  const list = PLANS[plan]?.price || 0;
  if (!list) return [];
  return BANDS.map((band) => ({
    up_to: band.upTo === Infinity ? "inf" : band.upTo,
    unit_amount: Math.round(round(list * (1 - band.off)) * 100),
  }));
}

/** "25 seats · $531/mo · $21.25 each, saving $93" — one line for a button. */
export function sayQuote(plan, seats) {
  const q = quote(plan, seats);
  if (!q.total) return "";
  const money = (n) => (n % 1 ? `$${n.toFixed(2)}` : `$${n}`);
  const each = `${money(q.perSeat)} each`;
  return q.saved > 0
    ? `${q.seats} seats · ${money(q.total)}/mo · ${each}, saving ${money(q.saved)}`
    : `${q.seats} seats · ${money(q.total)}/mo · ${each}`;
}
