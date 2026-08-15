import Capacitor
import Foundation
import StoreKit

/**
 In-App Purchase, because Apple requires it and Stripe is not allowed in here.

 Guideline 3.1.1 is not a grey area: a digital subscription bought inside an
 iOS app must go through StoreKit. The web app sells the same two plans through
 Stripe and always will — that is cheaper for the business and stays exactly as
 it is — but the moment the same screens are running inside an app bundle, the
 buy button has to reach this file instead.

 ## What this does and does not decide

 It does not decide entitlement. It buys, restores, and hands the resulting
 signed transaction to the web layer, which posts it to `/api/apple/verify`;
 the server checks Apple's certificate chain, pins the bundle id, refuses
 sandbox receipts in production, and writes the plan. That split matters: a
 JWS payload is base64, not encryption, so anything that grants a plan by
 reading a transaction on the device is a free subscription for anybody with a
 debugger. The device asks; the server decides.

 ## Finishing, and why it is the web layer's call

 A StoreKit transaction stays undelivered until `finish()` is called, and that
 is a feature. The order is: purchase → hand the JWS over → server grants →
 *then* finish. If the app is killed between the payment and the grant — or the
 network drops, or the server is down — the transaction is still outstanding,
 and `Transaction.updates` below replays it at next launch until it lands.
 Finishing on the device the moment the payment succeeds is the bug that shows
 up as "I paid and I'm still on free", and it is unrecoverable without a
 support ticket.

 ## Setting this up in Xcode

 1. This file and `SquirrelStore.m` belong to the App target (the wiring
    script in `scripts/xcode-wire.mjs` puts them there).
 2. App Store Connect: one subscription group, two products whose ids match
    `APPLE_PRODUCT_PRO` and `APPLE_PRODUCT_STUDIO` on the server.
 3. Nothing else. In-App Purchase needs no entitlement file; the capability
    comes from the App ID.
 */
@objc(SquirrelStore)
public class SquirrelStore: CAPPlugin {

    /// Renewals, refunds, Ask-to-Buy approvals, and anything that failed to
    /// reach the server last time. Started at launch and never stopped, because
    /// a transaction that arrives while nobody is listening is one the customer
    /// paid for and did not get.
    private var updates: Task<Void, Never>?

    override public func load() {
        updates = Task.detached { [weak self] in
            for await result in Transaction.updates {
                guard let self, case .verified(let tx) = result else { continue }
                // Deliberately not finished here. The web layer verifies it
                // server-side and calls back to `finish`; until it does, this
                // same transaction is offered again at every launch.
                self.notifyListeners("transaction", data: [
                    "signedTransaction": result.jwsRepresentation,
                    "productId": tx.productID,
                    "transactionId": String(tx.id),
                    "reason": "update",
                ])
            }
        }
    }

    deinit { updates?.cancel() }

    /**
     Can this device pay at all?

     False under parental controls and on a device signed out of the App Store.
     The web layer uses it to say so plainly rather than showing a buy button
     that opens a sheet and dies.
     */
    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": AppStore.canMakePayments])
    }

    /**
     What the products actually cost, in the customer's own currency.

     Read from StoreKit rather than from `plans.js`, and that is not a detail:
     the app advertises $24.99 because that is the US price, while the person
     holding the phone may be charged in euros, in yen, or at a regional price
     Apple set. Printing a hardcoded dollar figure next to a sheet that charges
     something else is both a rejection and a complaint.
     */
    @objc func products(_ call: CAPPluginCall) {
        let ids = call.getArray("ids", String.self) ?? []
        guard !ids.isEmpty else {
            call.reject("No product ids given")
            return
        }

        Task {
            do {
                let found = try await Product.products(for: ids)
                call.resolve(["products": found.map(Self.describe)])
            } catch {
                call.reject("Could not read the App Store: \(error.localizedDescription)")
            }
        }
    }

    /**
     Buy one.

     Every outcome is a resolve rather than a reject except a genuine failure,
     because "cancelled" is not an error — somebody closing the payment sheet
     has done a normal thing and should not meet a red banner for it.

     `pending` is Ask-to-Buy: a child has asked a parent, and the answer may
     arrive hours later. It comes back through `Transaction.updates` above,
     which is the whole reason that listener exists.
     */
    @objc func purchase(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("No product id given")
            return
        }

        Task {
            do {
                guard let product = try await Product.products(for: [id]).first else {
                    call.reject("That plan is not available on the App Store")
                    return
                }

                switch try await product.purchase() {
                case .success(let verification):
                    guard case .verified(let tx) = verification else {
                        // Apple itself could not verify what it just handed us.
                        call.reject("The App Store returned a receipt that failed verification")
                        return
                    }
                    call.resolve([
                        "state": "purchased",
                        "signedTransaction": verification.jwsRepresentation,
                        "productId": tx.productID,
                        "transactionId": String(tx.id),
                    ])
                case .pending:
                    call.resolve(["state": "pending"])
                case .userCancelled:
                    call.resolve(["state": "cancelled"])
                @unknown default:
                    call.resolve(["state": "unknown"])
                }
            } catch {
                call.reject("The purchase did not go through: \(error.localizedDescription)")
            }
        }
    }

    /**
     Restore purchases — required by 3.1.1, and the first thing review looks for.

     Two halves, and skipping either one is the usual bug. `AppStore.sync()`
     pulls the account's history down (this is what asks for the App Store
     password, and why it must never run unprompted). `currentEntitlements`
     then reports what is actually live, which is what the server needs to see
     to put a reinstalled app back on the plan its owner is paying for.
     */
    @objc func restore(_ call: CAPPluginCall) {
        Task {
            do {
                try await AppStore.sync()
            } catch {
                // A cancelled password prompt lands here. The entitlements
                // already on the device are still worth reporting, so this is
                // not fatal — falling through gives a customer who is signed in
                // their plan back without a second prompt.
            }
            call.resolve(["entitlements": await Self.entitlements()])
        }
    }

    /**
     What this Apple ID is entitled to right now, without prompting for anything.

     Called at launch and whenever the app comes back, so a subscription that
     renewed, lapsed, or was refunded while the app was closed is reflected
     without the customer doing anything.
     */
    @objc func current(_ call: CAPPluginCall) {
        Task { call.resolve(["entitlements": await Self.entitlements()]) }
    }

    /**
     Mark a transaction delivered.

     Called by the web layer only after the server has granted the plan. See the
     note at the top of this file: this is the last step, never the first.
     */
    @objc func finish(_ call: CAPPluginCall) {
        guard let wanted = call.getString("transactionId") else {
            call.reject("No transaction id given")
            return
        }

        Task {
            for await result in Transaction.unfinished {
                guard case .verified(let tx) = result, String(tx.id) == wanted else { continue }
                await tx.finish()
                call.resolve(["finished": true])
                return
            }
            // Already finished, or never ours. Both mean there is nothing left
            // to do, and neither is worth an error the customer would see.
            call.resolve(["finished": false])
        }
    }

    // ------------------------------------------------------------- helpers

    private static func entitlements() async -> [[String: Any]] {
        var out: [[String: Any]] = []
        for await result in Transaction.currentEntitlements {
            guard case .verified(let tx) = result else { continue }
            out.append([
                "signedTransaction": result.jwsRepresentation,
                "productId": tx.productID,
                "transactionId": String(tx.id),
                "expiresAt": tx.expirationDate.map { ISO8601DateFormatter().string(from: $0) } ?? "",
            ])
        }
        return out
    }

    private static func describe(_ product: Product) -> [String: Any] {
        var out: [String: Any] = [
            "id": product.id,
            "title": product.displayName,
            "description": product.description,
            // Already formatted by StoreKit in the storefront's own currency
            // and conventions. Building this string from the number is how an
            // app ends up printing "€24.99" where the locale writes "24,99 €".
            "price": product.displayPrice,
            "amount": NSDecimalNumber(decimal: product.price).doubleValue,
        ]
        if let period = product.subscription?.subscriptionPeriod {
            out["period"] = "\(period.value) \(String(describing: period.unit))"
        }
        return out
    }
}
