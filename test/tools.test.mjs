import { chromium } from "playwright";

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));

// Dev server so source modules can be imported directly by URL.
await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });

const result = await p.evaluate(async () => {
  const store = await import("/src/lib/store.js");
  const { runTool } = await import("/src/lib/tools.js");
  const out = [];

  localStorage.removeItem("squirrel.v2");
  location.hash = "";

  // Next Monday 15:00–16:00
  const monday = new Date();
  monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
  const p2 = (n) => String(n).padStart(2, "0");
  const dstr = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const monKey = dstr(monday);

  const ev = store.addEvent({
    title: "Meridian partner call",
    start: `${monKey}T15:00:00`,
    end: `${monKey}T16:00:00`,
  });

  // 1. get_schedule must surface the event WITH its id.
  const sched = JSON.parse(runTool("get_schedule", { from: monKey, to: monKey }).content);
  out.push(["get_schedule returns id", sched.events.length === 1 && sched.events[0].id === ev.id]);

  // 2. move to the following Wednesday at 14:00, duration preserved.
  const wed = new Date(monday);
  wed.setDate(wed.getDate() + 9);
  const wedKey = dstr(wed);
  const moved = runTool("move_event", { eventId: ev.id, start: `${wedKey}T14:00:00` });
  const after = store.getState().events.find((e) => e.id === ev.id);
  const durMins = (new Date(after.end) - new Date(after.start)) / 60000;
  out.push(["moved to new day", after.start.startsWith(wedKey)]);
  out.push(["moved to 14:00", after.start.endsWith("T14:00:00")]);
  out.push(["duration preserved (60m)", durMins === 60]);
  out.push(["receipt produced", typeof moved.summary === "string" && moved.summary.length > 0]);

  // 3. Unknown id must error rather than throw, so the model can self-correct.
  const bad = runTool("move_event", { eventId: "nope", start: `${wedKey}T09:00:00` });
  out.push(["unknown id returns isError", bad.isError === true]);

  // 4. Task lifecycle through tools.
  const made = JSON.parse(runTool("create_task", {
    title: "Review term sheet", projectName: "Series B", estimateMins: 45,
    due: monKey, priority: "critical",
  }).content);
  out.push(["task created with project", store.getState().projects.some((x) => x.name === "Series B")]);
  runTool("update_task", { taskId: made.id, priority: "high" });
  out.push(["task updated", store.getState().tasks.find((t) => t.id === made.id).priority === "high"]);
  runTool("complete_task", { taskId: made.id });
  out.push(["task completed", store.getState().tasks.find((t) => t.id === made.id).done === true]);

  // 5. Free-time search must exclude the booked hour.
  store.addEvent({ title: "Block", start: `${wedKey}T09:00:00`, end: `${wedKey}T10:00:00` });
  const slots = JSON.parse(runTool("find_free_time", { date: wedKey, minMins: 30 }).content);
  const overlapsBlock = slots.some((s) => s.start.endsWith("T09:00:00"));
  out.push(["free slots skip booked hour", !overlapsBlock && slots.length > 0]);

  localStorage.removeItem("squirrel.v2");
  return out;
});

let failed = 0;
for (const [name, ok] of result) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
console.log(errs.length ? `page errors: ${errs.slice(0, 3)}` : "page errors: none");
await b.close();
process.exit(failed ? 1 : 0);
