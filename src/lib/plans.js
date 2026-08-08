/**
 * Plan definitions for rendering — paywall copy, upgrade prompts, usage meters.
 *
 * These are NOT the enforcement point. Limits are enforced by database triggers
 * and `claim_assistant_chat` in supabase/migrations/0001_init.sql; anything the
 * client checks is a courtesy to the user, not a control. Change the SQL first,
 * then mirror it here.
 */

export const PLANS = {
  // Free is the whole app on one device, capped so a genuinely busy person
  // hits the wall in a week. The cap is on scope, never on quality — the
  // built-in assistant, the calendar, and the focus timer are all here in
  // full, because a crippled free tier converts worse than a generous one that
  // simply runs out of room.
  free: {
    id: "free",
    name: "Free",
    price: 0,
    projects: 2,
    tasks: 15,
    chats: 25,
    tagline: "Get organized",
    blurb: "The whole planner on one device, capped at two projects.",
    features: [
      "Calendar, agenda, and focus timer",
      "2 projects · 15 open tasks",
      "Plan your week by hand",
      "This device only",
    ],
  },

  // The flagship. One person running their entire life on it, on every device.
  // This is the tier the pricing page is built to sell.
  pro: {
    id: "pro",
    name: "Pro",
    price: 24.99,
    projects: null,
    tasks: null,
    chats: null,
    tagline: "Run your week",
    popular: true,
    blurb: "Everything unlimited, synced everywhere, with Squirrel on tap.",
    features: [
      "Squirrel, your assistant — say it, she does it",
      "Unlimited projects and tasks",
      "Sync across every device",
      "Insights: where your time actually goes",
      "Auto-scheduling that lays work into your week",
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
    chats: null,
    tagline: "Run your team",
    blurb: "Pro, plus real delegation, client projects, and Squirrel at her most capable.",
    features: [
      "Everything in Pro",
      "Invite teammates — they see what's theirs",
      "Shared client projects with value and reporting",
      "Squirrel at her most capable, with the highest limits",
      "Advanced automations and recurring rules",
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
  autoSchedule:{ tiers: ["pro", "plus", "studio"], name: "Auto-scheduling" },
  delegation:  { tiers: ["studio"], name: "Teammates and delegation" },
  clientWork:  { tiers: ["studio"], name: "Client projects" },
};

/** Can this plan use this feature? Unknown features are open, never accidentally locked. */
export const can = (plan, feature) => {
  const f = FEATURES[feature];
  if (!f) return true;
  return f.tiers.includes(plan ?? "free");
};

/**
 * How many turns a free account gets with the assistant each day.
 *
 * She is the reason to pay, and a wall in front of something nobody has used is
 * a wall in front of nothing: "unlimited assistant" means little to someone who
 * has never watched her move a meeting. A few turns a day is enough to feel
 * what it does and short enough to run out of on a busy morning, which is the
 * moment the upgrade makes sense.
 *
 * Counted in the browser, and deliberately so. The built-in assistant is
 * deterministic and costs nothing to run, so this is a pricing decision rather
 * than a spend control — there is nothing here worth defending with a server
 * round-trip. The one thing that does cost money, the model fallback, is
 * metered in SQL where it cannot be argued with.
 */
export const FREE_ASSISTS_PER_DAY = 5;

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
