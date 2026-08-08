/**
 * Privacy and terms.
 *
 * Stripe requires both before it will let an account take live payments, and
 * Apple rejects a submission without them. They also have to be reachable
 * without an account — a policy you can only read after signing up is not a
 * policy anybody can consent to.
 *
 * Written to be true about this app specifically rather than assembled from a
 * generator. A policy that describes data collection this app does not do is
 * worse than none: it is a public statement nobody can verify, and the first
 * person who checks it against the behaviour finds a discrepancy.
 *
 * Not legal advice, and it says so. A lawyer should read it before launch —
 * but a lawyer reading an accurate description of what the software actually
 * does is a cheap review, and reading a template is an expensive one.
 */

const UPDATED = "8 August 2026";

export default function Legal({ page = "privacy", onBack }) {
  const Doc = page === "terms" ? Terms : Privacy;
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      {onBack && (
        <button
          onClick={onBack}
          className="text-sm text-[var(--muted)] underline-offset-4 hover:underline"
        >
          ← Back
        </button>
      )}
      <article className="legal mt-4">
        <Doc />
        <p className="mt-10 text-xs text-[var(--faint)]">
          Last updated {UPDATED}. This document describes how Squirrel actually
          behaves; it is not legal advice.
        </p>
      </article>
    </div>
  );
}

function H1({ children }) {
  return <h1 className="mb-2 text-3xl font-semibold tracking-tight">{children}</h1>;
}
function H2({ children }) {
  return <h2 className="mb-2 mt-8 text-base font-semibold">{children}</h2>;
}
function P({ children }) {
  return <p className="mb-3 text-sm leading-relaxed text-[var(--muted)]">{children}</p>;
}
function L({ children }) {
  return (
    <ul className="mb-3 flex list-none flex-col gap-1.5 pl-0">
      {children}
    </ul>
  );
}
function Li({ children }) {
  return (
    <li className="relative pl-5 text-sm leading-relaxed text-[var(--muted)]">
      <span aria-hidden className="absolute left-1 top-[0.6em] h-1.5 w-1.5 rotate-45 rounded-[1px] bg-[var(--line)]" />
      {children}
    </li>
  );
}

function Privacy() {
  return (
    <>
      <H1>Privacy</H1>
      <P>
        Squirrel is a planner. The short version: it runs on your device, it
        keeps as little as it can, it never sells anything, and you can take it
        all back or delete all of it whenever you like.
      </P>

      <H2>Without an account</H2>
      <P>
        Squirrel works fully signed out. In that state your projects, tasks,
        events, focus history and the assistant conversation live in your own
        browser or app and are sent nowhere. We cannot see them, because they
        never leave the device. Clearing the app's data erases them.
      </P>

      <H2>With an account</H2>
      <P>
        Signing in adds sync across your devices. We then store, on our
        infrastructure:
      </P>
      <L>
        <Li>your email address, so you can sign in and we can contact you about the service;</Li>
        <Li>your projects, tasks, events, focus sessions and assistant conversation, so they follow you between devices;</Li>
        <Li>your subscription status and renewal date.</Li>
      </L>
      <P>
        Card details are never sent to us and never stored by us. Payment is
        handled entirely by Stripe, or by Apple when you subscribe inside the
        iOS or macOS app.
      </P>

      <H2>The assistant</H2>
      <P>
        Squirrel answers on your device. Ordinary requests involve no network
        call at all, which is why she works offline and costs nothing per
        message.
      </P>
      <P>
        When she cannot understand a request and you have turned on the optional
        boost, that single message is sent to a language-model provider to be
        reworded, along with a short summary of your next ten events and tasks
        so the rewording makes sense. Nothing else goes with it, messages she
        already understands are never sent, and the setting is off unless you
        turn it on. The reworded request comes back and runs down the ordinary
        path on your device.
      </P>

      <H2>Calendars</H2>
      <P>
        If you connect Google Calendar we store a token that lets us read and
        write events on the calendar you chose, and a record of which of your
        events corresponds to which of theirs. The token is held on our servers
        and is never readable by the app in your browser. Disconnecting revokes
        it with Google and deletes it here; your events stay, because they are
        yours.
      </P>
      <P>
        Apple Calendar, where supported, is read on your own device by the
        operating system. Nothing from it passes through us.
      </P>

      <H2>Email</H2>
      <P>
        When you send a meeting invitation, the recipients you entered receive
        it from our sending domain with your address as the reply-to. We keep a
        record of which invitations were sent, for which meeting, so you can see
        whether one went out.
      </P>

      <H2>What we do not do</H2>
      <L>
        <Li>We do not sell or rent your data to anyone, for any purpose.</Li>
        <Li>We do not use your tasks, events or conversations to train models.</Li>
        <Li>We do not run advertising or third-party trackers inside the app.</Li>
      </L>

      <H2>Your data, back or gone</H2>
      <P>
        You can delete your account from inside the app, in Settings. It removes
        everything above, cancels any subscription immediately, and disconnects
        any calendars. It is not recoverable, which is the point of it.
      </P>

      <H2>Children</H2>
      <P>
        Squirrel is not directed at children under 13 and we do not knowingly
        collect their information.
      </P>

      <H2>Contact</H2>
      <P>
        Questions, requests for a copy of your data, or anything else:{" "}
        <a className="underline underline-offset-2" href="mailto:hello@squirrelll.com">
          hello@squirrelll.com
        </a>.
      </P>
    </>
  );
}

function Terms() {
  return (
    <>
      <H1>Terms of service</H1>
      <P>
        By using Squirrel you agree to these terms. They are written to be read
        rather than survived.
      </P>

      <H2>The service</H2>
      <P>
        Squirrel is a planner with a built-in assistant. We provide it as it is
        and work to keep it running, but we do not promise it will be available
        without interruption, and it is not a system of record for anything you
        cannot afford to lose. Keep your own copy of anything critical.
      </P>

      <H2>Your account</H2>
      <P>
        You are responsible for what happens under your account and for keeping
        access to your email secure. Do not use Squirrel to break the law, to
        send unsolicited bulk mail through the invitation feature, or to
        interfere with the service for anyone else. We may suspend an account
        doing any of those.
      </P>

      <H2>Your content is yours</H2>
      <P>
        Your projects, tasks, events and conversations belong to you. We claim
        no ownership of them. We store and transmit them only to provide the
        service to you.
      </P>

      <H2>Paying</H2>
      <L>
        <Li>The free tier is not a trial. It keeps working.</Li>
        <Li>Paid plans are billed monthly or yearly in advance and renew automatically until cancelled.</Li>
        <Li>Cancel any time. Access continues to the end of the period you have already paid for; we do not pro-rate a partial period.</Li>
        <Li>Prices can change, and we will tell you before a change affects a renewal.</Li>
      </L>
      <P>
        Subscriptions bought inside the iOS or macOS app are billed by Apple and
        managed in your Apple account, under Apple's terms. Subscriptions bought
        on the web are billed by Stripe and managed from the billing portal in
        Settings.
      </P>

      <H2>Refunds</H2>
      <P>
        If Squirrel has not worked for you, write to us and we will sort it out.
        Purchases made through Apple are refunded by Apple.
      </P>

      <H2>The assistant</H2>
      <P>
        The assistant changes your calendar and tasks on your instruction. It
        reads changes back before making them unless you turn that off, and
        every change can be undone. It can still misunderstand you. Check
        anything that matters, and treat what it schedules as a draft of your
        day rather than an authority on it.
      </P>

      <H2>Ending it</H2>
      <P>
        You can stop using Squirrel and delete your account at any time from
        Settings. We may end an account that breaks these terms, and will say
        why where we can.
      </P>

      <H2>Liability</H2>
      <P>
        To the extent the law allows, Squirrel is provided without warranties,
        and our total liability to you is limited to what you have paid us in
        the twelve months before the claim. Nothing here limits liability that
        cannot legally be limited.
      </P>

      <H2>Contact</H2>
      <P>
        <a className="underline underline-offset-2" href="mailto:hello@squirrelll.com">
          hello@squirrelll.com
        </a>
      </P>
    </>
  );
}
