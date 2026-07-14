# Counterweight Hoist — design

**Date:** 2026-07-14
**Status:** proposed (from the physics-engine design discussion), pending review
**Companion spec:** `2026-07-14-look-physics-layer-design.md` (the cosmetic side
of the same discussion)

## Problem

The game's core asymmetry — **down is free, up is expensive for cargo**
(`docs/DESIGN.md` §"Why these mechanics") — currently has exactly one "up"
answer: the Cargo Lift, a magic box that hoists for free once built. The design
discussion concluded that the right way to add "physics" to Smallhands is not a
rigid-body engine (it would break the solvability verifier, the plan-then-watch
loop and the zero-dependency budget) but **deterministic mechanism physics**:
machines whose behavior is a visible, chartable physical rule.

The Counterweight Hoist is the poster child: a pulley where **weight going down
pays for weight going up**. It turns the asymmetry itself into a resource the
player trades — Archimedes as logistics.

## Goal

A new buildable transit, the **Counterweight Hoist**: two cargo cars on a shared
rope over a wheel at a cliff edge. Loading the *upper* car heavier than the
*lower* car makes the machine cycle — the heavy side sinks, the light side
rises, and the cars swap ends. To raise planks, you must send ballast down.

One sentence for the player: **"the heavier side sinks."** Everything else
follows from it.

## Non-goals

- **No continuous physics.** The cycle is a timed animation between two discrete
  states, like the lift car (`liftCarY`). No forces, no integration, no float
  drift; headless tests and share codes stay exact.
- **No worker transport.** The hoist moves *items only*. Workers keep using
  ladders, lifts and ropes. (This also sidesteps every boarding-deadlock
  question the two-car design would otherwise raise.)
- **No generator speculation this pass.** Same conservative posture the Ramp
  took (`2026-07-11-ramp-and-bridge-design.md` §Verifier): hand-placed and
  level-authored hoists verify; the generator does not *invent* them yet.
- **No new resource.** Rope-the-item is Chapter 1 material (`fiber → ropewalk`);
  the hoist costs existing goods so it can ship before that chain.

## Design constraints

1. **Indirect control** — the hoist is built and loaded by autonomous haulers;
   the player only places it and routes goods, exactly like sawmill inputs.
2. **Must not obsolete the Cargo Lift.** The lift moves a *worker with cargo*,
   costs nothing per trip, and is the throughput workhorse. The hoist moves
   *items only*, demands ballast every cycle (a real, per-use logistics cost)
   and holds few items. Lift = arterial; hoist = clever, cheap, situational.
   It must stay legal to solve every existing level without a hoist.
3. **Verifier honesty** — every capability the player gets, `verifyLevel` /
   `cargoReach` must reason about conservatively (false negatives allowed,
   false positives never).
4. **Visible logistics** — mass is conserved and visible: ballast is not
   consumed, it is *relocated*. Stone sent down as ballast lands as ordinary
   ground items at the base — still yours, now at the bottom. That relocation
   IS the puzzle.

## Design

### 1. Placement

Mirrors the Cargo Lift's placement grammar so players already know it:

- Placed on a **cliff-edge cell at the top** (like the Rope Anchor,
  `ropeDropFor`, `world.ts:264`): the wheel post sits on the edge, both cars
  hang over the side in the drop column.
- Requires a clear vertical drop of **≥ 3 tiles** to a standable landing (same
  minimum the lift enforces from below via `liftTopFor`, `world.ts:243`).
- Footprint 1×1 (the post), plus a reserved passable drop column — reuse the
  rope's placement validation shape.
- **Two stations**: the post cell is the *top station*; the landing cell is the
  *bottom station*. Haulers interact with each via the existing
  `buildingApproachCells` (`nav.ts:186`).

### 2. The rule (all of the mechanic)

Each car holds up to **3 items**. Every item has a **weight**:

| Item | Weight |
|------|--------|
| log, plank, iron, spear | 1 |
| stone | 2 |

Stone-as-prime-ballast gives the miner's most abundant output a late-level
identity, and makes "quarry at the top" a gift rather than a nuisance.

- Haulers deliver items into either car (they are building-style input slots;
  reservation via the existing `inbound` mechanism, `types.ts:97`).
- Whenever **weight(upper car) > weight(lower car)** and the machine is idle,
  it **cycles**: a fixed-duration animation (≈ 2.5 s, `HOIST_CYCLE` constant)
  after which the cars have swapped ends and their contents unload as ground
  items at the respective stations.
- Strictly greater — a balanced pulley doesn't move. Raising 1 plank (weight 1)
  costs ≥ 2 weight of ballast… of which 1 stone suffices. Raising a full car of
  3 planks needs 2 stones (weight 4) or any 4-weight mix.
- Items wanting *down* need no ballast: load the upper car, leave the lower
  empty, it cycles immediately (upper > 0 = lower). Downhill stays free, as the
  core asymmetry demands — the hoist is strictly better than dropping only
  because loaded workers survive just 2-tile falls (`MAX_FALL_CARRY`).

That's the whole mechanic. It is deterministic, previewable (the HUD can show
both cars' weights and an arrow for which side currently wins — same "show the
schedule" ethos as the weather forecast), and simulates as one `if` per tick.

### 3. Hauler integration

Two small additions to the job logic, no pathfinder changes for workers:

- The hoist's cars are **haul targets** like building inputs: a car requests
  the items the player routes to it. Routing v1: the top station exposes a
  simple per-item toggle in the inspect panel ("send down: ✓ plank ✓ stone…"),
  the bottom station likewise for "send up". Haulers fill cars accordingly.
- Cycled-out items become ordinary `GroundItem`s at the station cell —
  immediately reservable, haulable, deliverable. The hoist thus composes with
  everything (sawmill at the top, forge at the bottom, goal anywhere) without
  any of those systems learning about it.
- **Ballast demand**: when the lower car holds routed cargo but the upper car
  lacks weight, the top station requests ballast (prefers stone) exactly like a
  forge requesting iron. No new scheduling concept — it's an input slot.

### 4. Cargo graph & verifier

Items (not workers) gain a transit edge: **bottom station ⇄ top station**.

- `cargoReach` (`leveldata.ts:388`) models cargo movement as worker-carried
  edges; the hoist adds, for *pre-placed/hand-placed hoists only*:
  - a **down edge** (top → bottom): unconditional — always valid, since any
    load descends against an empty car.
  - an **up edge** (bottom → top): credited **only if** the level's resource
    budget leaves ≥ 1 stone (or weight-2 equivalent) spare after the order is
    satisfied. Conservative: a level whose up-route depends on ballast the
    order consumes is rejected rather than risk shipping unsolvable.
- The generator neither places hoists nor relies on the edges this pass
  (documented consequence, mirroring the Ramp precedent: generated levels will
  not *require* hoists until a later pass).

### 5. Cost, gating & balance

- **Cost:** 3 planks + 1 iron (proposed). Cheaper than the lift's
  4 planks + 2 stone, but every *use* costs ballast logistics.
- **Town Hall:** level 2, alongside lift and forge (`TOOL_DEFS`,
  `types.ts:146-150`) — it is a cargo-routing tool and belongs to the same
  learning stage. Open decision: TH1 would let early levels teach it in
  isolation; defaulting to TH2 until a campaign level needs otherwise.
- **Weather:** storms lock the hoist's brake exactly like the lift's
  (Campaign 2 rule) — one consistent rule: "storms stop rope machines."
- **Demolish:** refunds by the existing plank-based rule; items in cars drop
  at their current station.

### 6. Rendering & feel

Wheel post, two hanging cars, rope over the wheel. The cycle animation is the
mechanic's advertisement: the heavy car visibly *drags* the light one up.
Candidates for the look-physics layer (companion spec): rope tension sag,
car sway on arrival, a satisfying wheel-creak via the existing WebAudio synth.
The inspect panel shows both cars' contents and total weights — the "forecast
HUD" for gravity.

### 7. Story & campaign hook

DESIGN.md chapter fit: the hoist is old-kingdom machinery in spirit — a strong
citizen of **Ch. 3 "The Underway"** (mines, verticality, bulk goods) or as a
pre-placed *repairable ruin* in Ch. 5. Teaching arc for its debut level:
resources on a high shelf, order at the base, stone plentiful up top —
introduce ("send it down"), invert ("now planks must go UP — feed the ballast"),
combine (hoist feeding a forge that feeds the hoist's ballast back down).

## Affected code (survey, not a plan)

- `src/game/types.ts` — `BuildingKind` + `'hoist'`; car fields on `Building`
  (`hoistUpper/hoistLower: Partial<Record<ItemType, number>>`, `hoistBusy`,
  `hoistT`, `hoistBottomY`); `ITEM_WEIGHT` table; `TOOL_DEFS` entry;
  `FOOTPRINTS`, `BUILD_TIME`, `HOIST_CYCLE`.
- `src/game/world.ts` — `hoistDropFor(...)` (rope-style edge + column + landing
  validation; likely a shared helper with `ropeDropFor`, `world.ts:264`).
- `src/game/sim.ts` — placement (`placeLift` sibling, `sim.ts:459`); per-tick
  cycle check + swap; car input slots in the haul-job scan; unload-to-ground on
  cycle end; storm brake alongside the lift's; demolish branch.
- `src/game/nav.ts` — **no worker-edge changes** (contrast with lift/rope,
  `nav.ts:149-157`). Only `buildingApproachCells` reuse for the two stations.
- `src/game/leveldata.ts` — serialize hoists (share codes); `cargoReach` down
  edge + budget-gated up edge as in §4.
- `src/game/render.ts`, `src/engine/sprites.ts` — post/wheel/car sprites, cycle
  animation, ghost preview; inspect-panel weight readout in `src/game/ui.ts`.
- `src/engine/i18n.ts` — tool label/desc, hints, inspect strings (EN + DE).
- Tests — unit: cycle rule truth table (weights, strict inequality, storm
  brake); an editor-built end-to-end in the style of the rope anchor's
  ("deliver cargo down a 7-tile cliff" precedent): raise 2 planks up a 5-tile
  cliff by routing stone ballast down, win the level.

## Open decisions

1. **Weight table** — ship stone = 2 (proposed) or all-weights-1 for maximal
   readability, differentiating later? Proposed: stone = 2; it is the whole
   flavor of the machine.
2. **Car capacity 3** — tune after playtest; capacity bounds throughput and
   therefore how much the hoist can eat into the lift's role.
3. **TH gate** (see §5).
4. **Routing UI v1** — per-item toggles vs. auto-routing ("cars accept whatever
   a hauler brings"); toggles proposed, since auto-routing hides the plan.

## Success criteria

- A hauler-built hoist raises cargo up a ≥ 3-tile cliff **iff** the player
  routes sufficient ballast; a balanced or under-weighted hoist visibly refuses.
- Ballast is conserved: every stone sent down exists as a ground item at the
  base afterwards.
- "The heavier side sinks" is the only rule a player must learn; the inspect
  panel shows both weights, so any non-cycling hoist explains itself.
- The Cargo Lift remains strictly better for worker-borne throughput; all
  existing campaign levels remain solvable ignoring the hoist entirely.
- Levels containing hoists round-trip through share codes; the verifier never
  accepts a level whose solvability depends on ballast the order consumes.
- `npm run test:unit` gains the cycle truth table; the end-to-end ballast level
  passes headlessly like the campaign suites.
