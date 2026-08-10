/**
 * What you can say out loud, written down.
 *
 * App Intents has one weakness and it is not technical: the phrases work
 * perfectly and nobody knows they exist. iOS registers them at install and then
 * mentions them nowhere, so an app either teaches its own phrases or ships a
 * voice feature that is used by the person who built it. Every app that "adds
 * Siri support" and sees no usage added it and never said so.
 *
 * So this is the catalogue, and Settings reads from it. Which makes it worth
 * being careful about one thing: these have to be the phrases the system
 * *actually* registered. A settings screen teaching a phrase Siri does not know
 * is worse than teaching nothing, because the person tries it, it fails, and
 * they conclude the feature is broken rather than that the documentation is.
 *
 * `templates` is the literal registration from `SquirrelShortcuts` in
 * `ios/App/App/SquirrelIntents.swift`, normalised — `{app}` for the system's
 * application-name substitution and `{request}` for the spoken parameter.
 * test/shortcuts.test.mjs parses the Swift and fails if the two drift apart,
 * because they will otherwise: a phrase added in Swift months from now would
 * leave this list quietly teaching the old one.
 */

export const SHORTCUTS = [
  {
    id: "ask",
    title: "Ask Squirrel",
    /** What it does, in the voice used everywhere else in Settings. */
    what: "Anything you'd type. She opens, so you still see the change read back before it happens.",
    /** Written out the way somebody would actually say them. */
    examples: [
      "Ask Squirrel to move my three o'clock to Thursday",
      "Tell Squirrel the board deck is done",
      "Ask Squirrel to book a call with Priya on Friday at ten",
    ],
    templates: ["Ask {app}", "Ask {app} to {request}", "Tell {app} {request}", "{app} {request}"],
  },
  {
    id: "whats-on",
    title: "What's on today",
    // The one that does not open anything. It is the difference between an
    // assistant and a launcher, so it is said plainly.
    what: "Answered out loud without opening the app.",
    examples: ["What's on today in Squirrel", "Ask Squirrel what's on"],
    templates: ["What's on today in {app}", "What's my day in {app}", "Ask {app} what's on"],
  },
  {
    id: "open-today",
    title: "Open today",
    what: "Straight to today's plan — the Action button and the Home Screen.",
    examples: ["Open my day in Squirrel", "Open Squirrel"],
    templates: ["Open my day in {app}", "Open {app}", "Show my {app}"],
  },
];

/** Every phrase the system knows, flattened — used by the drift test. */
export const allTemplates = () => SHORTCUTS.flatMap((s) => s.templates);
