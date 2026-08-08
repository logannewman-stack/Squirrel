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
    chats: null,
    tagline: "Get organized",
    blurb: "The whole planner on one device, capped at two projects.",
    features: [
      "Calendar, agenda, and focus timer",
      "The built-in assistant — unlimited",
      "2 projects · 15 open tasks",
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
    blurb: "Everything unlimited, synced everywhere, with the smart assistant.",
    features: [
      "Unlimited projects and tasks",
      "Sync across every device",
      "Insights, delegation, and recurring work",
      "Auto-scheduling that lays work into your week",
      "Smart assistant: AI steps in when the built-in one is stuck",
      "Calendar sync (Google, Apple)",
      "Priority support",
    ],
  },

  // The top tier earns $50 by stopping being a personal app. A single person
  // rarely gets $50/month of value from a to-do list; a person who runs work
  // *through* other people does. So this is delegation with real teammates,
  // client-facing projects, and the assistant on the top model.
  studio: {
    id: "studio",
    name: "Studio",
    price: 50,
    projects: null,
    tasks: null,
    chats: null,
    tagline: "Run your team",
    blurb: "Pro, plus real delegation, client projects, and the top-tier assistant.",
    features: [
      "Everything in Pro",
      "Invite teammates — they see what's theirs",
      "Shared client projects with value and reporting",
      "The assistant on the top model, higher limits",
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
 * The assistant is deterministic and runs in the browser, so a message costs
 * nothing to serve. Chats are therefore unlimited on every plan and the tiers
 * differentiate on projects, tasks, and features instead. Reintroduce a chat
 * limit only if a paid model is ever added behind it.
 */

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
