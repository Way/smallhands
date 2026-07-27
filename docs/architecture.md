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
  slot, so a mis-placed bridge is a mistake, never a softlock — but only for placements the
  *player* made. That is what the `placedTiles` / `placedBuildings` ledger is for: a bare
  clamp at zero is not the guarantee it looks like, because once any budget has been spent
  there is room under the counter for level-authored terrain (an Ember Road adit ladder) to
  refund into. Tiles are safe to track by cell because a built tile can only leave the world
  through `demolish` — every placement path requires `T.AIR`, and digging skips built tiles.
- **One predicate gates every placement.** `Game.canAttemptPlacement(tool, x, y)` owns the
  tool-independent half — unlocked at this town-hall level, inside the budget, affordable
  (with the ladder's log-or-plank exception), not refused for darkness — and each caller adds
  only its own geometry. Seven ghost previews and four `place*` methods read it. They used to
  re-list those checks by hand, which is exactly how the budget gate reached the workshop
  preview and missed the lift, rope, hoist, bridge, ramp and ladder ones: a green outline
  over a click the sim refuses. Add a new gate here, never at a call site.
- `toolRemaining` also trims `runPlan`, the single source the ghost, the cursor readout and
  the drop all read — a drag can never promise tiles the budget won't pay for. `dig` is
  intentionally unbudgetable: its orders are painted and erased freely, so there is nothing
  standing to count.
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

## The sim is deterministic (card #65)

`Game` draws randomness from seeded `mulberry32` streams (`src/game/rng.ts`, shared with the
level generator) — and from **two of them, deliberately split by kind**:

| Stream | Drawn by | Rule |
|---|---|---|
| `rand` | `tryAssignWander` — and nothing else | Behavioural. Only sim logic inside the tick may draw from it. |
| `randFx` | particle fans, spawn `facing`/`animT`, dust puffs | Cosmetic. Safe for anything, including the UI, to advance. |

`new Game(level, seed?)` defaults the seed to `level.id`, so a suite that passes no seed still
replays the same run every time; `main.ts` passes a fresh `randomSeed()` per attempt so real
play keeps its variety. The seed is kept as `game.seed` and stamped into the bug report's run
table (`report.ts`), because a per-attempt seed nobody records makes a *reported* run
irreproducible even in principle — with it, `new Game(level, game.seed)` replays exactly what
the player saw.

Each stream is asserted twice, and **replay does not imply seed-driven**: a stream wired to a
constant replays perfectly while ignoring the seed entirely. So `tests/unit.mjs` checks replay
(same seed → same run) *and* divergence (different seed → different run) per stream — behaviour
compared with cosmetics excluded, and the fx stream sampled at spawn before the first tick, since
`animT` accumulates at behaviour-dependent rates and would otherwise smuggle `rand`'s divergence
into a claim about `randFx`.

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

Three rules follow — the first two enforced by `tests/unit.mjs`, the third by `tests/hoist.mjs`:

- **No unseeded randomness *and no wall-clock read* on the tick path.** `Date.now()`,
  `performance.now()` and `new Date()` break a reproducible tick exactly as `Math.random()` does,
  so both are swept together. Every `.ts` under `src/game` and `src/engine` is read —
  recursively, so splitting `sim.ts` into `sim/*.ts` stays covered — and the *exemptions* are
  per pattern, keyed by **path** rather than basename: `ENTROPY_OK` (`game/render.ts`,
  `game/motion.ts`, `game/generator.ts`, `game/leveldata.ts`, `engine/audio.ts` — look-physics,
  seed minting, id minting, playback jitter) and `CLOCK_OK` (`game/dailylog.ts`,
  `game/generator.ts`, `game/leveldata.ts`, `game/report-ui.ts` — calendar walking, the daily
  seed, id stamps, a report's `generatedAt`). So a file allowed to roll dice is still swept for
  clock reads; an `engine/render.ts` added later does not inherit `game/render.ts`'s licence; a
  module added to the tick path is covered by default; and an exemption reds both when it names
  a file that no longer exists **and** when its file no longer needs it — an exemption shielding
  nothing is indistinguishable from cover until the day it matters. Comments are stripped first so prose about the global can't red it, with a `[^:]` guard
  so a `//` inside a URL doesn't blank the rest of its line and hide a real call.
- **Cosmetics never touch `rand`, and `rand` never leaves the sim.** Enforced three ways. The
  suite counts the behavioural draws across *every swept file* and expects the wander's two; a
  third re-couples the streams. Because a count matches an *identifier*, it also rejects any
  `this.rand` in a non-call, non-assignment position — passing the stream to a helper that names
  its parameter `roll` would otherwise draw from it with the count still reading 2. And it runs
  twin games, one of them painting bursts from outside the tick as the UI does, requiring their
  behaviour to match byte for byte.
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
  The hoist suite scans three seeds that way (~2.5k ticks each) and still finishes in 0.14s.

## Offscreen stills (card #72)

Three places show a *picture of a whole level* rather than the live viewport: the level-select
popover (its starting map), the win ceremony (the map you just finished, with Save / Copy /
Share), and the bug report's overview shot. All three go through **one** function,
`renderMapShot` in `src/game/mapshot.ts`, and that is the point of the module — not code
reuse, but a single place to keep two rules that are invisible at the call site:

- **A second Renderer on a live Game starves the first one.** `MotionLayer.update` drains
  `game.lookEvents` on every call, *including* the reduced-motion early return (card #58), so
  every still swaps in a throwaway outbox for the duration of the draw. This is one line away
  from a bug that shows up as the live game quietly losing its look-physics — nothing throws,
  nothing logs.
- **Never draw below 1:1.** The renderer draws with smoothing off, so at a fractional zoom the
  nearest-neighbour scaler drops whole rows of source pixels and a one-tile ladder rung or a
  rope simply disappears. Thumbnails are drawn full size and then downscaled *with* smoothing,
  which keeps thin structures as a soft line instead of deleting them. `SHOT_THUMB` and
  `SHOT_FULL` are the two sizes in use.

`hideParticles` exists for the same reason: the win burst is a moment, not a structure, and it
differs on every run — a souvenir of the map should be the map.

**Previews are lazy and cached per session, not pre-rendered.** `main.ts` owns `levelPreview`
and builds a level's shot the first time its popover opens; `worldmap.ts` only takes it as a
dep, so the map screen stays free of `Game` and `Renderer`. Rendering every level up front
would cost a Game and an offscreen draw apiece for pictures nobody asked to see, and the world
map is opened far more often than any single node. No seed is passed, so `Game` falls back to
`level.id` and the *world* in a preview is identical every time — the picture is not quite, since
`Renderer` seeds its clouds from `Math.random()` per instance (legitimately `ENTROPY_OK`), so the
sky differs between sessions. The cache is what holds a preview still within one.

The pill's height therefore varies with the level's aspect ratio, which is why `fitPopover` in
`worldmap.ts` decides the above/below flip by **measuring** rather than by the old `at.y < 470`
threshold: `.overlay.worldmap` is `overflow: hidden`, so a pill that misses the visible box is
silently cut off rather than scrollable. Measured before the fix, seven of the seventeen pills lost
their preview and name off the top at 1280×720.

**The win snapshot is view-once.** It is not written to the save: `save.records` lives in
localStorage next to the custom levels, and a PNG per level would eat a real fraction of a
~5 MB budget to store something the player can already save to disk. Export routes live in
`src/game/share.ts` (download · clipboard image · Web Share), each feature-detected and each
reporting what actually happened — a Share button that opens nothing, or a "saved!" over a
file the browser refused, is worse than not offering it.
