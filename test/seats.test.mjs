/**
 * What a company is quoted.
 *
 * Pricing is the one arithmetic in the app a customer will check by hand, and
 * the one where being wrong is a refund and an apology rather than a bug
 * report. So the shape of the schedule is asserted, not just the totals: that
 * growing by one person never costs less than nothing and never triggers a
 * cliff, and that the discount is marginal rather than retroactive.
 */
import { quote, sayQuote, tiers, BANDS, TALK_TO_US } from "../src/lib/seats.js";
import { PLANS, SEATED } from "../src/lib/plans.js";

let pass = 0, fail = 0;
const t = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  → ${detail}` : ""}`);
};

const PRO = PLANS.pro.price; // 24.99

/* ------------------------------------------------------------ the basics */
{
  t("one seat is simply the list price",
    quote("pro", 1).total === PRO, quote("pro", 1).total);
  t("no seats is no bill, not a crash",
    quote("pro", 0).total === 0 && quote("pro", null).total === 0);
  t("an unknown plan is quoted nothing rather than guessed at",
    quote("enterprise", 10).total === 0);

  // Four seats is still list; the discount starts at the fifth.
  t("the first band is undiscounted",
    quote("pro", 4).total === Math.round(PRO * 4 * 100) / 100, quote("pro", 4).total);
}

/* -------------------------------------------------- marginal, not a cliff */
{
  const five = quote("pro", 5);
  t("the fifth seat is discounted, and only the fifth",
    five.lines.length === 2 && five.lines[0].count === 4 && five.lines[1].count === 1,
    JSON.stringify(five.lines));
  t("  so the first four still cost list price",
    five.lines[0].rate === PRO && five.lines[1].rate < PRO);

  /**
   * The property that matters more than any single total: one more person
   * always costs something, and never costs more than the person before.
   * A retroactive discount breaks the first half; a badly placed band breaks
   * the second, and either shows up as a customer asking why 24 seats cost
   * more than 25.
   */
  let broke = null;
  for (let n = 1; n < 150; n++) {
    const step = Math.round((quote("pro", n + 1).total - quote("pro", n).total) * 100) / 100;
    const prev = n === 1 ? Infinity
      : Math.round((quote("pro", n).total - quote("pro", n - 1).total) * 100) / 100;
    if (step <= 0 || step > prev + 0.001) { broke = { n, step, prev }; break; }
  }
  t("every added seat costs something, and never more than the last",
    broke === null, JSON.stringify(broke));

  // And the total never decreases as the company grows.
  let dropped = null;
  for (let n = 1; n < 150; n++) {
    if (quote("pro", n + 1).total < quote("pro", n).total) { dropped = n; break; }
  }
  t("  so a bigger company is never quoted a smaller bill", dropped === null, dropped);
}

/* ------------------------------------------------------------- the bands */
{
  const twentyFive = quote("pro", 25);
  t("25 seats reach the third band",
    twentyFive.lines.length === 3, JSON.stringify(twentyFive.lines.map((l) => l.count)));
  t("  and are cheaper per seat than five",
    twentyFive.perSeat < quote("pro", 5).perSeat);
  t("  with the saving stated, not implied",
    twentyFive.saved > 0 &&
    Math.abs(twentyFive.saved - (PRO * 25 - twentyFive.total)) < 0.01, twentyFive.saved);

  t("the deepest band is the cheapest per seat",
    quote("pro", 200).perSeat < quote("pro", 99).perSeat);
  t("a hundred seats is flagged as a conversation, not a checkout",
    quote("pro", TALK_TO_US).negotiable === true && quote("pro", 99).negotiable === false);

  // The bands must stay ordered, or the marginal property above is luck.
  t("the schedule's discounts only ever deepen",
    BANDS.every((b, i) => i === 0 || b.off >= BANDS[i - 1].off));
}

/* -------------------------------------------------------- studio and words */
{
  t("studio is quoted from its own list price",
    quote("studio", 10).total > quote("pro", 10).total);
  t("the breakdown always sums to the total",
    (() => {
      const q = quote("studio", 37);
      const sum = Math.round(q.lines.reduce((n, l) => n + l.subtotal, 0) * 100) / 100;
      return Math.abs(sum - q.total) < 0.01;
    })());

  const said = sayQuote("pro", 25);
  t("the one-line quote names seats, total, each, and the saving",
    /25 seats/.test(said) && /\/mo/.test(said) && /each/.test(said) && /saving/.test(said), said);
  t("  and says nothing at all for nothing", sayQuote("pro", 0) === "");
}

/* ------------------------------------------------ what Stripe will charge */
/**
 * The quote in the app and the invoice from Stripe are two different
 * implementations of one schedule, and only one of them the customer can see
 * in advance. If they disagree, the app is lying about a price — found by a
 * customer reading a card statement, which is a refund and an apology rather
 * than a bug report.
 *
 * So the tier table sent to Stripe is replayed here through Stripe's own
 * graduated arithmetic and checked against `quote()` seat by seat. The failure
 * this is really guarding is picking *volume* pricing instead of *graduated*
 * in the dashboard: identical-looking setup, every seat charged at the last
 * band's rate, and a bill roughly a third under what was promised.
 */
{
  /** Stripe's graduated maths, written out rather than assumed. */
  const asStripeWouldCharge = (plan, n) => {
    let from = 0, cents = 0;
    for (const tier of tiers(plan)) {
      const upTo = tier.up_to === "inf" ? Infinity : tier.up_to;
      const count = Math.min(n, upTo) - from;
      if (count > 0) cents += count * tier.unit_amount;
      from = Math.min(n, upTo);
      if (from >= n) break;
    }
    return cents / 100;
  };

  let drift = null;
  for (let n = 1; n <= 250 && !drift; n++) {
    const app = quote(SEATED, n).total;
    const stripe = asStripeWouldCharge(SEATED, n);
    if (Math.abs(app - stripe) > 0.005) drift = `${SEATED} at ${n} seats: app ${app}, Stripe ${stripe}`;
  }
  t("Stripe's tiers charge exactly what the app quoted, 1 to 250 seats", drift === null, drift);

  // A band boundary is where volume and graduated diverge most visibly, so it
  // is worth naming one explicitly rather than trusting the sweep alone.
  t("  the 25th seat is priced marginally, not retroactively",
    quote(SEATED, 25).total > quote(SEATED, 24).total
      && quote(SEATED, 25).total < PLANS[SEATED].price * 25,
    `${quote(SEATED, 24).total} → ${quote(SEATED, 25).total}`);

  t("every band appears in the tier table", tiers(SEATED).length === BANDS.length);
  t("  and the last one is open-ended", tiers(SEATED).at(-1).up_to === "inf");
  t("  and amounts are whole cents", tiers(SEATED).every((x) => Number.isInteger(x.unit_amount)));

  /**
   * Only the top tier is sold by the seat.
   *
   * Pro is a personal subscription. A per-seat table on it would advertise a
   * volume discount on a plan that cannot have volume — and, since the deepest
   * band is 35% off, would make forty Pro seats at $16.24 each the cheapest
   * route to a team, undercutting the tier that team features are sold on.
   */
  t("Pro has no per-seat table at all", tiers("pro").length === 0);
  t("and neither does free", tiers("free").length === 0);
  t("the seated tier is Studio", SEATED === "studio");
}

console.log(`\nSeats: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
