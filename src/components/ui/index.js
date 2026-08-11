/**
 * The shared control layer.
 *
 * One import site for the primitives every screen is built from, so a screen
 * reaches for the system before it reaches for a bare `<button>` with its own
 * classes. The rule is simple: if you are about to write Tailwind for a
 * button, chip, input, or icon button, use one of these instead — and if none
 * of them fit, that is a design decision to make on purpose, in here, once.
 */
export { default as Button } from "./Button";
export { default as Chip } from "./Chip";
export { default as IconButton } from "./IconButton";
export { default as Field, Input } from "./Field";
// The grouped inset list — the shape a settings screen has to have to read as
// native on a phone, and a good dense layout on a desktop besides.
export { Group, Row, NavRow, SwitchRow, ValueRow, PanelRow, groupId } from "./List";
// The way into search from a screen header — the only route on a phone, where
// there is no keyboard to press ⌘K on.
export { default as Find } from "./Find";
