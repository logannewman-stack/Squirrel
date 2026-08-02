import { useEffect, useRef, useState } from "react";
import { clock } from "../lib/format";

/**
 * Full-screen focus timer. Nothing on screen but the countdown and one way out.
 *
 * On what "can't leave" actually means: no web API can block an app switch or a
 * home swipe. What the browser does allow is stacked up here — fullscreen,
 * wake lock, a trapped back button, and a confirm on close — which removes
 * every accidental exit and makes a deliberate one deliberate. Installed to the
 * home screen as a PWA there is no browser chrome either, which is as close as
 * the web gets. Genuine lockdown needs a native app (iOS Screen Time API,
 * Android kiosk mode) and is not achievable here.
 */
export default function FocusScreen({ label, remainingMs, paused, onPause, onResume, onUnfocus }) {
  const [wandered, setWandered] = useState(false);
  const wakeLock = useRef(null);

  // Fullscreen + wake lock. Both can be refused (iOS Safari has no Wake Lock,
  // and fullscreen needs a user gesture) — neither is load-bearing.
  useEffect(() => {
    const el = document.documentElement;
    el.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});

    let released = false;
    navigator.wakeLock
      ?.request("screen")
      .then((lock) => {
        if (released) lock.release().catch(() => {});
        else wakeLock.current = lock;
      })
      .catch(() => {});

    return () => {
      released = true;
      wakeLock.current?.release().catch(() => {});
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  // Trap the back button: push a state, then re-push whenever it's popped.
  useEffect(() => {
    history.pushState({ focus: true }, "");
    const onPop = () => history.pushState({ focus: true }, "");
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  // Browser-native "leave site?" confirm on close or reload.
  useEffect(() => {
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, []);

  // If they switch away we note it on return — as a fact, with no judgement.
  // The session keeps running; leaving is not failure and is never punished.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "hidden") setWandered(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex select-none flex-col items-center justify-center
                    bg-[var(--paper)] px-6 text-[var(--ink)]">
      {label && (
        <p className="mb-10 max-w-lg text-center text-lg text-[var(--muted)]">{label}</p>
      )}

      <div className="text-[22vw] font-semibold leading-none tabular-nums tracking-tighter sm:text-[16vw] md:text-[12rem]">
        {clock(remainingMs)}
      </div>

      {paused && (
        <p className="mt-6 text-sm uppercase tracking-[0.3em] text-[var(--muted)]">Paused</p>
      )}

      {wandered && !paused && (
        <p className="mt-6 text-sm text-[var(--muted)]">Welcome back. Timer kept running.</p>
      )}

      <div className="mt-16 flex flex-col items-center gap-5">
        <button
          onClick={paused ? onResume : onPause}
          className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]
                     underline-offset-8 hover:underline"
        >
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          onClick={onUnfocus}
          className="rounded-full border border-[var(--line)] px-10 py-4 text-base
                     transition-colors hover:border-[var(--ink)]"
        >
          Unfocus
        </button>
      </div>
    </div>
  );
}
