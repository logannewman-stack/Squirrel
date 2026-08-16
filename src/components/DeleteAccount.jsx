import { useState } from "react";
import { Button } from "./ui";
import { client } from "../lib/supabase";
import { resetAll } from "../lib/store";
import { api } from "../lib/api";

/**
 * Leaving, properly.
 *
 * Apple requires account deletion to live inside the app rather than behind a
 * support email, and it is a review checklist item rather than a suggestion.
 * It is also the honest counterpart to sign-up: an account somebody cannot
 * leave is a hostage.
 *
 * Two guards, doing different jobs. The panel stays shut until it is asked
 * for, so nobody meets this control while looking for something else. And the
 * word has to be typed, because a confirm button next to a destructive action
 * is a button people press — typing is the smallest amount of deliberateness
 * that reliably separates "I meant this" from "I was clicking".
 */
export default function DeleteAccount({ email }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Signed out, this rendered nothing at all — which is wrong twice over.
   *
   * A reviewer checking for the deletion control finds a blank space and no
   * explanation, and Apple treats "we could not find it" the same as "it is not
   * there". And a person who *is* signed out still deserves an answer to "how
   * do I get rid of this", rather than silence where a control should be.
   *
   * So the section always says something. Where there is no account, the honest
   * answer is that there is nothing on a server to delete.
   */
  if (!email) {
    return (
      <p className="text-[15px] leading-relaxed text-[var(--muted)]">
        You don't have an account, so there's nothing on a server to delete. Everything
        Squirrel knows is on this device — <span className="text-[var(--ink)]">Erase everything</span>{" "}
        above removes all of it.
      </p>
    );
  }

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const supabase = await client();
      const { data } = (await supabase?.auth.getSession()) ?? {};
      const token = data?.session?.access_token;
      if (!token) throw new Error("Sign in again to delete your account.");

      const res = await api("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Couldn't delete the account.");

      // The server has gone. Clear this device too, or the app carries on
      // showing a cached copy of data that no longer exists anywhere.
      await supabase?.auth.signOut().catch(() => {});
      resetAll();
      location.replace("/");
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-[var(--muted)] underline-offset-4 hover:text-[var(--alert)] hover:underline"
      >
        Delete my account
      </button>
    );
  }

  return (
    <div className="rounded-xl border p-5" style={{ borderColor: "var(--alert)" }}>
      <p className="text-sm font-medium">Delete your account</p>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-[var(--muted)]">
        This removes your projects, tasks, events, focus history and the
        conversation, on every device. Any subscription is cancelled
        immediately and connected calendars are disconnected. It cannot be
        undone and there is no copy kept.
      </p>

      <label className="mt-4 block text-xs font-medium text-[var(--muted)]">
        Type <span className="font-semibold text-[var(--ink)]">DELETE</span> to confirm
        <input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-transparent px-3.5 py-2.5
                     text-sm tracking-wide outline-none focus:border-[var(--ink)]"
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="danger" disabled={word !== "DELETE" || busy} onClick={go}>
          {busy ? "Deleting…" : "Delete permanently"}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => { setOpen(false); setWord(""); }}>
          Keep my account
        </Button>
      </div>

      {error && <p className="mt-3 text-sm text-[var(--alert)]">{error}</p>}
    </div>
  );
}
