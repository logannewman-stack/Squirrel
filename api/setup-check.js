import { json } from "./_lib/db.js";

/**
 * What is configured, and what is still missing.
 *
 * Setting up four services by hand means twenty environment variables typed
 * across four dashboards, and the failure mode is not an error — it is a button
 * that silently does nothing, three days later, for one customer. This turns
 * that into a checklist that answers itself.
 *
 * ## Why this is safe to leave public
 *
 * It reports booleans and never values. Not a prefix, not a length, not a
 * masked version — the presence of a key is not a secret, and the moment an
 * endpoint returns any part of one, it is a leak waiting for a bug. Knowing
 * that Stripe is configured tells an attacker nothing they cannot learn by
 * pressing the upgrade button.
 */

const has = (name) => Boolean(process.env[name]?.trim());
const all = (...names) => names.every(has);

export default async function handler(req, res) {
  const groups = [
    {
      id: "supabase",
      name: "Supabase — accounts, sync, plan limits",
      required: true,
      ready: all("SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
      vars: {
        SUPABASE_URL: has("SUPABASE_URL"),
        SUPABASE_ANON_KEY: has("SUPABASE_ANON_KEY"),
        SUPABASE_SERVICE_ROLE_KEY: has("SUPABASE_SERVICE_ROLE_KEY"),
      },
      unlocks: "Sign-in, cross-device sync, and paid plans. Without it the app is local-only.",
    },
    {
      id: "stripe",
      name: "Stripe — web subscriptions",
      required: false,
      ready: all("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_PRO"),
      vars: {
        STRIPE_SECRET_KEY: has("STRIPE_SECRET_KEY"),
        STRIPE_WEBHOOK_SECRET: has("STRIPE_WEBHOOK_SECRET"),
        STRIPE_PRICE_PRO: has("STRIPE_PRICE_PRO"),
        STRIPE_PRICE_STUDIO: has("STRIPE_PRICE_STUDIO"),
        STRIPE_PRICE_PLUS: has("STRIPE_PRICE_PLUS"),
      },
      unlocks: "Taking money on the web. The webhook secret is what makes a plan change stick.",
    },
    {
      id: "assistant",
      name: "Squirrel's boost",
      required: false,
      ready: has("ANTHROPIC_API_KEY"),
      vars: { ANTHROPIC_API_KEY: has("ANTHROPIC_API_KEY") },
      unlocks: "The safety net for phrasings her rules miss. Unset, she still answers from her own rules at no cost.",
    },
    {
      id: "google",
      name: "Google Calendar sync",
      required: false,
      ready: all("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"),
      vars: {
        GOOGLE_CLIENT_ID: has("GOOGLE_CLIENT_ID"),
        GOOGLE_CLIENT_SECRET: has("GOOGLE_CLIENT_SECRET"),
        GOOGLE_REDIRECT_URI: has("GOOGLE_REDIRECT_URI"),
        // Falls back to the service-role key, so it is never actually absent.
        OAUTH_STATE_SECRET: has("OAUTH_STATE_SECRET") || has("SUPABASE_SERVICE_ROLE_KEY"),
      },
      unlocks: "Two-way calendar sync — the feature that most justifies Pro.",
    },
    {
      id: "cron",
      name: "Scheduled sync",
      required: false,
      ready: has("CRON_SECRET"),
      vars: { CRON_SECRET: has("CRON_SECRET") },
      unlocks: "Calendars sync themselves every 15 minutes. Without the secret the job refuses to run at all.",
    },
    {
      id: "apple",
      name: "App Store subscriptions",
      required: false,
      ready: all("APPLE_PRODUCT_PRO"),
      vars: {
        APPLE_PRODUCT_PRO: has("APPLE_PRODUCT_PRO"),
        APPLE_PRODUCT_STUDIO: has("APPLE_PRODUCT_STUDIO"),
      },
      unlocks: "In-app purchases on iOS and macOS.",
    },
    {
      id: "email",
      name: "Invite email",
      required: false,
      ready: all("RESEND_API_KEY", "INVITE_FROM"),
      vars: { RESEND_API_KEY: has("RESEND_API_KEY"), INVITE_FROM: has("INVITE_FROM") },
      unlocks: "Teammate invitations for Studio.",
    },
  ];

  const warnings = [];
  if (!has("PUBLIC_URL")) {
    // Checkout builds its return URLs from this. Empty means Stripe redirects
    // to a relative path and the customer lands nowhere after paying.
    warnings.push("PUBLIC_URL is not set — checkout will redirect to a broken URL after payment.");
  }
  if (has("APPLE_ALLOW_SANDBOX") && process.env.APPLE_ALLOW_SANDBOX === "true") {
    warnings.push("APPLE_ALLOW_SANDBOX is true — sandbox purchases will grant real plans. Never leave this on in production.");
  }
  if (groups[1].ready && process.env.STRIPE_SECRET_KEY?.startsWith("sk_test")) {
    warnings.push("Stripe is in test mode — no real money will move.");
  }

  const blocking = groups.filter((g) => g.required && !g.ready).map((g) => g.id);

  return json(res, 200, {
    ready: blocking.length === 0,
    blocking,
    canTakeMoney: groups[0].ready && groups[1].ready,
    warnings,
    groups: groups.map(({ id, name, required, ready, vars, unlocks }) => ({
      id, name, required, ready, unlocks,
      missing: Object.entries(vars).filter(([, ok]) => !ok).map(([k]) => k),
    })),
  });
}
