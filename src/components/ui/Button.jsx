/**
 * The one button.
 *
 * Before this, every screen hand-rolled its own — some `rounded-md`, some
 * `rounded-full`, paddings that differed by a pixel, three different disabled
 * treatments. On a single screen nobody notices; across the app it is the
 * difference between a tool that was designed and one that was assembled. A
 * product that asks for money monthly cannot look assembled.
 *
 * Four variants, two sizes, one focus ring. Anything a screen needs beyond
 * that is a sign the screen needs a different control, not that the button
 * needs another prop.
 */

const base =
  "inline-flex items-center justify-center gap-2 font-medium transition-all " +
  "outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)] " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--paper)] " +
  "disabled:pointer-events-none disabled:opacity-40";

const variants = {
  // Filled. The one call to action on a screen, and rarely more than one.
  primary: "bg-[var(--ink)] text-[var(--paper)] hover:opacity-90 active:opacity-100",
  // Outlined. Everything that is a real action but not the point of the screen.
  secondary:
    "border border-[var(--line)] text-[var(--ink)] hover:border-[var(--ink)] hover:bg-[var(--hover)]",
  // Text only. Dismissals, "cancel", the quiet way out.
  ghost: "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)]",
  // The reserved colour, for the one action that destroys something.
  danger: "border border-[var(--alert)] text-[var(--alert)] hover:bg-[var(--alert-bg)]",
};

const sizes = {
  sm: "rounded-lg px-3 py-1.5 text-xs",
  md: "rounded-lg px-4 py-2.5 text-sm",
};

export default function Button({
  variant = "secondary",
  size = "md",
  pill = false,
  className = "",
  type = "button",
  ...rest
}) {
  const radius = pill ? "!rounded-full" : "";
  return (
    <button
      type={type}
      className={`${base} ${variants[variant]} ${sizes[size]} ${radius} ${className}`}
      {...rest}
    />
  );
}
