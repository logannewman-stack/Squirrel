/**
 * What she is offered to do on the first run.
 *
 * These live outside the component for one reason: they are the demo, they are
 * run against the real parser on a brand-new empty account, and a suggestion
 * that stops working there is the single worst bug this app can ship. It is not
 * a broken feature somebody finds in week two — it is the assistant failing in
 * the sixty seconds when a stranger is deciding whether any of this is real.
 *
 * `test/firstrun.test.mjs` runs every line here against an empty store and
 * asserts it lands. Adding one without running it is how the demo rots.
 *
 * One of each shape rather than three examples — a meeting, a piece of work
 * with a deadline, a question. Somebody who has watched all three understands
 * the range without being told what it is.
 *
 * Every one is phrased to work from *nothing*. That rules out most of the
 * app's own EXAMPLES list: "the board deck will take 8 hours" is an estimate
 * against a task that already exists, and on an empty account it correctly
 * answers "I couldn't find a task matching that" — a true sentence and a
 * catastrophic first impression.
 */
export const FIRST_ASKS = [
  { text: "Book a call with Priya Thursday at 2", teaches: "Meetings, in a sentence" },
  { text: "Add a task to write the board deck, due Friday", teaches: "Work with a deadline" },
  { text: "What does my week look like?", teaches: "Ask her anything" },
];
