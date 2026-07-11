# Ramp & Bridge — design

**Date:** 2026-07-11
**Status:** approved (design), pending implementation plan

## Problem

The **Platform** tool is overloaded. One piece silently does two unrelated jobs:

1. **Bridging** — a horizontal run of platform tiles spans a gap so workers walk across.
2. **Climbing** — a diagonal staircase of platform tiles changes layers (the only cargo-friendly way up/down a short cliff, since loaded haulers can't use ladders and only fall ≤2 tiles).

Nothing on the tool communicates the climbing use, so players don't discover it — they reach for a Cargo Lift on a 2-tile step (which refuses, min. 3 tiles) and get stuck. Observed directly in playtest.

## Goal

Split the *identity* of the piece into two clearly-named, clearly-drawn tools — **Ramp** (climb) and **Bridge** (span) — **without changing the movement model**. This is a clarity/affordance change, not a physics change.

## Non-goals (deliberate deferrals)

- **No new movement physics.** No sub-tile slopes, no smooth-glide climbing. Workers still move on the tile grid and hop one tile per step.
- **No generator ramp-speculation this pass.** The solvability verifier/generator already treat these tiles as floor support, so hand-placed ramps validate. Teaching the generator to *speculatively build* ramps (as it already does for horizontal bridges in `cargoReach`) is a later enhancement.
- **No new levels.** Existing content benefits immediately from the split; new ramp-centric puzzles come later.

## Design constraints (why the mechanic must not change)

The game's core thesis (see `docs/DESIGN.md` §"Why these mechanics"): **down is free, up is expensive for cargo.** A ramp that let a loaded hauler climb cheaply would delete that tension and make the Cargo Lift pointless.

Preserved because a ramp costs **one plank per tile AND one horizontal tile of run per tile of height**, while a lift is compact and vertical. On sheer / no-room cliffs the lift is still required. The enforced pitch below guarantees this.

## Design

### 1. Two identities, one mechanic

Both pieces are floor-**support** tiles that a worker stands *on top of* — mechanically identical to today's platform (`isSupport` true, not passable, not "solid"). The only differences are identity, placement, and rendering.

| Piece | Purpose | Placement | Render |
|---|---|---|---|
| **Ramp** | climb between layers | diagonal drag-run | continuous diagonal slope |
| **Bridge** | span a gap/hole | horizontal drag-run | flat deck (today's platform look) |

### 2. Tiles

- Add a new tile `T.RAMP = 7` (**appended** after `LADDER = 6` so existing tile byte values are unchanged — save files and share-codes stay valid).
- `T.RAMP` behaves exactly like `T.PLATFORM` everywhere movement/support is evaluated: it is a support tile (`isSupport` → true), not passable, not solid.
- `T.PLATFORM` stays and **is** the Bridge. The tile is unchanged; only the tool's user-facing label becomes "Bridge." Every existing level, save, and share-code keeps working with zero migration.

### 3. Placement rules

**Ramp**
- The first tile of a run must have solid contact: solid ground/wall on a side, or solid below.
- Each subsequent tile must connect **diagonally** to the previous ramp tile.
- Enforced pitch: **≤ 1 tile of rise per 1 tile of horizontal travel** (45° is the steepest allowed). This is exactly the steepest a *loaded* hauler can walk (hop-up limit = 1 tile), so a ramp a player can build is always a ramp cargo can climb.
- Both directions supported (up-left and up-right); any length the player drags, as long as each tile passes the connection/support test.

**Bridge**
- Unchanged from the current platform rule (`canPlacePlatform`): the tile must touch solid or another deck on a side or below.

**Drag-run interaction (both tools)**
- Anchor on `pointerdown`, preview the connected run as a ghost following the pointer, place all valid tiles on `pointerup`. Cost is paid per placed tile; tiles that fail validation or that the player can't afford are skipped (and shown invalid/red in the ghost).
- While a build tool with drag-run is active, dragging builds a run instead of panning the camera. (Camera pan remains available via the `select` tool / existing gestures.)

### 4. Rendering

- New sprite `tile_ramp`. A ramp tile that has a diagonal ramp neighbor draws a slope face along the run; end caps and single tiles degrade gracefully to a short ramp glyph.
- Bridge tiles render exactly as platform tiles do today.
- Worker walk animation is unchanged — they hop tile-to-tile underneath the slope skin; the slope is a visual treatment only.

### 5. Cost & balance

- Ramp and Bridge each cost **1 plank per tile** (same as today's platform).
- Lift relevance preserved by the pitch rule + the plank-and-space cost of ramps (see constraints above).

## Affected code (survey, not a plan)

- `src/game/types.ts` — add `T.RAMP`; add `ramp` to `TOOL_DEFS` (cost `{ plank: 1 }`), relabel the `platform` tool to "Bridge" (keep tool id `platform` for compatibility unless the plan decides otherwise). Add a `drag`-run flag concept for build tools if not reusing the editor's.
- `src/game/world.ts` — `isSupport` includes `T.RAMP`; add `canPlaceRamp(world, x, y, prev?)` enforcing solid-anchor + diagonal-connection + ≤45° pitch.
- `src/game/sim.ts` — `placeRamp(x, y)`; include `T.RAMP` in the demolish branch (currently `T.LADDER || T.PLATFORM`); refund like platform.
- `src/main.ts` — drag-run pointer handling for build tools; ghost preview of the run; per-tile placement on release.
- `src/game/render.ts` — draw `T.RAMP` as a slope in `drawTerrain` and in the build ghost; add `tile_ramp` to the sprite factory in `src/engine/sprites.ts`.
- `src/game/leveldata.ts` — `decodeTiles`/verifier already handle arbitrary tile bytes and treat support tiles correctly; confirm `T.RAMP` counts as support in `verifyLevel`. No generator speculation this pass.
- Text touch-ups where "platform" is user-facing (tool desc "walk across gaps", the "no platforms" challenge twist, DESIGN.md references) → "Bridge".

## Success criteria

- Ramp and Bridge appear as two distinct tools with distinct icons and one-drag placement.
- A ramp drawn up a 2-tile step lets a **loaded** hauler climb it (the exact playtest failure is now solvable with an obviously-named tool).
- A ramp cannot be drawn steeper than 45°, and cannot start floating (needs solid contact).
- All existing levels, saves, and share-codes load and play unchanged; old platform tiles present as Bridges.
- "Up is expensive" holds: lifts remain the only option on sheer/no-horizontal-room cliffs.
