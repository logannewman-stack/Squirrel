# Shipping Squirrel to the App Store

`GO-LIVE.md` gets the web app running. This one gets the iPhone app approved.

Nobody here opens Xcode. Builds happen on **Codemagic**, from a clean checkout,
on a rented Mac — which is why the Xcode project is wired by a script
(`npm run ios:wire`), why the scheme is committed, and why `npm test` fails if
any of it drifts. Everything that has to be true of the build has to be true of
what is *committed*.

What remains is almost entirely dashboard work: Apple's developer portal, App
Store Connect, Codemagic, Supabase, Vercel.

> Before any build: `npm test`. It runs the compliance suite, which asserts what
> App Review checks and what only breaks on a device.

---

## What is already done

No action needed on any of this — written, tested, pushed.

- In-App Purchase end to end: StoreKit 2, purchase, **Restore purchases**,
  renewals, and server-side receipt verification before any transaction is
  finished
- The Stripe-vs-IAP fork, so no screen inside the app can reach Stripe checkout
- Company seats deliberately not sold in-app — StoreKit cannot express a
  quantity-based subscription — with the app saying where they are bought
- EventKit bridge, so the calendar permission has a real feature behind it
- Privacy manifests for the app and the widget
- `Info.plist`: arm64, export compliance answered, duplicate key removed
- The widget extension target, its embed phase and its dependency, built by
  `scripts/xcode-wire.mjs` with no Xcode involved
- A shared scheme, committed, so a clean checkout has something to build
- `codemagic.yaml`
- API calls routed through `lib/api.js`, and magic-link sign-in returning
  through `squirrel://auth` — **both were broken on device while working
  perfectly on the web**, which is why neither had been noticed

---

## 1. Apple developer portal (~10 min)

The App ID for `com.squirrelll.app` already exists. Three things are missing.

1. **Identifiers → App Groups → +** → `group.com.squirrelll.app`
2. **Identifiers → App IDs →** open `com.squirrelll.app` → **Edit** → tick
   **App Groups**, **In-App Purchase** and **SiriKit**, then inside App Groups
   select the group you just made. Save.
3. **Identifiers → App IDs → +** → `com.squirrelll.app.SquirrelWidget`, tick
   **App Groups**, select the same group.

> Step 3 can be skipped — the build registers the identifier if it is missing —
> but the **App Group cannot be**, and it must be enabled on *both*. Set on one
> and not the other, the app writes into a container the widget cannot read: no
> error, no log, a placeholder widget for ever.

4. **Integrations → App Store Connect API → Keys → +**, access **App Manager**.
   Download the `.p8` — it downloads once and never again. Note the **Key ID**
   and the **Issuer ID** from the same page.

---

## 2. App Store Connect (~30 min)

1. **Apps → +** → New App. iOS, `com.squirrelll.app`, SKU anything, Full Access.
2. **Monetization → Subscriptions → Create Subscription Group**, named
   `Squirrel`.

   > **One group, both plans.** Subscriptions in the same group upgrade and
   > downgrade between each other with Apple handling proration. In separate
   > groups, a customer moving from Pro to Studio pays for both at once. This
   > cannot be changed afterwards.

3. Two subscriptions inside it:

   | Reference name | Product ID | Price | Rank |
   | --- | --- | --- | --- |
   | Squirrel Pro | `com.squirrelll.app.pro.monthly` | $24.99/mo | 2 |
   | Squirrel Studio | `com.squirrelll.app.studio.monthly` | $50.00/mo | 1 |

   Rank 1 is the highest tier. Each needs a display name, description and
   localisation, or it stays in "Missing Metadata", never loads on device, and
   the paywall renders empty with no error.

4. **App Store Server Notifications** — set Production *and* Sandbox URLs to
   `https://your-domain/api/apple/notifications`. This is what keeps a
   subscription current afterwards: renewals, refunds, billing failures,
   cancellations. Without it, a customer who cancels keeps their plan for ever.

5. **Users and Access → Sandbox → Test Accounts → +**, on an email you control
   that is not already an Apple ID.

---

## 3. Vercel (~5 min)

| Variable | Value |
| --- | --- |
| `APPLE_PRODUCT_PRO` | `com.squirrelll.app.pro.monthly` |
| `APPLE_PRODUCT_STUDIO` | `com.squirrelll.app.studio.monthly` |
| `APPLE_BUNDLE_ID` | `com.squirrelll.app` |
| `APPLE_ALLOW_SANDBOX` | `true` — **while testing only** |

The app asks the server which product id is which plan, so these are the only
place the ids are written. A second copy compiled into the app is a copy that
goes stale, and the failure is the worst available: the purchase succeeds,
Apple charges the card, and the server does not recognise what was bought.

> `APPLE_ALLOW_SANDBOX=true` makes every TestFlight build a free subscription
> generator. Set it to test, remove it before the first real submission.

---

## 4. Supabase (~2 min)

**Authentication → URL Configuration → Redirect URLs** → add:

```
squirrel://auth
```

Without it, Supabase refuses the app's redirect and sends people to the web
Site URL instead — which on a phone is a dead end. They tap the link, a browser
opens, and the app never hears anything.

---

## 5. Codemagic (~15 min, once)

1. **Applications → Add application → GitHub →** `logannewman-stack/squirrel`.
   Choose **codemagic.yaml** when asked; it is in the repo root and defines
   everything.
2. **Teams → Integrations → Developer Portal → Add key.** Upload the `.p8`,
   paste the Key ID and Issuer ID, and **name it `squirrel-asc`** — the yaml
   refers to it by that exact name.
3. **Environment variables → group `squirrel-ios`**, three values:

   | Variable | Value |
   | --- | --- |
   | `VITE_API_URL` | `https://your-domain` — no trailing slash |
   | `VITE_SUPABASE_URL` | your Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | the `anon` key |

   These are compiled **into** the bundle the app ships. Missing them, the app
   installs, looks perfect, and nobody can sign in, buy anything, or open the
   company screen. The build stops rather than producing that.

4. **Build it.** The workflow triggers on a version tag:

   ```
   git tag v1.0.0 && git push --tags
   ```

   About fifteen minutes later it lands in TestFlight. It does **not** submit to
   App Review — that stays a deliberate act.

---

## 6. Test a real purchase (~20 min)

On a real device from TestFlight. The simulator cannot buy.

- [ ] Buy a plan; the app shows it immediately
- [ ] `profiles.plan` in Supabase agrees
- [ ] Delete the app, reinstall, tap **Restore purchases** — the plan comes back
- [ ] Cancel in Settings → Subscriptions — the plan ends at period end, not at
      the tap
- [ ] Sign out and back in — the emailed link opens the app and signs you in
- [ ] **Force-quit mid-purchase, then reopen.** The plan should arrive on its own

That last one matters most. It is why the code verifies with the server *before*
finishing the transaction, and it is the only failure here that costs a real
customer real money if it is wrong.

Then remove `APPLE_ALLOW_SANDBOX` from Vercel.

---

## 7. The listing (~45 min)

- **Screenshots** — 6.9" iPhone mandatory. `Info.plist` declares iPad
  orientations, so either add 13" iPad screenshots or set the App target to
  iPhone only.
- **Privacy policy URL** — `https://your-domain/privacy`, already reachable
  without an account.
- **Support URL** — required, and it must resolve.
- **Privacy nutrition labels** — must match `ios/App/App/PrivacyInfo.xcprivacy`
  exactly, because review reads both: **Email Address**, **Purchase History**,
  **Other User Content**, **Product Interaction** — all linked to the user, all
  "App Functionality", none for tracking.
- **Age rating** 4+, **category** Productivity.
- **Demo account.** The usual first-round rejection on a magic-link app: the
  reviewer cannot receive your sign-in emails. Give them an account already
  signed in, or a pre-authorised link, and say which in the review notes.

**Sign in with Apple is not required** — that applies only when you offer
third-party social login. Magic-link email is first-party.

---

## Not blocking submission

**Stripe.** The account exists; nothing for Squirrel is set up in it yet.
`GO-LIVE.md` §5 has the products, prices, webhook and four ids. Selling on the
web is allowed and cheaper — 2.9% + 30¢ against Apple's 15% — so it is worth
having, and it stays web-only: routing an in-app upgrade to Stripe is a 3.1.1
rejection, and `test/compliance.test.mjs` fails if any component tries.

**Invitation emails.** Inviting a colleague creates the record and sends
nothing. `api/email/invite.js` and `sendInvite` are written and need
`RESEND_API_KEY` and `INVITE_FROM`. A company of twelve currently has eleven
people who never hear they were invited.
