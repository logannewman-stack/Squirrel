import { useEffect, useState } from "react";
import { listCalendars, connectGoogle, syncNow, disconnect, connectResult } from "../lib/calendars";
import {
  appleCalendarAvailable, requestAppleAccess, appleCalendars, syncAppleCalendar,
} from "../lib/apple-calendar";
import { can } from "../lib/plans";
import { Button } from "./ui";

/** Why a connection failed, in words that say what to do about it. */
const REASONS = {
  no_refresh_token: "Google didn't grant offline access. Try again and leave the permissions ticked.",
  bad_state: "That link expired. Start the connection again.",
  not_configured: "Calendar sync isn't set up on this deployment yet.",
  exchange_failed: "Google turned down the connection. Try again.",
  no_code: "The connection was cancelled.",
  access_denied: "The connection was cancelled.",
};

/**
 * Connected calendars.
 *
 * The whole flow lives behind three buttons — connect, sync, disconnect — and
 * every one of them is a redirect or a single call. What makes this safe is on
 * the server: the refresh token never reaches the browser, and the schema's
 * column grants mean it cannot even be selected.
 */
export default function Calendars({ plan, email, onUpgrade }) {
  const [links, setLinks] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const allowed = can(plan, "calendarSync");

  const refresh = () => listCalendars().then(setLinks).catch(() => setLinks([]));

  useEffect(() => {
    refresh();
    // The redirect back from Google carries its own verdict in the URL. Read it
    // once, say it, then clear it — a reload should not re-announce a
    // connection made ten minutes ago.
    const result = connectResult();
    if (result) {
      setNote(result.ok
        ? { ok: true, text: "Calendar connected." }
        : { ok: false, text: REASONS[result.reason] || "Couldn't connect that calendar." });
      history.replaceState({}, "", location.pathname);
    }
  }, [email]);

  /**
   * Connect the device's own calendar.
   *
   * No OAuth and no server: permission comes from the operating system, and the
   * sync runs here. The default calendar is used rather than asking which one —
   * picking from a list of six calendars named "Calendar" is not a decision
   * anyone wants before they have seen it work.
   */
  async function connectApple() {
    const access = await requestAppleAccess();
    if (access !== "granted") {
      throw new Error(
        access === "unavailable"
          ? "Apple Calendar needs the iPhone or Mac app."
          : "Squirrel needs calendar permission — you can grant it in Settings.",
      );
    }
    const [first] = (await appleCalendars()).filter((c) => c.writable);
    if (!first) throw new Error("No calendar on this device can be written to.");

    const out = await syncAppleCalendar(first.id);
    if (!out.ok) throw new Error("Couldn't read that calendar.");
    return { pulled: out.pulled, pushed: out.pushed };
  }

  async function go(fn, key) {
    setBusy(key);
    setNote(null);
    try {
      const out = await fn();
      if (out && (out.pulled != null || out.pushed != null)) {
        const moved = (out.pulled || 0) + (out.pushed || 0);
        setNote({
          ok: true,
          text: moved ? `Synced — ${out.pulled} in, ${out.pushed} out.` : "Already up to date.",
        });
      }
      await refresh();
    } catch (e) {
      setNote({ ok: false, text: e.message === "not signed in" ? "Sign in first." : e.message });
    }
    setBusy(null);
  }

  if (!email) {
    return <p className="text-sm text-[var(--muted)]">Sign in to connect a calendar.</p>;
  }

  return (
    <div>
      {links?.length > 0 && (
        <ul className="mb-4 flex flex-col gap-2">
          {links.map((l) => (
            <li key={l.id} className="card flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.account}</p>
                <p className="truncate text-xs text-[var(--muted)]">
                  {l.calendar_name}
                  {l.last_error
                    ? " · needs reconnecting"
                    : l.last_synced_at
                      ? ` · synced ${new Date(l.last_synced_at).toLocaleString()}`
                      : " · not synced yet"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                onClick={() => go(() => disconnect(l.id), l.id)}
              >
                {busy === l.id ? "Removing…" : "Disconnect"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy !== null || !allowed}
          onClick={() => go(connectGoogle, "connect")}
        >
          {busy === "connect" ? "Opening Google…" : "Connect Google Calendar"}
        </Button>

        {/* Apple only appears where it can actually work. There is no
            server-side Apple Calendar API, so this is the native app or
            nothing — and an button that cannot do anything is worse than an
            absent one. */}
        {appleCalendarAvailable() && (
          <Button
            variant="secondary"
            disabled={busy !== null || !allowed}
            onClick={() => go(connectApple, "apple")}
          >
            {busy === "apple" ? "Asking permission…" : "Connect Apple Calendar"}
          </Button>
        )}

        {links?.length > 0 && (
          <Button variant="ghost" disabled={busy !== null} onClick={() => go(syncNow, "sync")}>
            {busy === "sync" ? "Syncing…" : "Sync now"}
          </Button>
        )}
      </div>

      {!appleCalendarAvailable() && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          Apple Calendar syncs in the iPhone and Mac apps. Apple publishes no way
          for a website to reach it — it has to run on your own device.
        </p>
      )}

      {/* This used to be a sentence with nothing to press: the app naming its
          own price and then leaving you to go and find it. */}
      {!allowed && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="min-w-[15rem] flex-1 text-sm text-[var(--muted)]">
            Calendar sync is part of Pro. Your meetings and Squirrel's plan stay in step, both ways.
          </p>
          <Button variant="primary" size="sm" onClick={() => onUpgrade?.("Calendar sync is on Pro")}>
            Upgrade
          </Button>
        </div>
      )}

      {note && (
        <p className={`mt-3 text-sm ${note.ok ? "text-[var(--muted)]" : "text-[var(--alert)]"}`}>
          {note.text}
        </p>
      )}

      <p className="mt-3 max-w-prose text-xs text-[var(--muted)]">
        Changes flow both ways. Squirrel never sees your Google password, and the
        token that keeps the connection alive stays on the server — it is not
        readable by this app in your browser.
      </p>
    </div>
  );
}
