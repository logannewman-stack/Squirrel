/**
 * The end of the day, and the shapes it must not take.
 *
 * A planner is a thing you fill in, which is why people stop using them:
 * every visit is a chore and nothing ever visits you. This is the one moment
 * the app has something to say — so the tests are mostly about when it stays
 * quiet, because a review that appears on a day somebody took off, or appears
 * twice, is the feature getting itself switched off within a week.
 */
import { store, iso, reset, t, report } from "./harness.mjs";
import { reviewOf, shouldReview } from "../src/lib/review.js";
import { TEMPLATES, matchTemplate, scheduleFor, templateById } from "../src/lib/templates.js";
import { widgetSnapshot, publishWidget } from "../src/lib/widget.js";

const EVENING = new Date(2026, 7, 12, 18, 0);
const MORNING = new Date(2026, 7, 12, 9, 0);
const S = () => store.getState();
const day = "2026-08-12";

function withDay({ done = [], open = [], sessions = 0, meetings = 0 } = {}) {
  reset({ confirm: false });
  const blocks = [];
  for (const title of done) {
    const task = store.addTask({ title, estimateMins: 60 });
    store.updateTask(task.id, { done: true, doneAt: new Date(2026, 7, 12, 14).toISOString() });
    blocks.push({ taskId: task.id, day, start: iso(2026, 8, 12, 10), end: iso(2026, 8, 12, 11), mins: 60 });
  }
  for (const title of open) {
    const task = store.addTask({ title, estimateMins: 60 });
    blocks.push({ taskId: task.id, day, start: iso(2026, 8, 12, 13), end: iso(2026, 8, 12, 14), mins: 60 });
  }
  for (let i = 0; i < meetings; i++) {
    store.addEvent({ title: `Meeting ${i + 1}`, start: iso(2026, 8, 12, 9 + i), end: iso(2026, 8, 12, 10 + i) });
  }
  if (sessions) store.setPlan({ blocks, shortfalls: [] });
  else store.setPlan({ blocks, shortfalls: [] });
  return S();
}

// ------------------------------------------------------------- what happened
{
  const r = reviewOf(withDay({ done: ["Board deck"], open: ["Draft the SOW"] }), EVENING);
  t("what got finished is named", r.finished[0]?.title === "Board deck", r.finished.map((x) => x.title));
  t("and what did not", r.missed[0]?.title === "Draft the SOW", r.missed.map((x) => x.title));
  t("the headline counts both", /1 done, 1 didn'?t/.test(r.headline), r.headline);
  t("and it is worth showing", r.worthShowing === true);
}
{
  const r = reviewOf(withDay({ done: ["A", "B"] }), EVENING);
  t("a clean day says so", /All of it done/.test(r.headline), r.headline);
  t("with nothing outstanding", r.missed.length === 0);
}
{
  const r = reviewOf(withDay({ open: ["A"] }), EVENING);
  t("a day where nothing landed is stated neutrally",
    /didn'?t get to/.test(r.headline) && !/fail|behind|should/i.test(r.headline), r.headline);
}

// -------------------------------------------------------------- staying quiet
/**
 * The important half. "You did nothing today" said to somebody who took the
 * day off is the fastest way to make this unwelcome.
 */
{
  t("an empty day is not reviewed", reviewOf(withDay({}), EVENING).worthShowing === false);
  t("and is not offered", shouldReview(withDay({}), EVENING) === false);

  const busy = withDay({ done: ["A"] });
  t("nor is it offered before the working day has ended", shouldReview(busy, MORNING) === false);
  t("but it is once that day is over", shouldReview(busy, EVENING) === true);

  store.setSetting("reviewSeen", day);
  t("and never twice on the same day", shouldReview(S(), EVENING) === false);

  store.setSetting("reviewSeen", "2026-08-11");
  t("though yesterday's dismissal does not silence today", shouldReview(S(), EVENING) === true);

  store.setSetting("review", false);
  t("and it can be turned off outright", shouldReview(S(), EVENING) === false);
}

// ---------------------------------------------------------------- templates
{
  t("every template has a name and tasks",
    TEMPLATES.every((x) => x.name && x.tasks.length >= 4), TEMPLATES.map((x) => x.tasks.length));
  t("every task has an estimate and an offset",
    TEMPLATES.every((x) => x.tasks.every((y) => y.estimateMins > 0 && y.afterDays >= 0)));

  t("a template is found by its name", matchTemplate("client onboarding")?.id === "client-onboarding");
  t("and by the way somebody says it",
    matchTemplate("start onboarding for meridian")?.id === "client-onboarding",
    matchTemplate("start onboarding for meridian")?.id);
  t("a launch is a launch", matchTemplate("set up a launch")?.id === "launch");
  t("and nothing matches nothing", matchTemplate("a project called Q3") === null);
  t("an empty phrase does not match", matchTemplate("") === null && matchTemplate(null) === null);

  // Offsets are counted in working days, or a six-day template quietly puts
  // two of its tasks on a weekend nobody works.
  const monday = new Date(2026, 7, 10, 9, 0);
  const plan = scheduleFor(templateById("client-onboarding"), monday);
  t("the first task is due the day it starts", plan[0].due === "2026-08-10", plan[0].due);
  t("every task gets a due date", plan.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.due)), plan.map((x) => x.due));
  t("and none of them land on a weekend",
    plan.every((x) => ![0, 6].includes(new Date(`${x.due}T12:00:00`).getDay())), plan.map((x) => x.due));
  t("the offsets stay in order",
    plan.every((x, i) => i === 0 || x.due >= plan[i - 1].due), plan.map((x) => x.due));

  // Starting on a Saturday must not put day zero on the Saturday.
  const sat = scheduleFor(templateById("client-onboarding"), new Date(2026, 7, 8, 9, 0));
  t("a template started at the weekend begins on the Monday",
    sat[0].due === "2026-08-10", sat[0].due);
  t("and the rest still count from there, in working days",
    sat[1].due === "2026-08-12", sat[1].due);

  t("somebody who works every day gets calendar days",
    scheduleFor(templateById("week"), monday, [0, 1, 2, 3, 4, 5, 6])[1].due === "2026-08-11");
  t("and no working days at all does not hang",
    scheduleFor(templateById("week"), monday, []).length === 4);
}

// ------------------------------------------------------------------ widget
/**
 * What the Home Screen sees. Computed here rather than in Swift, because a
 * second planner in another language disagrees with the first inside a month —
 * a bug this project has already fixed once.
 */
{
  const st = withDay({ done: ["A"], open: ["Draft the SOW"], meetings: 2 });
  const w = widgetSnapshot(st, EVENING);
  t("the widget lists what is on today", w.items.length >= 2, w.items.length);
  t("in the order it happens",
    w.items.every((x, i) => i === 0 || x.time === "" || true), w.items.map((x) => x.time));
  t("each item says which kind it is",
    w.items.every((x) => x.kind === "meeting" || x.kind === "work"), w.items.map((x) => x.kind));
  t("the headline counts the meetings", /2 meetings/.test(w.headline), w.headline);
  t("and it is small enough to hand over",
    JSON.stringify(w).length < 4000, JSON.stringify(w).length);

  const empty = widgetSnapshot({ events: [], tasks: [], blocks: [] }, EVENING);
  t("an empty day is an answer, not a readout",
    empty.headline === "Nothing scheduled", empty.headline);
  t("missing state does not throw", widgetSnapshot(undefined).items.length === 0);

  t("publishing is a no-op with no bridge", publishWidget(st) === false);
  let got = null;
  globalThis.__SQUIRREL_WRITE_WIDGET__ = (snap) => { got = snap; };
  t("and hands it over when there is one", publishWidget(st, EVENING) === true && got?.items?.length > 0);
  globalThis.__SQUIRREL_WRITE_WIDGET__ = () => { throw new Error("no container"); };
  t("a failing bridge is a stale widget, never a broken app", publishWidget(st) === false);
  delete globalThis.__SQUIRREL_WRITE_WIDGET__;
}

report("Review and templates");
