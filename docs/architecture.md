# Architecture

## Directory Structure

- `docs/` — Documentation
- `src/` — Source code
- `tests/` — Tests
- `tools/trailer/` — Teaser video renderer (deterministic in-game capture)

### `src/`

- `src/engine/` — engine
- `src/game/` — game

## Terminology (card #60)

Four registers, deliberately layered — don't collapse them into one word:

| Register | Word | Use |
|---|---|---|
| The game / product | **Smallhands** | Title, logo, save keys (`smallhands-save-v1`), the `window.__smallhands` hook, export format. Never renamed. |
| The species | **smallie** · **smallies** | The inhabitants. Lowercase in EN (a species, like *lemmings*); capitalised in DE (`der Smallie`, `die Smallies`) as a loanword, never translated. |
| The collective | **crew** · *Trupp* | "your autonomous crew" — a group, not a species name. |
| The counting noun | **hands** | Keeps the game's own metaphor alive: "many hands make the mountain small", DE tagline "Kleine Hände". |

Roles (Builder, Digger, Hauler, Miner) are **jobs**, not species — they stay as they are.
No identifier is named after either the brand or the species: the sim entity is `Worker`,
and it stays that way. Copy says *smallie*, code says `worker`, brand says *Smallhands*.

`tests/terminology.mjs` enforces all of the above — it walks both copy tables (EN and DE)
and sweeps the tree, so a half-renamed pair fails loudly instead of shipping. The brand is
always plural, so the guard reads any singular form of it as a creature reference the
rename missed.

## Level pressures & the difficulty curve (card #70)

Every level shares one win condition — fill the caravan's order sheet — so **variety comes
from the pressures a level switches on**, not from new goals. `LevelDef` carries them as
optional fields, and each one is deterministic, visible and plannable (never a dice roll):

| Field | Pressure | Reader |
|---|---|---|
| `weather` | looping `clear/rain/storm` schedule | `WEATHER_RULES` → `workFactor`, `wheelsLocked`, `lanternRadius` |
| `flood` | rain raises the water table one row, forever | `riseWater()` |
| `night` / `dayNight` / `startHour` | the light is a resource | `nightAmount()` → `isLit`, `darkBlocks` |
| `convoy` | the caravan docks on a window: `{ open, closed }` | `convoyOpen` / `convoyRemaining` |
| `toolLimit` | how many of a tool may **stand at once** | `toolRemaining(tool)` |

Two rules keep these from turning into frustration, which is the failure mode the card was
written against:

- **A budget is a cap on what stands, not on what you ever spend.** Demolishing returns the
  slot (`restoreTool`, clamped at zero so authored terrain can't mint budget), so a
  mis-placed bridge is a mistake, never a softlock. `toolRemaining` also trims `runPlan`,
  which is the single source the ghost, the cursor readout and the drop all read — a drag
  can never promise tiles the budget won't pay for. `dig` is intentionally unbudgetable:
  its orders are painted and erased freely, so there is nothing standing to count.
- **A closed convoy stops dispatch, not cargo.** The planner simply doesn't route to the
  goal while the caravan is away (`acceptingSinkCells` still lists it — that function
  answers "could this item *ever* be carried there", and a dock window is transient, like
  the keep floor). A hauler already walking still delivers on arrival.

**Curve intent.** Campaign 1 must not out-length what follows it: levels 1–4 run roughly
60 · 90 · 265 · 405 s of sim time in the scripted proofs, and each campaign rises to its own
finale. Two spikes were caused by the same mistake — re-teaching the town-hall upgrade on a
huge map with a level-1-sized crew — so levels 4 and 9 now open at `startThLevel: 2`. Each
new pressure gets an **introduce → experiment → master** arc (the budget: 6 → 12 → 16; the
convoy: 10 → 11 → 12), and the campaign proofs in `tests/campaign*.mjs` are the guard: they
print each level's completion time, which is the only difficulty telemetry the repo has.
Read those numbers before and after any retune. Assertions there (and in `tests/unit.mjs`)
must derive from the level data — never pin an order amount or a phase duration, or the next
balance pass fails a test that was only ever measuring a tuning knob.

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

**Descent is now a build problem too (card #48).** The free empty-hand "hop down up to 5
tiles" is gone: `MAX_FALL` and `MAX_FALL_CARRY` are both `1`, so anyone steps down a single
tile for free but a deeper drop needs a Ladder (empty), a Ramp (either) or a Rope (cargo
down) — the mirror of the climb rules. This works *precisely because* ladders and ramps stay
instant terrain (model 1): the player drags a descending ladder/ramp down from the rim, so
there is no builder-reachability chicken-and-egg. See the movement contract table in
`docs/terrain-vision.md`.

**A ramp is a walkable diagonal, not a wall (card #59).** `T.RAMP` is *passable* and
self-supporting in `isStandable` — the cell holds earth below its diagonal and walking space
above it, so a smallie walks **into** a ramp cell instead of only on the flat cell above,
and a ramp never seals the row it is built in. Two consequences worth knowing before touching
`nav.ts`:

- The tiles of a ramp run *are* the steps, which makes **switchback stacks** work: anchor a
  reversed second run on the cell directly above the first run's top tile and the pair climbs
  in a tight footprint. Placement needed no new rule — the existing anchor clause ("a RAMP
  neighbour horizontally or diagonally counts as support") already accepts the turn, and
  `rampFacesLeft` already reads each leg as its own slope face.
- Nav's only ramp-specific edge is the **straight-down step** (`world.get(x, y + 1) === T.RAMP`
  → step down, cargo included): the mirror of the ladder's climb-down, and the move a
  switchback turn needs, since the upper leg's anchor sits directly *under* the lower leg's top
  landing. Deliberately one-way — a vertical ramp column is a cargo chute down, never a free
  cargo elevator up. `cargoReach` in `leveldata.ts` mirrors this rule; the verifier and nav
  must stay in lockstep or levels verify against physics the sim doesn't have.
- **Machine anchors need clear `AIR`, not merely a standable cell.** `liftTopFor` and
  `ropeDropFor` are the only gate `placeLift`/`placeRope`/`placeHoist` have (they never call
  `canPlaceBuilding`), and "standable" now includes ladder *and* ramp cells — anchoring a
  machine inside one orphans it the moment that tile is demolished. Both helpers therefore
  require the cell to be `T.AIR`, which matches `canPlaceBuilding`'s footprint rule and covers
  every built tile in one test.
