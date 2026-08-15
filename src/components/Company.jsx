import { useEffect, useState } from "react";
import { Button, Input } from "./ui";
import { client } from "../lib/supabase";
import { startCheckout, inNativeApp } from "../lib/billing";
import { PLANS, can } from "../lib/plans";
import { quote } from "../lib/seats";
import { decode } from "../lib/merge";
import { teamLoad, sayLoad, LOAD } from "../lib/team";

/**
 * Does this company's subscription include reading its people's work?
 *
 * The mirror of `org_sees_work()` in migration 0014, and only a mirror: the
 * database decides what comes back, this decides what to draw and — the part
 * that matters more — what to promise the person holding the seat. A screen
 * that offers a window Postgres will not open is a bug the customer reports;
 * a screen that promises privacy Postgres does not keep is a different kind of
 * problem entirely, so the two conditions are written to match line for line.
 */
export const seesWork = (org) =>
  can(org?.plan, "teamVisibility") &&
  (!org?.renewsAt || new Date(org.renewsAt) > new Date());

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
  // Everybody's work, in one pass. Hooks cannot live behind the four early
  // returns below, so it is asked for here and simply answers null until
  // there is a Studio company with people in it to answer about.
  const work = useTeamWork(state.members, seesWork(state.org));

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
          <span className="font-medium">{invite.org?.name || "A company"}</span> has
          offered you a seat.
        </p>
        {/* What accepting actually costs, in the only currency anybody
            hesitates over. It differs by tier, so it is read off the plan
            rather than written once and hoped over: a member of a Pro company
            warned about a window that does not exist would decline a seat for
            nothing, and one on Studio who was not warned has been enrolled in
            something without being asked. */}
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
          {seesWork(invite.org)
            ? <>Taking it puts this account on their plan, and lets their administrators see the
                projects, tasks and calendar on it — the way a company device works. Your
                conversations with Squirrel stay private, and they cannot change your work.</>
            : <>Taking it puts this account on their plan. They can see that you hold a seat,
                and nothing that is on it — not your projects, not your tasks, not your
                calendar.</>}
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
  const visible = seesWork(org);

  if (role !== "admin") {
    return (
      <div className="text-[15px]">
        <p>This account is part of <span className="font-medium">{org.name}</span>.</p>
        <p className="mt-1 text-[13px] text-[var(--muted)]">
          On {PLANS[org.plan]?.name || org.plan}, paid for by your company.
        </p>
        {/* Said here, on the screen a member can reach at any time, and not
            only in the sentence they read once while accepting. Visibility
            somebody has to remember being told about is visibility they will
            eventually be surprised by, and the surprise is the whole harm. */}
        <div className="mt-3 rounded-lg border border-[var(--line)] p-3 text-[13px] leading-relaxed">
          {visible ? (
            <>
              <p className="font-medium">What your company can see</p>
              <p className="mt-1 text-[var(--muted)]">
                Administrators at {org.name} can read the projects, tasks and calendar on this
                account. They cannot change any of it, and they cannot read your conversations
                with Squirrel — those are shown to nobody.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">What your company can see</p>
              <p className="mt-1 text-[var(--muted)]">
                That you hold a seat, and nothing on it. Your projects, tasks, calendar and
                conversations are yours alone.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  /* --------------------------------------------------------------- admin */
  const free = Math.max(0, (org.seats || 0) - (seats?.taken || 0));

  // The roster, ordered by who needs looking at. Alphabetical is the ordering
  // that treats a person about to miss three deadlines the same as everybody
  // else, which is precisely the failure this screen is sold to prevent — so
  // load leads, and only falls back to the order the seats were filled in
  // when there is no load to read.
  const team = teamLoad(
    members.map((m) => ({ id: m.userId, name: shortName(m), tasks: work?.[m.userId]?.tasks || [] })),
  );
  const byId = Object.fromEntries(members.map((m) => [m.userId, m]));
  const roster = visible
    ? team.rows.map((r) => ({ member: byId[r.id], load: r.load }))
    : members.map((m) => ({ member: m, load: null }));
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

      {/* The one sentence this screen exists to say, when there is anybody to
          say it about. A company of one is a company with nothing to report. */}
      {members.length > 1 && (
        visible
          ? <p className="mt-4 text-[15px]">{team.headline}</p>
          : <VisibilityOffer onUpgrade={onUpgrade} count={members.length} />
      )}

      {/* ------------------------------------------------------- the roster */}
      <ul className="mt-3 divide-y divide-[var(--hairline)] border-t border-[var(--hairline)]">
        {roster.map(({ member: m, load }) => (
          <li key={m.userId} className="py-2">
            <div className="flex items-center justify-between gap-3">
              {/* The name is the door to their work — the visibility this tier
                  is sold on, one tap from the roster rather than a feature
                  nobody can find. Below Studio it is not a door, so it is not
                  drawn as one: no cursor, no hover, no promise. */}
              {visible ? (
                <button
                  onClick={() => setOpenMember(openMember === m.userId ? null : m.userId)}
                  className="min-w-0 flex-1 text-left transition-colors hover:text-[var(--ink)]"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate text-[14px]">{m.email || m.name || "—"}</span>
                    {load && load.state !== "empty" && load.state !== "clear" && (
                      <Chip state={load.state} />
                    )}
                  </span>
                  <span className="block truncate text-[12px] text-[var(--faint)]">
                    {sayLoad(load)}
                  </span>
                </button>
              ) : (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{m.email || m.name || "—"}</span>
                  <span className="block text-[12px] text-[var(--faint)]">
                    {m.role === "admin" ? "Administrator" : "Member"}
                    {m.userId === meId ? " · you" : ""}
                  </span>
                </span>
              )}
              <button
                onClick={() => post({ remove: m.userId })}
                disabled={busy}
                className="shrink-0 text-[12px] text-[var(--faint)] transition-colors hover:text-[var(--ink)]"
              >
                Remove
              </button>
            </div>
            {visible && openMember === m.userId && (
              <MemberWork member={m} work={work?.[m.userId]} load={load}
                          onClose={() => setOpenMember(null)} />
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
        {visible
          ? <>You can see the projects, tasks and calendars on the accounts you provide, and not
              change them. Their conversations with Squirrel are shown to nobody. Everyone you
              invite is told all of this before they accept.</>
          : <>You can see who holds a seat, and nothing on it. Everyone you invite is told
              the same.</>}
      </p>
    </div>
  );
}

/**
 * The name to put in a sentence.
 *
 * A headline reading "cass@acme.com has more due this week than the week
 * holds" is a machine talking; the same line with a person's name in it is a
 * colleague telling you something. Most companies invite by email long before
 * anybody fills in a full name, so the address gets trimmed to the part a
 * person would actually say out loud.
 */
const shortName = (m) => m?.name || (m?.email || "").split("@")[0] || "Somebody";

/**
 * Every seat-holder's work, read once.
 *
 * Through the ordinary signed-in client rather than a service-role endpoint,
 * deliberately: the policy from 0013 and its Studio condition from 0014 are
 * what decide whether these rows come back, so the screen and the database
 * agree by construction. An administrator whose company drops to Pro, or whose
 * card fails, or who is removed between one render and the next, gets an empty
 * result from Postgres rather than a check this component had to remember.
 *
 * One query per kind rather than one per person: a forty-seat company would
 * otherwise open a hundred and twenty requests to draw one screen.
 */
function useTeamWork(members, enabled) {
  const [work, setWork] = useState(null);
  // The dependency is the *contents* of the roster, not the array — a new
  // array with the same people in it arrives on every poll, and re-fetching
  // everybody's work each time is how a quiet screen becomes a busy one.
  const ids = (members || []).map((m) => m.userId).sort().join(",");

  useEffect(() => {
    if (!enabled || !ids) { setWork(null); return undefined; }
    let live = true;
    (async () => {
      try {
        const supabase = await client();
        if (!supabase || !live) return;
        const list = ids.split(",");
        const [projects, tasks, events] = await Promise.all([
          supabase.from("projects").select("*").in("user_id", list).is("deleted_at", null),
          supabase.from("tasks").select("*").in("user_id", list).is("deleted_at", null),
          supabase.from("events").select("*").in("user_id", list).is("deleted_at", null)
            .gte("starts_at", new Date().toISOString()).order("starts_at"),
        ]);
        if (!live) return;

        // Everybody gets a bucket, including the people who came back with
        // nothing — an absent key and an empty one mean "still loading" and
        // "genuinely empty", and the whole team screen turns on the difference.
        const by = Object.fromEntries(list.map((id) => [id, { projects: [], tasks: [], events: [] }]));
        const group = (kind, rows) => {
          const app = decode(kind, rows || []);
          (rows || []).forEach((row, i) => by[row.user_id]?.[kind].push(app[i]));
        };
        group("projects", projects.data);
        group("tasks", tasks.data);
        group("events", events.data);
        setWork(by);
      } catch {
        // A failed read is not "nobody has any work" — that would report a
        // calm, empty team at exactly the moment the screen knows nothing.
        if (live) setWork(null);
      }
    })();
    return () => { live = false; };
  }, [ids, enabled]);

  return work;
}

/** A person's state as a word, coloured only when it is worth a colour. */
function Chip({ state }) {
  const it = LOAD[state];
  if (!it) return null;
  const tone = it.tone === "alert"
    ? "border-[var(--alert,#b4453a)] text-[var(--alert,#b4453a)]"
    : it.tone === "warn"
      ? "border-[var(--ink)] text-[var(--ink)]"
      : "border-[var(--hairline)] text-[var(--faint)]";
  return (
    <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] uppercase tracking-wide ${tone}`}>
      {it.label}
    </span>
  );
}

/**
 * What the tier above this one would show, said as the thing it would show.
 *
 * Not "upgrade for team visibility". A company with nine people on it already
 * knows how many people it has; what it does not know is which of them is
 * about to miss something, and naming that is both the honest description of
 * the feature and the only version of this sentence anybody acts on.
 */
function VisibilityOffer({ onUpgrade, count }) {
  return (
    <div className="mt-4 rounded-lg border border-[var(--line)] p-3">
      <p className="text-[14px]">See what your team is carrying</p>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted)]">
        Studio shows the work on every seat you pay for — who has more due this week than the
        week holds, what is already late, and whose account has nothing on it yet. Right now
        you can see that {count} people hold seats, and nothing else.
      </p>
      <Button variant="secondary" size="sm" className="mt-3"
              onClick={() => onUpgrade?.("Seeing your team's work is on Studio")}>
        See what Studio adds
      </Button>
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
 *
 * ## Not sold inside the iOS app, and it cannot be
 *
 * Seats are a quantity-based subscription: one company, one invoice, twelve
 * people. In-App Purchase has no such concept — a StoreKit subscription
 * belongs to the Apple ID that bought it, and there is no way to express
 * "twelve of these, billed to the company, assignable to staff who each have
 * their own Apple ID". So this cannot be moved to IAP, and selling it through
 * Stripe inside the app is Guideline 3.1.1.
 *
 * The remaining honest option is the one every business tool takes: the app
 * does not sell it. An administrator on a phone is told where it is bought and
 * everything else on this screen — the roster, invitations, seats already
 * paid for, the team's load — keeps working exactly as it does on the web.
 */
function SeatPicker({ org, floor }) {
  const [plan, setPlan] = useState(org.plan === "free" ? "pro" : org.plan);
  const [seats, setSeats] = useState(Math.max(org.seats || 1, floor));
  const [sending, setSending] = useState(false);
  const q = quote(plan, seats);

  if (inNativeApp()) {
    return (
      <div className="mt-3 rounded-lg border border-[var(--hairline)] p-3 text-[13px] leading-relaxed">
        <p className="font-medium">Seats are bought on the web</p>
        <p className="mt-1 text-[var(--muted)]">
          {org.plan === "free"
            ? "A company subscription is one invoice for the whole team, so it's arranged at squirrel on a computer rather than through this app."
            : `${org.seats} ${org.seats === 1 ? "seat" : "seats"} on ${PLANS[org.plan]?.name || org.plan}. Add or remove seats from the same place you bought them.`}
          {" "}Everything else here works normally.
        </p>
      </div>
    );
  }
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
 * Handed the rows rather than fetching them, because the roster above already
 * read everybody's — a panel that re-queried on open would double the traffic
 * for data sitting in memory, and would show a spinner over numbers already on
 * the screen behind it.
 *
 * What is actually read still comes from the ordinary signed-in client, one
 * level up, so the policies of 0013 and 0014 are what decide. An administrator
 * whose company is on Pro, or has stopped paying, or who was removed a moment
 * ago, gets nothing from Postgres rather than a check somebody had to remember
 * to write here.
 *
 * Read-only, because the policy is. There is no control to tick somebody
 * else's task off, and one would fail at the database anyway.
 */
function MemberWork({ member, work, load, onClose }) {
  const open = work?.tasks.filter((t) => !t.done) || [];
  const done = (work?.tasks.length || 0) - open.length;
  const live = work?.projects.filter((p) => !p.archived) || [];
  // The late work first, and by name. "Three overdue" tells a manager to go
  // and ask; the three titles let them decide whether it matters before they
  // interrupt anybody.
  const late = load?.late || [];

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

      {late.length > 0 && (
        <div className="mt-3">
          <p className="label">Already late</p>
          <ul className="mt-1 space-y-1">
            {late.slice(0, 6).map((t) => (
              <li key={t.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{t.title}</span>
                <span className="num shrink-0 text-[11px] text-[var(--faint)]">
                  {new Date(`${t.due}T00:00`).toLocaleDateString([], { month: "short", day: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
          {late.length > 6 && (
            <p className="mt-1 text-[12px] text-[var(--faint)]">and {late.length - 6} more.</p>
          )}
        </div>
      )}

      {load && load.state !== "empty" && (
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--faint)]">
          {sayLoad(load)} — measured against a standard working week, not{" "}
          {member.name ? `${member.name}'s` : "their"} own hours, which stay on their device.
        </p>
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
            {work.events.slice(0, 5).map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{e.title}</span>
                <span className="num shrink-0 text-[11px] text-[var(--faint)]">
                  {new Date(e.start).toLocaleDateString([], { month: "short", day: "numeric" })}
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
