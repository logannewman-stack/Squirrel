/**
 * Plan definitions for rendering — paywall copy, upgrade prompts, usage meters.
 *
 * These are NOT the enforcement point. Limits are enforced by database triggers
 * and `claim_assistant_chat` in supabase/migrations/0001_init.sql; anything the
 * client checks is a courtesy to the user, not a control. Change the SQL first,
 * then mirror it here.
 */

export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    projects: 1,
    tasks: 10,
    chats: 0,
    blurb: "Calendar, one project, ten open tasks.",
    features: ["Calendar and focus timer", "1 project", "10 open tasks", "Rule-based day planning"],
  },
  plus: {
    id: "plus",
    name: "Plus",
    price: 20,
    projects: 5,
    tasks: null,
    chats: 200,
    blurb: "The assistant, five projects, unlimited tasks.",
    features: ["Everything in Free", "AI assistant — 200 chats/month", "5 projects", "Unlimited tasks", "Insights"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 50,
    projects: null,
    tasks: null,
    chats: null,
    blurb: "Unlimited assistant, unlimited everything.",
    features: ["Everything in Plus", "Unlimited assistant chats*", "Unlimited projects", "Unlimited tasks", "Priority support"],
    // Unlimited needs a stated ceiling somewhere, or one automated integration
    // can outspend the subscription indefinitely. See FAIR_USE_CHATS.
    footnote: "*Subject to fair use — see below.",
  },
};

/**
 * Soft ceiling on "unlimited". Beyond this a Pro user is asked to slow down
 * rather than being cut off. Without a number here, "unlimited" is an open
 * cheque against per-token API cost.
 */
export const FAIR_USE_CHATS = 2000;

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
