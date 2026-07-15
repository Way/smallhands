# Architecture

## Directory Structure

- `docs/` — Documentation
- `src/` — Source code
- `tests/` — Tests
- `tools/trailer/` — Teaser video renderer (deterministic in-game capture)

### `src/`

- `src/engine/` — engine
- `src/game/` — game

## Placement models

The sim (`src/game/sim.ts`) places things into the world through **three intentionally
distinct models**. The split is by design — it is *not* an oversight that ladders skip the
builder (decided on card #20):

1. **Instant terrain tiles** — ladders, ramps, platforms, bridges. `placeRun` pays wood and
   immediately `world.set`s the tile. There is no worker step; the player's drag *is* the
   labor. This is the direct "terraform the world" verb.
2. **Order + worker terrain edit** — digging. The player paints a *free* `digOrder` (an intent
   marker, not a world change). An idle **Digger** holding a shovel pathfinds to an adjacent
   approach cell and removes the tile over `DIG_TIME`. An unreachable dig order harmlessly
   no-ops — it simply never executes.
3. **Blueprint + builder entity** — lifts, ropes, hoists, sawmill, forge, workshop, lantern,
   and the town-hall upgrade. `addBuilding(kind, x, y, ready=false)` creates a `blueprint`; a
   **Builder** then runs a `construct` task that accumulates progress at `BUILDER_SPEED` up to
   `BUILD_TIME[kind]` before the building becomes `ready`.

The dividing line: **paint terrain tiles instantly · order terrain removal via a Digger ·
construct functional machines via a Builder.**

**Why ladders/ramps are not moved to the blueprint+builder model:** a ladder's whole purpose
is to *create* reachability. If a builder had to reach the cell it was about to build, it
could not — pathing cannot route over a not-yet-built `LADDER` tile — so descending ladders
and gap-spanning ramps become chicken-and-egg, multiplying the vertical-level deadlock hazard
(see the ladder-cost / plank-fallback rule). If labor cost on vertical mobility is ever
desired, use the dig-order model (not blueprint) and gate only *horizontal* spans, keeping
vertical ladders instant.
