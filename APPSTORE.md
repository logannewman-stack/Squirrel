# Shipping Squirrel to the App Store

`GO-LIVE.md` gets the web app running. This one gets the iPhone app *approved*.

Read it once end to end before starting. Most of it is App Store Connect
paperwork you cannot do from a repository, and the order matters in two places
— the bundle identifier and the subscription products both become permanent the
moment they exist.

Time: about two hours of clicking, spread over a couple of days while Apple
reviews. Cost: $99/year for the Developer Program.

> **Before every build:** `npm run ios:check`. It fails when a native file has
> been added to the folder and forgotten in the Xcode project, which is exactly
> how four Swift files once shipped as nothing at all. `npm test` runs the same
> assertions plus the rest of the compliance checks.

---

## 0. The one decision that cannot be undone

The bundle identifier is **`com.squirrelll.app`** — three `l`s. It is in
`capacitor.config.json`, the Xcode project, the App Group
(`group.com.squirrelll.app`), the entitlements files and the URL scheme.

If that is the domain, leave it. If it is a typo, **fix it now**: once an App
Store Connect record exists on an identifier, that identifier is yours for ever
and cannot be renamed, reused, or deleted. Change it in one pass:

```
capacitor.config.json                       appId
ios/App/App.xcodeproj/project.pbxproj       PRODUCT_BUNDLE_IDENTIFIER
ios/App/App/Info.plist                      CFBundleURLName
ios/App/App/App.entitlements                the group
ios/SquirrelWidget/SquirrelWidget.entitlements  the group
ios/App/App/SquirrelBridge.swift            squirrelAppGroup
scripts/xcode-wire.mjs                      APP_GROUP
test/compliance.test.mjs                    GROUP
```

`npm test` fails if any of them disagree, which is the point of the check.

---

## 1. Apple Developer, and the identifiers (~20 min)

1. Enrol at [developer.apple.com](https://developer.apple.com/programs/) — $99/yr.
   Allow a day or two; an organisation enrolment needs a D-U-N-S number.
2. **Certificates, Identifiers & Profiles → Identifiers → App IDs → +**
   - Bundle ID: `com.squirrelll.app` (explicit, not wildcard)
   - Capabilities: **App Groups**, **In-App Purchase**, **SiriKit**
3. **Identifiers → App Groups → +** → `group.com.squirrelll.app`.
   Then go back into the App ID, edit App Groups, and tick it.
4. **Identifiers → App IDs → +** again for the widget:
   `com.squirrelll.app.SquirrelWidget`, with **App Groups** ticked and the same
   group selected.

> The App Group is the least forgiving thing on this page. Set on the app and
> not the widget — or spelled differently in either entitlements file — the app
> writes happily into a container the widget cannot see. There is no error and
> no log entry; the widget just shows its placeholder for ever.

---

## 2. Xcode, once (~15 min)

```bash
npm run build          # the web bundle the app wraps
npx cap sync ios       # copy it in, refresh the plugins
npm run ios:wire       # put our native files back in the target
open ios/App/App.xcworkspace
```

`cap sync` is allowed to rewrite parts of the project, so **`ios:wire` runs
after it, every time.** It is idempotent; running it twice does nothing.

In Xcode, on the **App** target:

1. **Signing & Capabilities** → pick your team. Verify **App Groups** is listed
   and `group.com.squirrelll.app` is ticked.
2. **General** → Minimum Deployment **iOS 17.0**. This is not adjustable
   downward: the widget uses `containerBackground` (17.0) and the Siri
   shortcuts use App Intents (16.0). Below 17 the project does not compile.

---

## 3. The widget extension target (~5 min, and only Xcode can do it)

`ios/SquirrelWidget/` holds the widget, its `Info.plist`, its entitlements and
its privacy manifest. What it does not have is a *target*, because a widget
extension is nine linked objects in the project file and a mistake in any of
them produces a project Xcode refuses to open. Xcode's template writes all nine
correctly in half a minute.

1. **File → New → Target → Widget Extension**
2. Product Name: `SquirrelWidget`. **Untick** "Include Live Activity" and
   "Include Configuration App Intent". Finish, then **Activate** the scheme.
3. Xcode generates its own `SquirrelWidget.swift` and `Info.plist` — delete
   both (Move to Trash), then drag in the four real files from
   `ios/SquirrelWidget/`, ticking **SquirrelWidget** as the target and *not* App.
4. **Signing & Capabilities** on the new target → **+ Capability → App Groups**
   → tick `group.com.squirrelll.app`.
5. **Build Settings** on the new target:
   - `INFOPLIST_FILE` → `SquirrelWidget/Info.plist`
   - `CODE_SIGN_ENTITLEMENTS` → `SquirrelWidget/SquirrelWidget.entitlements`
   - `IPHONEOS_DEPLOYMENT_TARGET` → 17.0
6. **App target → General → Frameworks, Libraries, and Embedded Content**:
   confirm `SquirrelWidget.appex` is there and set to **Embed Without Signing**.

`npm run ios:check` stops reporting the widget once the target exists.

---

## 4. Subscriptions in App Store Connect (~30 min)

Nothing can be sold until these exist, and **their product ids are permanent**.

1. [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → **Apps → +**
   → New App. Platform iOS, your bundle id, SKU anything, Full Access.
2. **Monetization → Subscriptions → Create Subscription Group**, named
   something the customer sees, e.g. `Squirrel`.

   > One group, both plans. Subscriptions in the same group upgrade and
   > downgrade between each other with Apple handling the proration; in
   > separate groups a customer moving from Pro to Studio ends up paying for
   > both at once. This cannot be changed afterwards.

3. Add two subscriptions in that group:

   | Reference name | Product ID | Price | Rank |
   | --- | --- | --- | --- |
   | Squirrel Pro | `com.squirrelll.app.pro.monthly` | $24.99/mo | 2 |
   | Squirrel Studio | `com.squirrelll.app.studio.monthly` | $50.00/mo | 1 |

   Rank 1 is the highest tier. Each needs a display name, a description, and a
   localisation, or it stays in "Missing Metadata" and never loads on device.

4. Set the matching variables in Vercel and redeploy:

   | Variable | Value |
   | --- | --- |
   | `APPLE_PRODUCT_PRO` | `com.squirrelll.app.pro.monthly` |
   | `APPLE_PRODUCT_STUDIO` | `com.squirrelll.app.studio.monthly` |
   | `APPLE_BUNDLE_ID` | `com.squirrelll.app` |
   | `APPLE_ALLOW_SANDBOX` | *unset in production* |

   The app asks the server which id is which plan (`GET /api/apple/verify`), so
   these are the only place the ids are written. A second copy compiled into
   the app is a copy that goes stale, and the failure is the worst available:
   the purchase succeeds, Apple charges the card, and the server does not
   recognise what was bought.

   > `APPLE_ALLOW_SANDBOX=true` makes every TestFlight build a free
   > subscription generator. Set it while testing, unset it before you ship,
   > and never set it in production.

5. **App Store Server Notifications V2** → Production and Sandbox URLs both
   `https://your-domain/api/apple/notifications`. This is what keeps a
   subscription current afterwards — renewals, refunds, billing failures,
   cancellations. Without it a customer who cancels keeps their plan for ever.

---

## 5. Testing purchases before you ship (~20 min)

1. **Users and Access → Sandbox → Test Accounts** → create one with an email
   you control that is *not* an existing Apple ID.
2. On a real device (not the simulator): Settings → App Store → sign out of
   the sandbox account section, then run a TestFlight or debug build and buy.
   Use the sandbox account when prompted.
3. Set `APPLE_ALLOW_SANDBOX=true` while doing this or every purchase is
   refused with `sandbox_not_allowed` — which is the correct production
   behaviour and a confusing hour in testing.
4. Check all four:
   - the app shows the new plan immediately
   - `profiles.plan` in Supabase says the same
   - **Restore purchases** on a fresh install puts the plan back
   - cancelling in Settings → Subscriptions drops the plan at period end, not
     at the click

> **The one to test deliberately: kill the app between paying and being
> granted.** Buy, then force-quit before the plan appears. Reopen. The plan
> should arrive on its own. That is the whole reason the code verifies with the
> server *before* finishing the transaction, and it is the only failure mode
> here that costs a customer real money if it is wrong.

---

## 6. The listing (~45 min)

- **Screenshots** — 6.9" iPhone is mandatory. Take them on a device or the
  simulator at that size. The Info.plist declares iPad orientations, so either
  produce 13" iPad screenshots too, or set the App target's supported
  destinations to iPhone only.
- **Privacy policy URL** — `https://your-domain/privacy`. Already reachable
  without an account (`App.jsx` routes it before first run), which is what the
  reviewer needs.
- **Support URL** — required, and it must resolve. A page with an email address
  on it is enough.
- **Privacy nutrition labels** — these must match
  `ios/App/App/PrivacyInfo.xcprivacy` exactly, because review reads both. Declare
  **Email Address**, **Purchase History**, **Other User Content** and **Product
  Interaction**, all *linked to the user*, all "App Functionality", none used
  for tracking.

  > Task and project titles do sync to Supabase. That is User Content, it is
  > linked to the person, and saying otherwise to look tidier is the kind of
  > discrepancy that gets found.

- **Age rating** — 4+. Nothing here needs anything higher.
- **Category** — Productivity.
- **Review notes** — say plainly: *"Sign-in is by emailed magic link. A demo
  account is below with the link pre-authorised; the app is fully usable
  without an account, which is the free tier."*
- **Demo account** — required, and the usual reason a first submission is
  rejected on a magic-link app: a reviewer cannot receive your emails. Give
  them an account already signed in on a device, or a pre-authorised link, and
  say which.

**You do not need Sign in with Apple.** It is required only when you offer
third-party social login. Magic-link email is first-party.

---

## 7. Upload

```bash
npm run build && npx cap sync ios && npm run ios:wire
```

Then in Xcode: bump **Build** (Apple refuses a build number it has seen
before — Version can stay 1.0), select **Any iOS Device**, **Product → Archive**,
and **Distribute App → App Store Connect**.

The export-compliance question is already answered in the bundle
(`ITSAppUsesNonExemptEncryption = false`, correct because the app uses HTTPS and
the platform's own TLS and nothing else), so the upload will not ask.

---

## What is deliberately not built

**Stripe stays web-only.** `api/checkout.js` is not reachable from the app and
must not become reachable: routing an in-app upgrade to Stripe Checkout is a
3.1.1 rejection, not a grey area. `upgrade()` in `src/lib/billing.js` is the
single fork, and `test/compliance.test.mjs` fails if any component imports
`startCheckout` directly.

Selling on the web is both allowed and cheaper — 2.9% + 30¢ against Apple's 15%
under the Small Business Program — so the web checkout is worth keeping and
worth pointing people at from your own marketing. What it may not be is a
button inside the app.

**Invitation emails.** Inviting a colleague creates the record and sends
nothing. `api/email/invite.js` and `sendInvite` exist and need a `RESEND_API_KEY`
and wiring. Not a submission blocker; it is a company of twelve people where
eleven never hear they were invited.
