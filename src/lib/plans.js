/**
 * Plan definitions for rendering — paywall copy, upgrade prompts, usage meters.
 *
 * These are NOT the enforcement point. Limits are enforced by database triggers
 * and `claim_assistant_chat` in supabase/migrations/0001_init.sql; anything the
 * client checks is a courtesy to the user, not a control. Change the SQL first,
 * then mirror it here.
 */

export const PLANS = {
  /**
   * Not a plan. The state of having no subscription.
   *
   * Squirrel used to have a real free tier — the whole planner on one device,
   * capped at two projects — and it does not any more. Every account starts on
   * a seven-day trial with a card already given, and `free` is what an account
   * becomes when that trial ends without payment, or when a subscription
   * lapses. It is a wall, not an offer.
   *
   * The row still exists, and the enum value in Postgres still says `free`,
   * because a hundred places read a plan id and a rename would be a migration
   * with nothing at the end of it. What changed is the meaning: zero of
   * everything, no feature entitlements, and copy that names the state rather
   * than selling it.
   *
   * Nothing is deleted when somebody lands here. Their projects, tasks and
   * calendar are exactly where they left them, behind a paywall, because an
   * expired card is a reason to stop serving somebody and never a reason to
   * destroy their week.
   */
  free: {
    id: "free",
    name: "No plan",
    price: 0,
    projects: 0,
    tasks: 0,
    chats: 0,
    tagline: "Trial ended",
    blurb: "Your work is safe and waiting. Start a plan to pick it up.",
    locked: true,
    features: [],
  },

  // The flagship. One person running their entire life on it, on every device.
  // This is the tier the pricing page is built to sell.
  pro: {
    id: "pro",
    name: "Pro",
    price: 24.99,
    projects: null,
    tasks: null,
    // A ceiling, not a meter you feel: the deterministic parser answers most
    // messages free on-device, so only model-backed turns count — and a
    // thousand of those is a heavy month. It exists because "unlimited" here
    // is an unlimited API bill for the app's owner.
    chats: 1000,
    tagline: "Run your week",
    popular: true,
    blurb: "Everything unlimited, synced everywhere, with Squirrel on tap.",
    features: [
      "Squirrel, your assistant — say it, she does it",
      "Unlimited projects and tasks",
      "Sync across every device",
      "Insights: where your time actually goes",
      "Calendar sync (Google, Apple)",
      "Priority support",
    ],
  },

  // The top tier earns $50 by stopping being a personal app. A single person
  // rarely gets $50/month of value from a to-do list; a person who runs work
  // *through* other people does. So this is delegation with real teammates,
  // client-facing projects, and Squirrel at her most capable.
  studio: {
    id: "studio",
    name: "Studio",
    price: 50,
    projects: null,
    tasks: null,
    chats: 3000,
    tagline: "Run your team",
    blurb: "Pro, plus your whole team's work in one place — and who is about to miss something.",
    features: [
      "Everything in Pro",
      // First, because it is the one thing here that is worth $50 to somebody
      // who already has a planner they like: not more of their own week, but
      // sight of everybody else's.
      "See what your team is carrying — who is over, what is late",
      "Buy seats for the whole company on one invoice",
      "Hand work to a teammate and follow it",
      "Client projects with value and reporting",
      "Squirrel at her most capable, with the highest limits",
      "Concierge setup and early access",
    ],
  },

  // `plus` is the old paid tier's name. Kept as an alias of Pro so any
  // subscription or database row still carrying it keeps full entitlement.
  get plus() { return { ...this.pro, id: "plus", name: "Pro" }; },
};

/** The paid tiers, cheapest first — what a free user is offered. */
export const PAID = ["pro", "studio"];

/**
 * The tier a company buys, and the only one that holds more than one person.
 *
 * Pro is a personal subscription: one account, every device, no roster. Studio
 * is where a company appears at all — seats, an invoice, people you can see
 * the work of — which is what makes $50 defensible next to $24.99 and is the
 * whole reason the top tier exists.
 *
 * Named once, here, because four places need to agree about it: the seat
 * picker draws it, `api/checkout.js` refuses a quantity on anything else,
 * `seats.js` prices only this, and `stripe-setup.mjs` gives only this a
 * per-seat tiered price. A company on Pro is not a cheaper company, it is a
 * state this product does not have.
 */
export const SEATED = "studio";

/**
 * How long a new account gets before the card is charged.
 *
 * The card is taken at sign-up and Stripe holds the subscription in
 * `trialing` until day eight, which the webhook already treats as entitled —
 * so a trialling account is a Pro account in every respect and nothing here
 * has to special-case it.
 *
 * Card up front, deliberately. A trial with no card is a signup number; a
 * trial with a card is a customer who has already decided, and it removes an
 * entire state machine — the countdown, the expiry lockout, the win-back
 * email, the "was I supposed to pay?" support thread. Stripe sends the
 * reminder, takes the money, and handles the cancellation.
 *
 * `api/checkout.js` refuses to grant it twice. Without that guard, cancelling
 * and re-subscribing is a free month a fortnight.
 */
export const TRIAL_DAYS = 7;

/**
 * The built-in assistant is deterministic and runs in the browser, so it costs
 * nothing to serve and stays unlimited on every plan. The metered thing is the
 * boost path (api/interpret.js), which only fires on what the rules miss:
 * Free gets a monthly taste (25), the paid tiers are effectively unlimited.
 * These numbers mirror plan_limit in supabase/migrations — the SQL is the
 * control; this copy is a courtesy.
 */

/**
 * What each tier is allowed to *do*, as opposed to how much of it.
 *
 * Everything gated here is still visible on every plan — the screens render,
 * the controls are drawn, the value is in plain sight. What a lower tier gets
 * is a lock rather than a blank space, because a feature nobody can see is a
 * feature nobody upgrades for. This is the list of what the lock covers.
 *
 * A courtesy, like the limits above: the server is the control. Anything that
 * costs money (the AI fallback) is metered in SQL as well, so a determined
 * client cannot spend by lying about its plan.
 */
export const FEATURES = {
  assistant:   { tiers: ["pro", "plus", "studio"], name: "Squirrel, the assistant" },
  calendarSync:{ tiers: ["pro", "plus", "studio"], name: "Calendar sync" },
  insights:    { tiers: ["pro", "plus", "studio"], name: "Insights" },
  delegation:  { tiers: ["studio"], name: "Teammates and delegation" },
  clientWork:  { tiers: ["studio"], name: "Client projects" },
  // Companies: the roster and the seat controls come with any paid seat, but
  // reading what the people on those seats are working on is the enterprise
  // capability, and priced like one.
  teamVisibility: { tiers: ["studio"], name: "See your team's work" },
};

/**
 * Auto-scheduling is free, on purpose, and is therefore not in the table.
 *
 * It was listed above as a paid feature and enforced in exactly no place —
 * a gate declared and never applied, which is worse than either choice made
 * deliberately: the pricing page claimed something the product did not do,
 * and one honest afternoon of "let's enforce our own table" would have taken
 * the best thing in the app away from the tier that has to fall in love with
 * it. The wall belongs *after* the magic. Somebody who has watched a week
 * rebuild itself three times will pay for a third project; somebody who never
 * saw it will not.
 *
 * Named here so the decision survives the next reading of FEATURES.
 */
export const ALWAYS_FREE = ["autoSchedule"];

/** Can this plan use this feature? Unknown features are open, never accidentally locked. */
export const can = (plan, feature) => {
  const f = FEATURES[feature];
  if (!f) return true;
  return f.tiers.includes(plan ?? "free");
};

/**
 * The assistant is a paid feature, with no free allowance at all.
 *
 * Free accounts used to get five turns a day, on the argument that nobody
 * upgrades for a feature they have only seen through glass. That is a real
 * effect and this is a deliberate trade against it: she is the single reason
 * to pay for this app, and a free tier that does the thing people would pay
 * for is a free tier that keeps them on it.
 *
 * Free is still the whole planner — the auto-scheduler, the calendar, the
 * focus timer, every hour of it laid out for nothing. What it does not include
 * is being *told* what to do in a sentence. That is the line.
 *
 * She stays on screen behind the lock rather than being hidden, because a
 * feature nobody can see is a feature nobody upgrades for. `FEATURES.assistant`
 * is the gate; there is no counter left to run down.
 */

/**
 * What this account is using of what it is allowed.
 *
 * One calculation, read by every surface that mentions the plan — the rail
 * card, the phone strip, the moment a cap is reached. Three copies of "which
 * limit is closest" drift within a week, and a meter that disagrees with the
 * wall it is warning about is worse than no meter at all.
 *
 * Only limits that bind on *this* plan come back. On Pro every one of them is
 * unlimited, so the list is empty and the surfaces fall silent rather than
 * printing "unlimited" three times.
 *
 * The assistant is not metered here. It is allowed or it is not, and a meter
 * that always reads "0 of 0" is a row of furniture on a screen that should
 * simply say what the plan costs.
 *
 * @param state  the store, for what has been created
 */
export function usage(state) {
  const plan = state?.plan ?? "free";
  const tier = PLANS[plan] ?? PLANS.free;

  /**
   * A locked account is not a nearly-full one.
   *
   * With no free tier there is nothing left that is capped-but-usable: a paid
   * plan is unlimited and everything else is a wall at zero. So the meters
   * stop being a gauge and become a statement, and the arithmetic that used to
   * drive them stops applying — `used / cap` against a cap of nothing is
   * Infinity when they have work and NaN when they do not, and neither is a
   * number worth putting on a card.
   *
   * `locked` is what the surfaces should read now. `full` and `pressing` are
   * kept true so anything still asking the old questions gets the safe answer
   * rather than a quiet false.
   */
  if (tier.locked) {
    return {
      plan,
      tier,
      locked: true,
      meters: [],
      tightest: null,
      pressing: true,
      full: true,
    };
  }

  const meters = [
    {
      key: "projects",
      label: "Projects",
      used: (state?.projects || []).filter((p) => !p.archived).length,
      cap: tier.projects,
    },
    {
      key: "tasks",
      label: "Open tasks",
      used: (state?.tasks || []).filter((t) => !t.done).length,
      cap: tier.tasks,
    },
  ].filter((m) => m.cap != null);

  // The nearest wall, which is the only one worth leading with. Seeded at -1 so
  // a set of meters all sitting at zero still names one, instead of returning
  // null and making every caller handle a case that is not actually special.
  const tightest = meters.reduce(
    (worst, m) => (m.used / m.cap > (worst ? worst.used / worst.cap : -1) ? m : worst),
    null,
  );

  return {
    plan,
    tier,
    locked: false,
    meters,
    tightest,
    // Close enough to be worth mentioning unprompted. Anything below this is an
    // advert, and adverts are what stop people reading the notices that matter.
    pressing: Boolean(tightest) && tightest.used / tightest.cap >= 0.6,
    full: Boolean(tightest) && tightest.used >= tightest.cap,
  };
}


/** A wall, said as the reason it is being brought up. */
export const wallReason = (meter) => {
  if (!meter) return null;
  const at = meter.used >= meter.cap;
  if (meter.key === "projects") return at ? `You're at ${meter.cap} projects` : "Nearly out of projects";
  if (meter.key === "tasks") return at ? `You're at ${meter.cap} open tasks` : "Running out of task room";
  return null;
};

/** The cheapest tier that unlocks a feature — what the lock should offer. */
export const unlocks = (feature) => {
  const f = FEATURES[feature];
  if (!f) return null;
  // "plus" is an alias of Pro, so it never needs naming as an upsell target.
  return f.tiers.find((t) => t !== "plus") ?? null;
};

export const limitFor = (plan, resource) => PLANS[plan ?? "free"]?.[resource] ?? 0;

/** null means unlimited, so a plain `used >= limit` would wrongly block. */
export const isOverLimit = (plan, resource, used) => {
  const lim = limitFor(plan, resource);
  return lim !== null && used >= lim;
};

export const remainingChats = (plan, used) => {
  const lim = limitFor(plan, "chats");
  return lim === null ? Infinity : Math.max(0, lim - used);
};

/**
 * Monthly recurring revenue from a count of accounts per plan.
 *
 * Here rather than in the API because this file is the one place a price is
 * written; a copy on the server is a number that goes stale the first time
 * pricing changes, and the first symptom is a dashboard quietly reporting
 * last quarter's revenue. An unrecognised tier contributes nothing — a typo
 * should under-report, never invent income.
 */
export const mrrOf = (byPlan = {}) =>
  Object.entries(byPlan).reduce(
    (sum, [plan, count]) => sum + (PLANS[plan]?.price || 0) * count, 0);
