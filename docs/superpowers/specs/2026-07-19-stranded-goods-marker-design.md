# Stranded-goods marker — design

**Date:** 2026-07-19
**Status:** Design (approved) → ready for implementation plan
**Slice:** 1 of 3 in the "point the player at what matters" family (Slice 2 = locate-on-map from the HUD; Slice 3 = invalid-cursor "why?" reason). This doc covers **Slice 1 only**.

## Problem

The sim can silently strand resources with no feedback. A miner harvests an iron vein on a ledge; the 4 iron drop as ground items; a **loaded** hauler can't climb the bare cliff back out, so the iron sits there forever. The HUD keeps showing `Iron · 0 in store`, the objective never advances, and nothing tells the player *why* or *where*. The player concludes the game is broken or that iron is unobtainable.

This is the worst class of failure in the game: the sim knows the goods are unreachable, but says nothing.

## Goal

Show a clear, on-map warning over any dropped resource that has **no route to a useful destination**, plus a one-line reason. Diagnosis only — point at the problem; do not auto-suggest or auto-build the fix.

## Non-goals (explicitly deferred)

- **Off-screen indicator** (screen-edge arrow / HUD count when the stranded pile is scrolled out of view) — deferred to Slice 2 (locate-on-map). Known limitation of this slice: a stranded pile off-screen shows nothing until the player scrolls to it.
- **Fix suggestions** (highlighting where a ladder/ramp/lift would reconnect it) — out of scope; MVP is diagnosis only.
- **Invalid-cursor "why is my cursor grey?" reason** — Slice 3.
- Any change to hauling behavior itself. This is a render + read-only-query feature; the sim's movement/assignment logic is untouched.

## Approach

Reuse the hauler's own reachability logic as the single source of truth. Do **not** introduce a second definition of "reachable" (the lesson from card #45, lantern radius: the preview must match what the real system does).

Rejected alternatives:
- **Piggyback on `haulCooldown`** — cheap (no new pathfinding) but the cooldown map is per-worker and time-boxed; it conflates "all haulers busy" with "physically impossible" and would false-positive.
- **Geometry heuristic** (item below a cliff with no adjacent ladder) — no pathfinding, but a second reachability definition that drifts from actual hauler behavior. Rejected.

## Strandedness test (faithful reuse)

A ground item is **stranded** iff a loaded hauler could never carry it to any accepting sink. Computed with existing sim primitives:

1. **Pickup cells:** `sourceCells({ t: 'ground', id })` (already exists, `sim.ts:1026`) — the stand-cells from which a hauler grabs the item. Returns `null` when the item is walled in with no standable neighbour → **stranded**.
2. **Accepting sinks:** every place the item could **ever** be carried to (route-existence, *not* the planner's transient here-and-now gates — see note below):
   - the town-hall **stockpile** (`{ t: 'stock' }`, universal fallback sink — every loose item can route to stock via route 3),
   - any **ready, unpaused building input** whose recipe consumes the item,
   - the **goal** if an objective for that item is still open,
   - a **ready hoist** landing, but only the car whose **per-item routing is configured** for that item — upper car if `hoistSendDown[item]`, lower car if `hoistSendUp[item]`. This matches what haulers actually do: `tryAssignHaul` only loads a car when its route flag is set, and a fresh hoist routes nothing until the player configures it. An unrouted hoist is therefore **not** a way out — an item that can only reach an unrouted hoist is correctly flagged stranded (the player must route the hoist or build a connection).

   Union their cells via existing `sinkCells(...)` / `hoistStationCells(...)`.

   Deliberately **excluded** are `tryAssignHaul`'s *transient* gates: the building-input buffer cap (`have < need*2`) and the goal `keep`-floor/surplus rule. Those describe whether the planner would route *right now*, not whether a route *exists*. Including them would flash a false "stranded!" on an item whose forge buffer is momentarily full. The one case this trades away — an item whose only reachable sink is a building whose recipe is **permanently** deadlocked (another input never arrives, so its buffer never drains) — is a *production-deadlock* diagnosis, a different feature, out of scope here. (Decision: card #47, route-existence semantics.)
3. **Carry-leg test:** `findPath(world, transits, pickupCell, sinkCellsUnion, /*carrying*/ true)` from each pickup cell. If **no** carry-route reaches **any** accepting sink → **stranded**.

Properties this gives us for free:
- Iron next to a forge on its own ledge is **not** flagged (the local building-input sink is reachable).
- Iron on a shelf with no ramp/lift/bridge out **is** flagged (no accepting sink reachable under a loaded carry) — the exact failure that motivated this. (A ladder would not clear it: loaded haulers can't climb ladders.)
- Fully walled-in items (no pickup cell) are flagged.

The check ignores hauler position (leg1) and reservations/cooldowns on purpose: strandedness is about whether a route *exists at all*, not whether a hauler is currently free. That's what distinguishes "stuck forever" from "just busy."

## State & lifecycle

- New fields on `GroundItem` (`types.ts:251`): `stranded: boolean` (cached result) and `idleFor: number` (seconds unreserved & settled). Render-only; no persistence — the game keeps no mid-level save, so nothing to serialize.
- **Throttle:** recompute stranded status on a cadence (~every 0.5s of sim time), not every frame. Ground items are few and `findPath` is a bounded BFS, but throttling keeps the per-tick cost flat. Also fine to recompute opportunistically when the item set / terrain / building-ready set changes; the simple time cadence is the required behavior, event-driven recompute is an optional optimization.
- **Grace period:** only set `stranded = true` after `idleFor >= ~3s`. Prevents flicker on fresh drops (which bounce/settle) and on momentary full-input-buffer states. Reserved items (`gi.reserved`) reset `idleFor` to 0 and are never flagged (a hauler already owns them).

## Rendering

- A pulsing amber warning glyph (a `!` in a warm disc) floating above each stranded item.
- Drawn in the **post-darkness pass** (same ordering the lantern-range preview uses, `render.ts` `drawGhost` runs after `drawDarkness`) so the glyph reads over the night veil.
- **Reduce-motion:** static glyph, no pulse — gate the pulse on `this.reduceMotion` (already used across the renderer).
- New sprite `warn` (or `stuck`) via `makeSprite` in `src/engine/sprites.ts`, styled to match the pixel set.

## Interaction / the reason

- Hover (desktop) or tap (touch) a stranded item's glyph → a one-line reason surfaced through the existing tooltip/tap-panel surface in `ui.ts`.
- Copy: **EN** "Stranded — no way to carry this out. Connect it with a ramp, bridge, or lift." / **DE** "Gestrandet — kein Abtransport möglich. Verbinde es mit einer Rampe, Brücke oder einem Lift."
- Copy note: deliberately **not** "ladder" — a loaded hauler cannot climb a ladder (`nav.ts:138`); loads ascend only via ramp step-ups / a cargo lift, cross gaps via a bridge/platform, and descend via fall / rope anchor.
- If the tooltip is driven by a signature string (the `buildingHintSig`/`producerSig` pattern), the stranded state must be part of that signature so an open tooltip refreshes when an item becomes/stops-being stranded.

## Testing

- Expose the detector as a pure, read-only `Game` method — `strandedGroundItems(): GroundItem[]` (or `isStranded(gi)`), independent of rendering.
- Unit test in `tests/unit.mjs` (bundles the sim, no browser):
  1. Build a level, force a drop on an isolated shelf (or mine a vein there), tick past the grace period → assert the item is flagged.
  2. Place a ramp/ladder connecting the shelf to a route to the stockpile → tick → assert the flag clears.
  3. Drop an item on the same level as the stockpile (trivially reachable) → assert never flagged.
  4. Drop next to a ready building input that consumes it, with no route to the stockpile → assert not flagged (local sink reachable).
- Deterministic; no timing/animation assertions.

## Files touched (anticipated)

- `src/game/types.ts` — `GroundItem` fields.
- `src/game/sim.ts` — detector method + throttle/grace bookkeeping in the tick; reuses `sourceCells`/`sinkCells`/`findPath`/recipe+objective enumeration.
- `src/game/render.ts` — draw the glyph in the post-darkness pass; reduce-motion gate.
- `src/engine/sprites.ts` — `warn` sprite.
- `src/game/ui.ts` — hover/tap reason + tooltip signature.
- `src/engine/i18n.ts` — EN + DE strings.
- `tests/unit.mjs` — detector tests.

## Acceptance criteria

- A dropped resource with no loaded-carry route to any accepting sink shows a warning glyph after a short grace period.
- An item that a forge/building on the same shelf can consume, or that can be carried to the stockpile/goal, is **not** flagged.
- Building a connecting ladder/ramp/lift clears the glyph without a reload.
- Hover/tap the glyph shows the one-line reason (EN + DE).
- Glyph renders correctly over the night veil; respects reduce-motion (no pulse).
- Detector is unit-tested headlessly and the existing suites stay green.
- No change to hauler assignment/movement behavior.
