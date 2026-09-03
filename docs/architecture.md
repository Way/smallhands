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
63 · 92 · 187 · 367 s of sim time in the scripted proofs, and each campaign rises to its own
finale. Two spikes were caused by the same mistake — re-teaching the town-hall upgrade on a
huge map with a level-1-sized crew — so levels 4 and 9 now open at `startThLevel: 2`. Each
new pressure gets an **introduce → experiment → master** arc (the budget: 6 → 12 → 16; the
convoy: 10 → 11 → 12), and the campaign proofs in `tests/campaign*.mjs` are the guard: they
print each level's completion time, which is the only difficulty telemetry the repo has.
Read those numbers before and after any retune. Assertions there (and in `tests/unit.mjs`)
must derive from the level data — never pin an order amount or a phase duration, or the next
balance pass fails a test that was only ever measuring a tuning knob.

Campaign 5 (ids 18–22) adds **no pressure at all** — every field it uses already existed — so
its arc is built out of *pairings none of the earlier campaigns made*, and `flood` × `dig` is
the one it exists for. Its proofs run 154 · 241 · 130 · 190 · 401 s. Level 20 is a deliberate
dip rather than a regression: what escalates across the campaign is the number of schedules a
player must read at once (one, then two, then three), and the finale is still the longest run
in the game outside campaign 2's summit. `tests/campaign5.mjs` therefore prints **two** numbers
per level — the completion time and the wall-clock of the first rise — because `flood.min` and
the rain cadence are coupled, and a level whose tide lands after the sheet is already full has
lost the thing it was built to show (the level-17 mistake, in a new costume).

## The rising tide (cards #70, #75)

`flood` was a campaign-2 mechanic that only ever met open meadow. Campaign 5 digs into it, and
two rules had to exist before "a mine on the water's clock" was true rather than decorative.
Both live in `sim.ts`, and each is one line away from silently un-teaching its own level:

- **`openCell` — a cell opened at or below the table fills with water, not air.** `riseWater`
  converts what is air *at the instant of a rise*, so without this a gallery cut open after the
  last rain stayed permanently dry and the winning move on every flood level was to sit out the
  weather and then mine in peace. With it the rule is one sentence — **you cannot dig below the
  water table** — and it enforces itself: a shaft driven past the line fills as it is cut, and
  water is not `isSolid`, so it is not diggable and nothing drains a lake. It is the single
  path by which the world gains empty space after the level is built (a Digger finishing a
  tile, a demolish), which is why both callers route through it.
- **`sweepTile` — timber standing in a flooding row is swept away.** A `LADDER` cell is
  passable and a smallie standing on one is not "in water", so a laddered shaft used to be a
  dry corridor through the lake and a laddered gallery let a crew mine below the table for
  ever. The sweep **deletes the cell's `placedTiles` entry** so a `toolLimit` slot comes back:
  `toolRemaining` counts what stands through that ledger, and sweeping without clearing it
  spends a slot for ever, which is a genuine softlock. No material refund — the water keeps
  wood exactly as it keeps goods. Authored tiles are swept and credit nothing, the same
  asymmetry `demolish` has.

Consequently a budgeted tile now leaves the world by **two** paths, `demolish` and the sweep,
and both clear the ledger. Nothing else can: every placement path requires `T.AIR` and digging
skips built tiles.

**Authoring a flood level** (both asserted from level data by `tests/campaign5.mjs`, because
each is a softlock that never throws):

1. **The town hall, the caravan, and the row each RESTS ON must stay above `flood.min`.** The
   footprint alone is not enough — water is not `isSupport`, so flooding the support row stops
   the floor being standable and the dock becomes unreachable. A buried caravan needs its floor
   *and* the rock under it dry.
2. **The order sheet must be fillable from above the final waterline, with margin.** A drowned
   hauler's load is gone, so an exact-fit sheet softlocks on one mistake. Deep seams are the
   fast route and the medal route, never the only route.

Two hazards found while tuning campaign 5, neither of which throws: a **two-deep scrape strands
its digger** (it stands in the cell it opens, so the second cut drops it into a trench whose lip
has lost its support, and an unstandable lip cannot be stepped onto), and the **keep floor
starves machines** — `spare()` gates every autonomous consumer, so banking stone to protect a
hoist's ballast also stops haulers loading it into the cars.

## The keep floor is a target, not only a ceiling

`Game.keep[item]` is the player's "hold this much in the store" dial, and `spare()` is the one
policy every autonomous consumer reads: what is on hand, minus what a hauler already promised
to carry, minus the floor. That half — **what may not leave** — is old (card #64). The other
half is that the floor also says **what must arrive**, and the two are one control:

- **Below the floor, banking that item is the crew's FIRST job.** `bankPriority` returns −1
  while `spare(item) < 0`, so a loose unit (or a producer's output shelf) outranks the caravan
  and the production lines instead of sitting at the bottom of the list at priority 2. Without
  it the floor was mute about arrival: a flagged boulder lay on the ground with an empty store
  and a maxed floor while the haulers finished the caravan's plank order, which reads as the
  dial doing nothing. The boost cannot starve anything, because it only ever wins while there
  is loose material left to bank — once the ground is clear the candidates are simply gone.
  The default floor of 0 keeps `spare` at or above zero (a stock reservation is only made
  against a positive surplus), so an untouched game never reaches the boost.
- **Raising the floor turns back a haul already heading out.** The floor is re-read at the
  moment of pickup, not trusted from dispatch time — but the answer depends on the source. For
  the `stock` source it is an abort: the unit is in the store and stays there. For a `ground`
  or `output` source the unit is in the hauler's hands, so "leave it alone" is not on offer and
  the haul is **re-routed to the stockpile** — where the planner would send it if it were
  dispatched now. That gap is what the bug report looked like from the outside: the store at 0,
  the floor at the maximum, and the crew still carrying every stone it picked up to the wagon.

Both are asserted in `tests/unit.mjs`'s reserve block. Note what this does to the campaign
proofs, which set floors heavily: filling the reserve first *shortens* the levels whose next
build is waiting on it (level 3: 264 → 187 s) and *lengthens* the one that banks a large
reserve while its production line is still the bottleneck (level 9: 529 → 603 s). Both are the
dial working; read the printed times after any change to `bankPriority`.

## A level opens held (level start & the delivery release)

Two locks, one constructor option: `new Game(def, seed, { held: true })` sets
`phase = 'muster'` **and** `shipping = false`. `main.ts`'s `startGame` is the only caller that
passes it — the front-door backdrop, the editor's live sandbox and every headless suite but two
build a plain `new Game(def)` and get today's behaviour. The two exceptions are deliberate:
`tests/held.mjs` has to open a held game itself to guard the muster and the hatch at all, and
`tests/campaign1.mjs`'s level 1 plays through the held door as the one play-to-a-win proof that
exercises the entry a real player uses. That inverted default is still the single most
load-bearing decision here: about fifteen play-to-a-win suites tick straight into a scripted run,
and a locked default would stall every one of them with a failure that reads as a hauling bug.
`tests/held.mjs` **asserts** the default rather than trusting the convention.

- **The muster freezes the world, not just the crew.** `tick` returns early on `phase === 'muster'`
  after moving workers and particles, so `time` never advances — and with it the weather schedule,
  the convoy window, the rising tide, the day→night clock and the medal time all begin at Start
  rather than at the moment the level was built. `spawnTimer` does not decrement either, so the crew
  that musters is exactly `startWorkers`. The mover is the ordinary `tickMove`; the run loop is not
  touched, and `begin()` snaps every task-less worker onto its cell so nobody is left frozen between
  two tiles by a loop that only moves workers holding a task.
- **The line-up is derived from the worker's index.** Offsets grow outward from the town hall's left
  edge, each `settle`d and each checked with `findPath`; an unusable cell is skipped, and a worker
  with no reachable cell simply stays at the door. On a cramped map the line degrades to the picture
  the game had before this existed. No die is rolled: `tests/unit.mjs` counts the behavioural
  stream's readers and expects the wander's two.
- **`shipping` gates the route; `keep` gates the item.** They are not two versions of one dial. The
  release sits at the single goal-dispatch decision in `schedule()`, beside `convoyOpen`, so it shuts
  **all three** routes to the wagon — the store, a loose ground item, and a producer's output shelf.
  Gating the stock route alone is the leak the keep floor shipped with. It stays out of
  `acceptingSinkCells` for the same reason the convoy window and the floor do: that function answers
  "could this item *ever* be carried there", and a shut hatch is transient.
- **Shutting the hatch turns cargo back, and it turns back at a whole cell.** This follows the keep
  floor's precedent, not the convoy's "stops dispatch, not cargo" — the reason a player shuts it is
  that they still need the material. `setShipping(false)` marks the tasks, and `tickMove` acts on the
  mark at **three** points, all of them whole cells: the top of the tick, guarded by
  `w.px === w.cx && w.py === w.cy`, and both arrivals, which go through `settleArrival`. The guard's
  equality is exact because every step boundary assigns px/py and cx/cy from one value; during a lift
  ride `py` travels while `cy` stays at the base, and re-pathing there would snap the rider down to
  the foot of the mast with nothing in the log. The two arrival points need no such guard — they are
  whole cells by construction — and they are not optional: the walk branch calls `arriveAtTaskTarget`
  from *inside* the same tick that the top-of-tick check already skipped, so without them a hauler on
  its final step delivers to a shut wagon. That gap made the suite assert an absolute the code did
  not guarantee, and it held only because no hauler on the fixture's seed happened to be on its last
  step at that instant. `sinkRefused` answers "must this haul turn back" for the two routes where
  the item is already in hand: the pickup, consulted once a ground- or output-sourced unit is
  already in the hauler's hands to decide whether its sink still holds, and `divertToStock`,
  consulted again before it acts on its own mark — so a hatch the player re-opened before the
  mark fired lets the haul continue instead of turning back on a stale reason. The stock-source
  pickup is a deliberate third gate, not a third reader of `sinkRefused`: it checks the hatch
  inline against raw `stock - keep`, because `sinkRefused`'s fallthrough reads `spare()`
  (`stock - stockReserved - keep`), and subtracting `stockReserved` there would quietly tighten
  the keep floor's own guarantee for stock-sourced hauls.
- **Every surface is derived.** The Start card is rebuilt by `syncReadyOverlay()` from
  `game.phase`, because `showOptions`, the report overlay and a language change all call
  `clearOverlay()` — a card created once and left there is removed by the options menu, and the level
  is then stuck in muster with no way to start it. The lock is drawn on `goal_dock`, never on `goal`,
  because the wagon drives away on a convoy level and the sign has to stay — it is hung on the order
  board's own post rather than floating in the sky above the dock, which is where it first landed
  before it was judged against a render and moved down.

`npm run test:held` is the headless guard (the defaults, the frozen clock, the derived line-up, the
shut hatch, and mass conservation through a turn-back counted by census rather than by two
containers); its delivery-release and turn-back fixture is **level 3, not level 2** — level 2's
caravan sits behind a lift the level does not build until the player does, so nothing is ever
dispatched to it and a hatch assertion there would pass for the wrong reason regardless of which way
the gate faces. `tests/campaign1.mjs`'s level 1 is the other named exception above — it plays
through the held door as the one play-to-a-win proof that exercises the entry a real player
actually uses (mustered, Started, hatch opened) rather than only the sim behind it. Tidying it
back to a plain `new Game(def)` would delete that coverage silently, since every other suite would
stay green regardless.
`npm run test:levelstart` is the browser guard, and its three most valuable assertions are the ones
for failures that throw nothing: the overlay must not take the pointer, the card must survive the
options round trip, and the speed control must stay off — disabled, and unmoved by Space, which
starts the run instead — until the player presses Start. That suite also pins an invariant nothing
else states: **Start does not open the hatch** — `begin()` only flips `phase` and never touches
`shipping`, so the two locks stay independent, and a level authored shut stays shut until the player
(or the HUD row) opens it. `tests/caravan-shot.mjs` carries two frames this feature added — `shut`
(the hatch closed at the dock) and `shut-wagon-gone` (the lock still standing with the wagon rolled
away) — because the suite that judges the dock's own artwork could not previously render the state
this feature adds.

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

**The `place` event names which model fired.** `{ type: 'place' }` used to be bare, so every
placement sounded identical — a sawmill and a single ladder rung got the same blip. It now
carries `what: 'building' | 'tile' | 'order'`, and the field is **required**, not optional:
there are nine emitters, and the only reliable way to enumerate them is to let the compiler
do it. Two of the nine are not where you would guess — the harvest flag (`toggleMark`) is an
`order`, because a flag is an intent marker the player paints and erases exactly like a dig
order, and the **town-hall upgrade is a `building`**, because it is genuinely the
blueprint+builder model (it is in the list above). It had been chirping like a ladder.
A tenth emitter added later cannot compile without choosing.

`node` rides along on the one placement that targets a resource — flagging it — so the cue
can answer in that resource's own material. The sim reports the *node*, never a material
name: it has no opinion about how a boulder sounds.

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

## The goal is a caravan (card #71)

Every level's win condition is "fill the caravan's order sheet", and the story the copy tells
is that the crew **loads the wagon before it rolls on**. The goal used to be drawn as a
sandstone temple with a glowing portal, so the picture and the fiction disagreed — the one
object the player is working *towards* all level was the only one that didn't say what it was.
It is now a covered trade wagon, and three rules keep that honest:

- **Two sprites, not one.** `goal` is the wagon; `goal_dock` is the station it stands on (order
  board, loading ramp, lashing post, flagstone kerb). The split exists because on a `convoy`
  level the wagon *leaves* — so something has to stay behind and go on saying "deliver here".
  Anything bolted to the wagon travels with it, which is why the loading ramp is dock furniture:
  as the wagon's own tailgate it rolled away and read as a flight of steps floating in mid-air.
- **The wagon's position is derived, never stored.** `caravanRoll` in `src/game/caravan-look.ts`
  turns `Game.convoyOpen` / `convoyRemaining` into a slide offset and an alpha, so the picture
  reads the *same* schedule that gates dispatch (`sim.ts` routes to the goal only while the
  window is open) and cannot drift from it — mid-animation included, restart included. The
  property that matters is the one a picture can silently break: a wagon parked on the dock
  must mean the window is open, and a wagon out of sight must mean it is shut.
  `tests/caravan.mjs` asserts both by stepping a real convoy level through three full cycles.
- **The load is the order sheet.** `crateLoad` stacks up to `CARAVAN_CRATES` crates in the
  wagon's open rear — the only place the player reads delivery progress off the world rather
  than the HUD. Two deliberate non-linearities: the *first* delivery must move the pile (plain
  rounding hides deliveries 1–2 of a 40-unit order, and a load that doesn't budge reads as
  broken hauling), and a full stack must mean a full sheet (so "loaded" never lies).

**The art lesson, because it cost four passes:** at a 4×3 footprint a wagon reads as a wagon
only if the **wheels are big, filled and cross the body line**, and if the space between them
is closed by a belly and a reach beam. The first pass had thin see-through wheels under a deep
bed on a full-width plank deck: every horizontal line landed at the same place and the whole
thing read as a market stall on stilts. Sprites are authored by stamping onto a char grid
(`bgrid`/`bbox`/`bwheel`/`btilt` in `src/engine/sprites.ts`) — `btilt` returns its per-column
canvas top so the rear third can have the cloth rolled back over bare hoops without
re-deriving the arch, and `drawCaravanFlags` fits a parabola to that same arch so the bunting
lies *on* the canvas instead of hanging in the sky.

`npm run test:caravan` is the headless guard (load arithmetic, roll-vs-window, copy);
`npm run test:caravan-shot` is the eyeball helper — it writes the wagon at four load levels and
three convoy states to `tests/.caravan-out/`, which is how the passes above were judged.

## A biome tints the weather, it doesn't own it (card #76)

The sky and the three parallax layers behind a level belong to the **weather look**
(`src/game/weather-look.ts`); a biome only leans on them. The weather carries every value
relationship — the two hill layers' separation and the whole clear→rain→storm darkening — and
`BIOME_LOOK.hillTint` / `skyTint` rotate the hue, applied after the weather blend so a phase
crossfade keeps working. `biomeSky`, `biomeHills` and `HILL_SKY_MIX` are exported from that
module and are the *only* place the mix happens: `render.ts` calls them and so do the tests,
because a copy of the arithmetic in a test would drift from `drawSky` and go on passing while
the screen was wrong. That is exactly how `redrock` shipped a sage-green horizon over
terracotta ground — nothing pinned the numbers, and the layer that reads worst is the one
hardest to eyeball.

**`hillTintAmt` is a trade-off, not a strength dial.** Two bounds squeeze it from either side,
and both are properties of *where* the layer sits:

- The horizon range is 55% sky (`HILL_SKY_MIX.horizon`). Under a blue sky no tint below ~0.76
  can bring it out warm at all, whatever the biome asks for — which is why "raise the number a
  bit" was not enough for redrock and 0.85 is.
- The near scrub line gets **no** sky mix, so the tint is the only thing colouring it. Luma is
  linear through the mix, so that layer's clear→storm drop is exactly `(1 - hillTintAmt)` of
  the weather look's own — at 1.0 every weather paints the scrub the identical colour and the
  storm stops registering on the layer closest to the player.

Which biomes must obey the no-green rule is **derived, not listed** (a list is what let the bug
exist): a biome with red bedrock *and* dry grass has no green anywhere in its country, so it
may have none in its distance. That rules `chalk` out without an exemption — chalk grows green
grass over pale stone, so green downs behind its white cliffs agree with its foreground — and
covers the next desert biome the day it is added. Chalk's own tint was examined and left: it
looks like a dead knob (within a few units of the clear hills) but lifts the *rain and storm*
hills by up to 22 units, so zeroing it is a visible change, not a cleanup.

`npm run test:biome-light` is the headless guard (hue bands, the storm-still-darkens floor, and
an exact pin of all five untouched biomes under all three weathers); `npm run test:biome-hills`
is the eyeball helper — it writes every biome × weather × night case plus campaign levels 18
and 22 to `tests/.hills-out/`, which is how this pass was judged. Neither can be skipped: no
number settles whether a horizon looks like it belongs to the ground.

## Sound is material, not entity

Every cue is synthesized at runtime in `src/engine/audio.ts` — no asset files, which is why
"add a sample" is never the cheap fix here. Two rules keep that from turning into a pile of
one-off beeps.

**One vocabulary: `Material = 'wood' | 'stone' | 'metal'`.** Clicks and harvests both key off
it, deliberately, so the HUD and the world agree about what iron sounds like. The engine
knows nothing about trees or veins — `main.ts` owns `HARVEST_MATERIAL` (by `NodeKind`) and
`ITEM_MATERIAL` (by `ItemType`), and both are full `Record`s so a fourth resource is a build
error rather than a silent fallback to wood. That fallback is the failure this exists to
prevent: resources that all sound the same is indistinguishable from the cue never having
been wired up, and it never throws. Crafted tools go with their working end, not their
handle — a shovel is a wooden shaft, but what you hear is the blade.

`click(material = 'wood')` defaults because wood is the game's *neutral* material: menus,
buttons and toolbar chips are the neutral surface, which is also why the ~20 existing callers
needed no argument.

**Materials are separated by decay and harmonicity, never by pitch.** Pitch-shift one cue
three ways and it is audibly the same cue three times. So wood cracks and is gone, stone is
the shortest and most brittle, and metal rings — `ring()` uses plate-like ratios (1 / 2.76 /
5.4) precisely *because* they are inharmonic; whole-number partials read as a bell or a
plucked note, and ore should read as a dull clang.

The one apparent inconsistency is intentional: **struck ore rings (`harvest('metal')`, 0.42s)
but worked iron thunks (`click('metal')`, 0.08s)**. A ring at click frequency nags, which is
the one thing a UI cue must never do.

`tone()`'s 8ms attack is **not** to be shortened. Fourteen cues are voiced against it, so
changing it there retunes the whole game at once. That ramp is longer than the entire
transient a click is made of, which is why a lone square read as a soft beep and why the
click has its own `tick()` (contact — band-passed noise, sub-millisecond attack) and `body()`
(material — pitched, falling as it decays) instead. `placeBuilding` stacks three layers and
is the loudest thing the engine plays, because a blueprint is the heaviest commitment the
player makes.

`npm run test:audio-smoke` is the guard, and it is honest about its limit: it cannot hear.
What it catches is the failure that reaches players — WebAudio throws on a bad param at call
time, and a cue that throws is silence plus a console line nobody reads — plus the wiring
that silently degrades: flagging a resource must emit an order **carrying its kind**, or the
cue has nothing to pick a material from and quietly falls back to neutral.

## The landing page counts, it doesn't claim (cards #67, #25)

The front door is marketing copy about a game that keeps growing. Card #67 found `feat1`
reading "2 hand-crafted campaigns · 9 levels" long after there were four and seventeen and
fixed it by hand; it stayed right afterwards only because campaign 5's own commit remembered
to edit the string. What card #25 found is the failure that remembering doesn't cover:
campaign 5 shipped with no landing hook, no unlock banner, and two of the game's five level
pressures described nowhere. Three rules exist so the next campaign updates the page by
arriving.

- **Numbers in `frontdoor-copy.ts` are `{c}` / `{n}` placeholders, never digits.**
  `frontdoor.ts` fills them from `LEVELS`, `TOOL_DEFS` and `BIOMES` (`trf()`), so the drift is
  *impossible* rather than merely guarded. The copy table stays a pure, import-free data
  module — the renderer is what reads the level table, which is free because `main.ts`
  already imports it for the world map. `tests/frontdoor-data.mjs` therefore checks for the
  **placeholder**, plus that no digit was typed in beside it: the only remaining failure is
  someone "simplifying" the interpolation away, after which the count is stale the next time
  a level lands. It also reads `TOOL_COUNT` / `BIOME_COUNT` **out of `frontdoor.ts`** rather
  than re-deriving them, because a test that re-implements the filter agrees with itself
  while the page prints a different number — which is what made `bundle.mjs` learn to stub
  CSS imports. The one count that cannot be interpolated is `index.html`'s
  `<meta name="description">` — a static file the table can't reach — so that one is
  compared against `LEVELS` for real, and must land inside the ~155-char search snippet.
  Watch which list a count comes from: **landscapes are `BIOMES`, not `GENERATED_BIOMES`**
  (the generator draws from a deliberately shorter list), and both are asserted so swapping
  them has to be deliberate.
- **A campaign is keyed by its number on three surfaces, and each is a place it can arrive
  without its words:** `camp<n>Body` (the landing roll-call hook), `map.terr<n>` (its name —
  read by *both* the world map and the landing page, so a rename can't make them disagree)
  and `win.campaign<n>` (the unlock banner). The banner is the one that failed silently:
  `main.ts` held a literal `{2,3,4}` map with a fallback to campaign 2, so finishing Shaft &
  Seam congratulated you on unlocking Storm & Tide. It now derives the key and uses `tOr`
  with a generic `win.campaignNext`, because `t()` prints an unknown key straight to screen.
  `tests/frontdoor-data.mjs` walks the campaign ids in `LEVELS` and demands all three.
- **The page describes every pressure, and the pressures are the ones in `LevelDef`.** The
  "world that fights back" grid ran three cards (day-night · weather · flood) while `convoy`
  and `toolLimit` shipped undescribed — a pressure the player meets with no warning reads as
  the game being unfair rather than unread. Five cards now, laid out 3-then-2 via six grid
  columns; those spans **must** be reset at the mobile breakpoint or they spill into implicit
  tracks and the row of three renders 16px narrower than the row of two.

`npm run test:frontdoor-data` is the headless guard (placeholders, tool count, per-campaign
copy on all three surfaces, the meta description); `npm run test:landing-shot` is both a
layout guard (no horizontal overflow at three widths in both languages, the derived values
actually reaching the DOM, the 3+2 shape) and the eyeball helper — it writes the three bands
to `tests/.landing-out/`, which is how Shaft & Seam's icon lost the shovel to `vein`. No
number settles whether an icon reads at 34px.

## The wordmark grows out of its baseline (front door)

`fd-logo-raise` in `src/frontdoor.css` is a baseline-anchored vertical squash: `scaleY: 0 → 1`
with `transform-origin: bottom`, full opacity throughout, 0.6s. Every glyph is *whole* at
every moment and merely compressed — a squashed `a` keeps its bowl — which is the difference
between reading as growth and reading as an unveiling. A bottom-up `clip-path` reveal looks
near-identical in a still and wrong in motion, so the distinction cannot be eyeballed from a
screenshot.

The keyframe stops **are a measurement**, sampled per frame and normalised, which is why
interpolation between them is `linear` — the curve lives in the stops, and an easing function
on top would apply it twice. Retime by scaling the duration, never by editing the stops.

`fd-float` must stay last in the `animation-name` list: both animations drive `transform`, and
they are kept from overlapping by delay alone (raise ends at 0.72s, float starts at 1.4s).

`npm run test:frontdoor-logo` asserts what is mechanizable — each stop tracks its keyframe, the
baseline does not drift, and reduced motion lands on the finished wordmark opaque at full
height rather than on a frozen squash — and writes the stops to `tests/.logo-out/` for the part
that isn't: whether whole-glyph squash actually reads as growth.

## Phone widths: the front door's rows shrink, they never wrap (card #77)

The front door's two icon rows — the hero production chain and the closing village skyline —
are **sequences whose order is the content**, and a phone is where that gets tested. Both now
obey one rule: **the row keeps its shape and the icons give way.**

- **The chain never wraps.** `flex-wrap: nowrap` plus `flex: 0 1 auto; min-width: 0` on the
  canvases (the `min-width` is what actually permits it — a replaced element's automatic
  minimum size is its specified width, so without it the row overflows instead of squeezing),
  and `height: auto` + `aspect-ratio: 1` so a shrinking width doesn't flatten the sprite. The
  arrows are `flex: 0 0 auto`: six 23px icons still read as a chain, a 6px arrow does not.
  The row it replaced broke wherever the width ran out — at 390px it left an arrow dangling at
  the end of the first line pointing at nothing, which is the exact opposite of what a row
  captioned "your crew runs the line" is for.
- **`min-width: 0` on `.hero-in` is part of that fix, not a tidy-up.** It is the flex item of
  `.hero`, so its automatic minimum is its min-content width — which an un-wrapping chain now
  owns. Left at `auto`, the hero cannot get narrower than 385px and a 320–375px phone scrolls
  the *whole page* sideways while the chain sits at full size: the shrink never engages,
  because nothing is ever short of room. Any future nowrap row inside a flex item needs the
  same release valve.
- **The skyline is sized from one `--s` per figure** so the same shrink applies without a
  second `height` winning over `height: auto` and squashing the village flat. Shrink is
  distributed in proportion to each figure's width, so the town hall stays the tallest thing
  on the ridge. It is full-bleed (not inside `.wrap`), so it carries its own gutter.

Two neighbours were the same defect in text and chrome, and both put horizontal scroll on the
page — which is worth stating plainly, because *any* one of these makes the whole document
scroll sideways and the symptom names none of them:

- The wordmark's `clamp(56px, 12vw, 116px)` **floor** is 321px of Pixelify, and a 320px screen
  offers 276px. A single unbreakable word cannot wrap out of that, so the H1 alone overflowed;
  `min(clamp(…), 14vw)` lets the floor give way below ~400px and leaves the ramp above it be.
- `.fd-topbar-in` is also a `.wrap`, and its `padding: 11px 0` shorthand **zeroed that class's
  horizontal gutter** — so on every screen under 1060px the brand and the language toggle sat
  flush against the edges while the hero kept its 22px margin, and `.wrap`'s
  `env(safe-area-inset-*)` (the thing that keeps controls out from under a notch) went with it.
  Vertical padding only, here and in `(pointer: coarse)`.

**Source order carries the narrow-width rules.** A phone is coarse *and* narrow, media queries
add no specificity, so `(pointer: coarse)` sits *above* the `max-width` blocks in the file: it
owns the thumb-sized vertical padding, and the width blocks own the horizontal. A `padding`
shorthand in the coarse block re-widens the EN/DE toggle that used to fall off a 320px screen —
on touch devices only, which is the one place nobody is looking with a mouse.

Below 360px the page gives its own gutter back (22px → 14px, safe-area insets kept), because
eight pixels of margin buy six pixels of icon where the icons are smallest, and German compounds
get `hyphens: auto` there — "Produktionsketten" is wider than a 280px card's text column, and an
unbreakable word makes the *whole page* scroll, not just its own card.

`npm run test:frontdoor-mobile` is the guard: 13 widths from 280px (a folded cover screen) up ×
both languages × pointer coarse and fine, asserting **slack** rather than the absence of a
symptom (a fit by one pixel — which is what the English top bar had at 390px — is not a fit; see
`tests/tool-labels.mjs` for the same lesson learned the hard way). It prints each width's
measurements on its ok line, because those numbers are what a retune has to be judged against.
Three of its own assertions are worth knowing before editing it: **room is the content box**
(`clientWidth` includes `.wrap`'s gutter, and measuring against that called an overhanging row a
139px fit), **equal-width means within a pixel** (flex hands the shrink deficit out in fractions),
and **each language pass asserts it is really in that language** — the German copy is the wider
of the two, so a toggle that quietly stopped working would leave the sweep passing on English
twice.

## The version is the commit's date (card #74)

One build-time stamp, three readouts: `vite.config.ts` derives `__VERSION__` (`2026.07.29`, the
**deployed commit's date**) for the front-door footer and an options-menu row, and `__BUILD__`
(`__VERSION__` + `'+'` + short sha) for the bug report. It is deliberately never `pkg.version` —
`0.1.0` has never been bumped, there are no tags, and every push to `main` deploys, so there is
no discrete release to name and a printed semver would be silently wrong on every day but the
first. A date-of-*commit* also keeps the bundle byte-stable across rebuilds, which a
date-of-build would not.

Two things here are one line away from breaking quietly. The footer takes the value through
**`trf('version', { v: __VERSION__ })`** — the placeholder rule the landing-page section above
records, with a second reason of its own: `frontdoor-copy.ts` must stay free of build-time
globals as well as of imports, because two suites load it under plain Node, where `__VERSION__`
is simply undefined. And **`'dev'` is a failure, not a mode**: git being unavailable ships
"Version dev" off a build that exits 0 and a page that looks fine, so `vite.config.ts` throws on
`VERSION === 'dev' && process.env.CI`. No test can own that one — `deploy.yml` runs no `test:*`
script, and a checkout has git by definition, so the suite only ever runs where the fallback
cannot fire.

`npm run test:version` is the headless guard (the three surfaces agree, the shape is a date, and
the options row's *label* is translated rather than a raw key printed to screen). It never
recomputes the date: a second copy of that derivation drifts, and then goes on passing while the
screen is wrong.
