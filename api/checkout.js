import Stripe from "stripe";
import { asUser, asService, requireUser, json } from "./_lib/db.js";

const PRICE = {
  plus: process.env.STRIPE_PRICE_PLUS,
  pro: process.env.STRIPE_PRICE_PRO,
  studio: process.env.STRIPE_PRICE_STUDIO,
};

/**
 * Where checkout sends the browser afterwards.
 *
 * Two callers, two destinations. The web app wants an ordinary URL. The native
 * app opens this in Safari — deliberately, because a link-out has to leave the
 * app to be allowed at all — and then needs the browser to hand control back,
 * which is what the universal link does.
 *
 * An allow-list rather than an echo of whatever was posted. `success_url` is
 * attacker-controlled input the moment it is taken from a request body, and a
 * checkout that redirects anywhere is a phishing page with your domain on the
 * receipt.
 */
const RETURNS = {
  web: (base) => ({ ok: `${base}/?upgraded=1`, no: `${base}/?upgrade=cancelled` }),
  // Same origin on purpose: iOS matches the universal link by domain and path,
  // so this opens the app when it is installed and the site when it is not.
  app: (base) => ({ ok: `${base}/app/upgraded`, no: `${base}/app/upgrade-cancelled` }),
};

/**
 * Stripe checkout — for the web, and for the native app's link-out.
 *
 * Apple requires In-App Purchase for anything bought *inside* an iOS or Mac app
 * (Guideline 3.1.1), so the native client uses StoreKit and api/apple/verify.
 * The exception, on the US storefront, is a link that leaves the app entirely:
 * since the 2025 Epic ruling an app may send someone to an external checkout in
 * the system browser. That is what `return: "app"` is for. It must open in
 * Safari rather than a webview — an in-app webview is still the app, and still
 * a rejection.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "method_not_allowed" });

  const auth = await requireUser(req);
  if (!auth) return json(res, 401, { error: "unauthorized" });

  const { plan, return: returnTo = "web", seats } = req.body || {};
  if (!PRICE[plan]) return json(res, 400, { error: "unknown_plan" });
  if (!RETURNS[returnTo]) return json(res, 400, { error: "unknown_return" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const db = asUser(auth.jwt);
  const service = asService();

  /**
   * Buying for a company rather than for yourself.
   *
   * `seats` turns this into a quantity-based subscription billed to the
   * organisation's own Stripe customer, so a company's invoice is one line
   * that says how many people it covers — and cancelling it does not touch
   * whatever the administrator pays for personally.
   *
   * The number is bounded and floored at the seats already occupied: a
   * company that has handed out nine seats cannot "reduce" to three and
   * strand six people. Stripe would happily take the smaller number.
   */
  let org = null;
  if (seats != null) {
    const { data: mine } = await service
      .from("org_members")
      .select("role, organizations(id,name,seats,stripe_customer_id)")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (!mine || mine.role !== "admin") return json(res, 403, { error: "not_an_admin" });
    org = mine.organizations;

    const { count: held } = await service
      .from("org_members").select("user_id", { count: "exact", head: true })
      .eq("org_id", org.id);
    const want = Math.floor(Number(seats));
    if (!Number.isFinite(want) || want < 1 || want > 500) {
      return json(res, 400, { error: "bad_seat_count" });
    }
    if (want < (held || 0)) return json(res, 409, { error: "fewer_seats_than_people", held });
    org.wanted = want;
  }

  const { data: profile } = await db.from("profiles")
    .select("stripe_customer_id,email").eq("id", auth.user.id).maybeSingle();

  let customerId = org ? org.stripe_customer_id : profile?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile?.email || auth.user.email,
      name: org ? org.name : undefined,
      metadata: org
        ? { squirrel_org_id: org.id, bought_by: auth.user.id }
        : { supabase_user_id: auth.user.id },
    });
    customerId = customer.id;
    // Service role: the user must not be able to point their profile — or
    // their company — at someone else's Stripe customer.
    if (org) {
      await service.from("organizations").update({ stripe_customer_id: customerId }).eq("id", org.id);
    } else {
      await service.from("profiles").update({ stripe_customer_id: customerId }).eq("id", auth.user.id);
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: PRICE[plan], quantity: org ? org.wanted : 1 }],
    ...(({ ok, no }) => ({ success_url: ok, cancel_url: no }))(
      RETURNS[returnTo](process.env.PUBLIC_URL || ""),
    ),
    // Carried onto the subscription so the webhook can attribute it without a
    // second lookup — to a company when there is one, to the person otherwise.
    subscription_data: {
      metadata: org
        ? { squirrel_org_id: org.id, plan, seats: String(org.wanted) }
        : { supabase_user_id: auth.user.id, plan },
    },
  });

  return json(res, 200, { url: session.url });
}
