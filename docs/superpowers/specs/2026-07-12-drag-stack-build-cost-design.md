# Drag-stack build + cursor cost readout — design spec

_2026-07-12_

## Problem

Ramp and Bridge already support click-drag-to-run (`runAnchor` in `main.ts` →
`placeRampRun`/`placeBridgeRun`, with a ghost preview via `runOverlay`). Two
gaps remain:

1. **Ladder is single-tile only.** Raising a ladder up a wall means clicking
   each cell. It should drag like Ramp/Bridge — one drag lays the whole shaft.
2. **No live cost while dragging.** The cursor cost badge
   (`showPlacementNeeds`) shows only a resource _shortfall_, and only while
   _not_ dragging. During a drag-run you get no running total, so you can't see
   what the stack you're drawing will cost until after you drop it.

There is also a latent bug the fix should close: `runOverlay` draws **every**
dragged cell as a valid ghost, but `placeRun` silently stops once you can't
afford the next tile. The ghost promises more than it places.

## Scope

- **In-game build only.** The level editor's paint tools (ground/rock/erase,
  which already drag) are untouched. No editor changes.
- **Three run tools:** Ladder (new), Ramp, Bridge (`platform`). Ladder drags as
  a **vertical column** (snaps to the anchor's x, walks toward the target's y);
  Ramp/Bridge keep their existing free-line behaviour.
- **Cursor cost readout during a drag-run**, showing the run's total cost per
  resource, flipping to a red `have/need` warning when the run exceeds stock.
- **Ghost shows the full dragged length** with a red/dimmed tail marking the
  tiles you can't afford; on drop only the affordable prefix is placed.
- No new tools, no balance/cost changes, no new sprites.

## Behaviour

### Ladder drag (vertical column)

- `isRunTool` gains `'ladder'`, so the existing pointerdown/up run plumbing
  routes ladder drags with no new event wiring.
- A drag lays a vertical shaft: cells share the anchor's x; the run walks from
  the anchor's y toward the target's y (up or down), keeping each cell where
  `canPlaceLadder(world, x, y)` holds. The horizontal component of the drag is
  ignored.
- A plain click (no drag) is a run of length 1 — same code path, no special
  case.

### The run plan (single source of truth)

Add `game.runPlan(tool, ax, ay, tx, ty): { cells, affordable, cost, rows }`:

- `cells` — ordered tiles the drag would fill, from the per-tool cell generator
  (`ladderRunCells` / `rampRunCells` / `bridgeRunCells`).
- `affordable` — how many leading cells the current stock can pay for.
- `cost` — the resource total for the **affordable prefix** (what the drop
  spends), as `Partial<Record<ItemType, number>>`. For Ladder this is the real
  log→plank mix (e.g. `{ log: 2, plank: 1 }`); used by placement.
- `rows` — display rows for the readout, one per resource, `{ item, have, need,
  short }` where `need` is the **full** run's requirement (all `cells`, not just
  the affordable prefix) and `have` is `game.stock[item]`. Same shape
  `placementShortfall` already returns, so the HUD stays a dumb renderer.

All three consumers read this one plan, so preview, placement, and readout can
never disagree:

- **Ghost** (`runOverlay`): tint cells `[0, affordable)` green, `[affordable,
  end)` dimmed red.
- **Placement** (`pointerup`): lay exactly `affordable` cells.
- **Readout**: show the run cost + shortfall.

### Ladder cost accounting

A ladder is 1 wood: a log if any remain, else a plank (existing `ladderWood`).
For a run of N cells:

- **Placement/`cost`** spends logs first, then planks: `logsUsed = min(N,
  stock.log)`, `planksUsed = min(N - logsUsed, stock.plank)`,
  `affordable = logsUsed + planksUsed` (= `min(N, log + plank)`).
- **Readout `rows`** pool wood into a single row under the log icon (matching
  the established `placementShortfall` ladder convention): `{ item: 'log',
  have: stock.log + stock.plank, need: N, short: N > log + plank }`. One line,
  no confusing two-resource split.

Ramp/Bridge stay single-resource (`plank: 1` per tile): `affordable =
min(N, stock.plank)`, `cost = { plank: affordable }`, `rows = [{ item: 'plank',
have: stock.plank, need: N, short: N > stock.plank }]`.

### Ghost with red tail

`runOverlay` reads `plan.affordable` and draws:

- cells `[0, affordable)` at the current valid-ghost alpha (green feel),
- cells `[affordable, end)` dimmed (lower alpha) with a red tint,

so you see the whole stack you're dragging and exactly where the budget runs
out.

### Cursor cost readout

- A `Hud.showRunCost(clientX, clientY, rows, tool)` method, modelled on
  `showPlacementNeeds`: a cursor-following `.tooltip` with `.tt-cost` rows,
  sig-cached so the DOM only rebuilds on change, clamped to stay on-screen.
- Content: `<b>{label}</b>` header + one row per `rows` entry. Unlike the
  shortfall badge, this **always** shows during a drag (the point is the running
  total). Affordable rows render just the total as `icon need`; short rows
  render `icon have/need` with the existing `.insufficient` red styling. So a
  Bridge run of 5 with 3 planks reads `Bridge  🟫 3/5` (red); with 8 planks,
  `Bridge  🟫 5`.
- **Lifecycle:** shown only while a drag-run is active (`runAnchor` set). The
  existing shortfall badge (`showPlacementNeeds`) is suppressed during the drag
  and restored on drop. Hidden on `pointerup`/`pointercancel`/`pointerleave`.

### Discoverability

Update the Ladder tool description in `TOOL_DEFS` to mention dragging, e.g.
"…drag up a wall to raise a whole ladder at once." (Ramp/Bridge already say
"drag to lay a run".)

## Touch points

- `src/game/world.ts` — add `ladderRunCells(world, ax, ay, tx, ty)`
  (vertical-column generator, mirrors `rampRunCells`/`bridgeRunCells`). Pure.
- `src/game/sim.ts` — add `runPlan(tool, ax, ay, tx, ty)` returning `{ cells,
  affordable, cost, rows }`, owning the per-tool cell-generator dispatch, the
  affordability count, the Ladder log→plank accounting (kept next to
  `ladderWood`), and the display `rows` (reusing the `ShortfallRow` shape from
  `placementShortfall`). Refactor `placeRun`/`placeRampRun`/`placeBridgeRun` to
  place `runPlan().affordable` cells via a shared core; add `placeLadderRun` that
  spends log-then-plank per cell. Single-click ladder routes through
  `placeLadderRun(tx, ty, tx, ty)`.
- `src/game/types.ts` — update the Ladder `ToolDef.desc`.
- `src/main.ts` — add `'ladder'` to `isRunTool`; `runOverlay` reads
  `game.runPlan(...)` to tint the affordable prefix vs. the red tail; in
  `pointermove` call `hud.showRunCost(...)` while `runAnchor` is set (and skip
  the shortfall badge then); hide the run-cost readout on
  up/cancel/leave. Single-click ladder in `applyTool` calls `placeLadderRun`.
- `src/game/ui.ts` — add `Hud.showRunCost(clientX, clientY, rows, tool)` /
  `hideRunCost()`, reusing the `.tooltip` / `.tt-cost` / `.insufficient`
  pattern with its own element + sig (`this.runCost` / `this.runCostSig`).

## Testing / verification

- Unit-test `runPlan` (pure):
  - Ramp/Bridge run of 5 with 3 planks ⇒ `affordable: 3`, `cost.plank: 3`.
  - Ladder run of 5 with 2 logs / 1 plank ⇒ `affordable: 3`, cost `{ log: 2,
    plank: 1 }`; with 0 log / 4 plank ⇒ `affordable: min(5,4)=4`, `cost.plank:
    4`; with plenty of both ⇒ `affordable: 5`.
  - `ladderRunCells` walks the column up and down and drops cells failing
    `canPlaceLadder`.
- Run the game: drag a ladder up a wall (one shaft placed), drag Ramp/Bridge
  (unchanged), drag any run past your budget and confirm the red tail matches
  where placement stops and the readout flips to red `have/need`.
- `tsc` clean + `vite build` clean.

## Non-goals

- No editor changes; the paint tools are separate.
- No change to placement validity, costs, or sim mechanics beyond routing
  placement through `runPlan`'s affordable count (same result as today's
  mid-loop `canAfford`).
- No horizontal/diagonal ladder runs (vertical column only, per the design
  decision).
- No new sprites; reuse existing tile sprites and tooltip CSS.
- No always-on cost readout for single-tile hover — the existing shortfall
  badge already covers the not-dragging case.
