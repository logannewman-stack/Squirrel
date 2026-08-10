# Siri and the widget, in Xcode

Everything in this document is a checkbox in Xcode. All the code is written and
in the repository; none of it can be wired up from the web side, which is why
this exists as a list rather than as a script.

The rule the whole design follows: **the web layer decides, the native layer
carries.** Squirrel's planner, parser and phrasing all live in JavaScript. A
second planner written in Swift would disagree with the first inside a month —
this project has already fixed that exact bug once, when the Today screen ran
its own scheduler alongside the real one. So Swift moves data and speaks; it
never works anything out.

---

## 1. The App Group

**Both targets need it, and this is the step that silently breaks everything
else.** Miss it on either and `UserDefaults(suiteName:)` returns nil, nothing is
written, and the widget shows its placeholder for ever — which looks like a bug
in the widget and is not.

- App target → Signing & Capabilities → **+ Capability** → App Groups →
  `group.com.squirrelll.app`
- Widget target → the same capability, the same identifier

If you change the identifier, change it in three places: both targets,
`SquirrelBridge.swift` (`squirrelAppGroup`), and `SquirrelWidget.swift`.

## 2. The URL scheme

Already in `App/App/Info.plist` as `CFBundleURLTypes` → `squirrel`. Nothing to
do unless it was removed.

This is what `squirrel://ask?q=…` and `squirrel://today` arrive on. Capacitor's
`AppDelegate` forwards them; `native.js` re-dispatches them as `squirrel:url`;
`intent.js` reads them. That path is covered by `test/siri.e2e.mjs`.

## 3. Files to add to the **App** target

| File | What it does |
|---|---|
| `App/App/SquirrelIntents.swift` | The three App Intents and the phrases the system learns at install |
| `App/App/SquirrelBridge.swift` | Writes the day into the App Group, reloads the widget |
| `App/App/SquirrelBridge.m` | Registers the plugin with Capacitor |

**The `.m` file is not optional.** Capacitor discovers plugins through the
Objective-C runtime, so a plugin without it compiles cleanly, ships, and is
simply absent at runtime: `SquirrelBridge` comes back undefined, the web layer
concludes there is no native side, and the widget never updates. It is the
quietest way to lose a feature in a Capacitor app.

## 4. The widget target

File → New → **Target** → Widget Extension, named `SquirrelWidget`, **without**
"Include Configuration Intent". Replace the generated Swift with
`ios/SquirrelWidget/SquirrelWidget.swift`.

Minimum deployment: iOS 17 (App Intents with `AppShortcutsProvider`).

---

## What each phrase does

| Said to Siri | Opens the app? | Why |
|---|---|---|
| "Ask Squirrel to move my three o'clock" | **Yes** | It changes a calendar. She reads every change back before making it everywhere else in this product; a voice phrase that silently books a meeting would be the one exception. |
| "What's on today in Squirrel" | **No** | A question is not a change. It reads the snapshot the app already published and speaks. Opening the whole app to read out two lines is the difference between an assistant and a launcher. |
| "Open my day in Squirrel" | Yes | It is a request to be somewhere. |

## Testing it

1. Run the app once on a device — the snapshot has to exist before the widget
   or the read-only intent can say anything. Both say so plainly if it does not,
   rather than reporting an empty day, because "you have nothing on" is a
   sentence somebody might act on.
2. Long-press the Home Screen → add the **Today** widget.
3. Settings → Siri & Search → Squirrel — the phrases appear there once
   installed. No Shortcut needs building.
4. Change something in the app and watch the widget redraw:
   `WidgetCenter.reloadAllTimelines()` fires on every write.

## Without any of this

The app is unaffected. `publishWidget` is a no-op when the bridge is absent,
which is every browser, and `?ask=` works on the web today — a Shortcut with a
single "Open URL" action pointing at `https://squirelll.com/?ask=...` is a
working Siri phrase with no native code at all.
