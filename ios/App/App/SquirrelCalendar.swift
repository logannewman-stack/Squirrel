import Capacitor
import EventKit
import Foundation

/**
 Apple Calendar, which only exists here.

 Google publishes a Calendar API a server can call; Apple does not. There is no
 OAuth to perform, no token to hold, and nothing a backend can reach — EventKit
 lives inside the app on the user's own hardware, and that is the whole of it.
 This file is therefore the entire reason the native wrap is worth building:
 everything else Squirrel does works in a browser, and this does not.

 It is also a compliance requirement rather than a nice-to-have. `Info.plist`
 declares `NSCalendarsUsageDescription`, and an app that asks for a permission
 it never uses is refused under Guideline 5.1.1. Before this file existed the
 plist made a promise the binary could not keep.

 ## The contract

 Deliberately shaped by `src/lib/apple-calendar.js`, not by EventKit — the web
 layer already owns every sync decision (`isEcho`, `resolve`, the two-way
 merge), and it makes the same decisions for Google. Nothing here decides
 anything; it reads, writes, and translates.

     available()                      → Bool
     requestAccess()                  → "granted" | "denied"
     calendars()                      → [{ id, title, writable }]
     events({ calendarId, from, to }) → [{ id, title, startDate, … }]
     save({ calendarId, event })      → { id, lastModified }
     remove({ calendarId, id })       → Bool

 ## Access

 iOS 17 replaced `requestAccess(to:)` with a full/write-only pair. The project
 targets 17, so only the current call is here — carrying the deprecated one
 behind an availability check would be dead code that reads like support for
 devices this build will never be installed on.

 Full access rather than write-only, deliberately: Squirrel reads the calendar
 to know what the day already holds, and a planner that can only add is a
 planner that double-books.
 */
@objc(SquirrelCalendar)
public class SquirrelCalendar: CAPPlugin {

    /// One store for the app's lifetime. Creating one per call is the classic
    /// EventKit performance bug — each instance rebuilds its view of the
    /// database, and a sync that makes six calls pays for it six times.
    private let store = EKEventStore()

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// Lenient on the way in, strict on the way out. JavaScript's `toJSON`
    /// always writes fractional seconds; hand-written dates and older payloads
    /// may not, and a parser that accepts only one shape rejects half of them.
    private static func parse(_ s: String?) -> Date? {
        guard let s else { return nil }
        if let d = iso.date(from: s) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: s)
    }

    private static func stamp(_ d: Date?) -> String {
        guard let d else { return "" }
        return iso.string(from: d)
    }

    @objc func available(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    /**
     Ask once, and report the answer as the web layer's three words.

     "denied" covers refused, restricted by parental controls, and write-only —
     all three mean the same thing to a caller that has to read the calendar to
     do its job, and collapsing them here keeps the branch out of every call
     site upstream.
     */
    @objc func requestAccess(_ call: CAPPluginCall) {
        store.requestFullAccessToEvents { granted, _ in
            call.resolve(["status": granted ? "granted" : "denied"])
        }
    }

    /**
     The calendars this account can see, and which of them can be written to.

     Subscribed calendars — a shared team diary, a holiday feed — come back
     read-only, and the web layer uses `writable` to keep them out of the
     "sync into" picker. Offering somebody a calendar EventKit will refuse to
     write to produces a sync that silently half-works.
     */
    @objc func calendars(_ call: CAPPluginCall) {
        let list = store.calendars(for: .event).map { cal -> [String: Any] in
            [
                "id": cal.calendarIdentifier,
                "title": cal.title,
                "writable": cal.allowsContentModifications,
            ]
        }
        call.resolve(["calendars": list])
    }

    /**
     Everything in one calendar between two dates.

     `predicateForEvents` is the only supported way to read a range — iterating
     is not offered, because the store is backed by a database that may hold
     years. Recurring events arrive already expanded into their occurrences,
     which is what the planner wants: a weekly stand-up is thirteen things in
     the quarter, not one rule.
     */
    @objc func events(_ call: CAPPluginCall) {
        guard let calendarId = call.getString("calendarId"),
              let calendar = store.calendar(withIdentifier: calendarId) else {
            call.reject("That calendar is no longer on this device")
            return
        }
        guard let from = Self.parse(call.getString("from")),
              let to = Self.parse(call.getString("to")) else {
            call.reject("A start and end date are required")
            return
        }

        let predicate = store.predicateForEvents(withStart: from, end: to, calendars: [calendar])
        let found = store.events(matching: predicate).map { ev -> [String: Any] in
            var out: [String: Any] = [
                // `eventIdentifier` is stable for the event; an occurrence of a
                // recurring series shares it with its siblings, which is why
                // the web layer keys its map on this *and* the start time.
                "id": ev.eventIdentifier ?? "",
                "title": ev.title ?? "",
                "startDate": Self.stamp(ev.startDate),
                "endDate": Self.stamp(ev.endDate),
                "location": ev.location ?? "",
                "notes": ev.notes ?? "",
                "allDay": ev.isAllDay,
                // The change token the echo check rests on. Without it every
                // pass re-imports every event and calls it new.
                "lastModified": Self.stamp(ev.lastModifiedDate ?? ev.creationDate),
            ]
            out["attendees"] = (ev.attendees ?? []).map { who -> [String: Any] in
                [
                    "name": who.name ?? "",
                    // EventKit gives addresses as `mailto:` URLs, never plainly.
                    "email": who.url.scheme == "mailto" ? (who.url.resourceSpecifier ?? "") : "",
                    "isCurrentUser": who.isCurrentUser,
                ]
            }
            return out
        }
        call.resolve(["events": found])
    }

    /**
     Write one event, creating or updating.

     An `id` in the payload means update; its absence means create. The update
     path re-reads the event from the store rather than trusting the fields it
     was handed, so a meeting whose location changed on another device does not
     get its own change overwritten by a stale copy of everything else.

     `span: .thisEvent` on purpose: editing one occurrence of a recurring
     meeting must not silently rewrite the whole series, which is the EventKit
     default people discover after they have moved thirteen stand-ups.
     */
    @objc func save(_ call: CAPPluginCall) {
        guard let calendarId = call.getString("calendarId"),
              let calendar = store.calendar(withIdentifier: calendarId) else {
            call.reject("That calendar is no longer on this device")
            return
        }
        guard calendar.allowsContentModifications else {
            call.reject("That calendar is read-only")
            return
        }
        guard let fields = call.getObject("event") else {
            call.reject("No event given")
            return
        }

        let existingId = fields["id"] as? String
        let event: EKEvent
        if let existingId, let found = store.event(withIdentifier: existingId) {
            event = found
        } else {
            event = EKEvent(eventStore: store)
            event.calendar = calendar
        }

        guard let start = Self.parse(fields["startDate"] as? String),
              let end = Self.parse(fields["endDate"] as? String), end > start else {
            call.reject("An event needs a start and an end, in that order")
            return
        }

        event.title = (fields["title"] as? String) ?? "(no title)"
        event.startDate = start
        event.endDate = end
        event.location = fields["location"] as? String
        event.notes = fields["notes"] as? String

        do {
            try store.save(event, span: .thisEvent, commit: true)
            call.resolve([
                "id": event.eventIdentifier ?? "",
                "lastModified": Self.stamp(event.lastModifiedDate ?? Date()),
            ])
        } catch {
            call.reject("The calendar refused the change: \(error.localizedDescription)")
        }
    }

    /**
     Delete one event.

     An event that is already gone reports success. It is the ordinary case —
     deleted on another device between one sync and the next — and treating it
     as a failure makes a sync that has done exactly the right thing look
     broken.
     */
    @objc func remove(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("No event id given")
            return
        }
        guard let event = store.event(withIdentifier: id) else {
            call.resolve(["removed": true])
            return
        }

        do {
            try store.remove(event, span: .thisEvent, commit: true)
            call.resolve(["removed": true])
        } catch {
            call.reject("The calendar refused the deletion: \(error.localizedDescription)")
        }
    }
}
