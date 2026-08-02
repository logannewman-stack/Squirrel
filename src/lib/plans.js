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
    chats: null,
    blurb: "Calendar, one project, ten open tasks.",
    features: ["Calendar and focus timer", "Assistant — unlimited", "1 project", "10 open tasks"],
  },
  plus: {
    id: "plus",
    name: "Plus",
    price: 20,
    projects: 5,
    tasks: null,
    chats: null,
    blurb: "Five projects, unlimited tasks, insights.",
    features: ["Everything in Free", "5 projects", "Unlimited tasks", "Insights", "Meeting invites by email"],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 50,
    projects: null,
    tasks: null,
    chats: null,
    blurb: "Unlimited projects and tasks.",
    features: ["Everything in Plus", "Unlimited projects", "Unlimited tasks", "Priority support"],
  },
};

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
