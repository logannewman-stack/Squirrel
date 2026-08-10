import AppIntents
import UIKit

/**
 Asking Squirrel from Siri, Spotlight, the Shortcuts app, or the Action button.

 The whole native surface of this is one intent that takes a sentence and hands
 it to the app. Everything Squirrel can do already lives in the web layer —
 booking, moving, clearing, planning — and duplicating any of it here would mean
 two parsers that disagree with each other within a month. So this does the one
 thing Swift is needed for: getting the words across.

 `AppShortcutsProvider` is why this matters more than a URL scheme on its own.
 It registers the phrases with the system at install, so "Hey Siri, ask Squirrel
 to move my three o'clock" works without the user opening the Shortcuts app and
 building anything. A URL scheme requires them to know they want it; this is
 there the moment they install.

 ## Setting this up in Xcode

 1. Add this file to the App target.
 2. Info.plist needs a `CFBundleURLTypes` entry with the scheme `squirrel`.
 3. Nothing else. The intent opens the app, and `AppDelegate` already forwards
    the URL to Capacitor, which fires `appUrlOpen` — where `native.js` picks it
    up and re-dispatches it to `intent.js`.

 The `openAppWhenRun` is not laziness. A calendar change made without showing
 anybody what it did is the one behaviour this app has been careful to avoid
 everywhere else: she reads a change back before making it, and a Siri phrase
 that silently books a meeting would be the single exception. Opening means the
 confirmation still happens.
 */
struct AskSquirrelIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Squirrel"
    static var description = IntentDescription(
        "Tell Squirrel what changed — she books it, moves it, or answers.",
        categoryName: "Assistant"
    )

    // She changes a calendar, so she is shown doing it. See the note above.
    static var openAppWhenRun: Bool = true

    @Parameter(
        title: "What to ask",
        description: "Anything you would type — “move my 3pm to Thursday”.",
        requestValueDialog: "What should I do?"
    )
    var request: String

    static var parameterSummary: some ParameterSummary {
        Summary("Ask Squirrel to \(\.$request)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        var parts = URLComponents()
        parts.scheme = "squirrel"
        parts.host = "ask"
        // `from=siri` is what makes her answer out loud: somebody who asked
        // without looking at the screen should not have to look at it for the
        // reply.
        parts.queryItems = [
            URLQueryItem(name: "q", value: request),
            URLQueryItem(name: "from", value: "siri"),
        ]
        if let url = parts.url {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}

/**
 Opening the day, for the Action button and the Home Screen.

 A second, deliberately trivial intent. "Open my day" is the phrase people
 actually reach for, and routing it through the ask intent would make Siri
 prompt for a sentence nobody wanted to give.
 */
struct OpenTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Open today"
    static var description = IntentDescription("Open Squirrel on today's plan.", categoryName: "Assistant")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        if let url = URL(string: "squirrel://today") {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}


/**
 "Hey Siri, what's on today?" — answered without launching anything.

 The other intents open the app, and that is right for anything that *changes*
 a calendar: she reads a change back before making it everywhere else in this
 product, and a voice phrase that silently books a meeting would be the one
 exception.

 A question is not a change. Opening the whole app to read out three lines is
 the difference between an assistant and a launcher, and it is the thing people
 notice about apps that "support Siri" without meaning it. So this reads the
 same App Group container the widget draws from — written by the web layer,
 which is the only thing that knows how to work a day out — and speaks.

 Nothing is computed here. If the app has never run, it says so rather than
 inventing an empty day, because "you have nothing on" is a sentence somebody
 might act on.
 */
struct WhatsOnIntent: AppIntent {
    static var title: LocalizedStringResource = "What's on today"
    static var description = IntentDescription(
        "Hear today's plan without opening the app.",
        categoryName: "Assistant"
    )

    // The whole point: no launch.
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard
            let defaults = UserDefaults(suiteName: squirrelAppGroup),
            let data = defaults.data(forKey: squirrelSnapshotKey),
            let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return .result(dialog: "Open Squirrel once and I'll be able to tell you.")
        }

        let headline = raw["headline"] as? String ?? "Nothing scheduled"
        let overdue = raw["overdue"] as? Int ?? 0
        let items = raw["items"] as? [[String: Any]] ?? []

        // Two lines at most. A spoken list of eight is three quarters of a
        // minute of times nobody can skim back through — the same reason the
        // app caps what it reads aloud.
        var said = headline + "."
        if let first = items.first,
           let title = first["title"] as? String {
            let time = first["time"] as? String ?? ""
            said += time.isEmpty ? " First up, \(title)." : " First up, \(title) at \(time)."
        }
        if overdue > 0 {
            said += overdue == 1 ? " One thing is overdue." : " \(overdue) things are overdue."
        }
        return .result(dialog: IntentDialog(stringLiteral: said))
    }
}

/**
 The phrases the system learns at install.

 `applicationName` is substituted by the system, so these read as "ask Squirrel
 to…" without hardcoding the name. Several phrasings per intent because people
 do not converge on one: the whole value of this over a hand-built Shortcut is
 that it works on the first thing somebody thinks to say.
 */
struct SquirrelShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskSquirrelIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Ask \(.applicationName) to \(\.$request)",
                "Tell \(.applicationName) \(\.$request)",
                "\(.applicationName) \(\.$request)",
            ],
            shortTitle: "Ask Squirrel",
            systemImageName: "bubble.left.and.text.bubble.right"
        )
        AppShortcut(
            intent: WhatsOnIntent(),
            phrases: [
                "What's on today in \(.applicationName)",
                "What's my day in \(.applicationName)",
                "Ask \(.applicationName) what's on",
            ],
            shortTitle: "What's on today",
            systemImageName: "list.bullet.rectangle"
        )
        AppShortcut(
            intent: OpenTodayIntent(),
            // Deliberately no "what's my day" here: that phrase belongs to the
            // intent that *answers* it. Two intents claiming one phrase is
            // ambiguous, and the system resolves it by picking one silently.
            phrases: [
                "Open my day in \(.applicationName)",
                "Open \(.applicationName)",
                "Show my \(.applicationName)",
            ],
            shortTitle: "Open today",
            systemImageName: "calendar.day.timeline.left"
        )
    }
}
