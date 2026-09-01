# Level start ("muster") and the delivery release — Design

**Date:** 2026-09-02
**Status:** Approved design, pending implementation plan

## Problem

Two complaints, one root: **a level commits the player before the player has decided anything.**

1. **The level is already running when you arrive.** `startGame` (`src/main.ts:1389`) builds the
   `Game` and sets `speed = 1` in the same breath. The crew starts assigning tasks on the first
   `schedule()`. Level hints with `when: () => true` (`lvl1.hint.welcome`) fire into a toast while
   the sim is already moving, so the one line of copy explaining the level is read *over* the thing
   it explains. There is no moment to pan the map, read the order sheet, and find the caravan.

2. **The starting stock ships out immediately.** `startStock` lands in the store, goal delivery is
   priority 0, and `keep` defaults to 0 — so on the first `schedule()` the crew empties the store
   into the caravan. Material the player was going to spend on a lift, a forge or a town-hall
   upgrade is gone before the first click. The player can prevent it, but only by knowing about the
   per-resource keep dial and setting it in the first seconds, which is the definition of a trap.

## Goal

- A level opens **held**: the crew musters out of the town hall, lines up in front of it, and waits
  behind a translucent Start card. The player pans, reads and plans, then starts the run.
- The caravan's hatch opens on the player's word, not on the level's. One switch, not one per
  resource, reachable both from the HUD and from the wagon itself.

## Non-goals

- **No planning during the muster.** Look, pan, zoom, inspect — no tools, no placement, no dig
  orders. A planning phase would need the cost accounting and every ghost preview to be correct in
  a phase where nothing can be paid for yet. Decided explicitly; revisit only as its own card.
- **No per-resource shipping toggle.** That is `keep`, and it already exists (card #64).
- **No `held` field on `LevelDef`.** Every level opens the same way. A list of exceptions is a list
  someone has to maintain, and the rule stops being derivable from the level.
- **No new wagon art for the closed state.** A lock glyph drawn over the dock's order board is
  enough; the wagon sprites cost four passes and are not being reopened.
- **The muster is not a cutscene.** No camera moves, no letterboxing, no skip-on-first-input beyond
  the Start button itself.

### A reversed decision, recorded

`docs/superpowers/specs/2026-07-11-resource-reserve-design.md` lists as a non-goal: *"No global
'pause all deliveries' toggle (considered and rejected as too coarse)."* This design reverses that.
The reasoning has changed, not been forgotten: `keep` was designed as a **floor for a resource the
player is saving up**, and it is the right tool for that. It is the wrong tool for **"the road is
shut"**, which is a property of the route, not of any item — expressing it through `keep` means
setting five dials to hold a delivery that has one cause. The two now compose: `keep` says *how much
of this item stays home*, `shipping` says *whether anything leaves at all*.

## Design

### One option, two locks

`Game` gains one constructor option that sets both locks, because they are the same idea — the level
starts held — and because a flag whose default is "locked" would red every headless suite:

```ts
constructor(level: LevelDef, seed: string | number = level.id, opts?: { held?: boolean })
```

`held: true` sets `phase = 'muster'` and `shipping = false`. Without the option, `phase` is `'run'`
and `shipping` is `true` — today's behaviour, byte for byte.

This matters more than it looks. Roughly fifteen suites build `new Game(def)` and tick immediately
(`tests/campaign1–5`, `unit`, `hoist`, `digging`, `ramp`, `terrain`, `caravan`, the editor soak).
A `shipping = false` default would stall all of them, and the failure would read as a hauling bug.
The opt-in keeps them untouched, and `tests/held.mjs` **asserts the defaults** rather than assuming
them, so the protection is a test rather than a convention.

Callers:

| Caller | `held` | Why |
|---|---|---|
| `main.ts` `startGame` (campaign + custom) | `true` | The real thing. |
| `main.ts` playtest from the editor | `true` | A playtest that behaves differently from the game is worthless as a test. |
| `main.ts` `idleGame` (front-door backdrop) | `false` | A frozen backdrop is a broken backdrop. |
| `verifyLevel` / the generator soak | `false` | Solvability proof; the muster proves nothing and costs ticks. |
| Headless suites | `false` (default) | Unchanged. |

### The muster phase

**State.** `phase: 'muster' | 'run'` on `Game`.

**Tick.** At the very top of `tick(dt)`, before `this.time += dt`:

```ts
if (this.phase === 'muster') { this.tickMuster(dt); this.tickParticles(dt); return; }
```

`tickMuster` walks `this.workers` and calls `tickMove`. Everything else holds: `time`, and therefore
`timeOfDay`, the weather schedule, `convoyOpen`, `riseWater`, `tickBuildings`, `tickGravity`,
`schedule()`, `tickHints`, `recomputeStranded`, and the medal clock. `spawnTimer` never decrements
either, so the crew that musters is exactly `startWorkers` and nobody joins mid-line-up. A level's
first second is the first second after Start.

**The mover is the ordinary one.** `tickMuster` calls `tickMove` directly, so the run loop's
`else if (w.task)` branch is not touched at all — the running game keeps the exact code it has today.
`tickMove` calls `arriveAtTaskTarget` only when `w.task` is set (`sim.ts:2170`, `sim.ts:2255`), so a
worker with a path and no task walks and then stands. There is no second mover, no second set of
movement physics, and every existing rule (ladders, ramps, the fall cap) applies to the walk out.

`begin()` is what makes this safe: it snaps every task-less worker to its cell (`px = cx`, `py = cy`)
and clears the leftover path, so nobody is left frozen half-way between two tiles by a run loop that
only moves workers with tasks.

**The line-up.** `startMuster()` runs once, from the constructor, when `held`. It hands worker `i` the
`i`-th cell of a sequence that grows outward from the town hall's left edge — offsets
`0, 1, 2, 3, −1, 4, −2, 5, …` from `th.x`, each dropped to the ground with `settle()`, each reached
with `findPath`. A cell that `settle` cannot find, or that `findPath` cannot reach, is skipped; a
worker with no reachable cell simply stays at the door. On a cramped map (campaign 5's buried
caravans, a cliff-edge hall) the line-up degrades cleanly to today's picture instead of throwing.

The offsets are **derived from the index, never drawn**. `tests/unit.mjs` counts behavioural draws
across every swept file and expects exactly the wander's two; a third would red it.

`spawnWorker`'s `randFx` draw for `facing` **stays exactly as it is**. It looks like a natural thing
to replace with the walk direction, but `tests/unit.mjs` samples `facing` and `animT` at spawn — before
the first tick — as its proof that the cosmetic stream diverges on a new seed. Removing that draw
removes the sample the guard reads. The walk sets `facing` on its own through `tickMove` anyway.

**Starting.** `begin()` sets `phase = 'run'` and clears any leftover muster path, so the first
`schedule()` after Start dispatches from a clean slate rather than inheriting a half-walked route.

**Two rules outside the sim:**

- **Auto-pause on blur is suppressed while `phase === 'muster'`.** The level is already held. Without
  this, alt-tabbing during the muster stacks `.resume-overlay` (z-index 30) on the Start card and the
  player dismisses one dialog to find another.
- **The speed control is disabled until Start.** A pause button on a level that has not begun is a
  control with nothing to do, and pausing mid-muster freezes the walk-out with no way to read why.

### The delivery release

**State.** `shipping: boolean` (default `true`), plus `setShipping(on: boolean)`. **Start does not
open it.** The player opens it deliberately; that is the whole point of the feature.

**The gate is one line**, at the goal-dispatch block (`sim.ts:1590`):

```ts
const goal = this.convoyOpen && this.shipping ? this.goal : null;
```

Placing it here rather than at the four candidate pushes below gives the switch every property the
convoy window already has: it shuts **all** routes to the wagon — the stock route, loose ground items,
and producer output shelves. Gating only the stock route is precisely the bug the comment above that
block records against `keep` ("all planks keep get delivered to target").

**It does not belong in `acceptingSinkCells`.** That function answers *"could this item ever be
carried there"*. The convoy window and the keep floor are deliberately excluded because they are
transient. The switch is transient too.

### Diverting a haul already under way

Closing the switch turns back cargo already walking, matching the precedent set by the keep floor
("Raising the floor turns back a haul already heading out", `docs/architecture.md`) rather than the
convoy's "stops dispatch, not cargo". The switch's whole purpose is *I still need that material*, and
a switch that lets a dozen units finish their walk does not deliver on it.

**Diversion happens at a whole cell, not at the instant of the click.** `Task` gains one optional
field, `divert?: boolean`. `setShipping(false)` sets it on every task with `sink.t === 'goal'`;
`setShipping(true)` clears any mark that has not yet been acted on, so flipping the switch twice in
a second leaves a haul on its original route. A haul that has already been diverted stays diverted —
its sink is the store now, and re-routing it back to the wagon would be a third trip for one unit. `tickMove` acts on the mark at the top, before
reading the next step:

```ts
if (w.task?.divert && w.px === w.cx && w.py === w.cy) this.divertToStock(w);
```

The predicate is exact, not approximate: at every step boundary `tickMove` assigns
`w.px = tx; w.py = ty; w.cx = tx; w.cy = ty` from one value (`sim.ts:2248`). During a lift ride `w.py`
travels while `w.cy` stays at the base, and during a rope slide the same. Diverting immediately would
re-path from `w.cx, w.cy` and snap a rider back down to the foot of the mast — a visible teleport with
nothing in the log. The predicate simply waits for the car to land.

`divertToStock(w)`:

1. `unreserveSink(task.sink, task.item)` — this is what returns `objectives[].inbound` to truth.
2. `task.sink = { t: 'stock' }`, `task.divert = false`.
3. Re-path from the current cell to `sinkCells({ t: 'stock' })` with `carrying = true`.
4. No path → `abortTask(w)`, which drops the item where the worker stands. That is the existing
   fallback on every other route in the sim, and it is reachable for real: a hauler on a plateau
   whose only way down was a rope the player has since demolished.

**A second reading at pickup.** `sim.ts:1993` already re-reads the keep floor at the moment of pickup
rather than trusting the dispatch decision. The switch joins it through a **shared predicate**, so the
next gate added here cannot repeat the "only half the routes" mistake a third time: a stock-sourced
haul to a shut wagon aborts (the unit is in the store and stays there); a ground- or output-sourced
one diverts (the unit is in the worker's hands, so "leave it" is not on offer).

### What the player sees

**The Start card** — a `.overlay.ready-overlay` holding one narrow card: the level name, the single
line of `def.desc`, the order sheet as a row of item icons with amounts, and the Start button.

- `pointer-events: none` on the overlay, `auto` on the card. Without this the overlay eats the
  canvas drag and "look around first" — the entire feature — does not work.
- No full dim. A light scrim only; the level has to stay readable behind it.
- Space and Enter press Start. Escape does not — it stays the menu key.

**The card is derived, never held.** `showOptions`, the report overlay and a language change all call
`clearOverlay()`, which removes every `.overlay`. Left alone, the player closes the options menu and
finds a level stuck in muster with no way to start it — a softlock that throws nothing and logs
nothing. One function, `syncReadyOverlay()`, shows the card if and only if `game.phase === 'muster'`,
and `startGame`, `resumeGame` and `attachHud` all call it. Same rule as the wagon in
`caravan-look.ts`: the picture reads the state, it does not remember it.

**The switch, two surfaces, one truth.**

- **HUD:** a `ship-row` in the objectives panel beside the existing `convoy-row` (`ui.ts:272`),
  reading "Delivery: on / off" and acting as its own button. This is where the player is already
  looking when asking why nothing arrives.
- **Wagon:** the same control in `renderBuildingBody`'s misc branch, built like the producer's
  pause button (`ui.ts:963`) — a `tt-btn` on the pinned panel, and a "▸ Click…" line on the hover
  tooltip pointing at it.

**A sign in the world.** `render.ts` draws a lock over the dock's order board while `game.shipping`
is false. It goes on `goal_dock`, not on `goal`: on a convoy level the wagon drives away, and the
sign has to stay. That is exactly the split the two sprites exist for.

**Copy.** New flat keys in `src/engine/i18n.ts`, both languages: `ready.title`, `ready.desc`,
`ready.btn`, `ship.on`, `ship.off`, `ship.hintOpen`, `ship.hintClose`, `ship.note`. The Start card
addresses the **crew** (*your crew* · *dein Trupp*), not the species — `tests/terminology.mjs` walks
both copy tables, and *crew* is the register for the group.

**The report stamps `shipping`.** "Nothing is being delivered" is the bug report this feature will
produce. Without the switch in `report.ts`'s run table, next to the seed, such a report cannot be
told apart from a real hauling failure.

## Testing

### `tests/held.mjs` (new, headless)

- `new Game(def)` gives `phase: 'run'`, `shipping: true`. This is the guard for the other fifteen
  suites, and it is asserted rather than assumed.
- `new Game(def, seed, { held: true })` gives `phase: 'muster'`, `shipping: false`.
- Over 300 muster ticks: `time` does not move, `timeOfDay` does not move, no worker holds a task, no
  building progresses, and every worker reaches its line-up cell and stops.
- Two games on **different seeds** muster identically — the proof that the line-up is derived, not
  drawn.
- `begin()` flips to `'run'` and the next `schedule()` assigns.
- **The reported bug:** a level whose `startStock` covers an objective runs 200 s with the switch shut
  and delivers **nothing**; the store is untouched.
- **Diversion by census, not by two containers.** `tests/hoist.mjs` paid for this lesson: a unit lives
  in `stock`, `groundItems`, `w.carrying`, or one of four building buckets (`inputs`, `outputs`,
  `hoistUpper`, `hoistLower` — never the `*In` reservations, which double-count). The test counts all
  of them, asserts the total on every tick, and asserts `objectives[].inbound` returns to zero.
- **The mid-step case:** a hauler carrying to the goal, shut the switch while `w.px !== w.cx`, tick
  once by a fraction of a step. The task must still be marked and still bound for the wagon — the
  diversion waits for a whole cell. This is the lift-ride hazard tested through its actual predicate;
  a scripted lift build would exercise the same line at ten times the cost.

### `tests/campaign1.mjs`

Level 1 runs with `held: true` and takes `begin()` and `setShipping(true)` as its first scripted
steps at t=0. Without this, no proof ever passes through the new door and a scripted run could stay
green while a real player is stuck. The printed completion times stay comparable, because the muster
does not advance `time`.

### The browser suites — the largest single cost

Eighteen files click `.fd-play` → `.map-node` → `.pop-play` and then expect a running level:
`e2e`, `autopause`, `mobile`, `clock`, `worldmap`, `i18n`, `version`, `report-e2e`, `restart-scenery`,
`drag-tooltip`, `hover-tooltip`, `audio-smoke`, `editor-generator`, `biome-hills`, `caravan-shot`,
`vale-visual`, `weather-visual`, `teaser-caption`. The screenshot suites among them would also
photograph the Start card. `tools/trailer/render-teaser.mjs` stages scenes through the same hook.

The entry sequences are **not** uniform enough to extract: some use `page.click`, one uses
`page.tap`, one uses `locator().first().click()`, one reaches the popover through `page.evaluate`,
and two (`i18n`, `version`) join the flow half-way with their own assertions in between. Replacing
all of them with one helper would rewrite nineteen working call sites to fix a problem none of them
have.

Plan instead: expose `begin()` and `setShipping()` on the `window.__smallhands` hook — which already
carries `setSpeed`, `setTool` and `startLevel` — and add a one-line `tests/enter.mjs` helper,
`beginRun(page)`, that each suite calls after its own entry. `e2e` and `mobile` are the exceptions:
they press the Start card for real, because somebody has to.

This can land **before** `held: true` does. `begin()` on a running game and `setShipping(true)` on an
open hatch are both no-ops, so all nineteen sites can be prepared while the suites stay green, and
the switch-on commit then breaks nothing.

## Risks

- **The player does not find the switch.** Mitigated on three surfaces (HUD row, wagon panel, lock on
  the dock) and unavoidably visible: the objectives panel is where the question gets asked. If
  playtesting still shows people stuck, the fallback is a level hint (the existing `LevelHint`
  mechanism, `when: (g) => !g.shipping && g.time > 45`) on the campaign's first level only — not a
  change to the default.
- **The muster reads as a bug on a cramped map.** If most workers fail to find a line-up cell, the
  crew stands at the door and the phase looks like a freeze. The Start card is the thing that says
  otherwise, which is why it carries the level name and the order sheet rather than only a button.
- **`held` is an inverted default.** A future caller that forgets it gets the old behaviour silently.
  Accepted deliberately: the alternative reds fifteen suites, and the table of callers above plus the
  defaults assertion in `tests/held.mjs` is the mitigation.
