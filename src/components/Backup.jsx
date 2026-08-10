import { useRef, useState } from "react";
import { Button } from "./ui";
import { getState, restoreAll } from "../lib/store";
import { exportOf, fileName, readBackup, summarize, download } from "../lib/backup";

/**
 * A copy of your week, as a file.
 *
 * Saving is one tap and needs no explaining. Restoring is the interesting one,
 * because it is destructive and irreversible and the person doing it is often
 * doing it for the first time, on a new phone, slightly anxious.
 *
 * So it happens in two steps with the truth in between. Picking a file does not
 * restore it — it reads it and tells you what is in it *and what is here now*,
 * side by side, and only then offers the button. Those two lines are the whole
 * design: almost every bad restore is somebody who picked the wrong file, and
 * seeing "3 tasks" about to replace "60 tasks" catches that before it happens
 * rather than after.
 */
export default function Backup() {
  const pick = useRef(null);
  const [found, setFound] = useState(null);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  function save() {
    const now = Date.now();
    download(JSON.stringify(exportOf(getState(), now), null, 2), fileName(now));
    setSaved(true);
    setTimeout(() => setSaved(false), 4000);
  }

  async function chose(e) {
    const file = e.target.files?.[0];
    // Reset the input, or choosing the same file twice in a row fires nothing
    // the second time — which reads as the app ignoring you.
    e.target.value = "";
    if (!file) return;
    setError(null);
    setFound(null);
    const result = readBackup(await file.text());
    if (!result.ok) return setError(result.error);
    setFound({ ...result.data, name: file.name });
  }

  const here = getState();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={save}>
          {saved ? "Saved" : "Save a copy"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => pick.current?.click()}>
          Restore from a copy
        </Button>
        <input
          ref={pick}
          type="file"
          accept="application/json,.json"
          onChange={chose}
          className="hidden"
          aria-label="Choose a backup file"
        />
      </div>

      {error && <p className="text-[13px] leading-relaxed text-[var(--alert)]">{error}</p>}

      {found && (
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--alert)" }}>
          <p className="text-[15px] font-medium">Replace everything with this file?</p>
          <dl className="mt-3 flex flex-col gap-1.5 text-[13px]">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-[var(--muted)]">In it</dt>
              <dd className="min-w-0">{summarize(found)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-[var(--muted)]">Here now</dt>
              <dd className="min-w-0">{summarize(here)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">
            Everything on this device is replaced by {found.name}. This can't be undone —
            save a copy first if you're not sure.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                restoreAll(found);
                // A reload rather than a re-render. Half the app is holding
                // derived state — the plan, the open screen, the assistant's
                // memory of a conversation that no longer exists — and the
                // honest way to invalidate all of it at once is to start again.
                location.replace("/");
              }}
            >
              Replace everything
            </Button>
            <Button variant="ghost" size="sm" onClick={save}>Save a copy first</Button>
            <Button variant="ghost" size="sm" onClick={() => setFound(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
