/**
 * The demo, run against an empty account.
 *
 * The last step of onboarding is not a description of the assistant — it is the
 * assistant, driving the real parser and the real store. Which means a
 * suggestion that stops working is not a broken feature somebody trips over in
 * week two. It is her failing in the sixty seconds a stranger spends deciding
 * whether any of this is real, and it would ship silently: the component would
 * render, the words would type themselves in, and the answer would be "I
 * couldn't find a task matching that."
 *
 * That is not hypothetical. The first draft of this step offered "The board
 * deck will take 8 hours, due Friday" — a line from the app's own EXAMPLES —
 * which is an *estimate against an existing task* and therefore misses on every
 * brand-new account by construction.
 *
 * So each suggestion is played here exactly as the UI plays it: from nothing,
 * through the confirmation, and then checked against what actually landed in
 * the store.
 */
import { store, ask, resolveChoice, reset, t, report } from "./harness.mjs";
import { FIRST_ASKS } from "../src/lib/firstrun.js";

// Tuesday 11 August 2026, 10:00 — mid-week, so "Thursday" and "Friday" are both
// ahead and "my week" has days on either side of today.
const NOW = new Date(2026, 7, 11, 10, 0);
const S = () => store.getState();

/**
 * One suggestion, as a person experiences it: tap, read the confirmation, tap
 * yes. Returns the final reply.
 */
function play(text, { now = NOW } = {}) {
  let r = ask(text, S(), { now });
  if (r.choices) {
    const yes = r.choices.options.find((o) => /^y/i.test(o.id) || /yes/i.test(o.label));
    if (yes) r = resolveChoice(r.choices, yes.id, S(), now);
  }
  return r;
}

// --------------------------------------------------------- none of them miss
for (const s of FIRST_ASKS) {
  reset({ confirm: true });
  store.setSetting("identity", { style: "first", firstName: "Logan" });
  const r = play(s.text);
  t(`“${s.text}” lands on an empty account`, !r.miss, `${r.miss} — ${r.text}`);
  t("  and answers in words rather than an apology",
    r.text && !/couldn'?t (?:find|catch)|didn'?t catch/i.test(r.text), r.text);
}

// ------------------------------------------------- and each does its own job
{
  reset({ confirm: true });
  store.setSetting("identity", { style: "first", firstName: "Logan" });

  // 1. A meeting, on the day named, at the hour named.
  play(FIRST_ASKS[0].text);
  const ev = S().events[0];
  t("the meeting suggestion books a meeting", S().events.length === 1, S().events.length);
  t("on Thursday", ev && new Date(ev.start).getDay() === 4, ev?.start);
  t("at two in the afternoon", ev?.start.includes("T14:00"), ev?.start);
  t("named after the person", /priya/i.test(ev?.title || ""), ev?.title);

  // 2. A task, with the deadline attached — the deadline is the whole point,
  //    because it is what lets the planner schedule the work at all.
  play(FIRST_ASKS[1].text);
  const task = S().tasks[0];
  t("the task suggestion creates a task", S().tasks.length === 1, S().tasks.length);
  t("with a title that reads like one", /board deck/i.test(task?.title || ""), task?.title);
  t("and a due date, not just a name", task?.due === "2026-08-14", task?.due);

  // 3. The question, which by now has both of the above to report.
  const week = play(FIRST_ASKS[2].text);
  t("the question is answered about the week", /this week/.test(week.text), week.text);
  t("and it mentions the meeting just booked", /Priya/i.test(week.text), week.text);
  t("and the task just added", /board deck/i.test(week.text), week.text);
  t("nothing was created by asking a question",
    S().events.length === 1 && S().tasks.length === 1);
}

// ------------------------------------------------------------- the demo path
/**
 * The order the UI offers them in matters. The question comes last so it has
 * something to say; asked first, on an empty account, the honest answer is
 * "clear — nothing scheduled", which is a true sentence and a flat demo.
 */
{
  reset({ confirm: true });
  const first = ask(FIRST_ASKS[0].text, S(), { now: NOW });
  t("the first suggestion offers a confirmation rather than acting",
    Boolean(first.choices), JSON.stringify(first.choices));
  t("which is how she behaves everywhere else",
    first.choices.options.some((o) => /yes/i.test(o.label)),
    first.choices.options.map((o) => o.label).join(" / "));

  // Declining has to leave the account exactly as it was, or the one person
  // who says no during onboarding gets a meeting they refused.
  const no = first.choices.options.find((o) => /no/i.test(o.label));
  resolveChoice(first.choices, no.id, S(), NOW);
  t("and saying no creates nothing", S().events.length === 0, S().events.length);
}

report("First run");
