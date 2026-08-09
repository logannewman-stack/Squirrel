import WidgetKit
import SwiftUI

/**
 Today's plan on the Home Screen.

 The surface that makes somebody open the app — and, more often, the one that
 means they do not have to. A planner's whole promise is that you always know
 what is next; a widget is that promise kept without unlocking anything.

 ## Where the data comes from

 The web layer owns everything. Rather than reimplementing the planner in Swift
 — two schedulers that disagree within a month, which this project has already
 fixed once — the app writes a small summary into a shared App Group container
 whenever the plan changes, and the widget only reads it. If the app has never
 run, the widget says so rather than inventing a day.

 ## Setting this up in Xcode

 1. File → New → Target → Widget Extension, named `SquirrelWidget`.
 2. Add an App Group — `group.com.squirrelll.app` — to *both* the app target
    and the widget target. Without it on both, the widget reads an empty
    container and shows the placeholder for ever, which is the failure mode
    that looks like a bug in this file and is not.
 3. Replace the generated file with this one.
 4. The app writes the snapshot; see `writeWidgetSnapshot` in the Capacitor
    plugin, and call `WidgetCenter.shared.reloadAllTimelines()` after each write.
 */

private let appGroup = "group.com.squirrelll.app"
private let snapshotKey = "squirrel.widget"

// MARK: - What the app hands over

struct Item: Codable, Hashable {
    let time: String     // "9:00 AM", or "" for work with no clock time
    let title: String
    let kind: String     // "meeting" | "work"
}

struct Snapshot: Codable {
    let headline: String     // "3 meetings, 2h of work"
    let items: [Item]
    let overdue: Int
    let writtenAt: Date

    static let placeholder = Snapshot(
        headline: "Open Squirrel to see your day",
        items: [],
        overdue: 0,
        writtenAt: .distantPast
    )

    static func read() -> Snapshot {
        guard
            let defaults = UserDefaults(suiteName: appGroup),
            let data = defaults.data(forKey: snapshotKey),
            let decoded = try? JSONDecoder().decode(Snapshot.self, from: data)
        else { return .placeholder }
        return decoded
    }
}

// MARK: - Timeline

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        Entry(date: Date(), snapshot: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: Date(), snapshot: Snapshot.read()))
    }

    /**
     Refreshed on the half hour rather than on a fixed interval.

     A day view whose next item has already started is worse than no widget:
     it is confidently wrong, which is the failure this whole product avoids
     everywhere else. Aligning to :00 and :30 means the thing on top is right
     within half an hour of any glance, and the app reloads the timeline
     directly whenever the plan actually changes.
     */
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let now = Date()
        let entry = Entry(date: now, snapshot: Snapshot.read())
        let calendar = Calendar.current
        let minute = calendar.component(.minute, from: now)
        let next = calendar.date(byAdding: .minute, value: minute < 30 ? 30 - minute : 60 - minute, to: now) ?? now.addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - The view

struct SquirrelWidgetView: View {
    var entry: Entry
    @Environment(\.widgetFamily) private var family

    private var limit: Int { family == .systemLarge ? 6 : family == .systemMedium ? 3 : 2 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("Today")
                    .font(.caption).fontWeight(.semibold)
                    .foregroundStyle(.secondary)
                Spacer()
                // The reserved colour, spent on the one thing that costs money
                // to find out late — exactly as in the app.
                if entry.snapshot.overdue > 0 {
                    Text("\(entry.snapshot.overdue) late")
                        .font(.caption2).fontWeight(.semibold)
                        .foregroundStyle(.orange)
                }
            }

            if entry.snapshot.items.isEmpty {
                Text(entry.snapshot.headline)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(entry.snapshot.items.prefix(limit), id: \.self) { item in
                    HStack(alignment: .top, spacing: 8) {
                        Text(item.time.isEmpty ? "—" : item.time)
                            .font(.caption).monospacedDigit()
                            .foregroundStyle(.secondary)
                            .frame(width: 58, alignment: .leading)
                        // Work is yours, meetings are owed to somebody else.
                        // The same distinction the app draws, drawn the same way.
                        Circle()
                            .strokeBorder(item.kind == "work" ? .secondary : .clear, lineWidth: 1)
                            .background(Circle().fill(item.kind == "meeting" ? Color.primary : .clear))
                            .frame(width: 6, height: 6)
                            .padding(.top, 5)
                        Text(item.title)
                            .font(.subheadline)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                }
                if entry.snapshot.items.count > limit {
                    Text("and \(entry.snapshot.items.count - limit) more")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(4)
        // Tapping anywhere opens the app on today. A widget with several tap
        // targets is a widget people mis-tap.
        .widgetURL(URL(string: "squirrel://today"))
        .containerBackground(.background, for: .widget)
    }
}

@main
struct SquirrelWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "SquirrelWidget", provider: Provider()) { entry in
            SquirrelWidgetView(entry: entry)
        }
        .configurationDisplayName("Today")
        .description("What's next, and what's still open.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
