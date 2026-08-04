export function clock(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Human duration: "45m", "1h 20m", "—".
 *
 * Zero is an em dash, not "under a minute". A dash reads as "none"; a sentence
 * where a figure belongs reads as a bug, and it was appearing in four places
 * on the dashboard at once.
 */
export function duration(ms, zero = "—") {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return zero;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Money at the scale this app deals in: "$40M", "$6.5M", "$850k".
 *
 * The old formatter printed "$40000k" for a forty-million-dollar raise, which
 * is the sort of detail that makes an executive close the tab.
 */
export function money(n) {
  if (n == null || Number.isNaN(n)) return "";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${trim(n / 1e9)}B`;
  if (abs >= 1e6) return `$${trim(n / 1e6)}M`;
  if (abs >= 1e3) return `$${trim(n / 1e3)}k`;
  return `$${Math.round(n)}`;
}

const trim = (v) => {
  const one = v.toFixed(1);
  return one.endsWith(".0") ? one.slice(0, -2) : one;
};

/** "in 2h 5m", "in 12m", "now" — for a countdown to the next thing. */
export function until(target, now = new Date()) {
  const mins = Math.round((new Date(target) - now) / 60000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}

export function when(ts) {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
}
