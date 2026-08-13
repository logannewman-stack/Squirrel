import { useEffect, useState } from "react";
import { setSetting, totals, resetAll } from "../lib/store";
import Identity from "./Identity";
import Account from "./Account";
import Reminders from "./Reminders";
import WorkingHours from "./WorkingHours";
import VoiceSettings from "./VoiceSettings";
import Misses from "./Misses";
import Billing from "./Billing";
import Usage from "./Usage";
import Calendars from "./Calendars";
import SetupCheck from "./SetupCheck";
import Owner from "./Owner";
import Managed from "./Managed";
import Company from "./Company";
import DeleteAccount from "./DeleteAccount";
import Appearance from "./Appearance";
import Backup from "./Backup";
import BoostCheck from "./BoostCheck";
import Shortcuts from "./Shortcuts";
import { Group, NavRow, SwitchRow, ValueRow, PanelRow, groupId } from "./ui";
import { configured as canSync } from "../lib/supabase";
import { addressOf } from "../lib/nlu/voice";
import { PLANS } from "../lib/plans";
import { voiceSettings } from "../lib/speech";
import { readTheme } from "../lib/theme";
import { duration } from "../lib/format";
import { hoursOf, sayHour } from "../lib/hours";
import { findSettings } from "../lib/settingsIndex";
import { useIsDesktop } from "../hooks/useMediaQuery";

/**
 * Settings, in the shape iOS gives this screen.
 *
 * It was thirteen sections stacked in one column — three and a half screens of
 * scroll, every heading the same weight, the plan next to the honorific next to
 * the deployment diagnostics. Grouping it into five helped; this goes the rest
 * of the way, into the grouped inset list, which is the single most recognisable
 * layout on the platform and the difference between a settings screen that
 * reads as native and one that reads as a website in an app bundle.
 *
 * Two consequences worth naming, because they are the point rather than side
 * effects:
 *
 * **Every answer is visible without opening anything.** A list row carries its
 * current value on the right — the plan, the working hours, the name she uses,
 * which voice. Ten settings show ten answers on one screen, so the common case
 * is reading rather than navigating.
 *
 * **The explanations moved to footers.** A footer is a sentence under a group,
 * not a paragraph above a control, and that constraint did more for the length
 * of this page than the grouping did. Anything that would not fit in one is a
 * setting that needs a better name.
 *
 * A phone drills down and a desktop uses a rail, which is not two designs but
 * the same list under two navigation models — the platform convention on each.
 */

const GROUPS = [
  { id: "account", name: "Account" },
  { id: "you", name: "You" },
  { id: "assistant", name: "Assistant" },
  { id: "connections", name: "Connections" },
  { id: "data", name: "Data" },
];

export default function Settings({ state, onBack, onLegal, onUpgrade, onKeyboard }) {
  const desktop = useIsDesktop();
  // Null is the index. A desktop never shows it — the rail is always there, so
  // there is nothing to go back to and no state to be in.
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState("");
  // Which group a search result asked for, so arriving somewhere is arriving at
  // the thing rather than at the top of a section containing it.
  const [found, setFound] = useState(null);
  const group = desktop ? (open ?? "account") : open;
  const hits = findSettings(query);

  /**
   * Land on the group, not near it.
   *
   * The panel has to render before its groups exist to scroll to, so this runs
   * after the commit that opened the section. The highlight fades on its own —
   * it is there to say "this one", and a marker that stays is a marker that has
   * to be dismissed.
   */
  useEffect(() => {
    if (!found) return;
    const el = document.getElementById(groupId(found));
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("found");
      setTimeout(() => el.classList.remove("found"), 1800);
    }
    setFound(null);
  }, [found]);

  const confirms = state.settings?.confirm !== false;
  // Off unless explicitly turned on. It is the only setting in the app that can
  // cost money, so the default has to be the free one.
  const fallback = state.settings?.fallback === true;
  const t = totals(state.sessions);
  const voice = voiceSettings(state.settings);
  const hours = hoursOf(state.settings);
  const plan = PLANS[state.plan] ?? PLANS.free;
  const who = addressOf(state.settings?.identity || {});
  const theme = readTheme();
  // Baked in by Vite. Absent under a bare `vite dev` of an older config, so it
  // is read defensively rather than allowed to throw on a settings screen.
  const version = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "—";

  /** The answer a row shows on its right, so the list reads without opening. */
  const summary = {
    account: state.settings?.email || "Not signed in",
    you: who || "No name",
    assistant: confirms ? "Confirms first" : "Acts straight away",
    // Siri and reminders are here whether or not there is a backend, so the
    // old "Not available" was answering for the whole section on behalf of one
    // row in it.
    connections: canSync ? "Calendars, Siri" : "Siri, reminders",
    data: `${state.projects.length + state.tasks.length + state.events.length} items`,
  };

  const panels = {
    account: (
      <>
        <Group header="Account" footer={
          state.settings?.email
            ? "Signed in. Your data syncs between devices and is kept on each one so it works offline."
            : "Everything works without an account — that's the free tier, not a trial. Sign in to keep your week on more than one device."
        }>
          <PanelRow><Account email={state.settings?.email || null} /></PanelRow>
        </Group>
        <Group header="Plan" footer="Billed monthly, cancel any time. The free tier keeps working underneath.">
          <PanelRow><Usage state={state} onUpgrade={onUpgrade} /></PanelRow>
          {canSync && <PanelRow><Billing email={state.settings?.email || null} /></PanelRow>}
        </Group>
      </>
    ),

    you: (
      <>
        <Group header="How she addresses you" footer="Used when she greets you, and when she reads a reply aloud.">
          <PanelRow><Identity value={state.settings?.identity || {}} compact /></PanelRow>
        </Group>
        <Group header="Your working day" footer="Every deadline in the app is measured against this — whether work fits, what counts as urgent, when to stop scheduling.">
          <PanelRow><WorkingHours state={state} /></PanelRow>
        </Group>
        <Group header="Appearance" footer="System follows your Mac or phone, including when it changes at sunset.">
          <PanelRow><Appearance /></PanelRow>
        </Group>
        <Group
          header="Keyboard"
          footer="Every shortcut the app answers to. None of them fire while you're typing."
        >
          <NavRow label="Shortcuts" value="?" onPress={onKeyboard} />
        </Group>
        <Group
          header="The introduction"
          footer="The screens from your first run. Nothing you've made is touched — it walks the same setup again and hands you back here."
        >
          <NavRow
            label="Play it again"
            onPress={() => {
              // Only the flag. Wiping anything would make "show me that again"
              // a destructive act, which is not what those words mean.
              setSetting("onboarded", false);
              onBack?.();
            }}
          />
        </Group>
      </>
    ),

    assistant: (
      <>
        <Group
          header="Before she acts"
          footer="She reads every change back before making it. Turn this off and she acts straight away — faster, and you'll occasionally correct her afterwards."
        >
          <SwitchRow
            label="Confirm before changing anything"
            on={confirms}
            onChange={() => setSetting("confirm", !confirms)}
          />
        </Group>
        <Group header="Voice" footer="She runs on this device — no key, no per-message cost, and she answers offline.">
          <PanelRow><VoiceSettings state={state} onUpgrade={onUpgrade} /></PanelRow>
        </Group>
        {canSync && (
          <Group
            header="Boost"
/* The whole truth: the rewording request carries context, and a privacy
   sentence that undersells what leaves the device is worse than none. */
            footer="When she can't parse something, that message is sent to be reworded — along with the names of your next few events and open tasks, which is what makes the rewording accurate. Then it runs through the ordinary path: same confirmation, same undo. Messages she already understands never leave the device."
          >
            <SwitchRow
              label="Give her a boost when she gets stuck"
              on={fallback}
              onChange={() => setSetting("fallback", !fallback)}
            />
            {/* A failed boost is invisible by design — the message falls back
                to the rules and she says she didn't catch it. Which means a
                key with a typo in it looks identical to a working one, for
                ever. This is the only way to tell them apart. */}
            <PanelRow><BoostCheck /></PanelRow>
          </Group>
        )}
        <Group
          header="End of the day"
          footer="Once your working day is over, on a screen you already have open: what got finished, and what to do about anything that didn't. Never twice, and never on a day with nothing in it."
        >
          <SwitchRow
            label="Look back at the end of the day"
            on={state.settings?.review !== false}
            onChange={() => setSetting("review", state.settings?.review === false)}
          />
        </Group>
        <Group
          header="What she missed"
          footer="Every message she couldn't act on, so the gaps are a list rather than a feeling."
        >
          <PanelRow><Misses /></PanelRow>
        </Group>
      </>
    ),

    connections: (
      <>
        {/* First, because it is the one thing here iOS will never mention on
            its own. The phrases are registered at install and surfaced by the
            system nowhere, so an app either teaches them or ships a voice
            feature nobody finds. */}
        <Group
          header="Siri & Shortcuts"
          footer="Say any of these to Siri, or put them on the Action button. Anything that changes your calendar opens the app first, so you still see it read back."
        >
          <PanelRow><Shortcuts /></PanelRow>
        </Group>
        <Group
          header="Calendars"
          footer={canSync
            ? "Connect Google and the two stay in step, both ways. Apple Calendar syncs in the iPhone and Mac apps — Apple publishes no way for a website to reach it."
            : "Calendar sync needs a backend, and this build doesn't have one configured."}
        >
          {canSync ? (
            <PanelRow>
              <Calendars plan={state.plan} email={state.settings?.email || null} onUpgrade={onUpgrade} />
            </PanelRow>
          ) : (
            <PanelRow><p className="text-[15px] text-[var(--muted)]">Not available on this build.</p></PanelRow>
          )}
        </Group>
        <Group header="Reminders" footer="Nudges before what's next, on this device.">
          <PanelRow><Reminders state={state} /></PanelRow>
        </Group>
      </>
    ),

    data: (
      <>
        {/* Renders nothing on a personal account. On a company one it says so
            before anything else on this screen, because somebody reading
            "Stored here" deserves to know who else can read it. */}
        {canSync && (
          <Group
            header="Your company"
            footer="One subscription, a seat each, one invoice. Administrators can see the work on the accounts they provide — and everyone invited is told so before they accept."
          >
            <PanelRow><Managed /></PanelRow>
            <PanelRow><Company onUpgrade={onUpgrade} /></PanelRow>
          </Group>
        )}
        <Group
          header="Stored here"
          footer={state.settings?.email
            ? "Synced to your account and kept on this device, so it works offline."
            : "All of it lives in this browser. Clearing site data erases it, and it doesn't sync between devices."}
        >
          <PanelRow>
            <p className="text-[15px] text-[var(--muted)]">
              {state.projects.length} projects · {state.tasks.length} tasks ·{" "}
              {state.events.length} events · {t.count} sessions · {duration(t.focusedMs)} focused.
            </p>
          </PanelRow>
          <NavRow
            label="Erase everything on this device"
            danger
            onPress={() => {
              if (confirm("Erase all projects, tasks, and sessions? This cannot be undone.")) resetAll();
            }}
          />
        </Group>

        {/* The counterpart to erasing, and the answer to the one honest
            objection to keeping everything on the device: what happens when
            you get a new phone. */}
        <Group
          header="A copy of everything"
          footer="One file with your projects, tasks, meetings, focus history and settings in it. Yours to keep — restore it on a new phone, or just hold on to it."
        >
          <PanelRow><Backup /></PanelRow>
        </Group>

        {/* Erasing clears this device. Deleting removes the account itself,
            everywhere — a different thing, so it is said separately and asks
            for more than a tap. */}
        <Group header="Account" footer="Deleting removes the account and everything in it, on every device. There is no undo.">
          <PanelRow><DeleteAccount email={state.settings?.email || null} /></PanelRow>
        </Group>

        {/* The founder's console. Renders nothing at all unless the server
            recognises this account as an owner, so a customer never sees a
            heading, a spinner, or a hint that it exists. */}
        {canSync && (
          <Group
            header="Your people"
            footer="Accounts and billing across every signed-in device. Never anybody's tasks, projects, or calendar."
          >
            <PanelRow><Owner /></PanelRow>
          </Group>
        )}

        <Group header="This build" footer="Only whether a key is set, never any part of its value.">
          <ValueRow label="Version" value={version} />
          <PanelRow><SetupCheck /></PanelRow>
        </Group>

        <Group header="Legal">
          <NavRow label="Privacy" onPress={() => onLegal?.("privacy")} />
          <NavRow label="Terms of service" onPress={() => onLegal?.("terms")} />
        </Group>
      </>
    ),
  };

  const title = group ? GROUPS.find((g) => g.id === group)?.name : "Settings";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      {/* One bar, two jobs. On a phone it goes back a level at a time, the way
          a pushed screen does; on a desktop there are no levels to go back
          through, so it leaves settings entirely. */}
      <button
        onClick={() => (!desktop && group ? setOpen(null) : onBack())}
        className="-ml-1 flex items-center gap-1 px-1 py-1 text-[15px] text-[var(--muted)]
                   transition-colors hover:text-[var(--ink)]"
      >
        <svg viewBox="0 0 24 24" aria-hidden className="h-[18px] w-[18px] fill-none stroke-current stroke-[2.2]">
          <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {!desktop && group ? "Settings" : "Back"}
      </button>

      <h1 className="mb-4 mt-3 text-[34px] font-bold leading-tight tracking-[-0.02em]">
        {desktop ? "Settings" : title}
      </h1>

      {/* Under the title, where iOS puts it. On a phone it belongs to the index
          only — once you have pushed into a section there is one screen of
          rows in front of you and nothing to search. A desktop keeps its rail
          visible the whole time, so the field stays too. */}
      {(desktop || !group) && (
        <div className="relative mb-6">
          <svg viewBox="0 0 24 24" aria-hidden
               className="pointer-events-none absolute left-3.5 top-1/2 h-[17px] w-[17px] -translate-y-1/2
                          fill-none stroke-[var(--faint)] stroke-[2.2]">
            <circle cx="11" cy="11" r="7" />
            <path d="M16.5 16.5L21 21" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            className="h-[38px] w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] pl-10 pr-3
                       text-[15px] outline-none transition-colors placeholder:text-[var(--faint)]
                       focus:border-[var(--ink)]"
          />
        </div>
      )}

      {query.trim() ? (
        /* Results stand in for the whole screen rather than sitting above it.
           A list of matches with the untouched settings still below is two
           things to read at the moment somebody has already told you exactly
           what they were looking for. */
        hits.length ? (
          <Group footer="Tap one to go straight to it.">
            {hits.map((h) => (
              <NavRow
                key={`${h.group}:${h.header}`}
                label={h.title}
                value={h.section}
                onPress={() => {
                  setOpen(h.group);
                  setQuery("");
                  setFound(h.header);
                }}
              />
            ))}
          </Group>
        ) : (
          <p className="px-4 py-8 text-center text-[15px] text-[var(--muted)]">
            Nothing here matches “{query.trim()}”.
          </p>
        )
      ) : desktop ? (
        <div className="grid grid-cols-[13rem_1fr] gap-8">
          <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                onClick={() => setOpen(g.id)}
                aria-current={g.id === group}
                className={`rounded-lg px-3.5 py-2 text-left text-[15px] transition-colors ${
                  g.id === group
                    ? "bg-[var(--hover)] font-medium text-[var(--ink)]"
                    : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                }`}
              >
                {g.name}
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-col gap-7">{panels[group]}</div>
        </div>
      ) : group ? (
        <div className="flex flex-col gap-7">{panels[group]}</div>
      ) : (
        /* The index. Every row carries its own answer, so the common visit is
           a glance rather than a navigation. */
        <Group>
          {GROUPS.map((g) => (
            <NavRow key={g.id} label={g.name} value={summary[g.id]} onPress={() => setOpen(g.id)} />
          ))}
        </Group>
      )}

      {/* A quiet standing summary under the index, the way iOS puts the account
          and the device at the top of its own. Only where there is nothing else
          on screen to read. */}
      {!desktop && !group && !query.trim() && (
        <Group className="mt-7" header="At a glance"
               footer="Tap any section above to change these.">
          <NavRow label="Plan" value={plan.name} onPress={() => setOpen("account")} />
          <NavRow
            label="Working day"
            value={`${sayHour(hours.start)} – ${sayHour(hours.end)}`}
            onPress={() => setOpen("you")}
          />
          <NavRow label="Appearance" value={theme === "system" ? "System" : theme === "dark" ? "Dark" : "Light"} onPress={() => setOpen("you")} />
          <NavRow label="Voice" value={voice.speak ? "On" : "Off"} onPress={() => setOpen("assistant")} />
        </Group>
      )}
    </div>
  );
}
