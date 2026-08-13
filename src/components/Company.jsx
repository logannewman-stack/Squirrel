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

  const token = async () => {
    const supabase = await client();
    const { data } = (await supabase?.auth.getSession()) ?? {};
    return data?.session?.access_token || null;
  };

  const load = async () => {
    try {
      const t = await token();
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
          <li key={m.userId} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="block truncate text-[14px]">{m.email || m.name || "—"}</span>
              <span className="block text-[12px] text-[var(--faint)]">
                {m.role === "admin" ? "Administrator" : "Member"}
              </span>
            </span>
            <button
              onClick={() => post({ remove: m.userId })}
              disabled={busy}
              className="shrink-0 text-[12px] text-[var(--faint)] transition-colors hover:text-[var(--ink)]"
            >
              Remove
            </button>
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
