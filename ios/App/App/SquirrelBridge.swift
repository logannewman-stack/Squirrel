import Capacitor
import Foundation
import WidgetKit

/**
 The one piece of native code that carries data, rather than deciding anything.

 Everything Squirrel knows — the plan, the deadlines, what fits — is worked out
 in the web layer, and that is deliberate: a second planner written in Swift
 disagrees with the first inside a month, and this project has already fixed
 that exact bug once when the Today screen ran its own scheduler.

 So this plugin does two things and no more. It copies a small summary of the
 day into the App Group container, and it tells WidgetKit to redraw. The widget
 reads that container; so does the Siri intent that answers questions without
 launching anything. Neither computes a thing.

 ## Setting this up in Xcode

 1. Add this file to the App target.
 2. Signing & Capabilities → App Groups → `group.com.squirrelll.app`, on **both**
    the app target and the widget target. Missing it on either is the failure
    that looks like a bug in the widget and is not: the container silently
    resolves to nil, nothing is written, and the placeholder shows for ever.
 3. Nothing else. Capacitor finds the plugin through the `CAP_PLUGIN` macro.
 */

let squirrelAppGroup = "group.com.squirrelll.app"
let squirrelSnapshotKey = "squirrel.widget"

@objc(SquirrelBridge)
public class SquirrelBridge: CAPPlugin {

    /**
     Store the day for the widget and the Siri intent to read.

     Called by the web layer whenever the plan changes. The payload is already
     the finished shape — times formatted, items ordered, headline written — so
     nothing here has to interpret it, and a change to how a day is described
     never needs a new build of the app.
     */
    @objc func writeWidget(_ call: CAPPluginCall) {
        guard let defaults = UserDefaults(suiteName: squirrelAppGroup) else {
            // The App Group is missing from the target. Worth saying out loud:
            // silently succeeding here is what makes a blank widget look like a
            // bug in the widget rather than a checkbox in Xcode.
            call.reject("App Group \(squirrelAppGroup) is not configured on this target")
            return
        }

        let snapshot: [String: Any] = [
            "headline": call.getString("headline") ?? "Nothing scheduled",
            "items": call.getArray("items") as? [[String: Any]] ?? [],
            "overdue": call.getInt("overdue") ?? 0,
            "writtenAt": call.getString("writtenAt") ?? ISO8601DateFormatter().string(from: Date()),
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: snapshot) else {
            call.reject("Could not encode the day")
            return
        }

        defaults.set(data, forKey: squirrelSnapshotKey)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve(["ok": true])
    }

    /** Whether the container is reachable, so the web layer can stop trying. */
    @objc func widgetAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": UserDefaults(suiteName: squirrelAppGroup) != nil])
    }
}
