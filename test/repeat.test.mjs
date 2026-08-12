/**
 * Work that comes back.
 *
 * A weekly review finished this Friday IS next Friday's review. The respawn
 * happens in the store, inside the same mutation as the tick — so undo takes
 * back both, sync carries both, and no screen has to remember to do it.
 */
import { store, reset, t, report } from "./harness.mjs";

const open = () => store.getState().tasks.filter((x) => !x.done);

{
  reset();
  const weekly = store.addTask({
    title: "Weekly review", estimateMins: 30, due: "2026-08-14",
    repeat: "week", priority: "high", notes: "agenda in drive",
  });
  store.toggleTask(weekly.id);

  const kids = open();
  t("finishing a weekly task hatches next week's", kids.length === 1, kids.length);
  const kid = kids[0];
  t("  a week later to the day", kid.due === "2026-08-21", kid.due);
  t("  same title, size, priority, notes — and still repeating",
    kid.title === "Weekly review" && kid.estimateMins === 30 &&
    kid.priority === "high" && kid.notes === "agenda in drive" && kid.repeat === "week");
  t("  a fresh task, not the old one resurrected",
    kid.id !== weekly.id && kid.done === false && kid.doneAt === null);
  t("  the finished one stays finished",
    store.getState().tasks.find((x) => x.id === weekly.id)?.done === true);

  store.undo();
  t("one undo takes back the tick AND the hatchling",
    open().length === 1 && open()[0].id === weekly.id &&
    store.getState().tasks.length === 1, store.getState().tasks.length);
}

{
  reset();
  const daily = store.addTask({ title: "Standup notes", estimateMins: 15, due: "2026-08-12", repeat: "day" });
  store.toggleTask(daily.id);
  t("daily advances one day", open()[0]?.due === "2026-08-13", open()[0]?.due);
}

{
  reset();
  const invoice = store.addTask({ title: "Invoice", estimateMins: 30, due: "2026-01-31", repeat: "month" });
  store.toggleTask(invoice.id);
  t("a month after Jan 31 is the end of February, not March 3rd",
    open()[0]?.due === "2026-02-28", open()[0]?.due);
}

{
  reset();
  const undated = store.addTask({ title: "Someday", estimateMins: 30, repeat: "week" });
  store.toggleTask(undated.id);
  t("no due date, no respawn — repetition is anchored to a date",
    store.getState().tasks.length === 1);

  reset();
  const plain = store.addTask({ title: "Once", estimateMins: 30, due: "2026-08-14" });
  store.toggleTask(plain.id);
  store.toggleTask(plain.id);
  t("un-ticking never hatches anything", store.getState().tasks.length === 1);

  reset();
  const handed = store.addTask({
    title: "Chase legal", estimateMins: 30, due: "2026-08-14",
    repeat: "week", delegatedTo: "Anders",
  });
  store.toggleTask(handed.id);
  t("the hatchling is yours, even when the finished one was handed over",
    open()[0]?.delegatedTo === "", JSON.stringify(open()[0]?.delegatedTo));
}

report("Repeat");
