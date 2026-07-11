# Placement cost badge — design spec

_2026-07-11_

## Problem

When you hold a building tool and hover the map, the placement ghost turns
green (can build) or red (can't) via `canAfford` + placement validity +
`toolUnlocked` (`drawGhost` in `render.ts`). A red outline is a dead end: it
tells you _no_ but never _why_. If the block is a resource shortfall, you can't
tell which resource you're short on without hovering back over the toolbar
button (whose tooltip already lists the cost with `.insufficient` styling) —
and that tooltip vanishes the moment you move onto the map to place.

We want to carry that cost readout to the cursor, but only when it's needed:
show it precisely when a resource is missing, so it reads as _"here's why the
outline is red and you can't build this yet."_

## Scope

- **All cost-bearing placement tools:** Ladder, Platform, Sawmill, Lift, Rope,
  Forge (everything in `TOOL_DEFS` with a `cost`).
- **Show only on shortfall.** The badge appears iff at least one required
  resource is short against `game.stock`. Fully affordable ⇒ no badge; the green
  outline already says "go".
- **Resource-only.** The badge explains *resource* shortfalls. A red outline
  caused by bad terrain (`canPlaceBuilding`/`canPlaceLadder`/…) or a town-hall
  level lock (`toolUnlocked`) does **not** get a badge — those reds are out of
  scope here.

## Behaviour

### Trigger & lifecycle
- Driven from the existing `pointermove` handler in `main.ts`, alongside the
  town-hall hint. On each move, when `game && running && !dragging` and the held
  tool is a cost-bearing tool, ask the sim for the shortfall and show/hide the
  badge accordingly.
- Hidden while panning/dragging, on `pointerleave`, and whenever a non-cost tool
  (Inspect, Harvest, Demolish) is active. Also hidden when nothing is short.
- The town-hall hint and this badge are mutually exclusive by tool (Inspect vs.
  a build tool), but use a **separate** DOM element + sig so they never fight.

### Content
- The badge lists **every** required resource for the tool (full recipe as
  context), each row as `icon have/need`.
- Short rows (`have < need`) render red via the existing `.insufficient` class;
  satisfied rows stay dim/neutral. The eye lands on the missing item.
- A small header names the tool, e.g. `Forge needs`.
- Example — Forge (`plank 4`, `stone 4`) with 5 planks and 1 stone in stock:

  ```
  Forge needs
  🪵 plank 5/4     🪨 stone 1/4     ← stone row red
  ```

### Affordability basis
- Compare each requirement against `game.stock[item]` — the exact value
  `canAfford`/`payCost` read — so the badge always agrees with the outline. (Not
  `available()`, which subtracts haul reservations; construction spends raw
  stock.)

### Ladder's fallback
- Ladder costs **1 log _or_ 1 plank** (`ladderWood()` prefers log, falls back to
  plank). It is therefore unaffordable only when you have **neither**.
- The shortfall helper special-cases Ladder: it returns a single `log 0/1`
  (red) row **only** when both log and plank stock are 0, and returns "nothing
  missing" otherwise. No "log OR plank" display is needed, because the badge only
  ever appears in the both-zero case.

## Touch points

- `src/game/sim.ts` — add `placementShortfall(tool): { item, have, need,
  short }[]` (empty ⇒ nothing missing). Owns the `TOOL_DEFS` cost lookup and the
  Ladder special-case, keeping the fallback logic next to `ladderWood()`. Pure,
  read-only.
- `src/game/ui.ts` — add `Hud.showPlacementNeeds(clientX, clientY, tool)` /
  `hidePlacementNeeds()`. Mirrors `showBuildingHint`: a cursor-following
  `.tooltip` element, `.tt-cost` rows built with `icon()` + a `<b>` that carries
  `.insufficient` on short rows, a sig-cache so DOM only rebuilds on change, and
  clamped screen positioning. New private `this.needs` element + `this.needsSig`.
- `src/main.ts` — in `pointermove`, call `showPlacementNeeds`/
  `hidePlacementNeeds` next to the town-hall-hint logic; call
  `hidePlacementNeeds` in `pointerleave` and on tool change (`setTool`).

## Testing / verification

- Unit-test the pure helper `placementShortfall`:
  - Forge with enough planks but too little stone ⇒ both rows returned, stone
    `short: true`, plank `short: false`.
  - Fully affordable building ⇒ empty array.
  - Ladder with 0 log / 0 plank ⇒ one `log 0/1` short row; with 0 log / 2 plank
    ⇒ empty (fallback covers it); with 3 log ⇒ empty.
- Run the game to verify the badge follows the cursor, appears only on
  shortfall, names the culprit in red, and disappears when you gather enough or
  switch to Inspect/Harvest/Demolish.
- `tsc` clean + `vite build` clean.

## Non-goals

- No change to placement rules, costs, or sim mechanics — read-only overlay.
- No badge for terrain-invalid or town-hall-locked reds.
- No new sprites or CSS beyond reusing `.tooltip` / `.tt-cost` / `.insufficient`.
- No cursor cost readout for the Inspect tool on existing buildings (a possible
  future follow-up; explicitly deferred per the scoping decision).
