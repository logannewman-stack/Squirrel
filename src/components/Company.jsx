import { useEffect, useState } from "react";
import { Button, Input } from "./ui";
import { client } from "../lib/supabase";
import { startCheckout } from "../lib/billing";
import { PLANS } from "../lib/plans";
import { quote } from "../lib/seats";

/**
 * The company screen: seats, the people in them, and the invitations out.
 *
 * Three audiences, one component, because they are three states of the same
 * relationship rather than three features:
 *
 *   nobody      — no company, and an offer to start one
 *   invited     — an invitation waiting, and one button to take it
 *   member      — which company this account belongs to
 *   admin       — the roster, the seat count, and the controls
 *
 * Everything it can do is refused server-side as well; this is the window,
 * `api/org` is the door.
 */
export default function Company({ onUpgrade }) {
  const [state, setState] = useState({ loading: true });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Which member's work is open, and who the viewer is — so the roster can
  // say "you" rather than offering to show somebody their own account.
  const [openMember, setOpenMember] = useState(null);
  const [meId, setMeId] = useState(null);

  const token = async () => {
    const supabase = await client();
    const { data } = (await supabase?.auth.getSession()) ?? {};
    return data?.session?.access_token || null;
  };

  const load = async () => {
    try {
      const supabase = await client();
      const { data: session } = (await supabase?.auth.getSession()) ?? {};
      setMeId(session?.session?.user?.id ?? null);
      const t = session?.session?.access_token || null;
      if (!t) return setState({ signedOut: true });
      const res = await fetch("/api/org", { headers: { authorization: `Bearer ${t}` } });
      if (!res.ok) return setState({ unavailable: true });
      setState(await res.json());
    } catch {
      setState({ unavailable: true });
    }
  };

  useEffect(() => { load(); }, []);

  const post = async (body) => {
    setBusy(true);
    setErr(null);
    try {
      const t = await token();
      const res = await fetch("/api/org", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${t}` },
        body: JSON.stringify(body),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) setErr(SAYS[out.error] || "That didn't work. Try again.");
      else await load();
      return res.ok;
    } finally {
      setBusy(false);
    }
  };

  if (state.loading || state.signedOut || state.unavailable) {
    return (
      <p className="text-[15px] text-[var(--muted)]">
        {state.signedOut
          ? "Sign in to buy seats for a team."
          : state.unavailable
            ? "Teams need an account on this deployment."
            : "Loading…"}
      </p>
    );
  }

  /* ------------------------------------------------------------- invited */
  const invite = state.invites?.[0];
  if (!state.org && invite) {
    return (
      <div className="text-[15px]">
        <p>
          <span className="font-medium">{invite.organizations?.name || "A company"}</span> has
          offered you a seat.
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
          Taking it puts this account on their plan, and lets their administrators see the
          projects, tasks and calendar on it — the way a company device works. Your
          conversations with Squirrel stay private, and they cannot change your work.
        </p>
        <Button variant="primary" size="sm" className="mt-3" disabled={busy}
                onClick={() => post({ accept: invite.id })}>
          Take the seat
        </Button>
        {err && <p className="alert mt-2 text-[13px]">{err}</p>}
      </div>
    );
  }

  /* -------------------------------------------------------------- nobody */
  if (!state.org) {
    return (
      <div className="text-[15px]">
        <p className="text-[var(--muted)]">
          Buy Squirrel for a team: one subscription, a seat each, and one invoice.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)}
                 aria-label="Your company's name" placeholder="Your company's name"
                 className="w-56" />
          <Button variant="secondary" size="sm" disabled={busy || !name.trim()}
                  onClick={() => post({ name })}>
            Start a company
          </Button>
        </div>
        {err && <p className="alert mt-2 text-[13px]">{err}</p>}
      </div>
    );
  }

  /* -------------------------------------------------------------- member */
  const { org, role, seats, members = [], pending = [] } = state;
  if (role !== "admin") {
    return (
      <div className="text-[15px]">
        <p>This account is part of <span className="font-medium">{org.name}</span>.</p>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          On {PLANS[org.plan]?.name || org.plan}, paid for by your company.
        </p>
      </div>
    );
  }

  /* --------------------------------------------------------------- admin */
  const free = Math.max(0, (org.seats || 0) - (seats?.taken || 0));
  return (
    <div className="text-[15px]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{org.name}</p>
        <p className="text-[13px] text-[var(--muted)]">
          {org.plan === "free"
            ? "No subscription yet"
            : `${PLANS[org.plan]?.name || org.plan} · ${org.seats} ${org.seats === 1 ? "seat" : "seats"}`}
          {free > 0 && org.plan !== "free" ? ` · ${free} free` : ""}
        </p>
      </div>

      {org.billingAlert && (
        <p className="alert mt-2 text-[13px]">
          The card on this subscription is failing. Update it before the plan lapses for everyone.
        </p>
      )}

      {/* Seats are bought through Stripe, so the number here is always the
          number being billed — there is no way to grant one for free. The
          quote is shown before the button, because a company setting a budget
          line should see the arithmetic rather than meet it on an invoice. */}
      <SeatPicker org={org} floor={Math.max(members.length, 1)} />

      {/* ------------------------------------------------------- the roster */}
      <ul className="mt-4 divide-y divide-[var(--hairline)] border-t border-[var(--hairline)]">
        {members.map((m) => (
          <li key={m.userId} className="py-2">
            <div className="flex items-center justify-between gap-3">
              {/* The name is the door to their work — the visibility this tier
                  is sold on, one tap from the roster rather than a feature
                  nobody can find. */}
              <button
                onClick={() => setOpenMember(openMember === m.userId ? null : m.userId)}
                className="min-w-0 flex-1 text-left transition-colors hover:text-[var(--ink)]"
              >
                <span className="block truncate text-[14px]">{m.email || m.name || "—"}</span>
                <span className="block text-[12px] text-[var(--faint)]">
                  {m.role === "admin" ? "Administrator" : "Member"}
                  {m.userId === meId ? " · you" : " · see their work"}
                </span>
              </button>
              <button
                onClick={() => post({ remove: m.userId })}
                disabled={busy}
                className="shrink-0 text-[12px] text-[var(--faint)] transition-colors hover:text-[var(--ink)]"
              >
                Remove
              </button>
            </div>
            {openMember === m.userId && (
              <MemberWork member={m} onClose={() => setOpenMember(null)} />
            )}
          </li>
        ))}
        {pending.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-[14px] text-[var(--muted)]">{p.email}</span>
              <span className="block text-[12px] text-[var(--faint)]">Invited, not yet joined</span>
            </span>
            <button
              onClick={() => post({ revoke: p.id })}
              disabled={busy}
              className="shrink-0 text-[12px] text-[var(--faint)] transition-colors hover:text-[var(--ink)]"
            >
              Withdraw
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input value={email} onChange={(e) => setEmail(e.target.value)}
               aria-label="Invite by email" placeholder="name@company.com" className="w-56" />
        <Button variant="secondary" size="sm" disabled={busy || !email.trim()}
                onClick={async () => { if (await post({ invite: email })) setEmail(""); }}>
          Invite
        </Button>
      </div>
      {err && <p className="alert mt-2 text-[13px]">{err}</p>}
      <p className="mt-3 text-[12px] leading-relaxed text-[var(--faint)]">
        You can see the projects, tasks and calendars on the accounts you provide, and not
        change them. Everyone you invite is told this before they accept.
      </p>
    </div>
  );
}

/**
 * How many seats, at what price, before anybody is charged.
 *
 * A number and a live quote rather than a prompt() and a surprise. The floor
 * is the people already seated — offering a company the chance to buy fewer
 * seats than it has staff is offering it a way to lock somebody out, and the
 * server refuses it anyway.
 */
function SeatPicker({ org, floor }) {
  const [plan, setPlan] = useState(org.plan === "free" ? "pro" : org.plan);
  const [seats, setSeats] = useState(Math.max(org.seats || 1, floor));
  const [sending, setSending] = useState(false);
  const q = quote(plan, seats);
  const money = (n) => (n % 1 ? `$${n.toFixed(2)}` : `$${n}`);

  return (
    <div className="mt-3 rounded-lg border border-[var(--hairline)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        {["pro", "studio"].map((id) => (
          <button
            key={id}
            onClick={() => setPlan(id)}
            className={`rounded-md border px-2.5 py-1 text-[13px] transition-colors ${
              plan === id ? "border-[var(--ink)] font-medium" : "border-[var(--line)] hover:border-[var(--ink)]"
            }`}
          >
            {PLANS[id].name}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <button
            aria-label="One fewer seat"
            onClick={() => setSeats((n) => Math.max(floor, n - 1))}
            className="grid h-7 w-7 place-items-center rounded-md border border-[var(--line)] transition-colors hover:border-[var(--ink)]"
          >
            −
          </button>
          <span className="num w-10 text-center text-[15px]">{seats}</span>
          <button
            aria-label="One more seat"
            onClick={() => setSeats((n) => Math.min(500, n + 1))}
            className="grid h-7 w-7 place-items-center rounded-md border border-[var(--line)] transition-colors hover:border-[var(--ink)]"
          >
            +
          </button>
        </span>
      </div>

      <p className="mt-2 text-[15px]">
        <span className="font-medium">{money(q.total)}</span>
        <span className="text-[var(--muted)]">/month · {money(q.perSeat)} a seat</span>
      </p>
      {q.saved > 0 && (
        <p className="text-[12px] text-[var(--muted)]">
          {money(q.saved)} a month less than {seats} individual subscriptions.
        </p>
      )}
      {q.negotiable && (
        <p className="mt-1 text-[12px] text-[var(--muted)]">
          At this size the price is a conversation — buy these now and we'll sort the rest out.
        </p>
      )}
      {floor > 1 && seats === floor && (
        <p className="mt-1 text-[12px] text-[var(--faint)]">
          {floor} people hold seats, so that's the fewest you can buy.
        </p>
      )}

      <Button
        variant="primary"
        size="sm"
        className="mt-3"
        disabled={sending}
        onClick={() => {
          setSending(true);
          startCheckout(plan, { seats }).catch(() => setSending(false));
        }}
      >
        {org.plan === "free" ? `Buy ${seats} ${seats === 1 ? "seat" : "seats"}` : "Change the subscription"}
      </Button>
    </div>
  );
}

/**
 * One member's work, as their administrator sees it.
 *
 * Read through the ordinary signed-in client rather than a service-role
 * endpoint, deliberately: the row-level policy from 0013 is what decides
 * whether these rows come back, so the screen and the database agree by
 * construction. Somebody who is not an administrator — or who has just lost
 * the seat — gets an empty list from Postgres rather than a check this
 * component had to remember to make.
 *
 * Read-only, because the policy is. There is no control here to tick
 * somebody else's task off, and one would fail at the database anyway.
 */
function MemberWork({ member, onClose }) {
  const [work, setWork] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const supabase = await client();
        if (!supabase) return;
        const [projects, tasks, events] = await Promise.all([
          supabase.from("projects").select("id,name,archived")
            .eq("user_id", member.userId).is("deleted_at", null),
          supabase.from("tasks").select("id,title,done,due")
            .eq("user_id", member.userId).is("deleted_at", null)
            .order("done").limit(200),
          supabase.from("events").select("id,title,starts_at")
            .eq("user_id", member.userId).is("deleted_at", null)
            .gte("starts_at", new Date().toISOString())
            .order("starts_at").limit(5),
        ]);
        if (!live) return;
        setWork({
          projects: projects.data || [],
          tasks: tasks.data || [],
          events: events.data || [],
        });
      } catch {
        if (live) setWork({ projects: [], tasks: [], events: [] });
      }
    })();
    return () => { live = false; };
  }, [member.userId]);

  const open = work?.tasks.filter((t) => !t.done) || [];
  const done = (work?.tasks.length || 0) - open.length;
  const live = work?.projects.filter((p) => !p.archived) || [];

  return (
    <div className="mt-3 rounded-lg border border-[var(--line)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{member.email || member.name}</p>
          <p className="text-[12px] text-[var(--muted)]">
            {work
              ? `${live.length} projects · ${open.length} open · ${done} done`
              : "Reading…"}
          </p>
        </div>
        <button onClick={onClose} aria-label="Close"
                className="shrink-0 px-1 text-[var(--faint)] hover:text-[var(--ink)]">×</button>
      </div>

      {work && !live.length && !open.length && (
        <p className="mt-2 text-[13px] text-[var(--muted)]">Nothing on this account yet.</p>
      )}

      {live.length > 0 && (
        <div className="mt-3">
          <p className="label">Projects</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {live.map((p) => (
              <li key={p.id} className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[12px]">
                {p.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {open.length > 0 && (
        <div className="mt-3">
          <p className="label">Open work</p>
          <ul className="mt-1 space-y-1">
            {open.slice(0, 12).map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{t.title}</span>
                {t.due && (
                  <span className="num shrink-0 text-[11px] text-[var(--faint)]">
                    {new Date(`${t.due}T00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {open.length > 12 && (
            <p className="mt-1 text-[12px] text-[var(--faint)]">and {open.length - 12} more.</p>
          )}
        </div>
      )}

      {work?.events.length > 0 && (
        <div className="mt-3">
          <p className="label">Next up</p>
          <ul className="mt-1 space-y-1">
            {work.events.map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{e.title}</span>
                <span className="num shrink-0 text-[11px] text-[var(--faint)]">
                  {new Date(e.starts_at).toLocaleDateString([], { month: "short", day: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-[12px] text-[var(--faint)]">
        Read-only, and they have been told you can see it. Conversations with Squirrel are
        shown to nobody.
      </p>
    </div>
  );
}

/** Server errors, said the way a person would say them. */
const SAYS = {
  no_seats: "Every seat is taken. Buy another to invite one more person.",
  already_invited: "They already have an invitation waiting.",
  bad_email: "That doesn't look like an email address.",
  already_in_a_company: "This account already belongs to a company.",
  not_an_admin: "Only an administrator can do that.",
  last_admin: "You're the only administrator — make somebody else one first.",
  no_invitation: "That invitation has been withdrawn or already used.",
  fewer_seats_than_people: "That's fewer seats than people. Remove somebody first.",
};
