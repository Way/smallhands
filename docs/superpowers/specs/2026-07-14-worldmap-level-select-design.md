# World-Map Level Select — Design

**Date:** 2026-07-14
**Status:** approved (brainstorm 2026-07-14)

## Problem

The level select is one long scrolling overlay: trophy shelf, three stacked campaign
card grids, and a "workshop" grid mixing daily challenge, generator, editor, import,
and saved custom levels. The grid wraps at 4 cards (720px), so campaign 2's five
levels break into an ugly 4+1. Locked campaigns render full rows of 🔒 cards. The
layout neither scales (4–6 campaigns planned, 3–8 levels each) nor gives the daily
challenge or creation tools a clear home.

## Solution overview

Replace the card grids with a **hand-authored SVG world map** (cartographic style:
coastlines, water hatching, contour lines — inspired by Thronefall's map). Reads as
"the crew's paper map", deliberately distinct from the in-game pixel art.

- **Campaign = territory.** A named SVG region. Locked territories are fogged;
  completed ones fly a banner. Adding a campaign = drawing one more territory group
  and adding node coordinates — no grid math, any level count.
- **Level = node.** Small markers inside their territory, joined by a dotted path in
  play order. Click opens a popover card (today's card content) with a Play button.
- **Daily challenge = fixed landmark** (lighthouse island), always the same map spot,
  animated until done today.
- **Creation tools = legend bar** pinned at the bottom: Generate · Editor · Import ·
  My Levels. My Levels opens a slide-up drawer with the saved custom levels.
- **Trophy shelf = corner cartouche** next to a compass rose.

No page scroll; the map scales to fit. The old grid UI is fully replaced.

## Screen structure

Three layers inside the existing `.overlay` system:

1. **Top bar** — small game title, trophy cartouche (medal counts × gold/silver/bronze,
   feat pins, gold progress `a/b`). Cartouche hidden while `save.records` is empty
   (same rule as today's shelf).
2. **Map** — one inline `<svg>` with a fixed `viewBox` (1600×900),
   `preserveAspectRatio: xMidYMid meet`, filling the space between bars. Below ~700px
   CSS width the map container switches to `overflow-x: auto` with a min-width
   (~900px) so nodes stay tappable; the map pans instead of shrinking.
3. **Legend bar** — parchment strip pinned to the bottom.

## Territories (campaigns)

Each campaign renders as an SVG `<g>`: coastline blob, water hatching around it,
contour lines, decorative details, and a territory name label.

| State | Rule | Look |
| --- | --- | --- |
| Locked | previous campaign not fully complete | desaturated, ~35% opacity, hatched fog overlay, 🔒 badge + unlock hint ("Finish Storm & Tide") |
| Unlocked | gate passed | full color |
| Complete | every level in campaign done | small flag/banner on the territory |

Territory label = campaign name. Campaign 2/3 names exist in i18n (`camp2.*`,
`camp3.*`); campaign 1 gets a new name key. Unlock logic is unchanged from today:
campaign gate + sequential unlock within a campaign.

## Level nodes

- Node = real `<button>` (HTML, absolutely positioned over the SVG via layout
  coordinates), rendered as a small building/dot marker. Tab order = play order.
- Dotted path connects nodes in play order within each territory; a path segment also
  links territory to territory (the "journey line").
- States: **done** (ring in best-medal color: gold/silver/bronze), **next up** (gentle
  pulse, disabled under `prefers-reduced-motion`), **locked** (gray, `disabled`, not
  focusable), plain unlocked.
- `aria-label`: level number, name, status (e.g. "Level 5 — Storm Landing, done, gold").
- Click/tap → **popover card** anchored at the node: level name, description, medal
  row + best time + feats (existing `addMedalBits`), status chip, Play button. One
  popover at a time; closes on Esc, outside click, or opening another. Flips placement
  near viewport edges. `role="dialog"`, focus moves to Play, returns to node on close.
- Play routes through the existing `confirmIfInProgress` → `startLevel(i)` flow.

## Daily challenge landmark

A lighthouse island drawn at a fixed map spot. Until today's daily is done it glows /
flies a flag; done shows the usual done state. Click opens the same popover style
(daily name, label + difficulty, empty medal slots via `addMedalBits(seed, null)`),
Play generates via `generateVerifiedLevel({ seed, difficulty })` exactly as today.

## Legend bar

Styled as the map's legend on a parchment strip:

- 🎲 **Generate** → existing `showGenerateDialog()`
- ✎ **Editor** → existing `openEditor()` (with in-progress confirm)
- ⇩ **Import** → existing prompt/`decodeShareCode` flow
- ★ **My Levels (n)** → slide-up drawer above the legend: saved custom levels as
  cards (reuse `.level-card.custom` markup: play on click, ✎ edit, ⧉ copy, ✕ delete),
  wrapping grid, vertically scrollable, close via button/Esc. Count badge on the
  legend button. Empty state: short hint pointing at Editor/Import.

## Data & code layout

- **New `src/game/worldmap.ts`** — builds the whole screen: SVG territories, node
  buttons, popover, daily landmark, legend, drawer. Exported entry point takes the
  dependencies it needs (save, customLevels, i18n `t`, callbacks: `startLevel`,
  `startCustomLevel`, `openEditor`, `showGenerateDialog`, import handler, …) so
  `main.ts`'s `showLevelSelect()` reduces to wiring.
- **`MAP_LAYOUT` table** (in `worldmap.ts`): per campaign — territory SVG path data,
  label position, fog/decoration params, and an ordered list of node `{x, y}`
  coordinates in viewBox units; plus the daily landmark position. Levels map to node
  slots in order. If a campaign has more levels than slots: `console.warn` and
  auto-place extras by extending the line through the last two nodes (dev safety net,
  not a designed state).
- **CSS** — new section in `src/style.css` (map container, fog, nodes, popover,
  legend, drawer, cartouche). Existing `.level-card` styles stay (drawer reuses them).
- **i18n** — new keys (EN + DE): campaign 1 name, territory/unlock hints, legend
  labels, drawer title/empty state, daily landmark strings. Existing `camp2.*`,
  `camp3.*`, `daily.*`, `workshop.*` keys reused or migrated.
- Save format, unlock rules, and all game-start flows unchanged.

## Edge cases

- `prefers-reduced-motion`: no node pulse, no daily glow animation.
- Narrow screens: horizontal pan (see Screen structure); legend bar wraps.
- Empty `save.records`: no cartouche. No custom levels: drawer shows empty-state hint.
- Popover near map edge: flip/clamp into viewport.
- Mid-run confirm ("abandon level?") flows exactly as today for every start path.

## Testing

- `tests/e2e.mjs` clicks `.level-card:not(.locked)` — update to: click first unlocked
  node button → click Play in popover. Any other browser suites touching the select
  screen (i18n, editor/generator flows) get the same selector update.
- Headless sim tests (`tests/unit.mjs`) untouched — sim/logic unchanged.
- New quick checks: locked-territory node not clickable; popover opens/closes; drawer
  lists custom level and its actions still work.

## Out of scope

- Zoom/cinematic camera on territories (hybrid option was rejected).
- Redrawing in-game art or changing level content, unlock rules, or save data.
- Map art for campaigns that don't exist yet.
