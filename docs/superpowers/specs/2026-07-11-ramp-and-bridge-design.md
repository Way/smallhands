# Ramp & Bridge — design

**Date:** 2026-07-11
**Status:** approved (design + open decisions), pending implementation plan
**Rev 2:** incorporates code-verified review — campaign `allowedTools` gap, ban-semantics decision, verifier conservatism, ramp headroom check, fixed-pitch wording, rope-free-descent note. Decisions locked: **Level 4 only** this pass; **keep tool id `platform`** (label → "Bridge").

## Problem

The **Platform** tool is overloaded. One piece silently does two unrelated jobs:

1. **Bridging** — a horizontal run of platform tiles spans a gap so workers walk across.
2. **Climbing** — a diagonal staircase of platform tiles changes layers (the only cargo-friendly way up/down a short cliff, since loaded haulers can't use ladders and only fall ≤2 tiles).

Nothing on the tool communicates the climbing use, so players don't discover it — they reach for a Cargo Lift on a 2-tile step (which refuses; `liftTopFor` requires `y - ty >= 3`, world.ts:141) and get stuck. Observed directly in playtest on "The Summit Beacon" (Level 4).

## Goal

Split the *identity* of the piece into two clearly-named, clearly-drawn tools — **Ramp** (climb) and **Bridge** (span) — **without changing the movement model**. This is a clarity/affordance change, not a physics change. It must actually reach the campaign level where the failure was observed.

## Non-goals (deliberate deferrals)

- **No new movement physics.** No sub-tile slopes, no smooth-glide climbing. Workers move on the tile grid and hop one tile per step. (Verified: nav.ts step-up `consider(nx, y-1, 'walk', 1.4)` at lines 110-113 sits *outside* the `if (!carrying)` gate, so loaded haulers already climb +1/+1 diagonals. Ramp = existing capability, renamed.)
- **No generator ramp-speculation this pass.** See "Verifier" below.
- **No brand-new levels.** Existing campaign levels are *edited* to offer the tool (see "Campaign integration") — that is required for the feature to work — but no new level files are authored.

## Design constraints (why the mechanic must not change)

The game's core thesis (`docs/DESIGN.md` §"Why these mechanics"): **down is free, up is expensive for cargo.** A ramp that let a loaded hauler climb cheaply would delete that tension and make the Cargo Lift pointless.

Preserved because a ramp costs **one plank per tile AND one horizontal tile of run per tile of height**, while a lift is compact and vertical. Crossover: short rises → ramp wins; tall cliffs → a 45° ramp needs N planks + N horizontal tiles, so the lift's compact `4 plank + 2 stone` wins. On sheer / no-horizontal-room cliffs the lift is required. The fixed pitch below guarantees this.

## Design

### 1. Two identities, one mechanic

Both pieces are floor-**support** tiles a worker stands *on top of* — mechanically identical to today's platform (`isSupport` true, not passable, not "solid"). The only differences are identity, placement, and rendering.

| Piece | Purpose | Placement | Render |
|---|---|---|---|
| **Ramp** | climb between layers | diagonal drag-run | continuous diagonal slope |
| **Bridge** | span a gap/hole | horizontal drag-run | flat deck (today's platform look) |

### 2. Tiles

- Add a new tile `T.RAMP = 7` (**appended** after `LADDER = 6` so existing tile byte values are unchanged — save files and share-codes stay valid).
- `T.RAMP` behaves exactly like `T.PLATFORM` everywhere movement/support is evaluated: support tile (`isSupport` → true), not passable, not solid.
- `T.PLATFORM` stays and **is** the Bridge. The tile is unchanged; only the tool's user-facing label becomes "Bridge." Every existing level, save, and share-code keeps working with zero migration.

### 3. Placement rules

**Ramp**
- The first tile of a run must have solid contact: solid ground/wall on a side, or solid below.
- Each subsequent tile connects **diagonally** to the previous ramp tile — a **fixed 45° (1:1) pitch**. This is exactly the steepest a *loaded* hauler can walk (hop-up limit = strictly +1 rise per +1 run; no 2-up move exists in the nav graph), so any ramp a player can build is one cargo can climb. Shallower grades are not a single ramp — combine a Bridge run with a Ramp step.
- **Headroom check (new):** each ramp tile is only valid if the cell a worker would stand in (directly above the tile) is passable and stays clear along the run. A ramp buried under an overhang places-but-is-useless otherwise. (Platform has this latent gap too; we add the check for Ramp rather than propagate the bug.)
- Both directions supported (up-left and up-right); any length the player drags, as long as each tile passes connection + support + headroom.

**Bridge**
- Unchanged from the current platform rule (`canPlacePlatform`): the tile must touch solid or another deck on a side or below.

**Drag-run interaction (both tools)**
- Anchor on `pointerdown`, preview the connected run as a ghost following the pointer, place all valid tiles on `pointerup`. Cost paid per placed tile; tiles that fail validation or that the player can't afford are skipped and shown invalid/red in the ghost.
- While a build tool with drag-run is active, dragging builds a run instead of panning. (Camera pan remains via the `select` tool / existing gestures.) The editor already has a `drag` flag concept (editor.ts:42) to model this on.

### 4. Rendering

- New sprite `tile_ramp` (add to the factory in `src/engine/sprites.ts`). A ramp tile with a diagonal ramp neighbor draws a slope face along the run; single tiles / end caps degrade to a short ramp glyph.
- Bridge tiles render exactly as platform tiles do today.
- Worker walk animation unchanged — they hop tile-to-tile underneath the slope skin; the slope is a visual treatment only.

### 5. Cost & balance

- Ramp and Bridge each cost **1 plank per tile** (same as today's platform). Demolish refund follows the existing plank-based rule (sim.ts:337-341 can't mint value; safe to extend to `T.RAMP`).
- **Acknowledged property:** a downhill ramp also lets cargo descend drops **>2 tiles** (chained 1-tile falls down the slope) *without* a Rope Anchor. This is intended and fine — the Rope still wins on cost and space for tall/sheer drops. The Ramp is implicitly a two-way tool (climb *and* rope-free short descent).

## Campaign integration (required — this is what makes the feature real)

Tool availability gates on `allowedTools` (`toolUnlocked`, sim.ts:227: `(level.allowedTools ?? all).includes(tool)`). Every campaign level in `src/game/levels.ts` sets `allowedTools` explicitly, so a new `ramp` is **invisible in the campaign** until added. Generated/daily/editor levels (no `allowedTools`) get it automatically.

- **Add `'ramp'`** to the `allowedTools` of the level(s) whose puzzle is short-step climbing/descent — at minimum **Level 4 "The Summit Beacon"**, the level where the failure was observed. Add a one-line teaching **hint** introducing the Ramp on its first campaign appearance.
- **Level 2 "The Cliff Shrine" stays lift-only** (do *not* add ramp): it is the Cargo Lift's dedicated tutorial and a 7-tile sheer cliff is where the lift is meant to shine. Diluting it with a ramp alternative weakens the introduction.
- Levels 1 (flat) and 3 (pit — a lift/reserve lesson): no ramp unless playtest shows a short-step need.
- **Decided (this pass): Level 4 only.** Level 3 stays a pure pit/reserve lesson; revisit if playtest shows another level needs the tool. This keeps each level's teaching clean.

### Level-authoring guideline (resolves the "force a lift" question)

Because a Ramp is mechanically a Platform, any level meant to **force** a Lift/Rope solution must exclude **both** `'platform'` and `'ramp'` from `allowedTools`. There is no separate "no platforms" modifier in code — it is (and remains) an allow-list exclusion. (The `docs/DESIGN.md` challenge-mode line that mentions "no platforms" is a design example, not implemented behavior; update it to "no ramps/bridges" phrasing for accuracy.)

## Verifier (safe, conservative)

`cargoReach` (leveldata.ts:388) speculatively builds **horizontal bridges**, not diagonal ramps. Once `T.RAMP ∈ isSupport`, *hand-placed* ramps validate correctly (uses `isStandable → isSupport`). The speculative model staying bridge-only is a **false-negative** direction — it may reject some now-solvable levels, but never accepts an unsolvable one — so there is no ship-broken risk. Consequence to document: **generated levels will not rely on ramps for solvability** until the deferred generator/verifier enhancement lands.

## Affected code (survey, not a plan)

- `src/game/types.ts` — add `T.RAMP = 7`; add `ramp` to `TOOL_DEFS` (cost `{ plank: 1 }`); relabel the `platform` tool to "Bridge" — **keep the internal tool id `platform`** (only the user-facing label changes), so saved levels/share-codes that reference the id keep working.
- `src/game/world.ts` — `isSupport` includes `T.RAMP`; add `canPlaceRamp(...)` (solid-anchor + diagonal-connection + fixed-45° + headroom clearance).
- `src/game/sim.ts` — `placeRamp(x, y)`; include `T.RAMP` in the demolish branch (currently `T.LADDER || T.PLATFORM`, sim.ts:337); refund like platform.
- `src/game/levels.ts` — **add `'ramp'` to Level 4 `allowedTools` + a teaching hint.** (Missed in rev 1; the feature is inert in the campaign without it.)
- `src/main.ts` — drag-run pointer handling for build tools (`applyTool` at 932, pointer handlers ~744-811); ghost preview of the run; per-tile placement on release.
- `src/game/render.ts` — draw `T.RAMP` as a slope in `drawTerrain` (~212) and in the build ghost (~778); `src/engine/sprites.ts` — add `tile_ramp`.
- `src/game/leveldata.ts` — confirm `T.RAMP` counts as support in `verifyLevel`; no generator speculation this pass.
- Text: user-facing "platform" → "Bridge" (tool desc "walk across gaps"); `docs/DESIGN.md` "no platforms" example wording.

## Known limitation (pre-existing, not addressed this pass)

A **2-tile sheer step with no horizontal room** is uncarryable: a ramp needs run it doesn't have, and the lift refuses `<3`. This hole predates this work; generator solvability presumably avoids constructing it. Flagged so a future pass (e.g. lowering the lift minimum, or a 1-2 tile "hoist") can own it.

## Success criteria

- Ramp and Bridge appear as two distinct tools with distinct icons and one-drag placement.
- **Level 4 "The Summit Beacon" offers the Ramp**, and a loaded hauler can climb the +1/+2 step that the lift refuses — the observed playtest failure is solvable with an obviously-named tool.
- A ramp cannot be drawn steeper than 45°, cannot start floating, and cannot be placed under an overhang that blocks the walk cell.
- All existing levels, saves, and share-codes load and play unchanged; old platform tiles present as Bridges.
- "Up is expensive" holds: lifts remain the only option on sheer/no-horizontal-room cliffs.
