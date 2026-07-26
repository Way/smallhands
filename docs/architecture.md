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

## The sim is deterministic (card #65)

`Game` draws randomness from seeded `mulberry32` streams (`src/game/rng.ts`, shared with the
level generator) — and from **two of them, deliberately split by kind**:

| Stream | Drawn by | Rule |
|---|---|---|
| `rand` | `tryAssignWander` — and nothing else | Behavioural. Only sim logic inside the tick may draw from it. |
| `randFx` | particle fans, spawn `facing`/`animT`, dust puffs | Cosmetic. Safe for anything, including the UI, to advance. |

`new Game(level, seed?)` defaults the seed to `level.id`, so a suite that passes no seed still
replays the same run every time; `main.ts` passes a fresh `randomSeed()` per attempt so real
play keeps its variety.

Why the split rather than one stream: `tryAssignWander`'s idle stroll is **behavioural** —
moving an idle smallie changes who is nearest when the next task opens, which changes
assignment order and so the timing of the whole run. `spawnBurst` is public and the UI calls
it (win confetti, harvest-flag sparks in `main.ts`), so on a shared stream a click that changes
no sim state would still shift the wander and reorder assignments: **render feeding back into
the sim**, which nothing else in this codebase does. Separate streams make cosmetics
unobservable to behaviour, in the browser as well as headless.

While the wander drew from an unseeded `Math.random()`, every play-to-a-win suite — `hoist`,
`campaign1`–`campaign4`, `digging`, the `editor-generator` soak — was a *sample*, not a proof,
and `hoist` reddened about 1 run in 20 on a genuinely wrong assertion nobody could reproduce.

Three rules follow, all enforced by `tests/unit.mjs`:

- **No `Math.random()` on the tick path.** The sweep is an *exemption* list, not a list of files
  to check: everything under `src/game` is swept unless named in `RENDER_ONLY` (`render.ts`,
  `motion.ts`, `generator.ts`, `leveldata.ts` — look-physics, seed minting, id minting, none of
  which can move a smallie). A module added to the tick path later is therefore covered by
  default, exempting one is a deliberate act, and a stale exemption naming a file that no longer
  exists reds. Comments are stripped first, so prose about the global can't red it.
- **Cosmetics never touch `rand`.** The suite counts the behavioural draws in `sim.ts` and
  expects exactly the wander's two; adding a third re-couples the streams.
- **Assert on state, not on the instant.** A play-to-a-win loop breaks the moment `won` flips,
  which is an arbitrary point in the hauling cycle. An item mid-run may be in `stock`, loose in
  `groundItems`, in a worker's hands (`w.carrying`), or in one of a building's four buckets —
  `inputs`, `outputs`, `hoistUpper`, `hoistLower` (the same four `locateItem` counts, and *not*
  `hoistUpperIn`/`hoistLowerIn`, which are inbound reservations that double-count the hauler
  already holding it). `tests/hoist.mjs`'s `stoneCensus` counts them all and is itself tested
  container by container; reading only two of them is what made the ballast check flaky.
  **Scan for such an instant, don't pin a seed to it.** A seed that happens to win mid-haul is an
  emergent trajectory — the first attempt was retired by an unrelated draw-order change within a
  day, and its red read like a ballast bug. Stepping the run tick by tick finds the state in
  *every* run and lets the suite check mass on every tick, which is both stronger and rot-proof.
