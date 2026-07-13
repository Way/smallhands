# Auto-hiding corner menus — design

**Date:** 2026-07-13

## Goal

Reduce persistent HUD clutter by collapsing the two bottom-corner control
clusters to a single icon each, expanding to the full menu on hover. Also unify
and visually polish the currently-split speed and zoom controls.

## Current state

`src/game/ui.ts` builds four bottom-anchored panels:

- `.menubar` (bottom-left): **Levels**, **Restart**, **⚙ Settings** — text buttons.
- `.speedbar` (bottom-right, `bottom:12px`): `⏸ 1× 2× 4×`.
- `.zoombar` (bottom-right, `bottom:58px`): `− +`.
- `.toolbar` (bottom-center): unchanged by this work.

Speed and zoom are two separate floating pills ("split menu"). All use
`.speed-btn` styling.

The game is touch-capable (mobile viewport, `touch-action: none`), so a
hover-only affordance would strand touch users.

## Behavior model — hover-gated, CSS-driven

Each collapsing cluster becomes a `.flyout` containing a **trigger** (the
collapsed icon) and a **body** (the full menu).

- `@media (hover: hover)` — body collapsed by default; expands on `.flyout:hover`.
  Trigger fades out as the body fades in. Transitions on opacity + transform +
  size.
- `@media (hover: none)` (touch) — trigger hidden, body always shown full-size.
  No JS interaction, no device-sniffing in JS.
- `@media (prefers-reduced-motion: reduce)` — expand/collapse transitions off.

## Left menu — `.menubar` flyout

- Trigger: `☰` icon pill.
- Body: existing **Levels / Restart / ⚙** buttons, unchanged. Grows rightward /
  upward from the bottom-left corner.

## Right menu — merge into one `.ctrlbar` flyout

Delete the separate `.zoombar`; combine speed + zoom into one panel at
`bottom:12px` right.

- Trigger: a live pill showing the **current speed** (`⏸` / `1×` / `2×` / `4×`),
  doubling as a status readout. `setSpeed()` updates this label (it already
  toggles the active button and the pause-note).
- Body (on hover): two rows in one unified panel —
  - row 1: `⏸ 1× 2× 4×`
  - hairline `--panel-border` divider
  - row 2: dim `zoom` label + `− +`
- The collapsed pill takes the accent treatment when speed ≠ `1×` so a
  non-default speed is glanceable while collapsed.

## Visual polish (the "improve appearance" ask)

- One cohesive rounded panel instead of two stray pills.
- Consistent `.speed-btn` sizing across both rows.
- Subtle divider between the speed row and the zoom row.
- Small dim `zoom` label so the bare `− +` reads clearly.

## Scope guards

- No changes to `HudCallbacks`, tool logic, or the top bar.
- `buildSpeedBar` + `buildZoomBar` collapse into one `buildControlBar`;
  `buildMenuBar` gains the trigger wrapper.
- `setSpeed()` gains one line to sync the collapsed-pill label.
- Touch detection is CSS-only.

**Files touched:** `src/game/ui.ts`, `src/style.css`. No HTML or type changes.

## Verification

- Desktop: both corners show a single icon; hovering expands the full menu;
  moving away collapses it. Speed pill reflects the active speed.
- Touch/no-hover viewport: both menus render fully expanded.
- Speed and zoom controls still drive `onSpeed` / `onZoom`; the menu buttons
  still drive `onMenu` / `onRestart` / `onOptions`.
