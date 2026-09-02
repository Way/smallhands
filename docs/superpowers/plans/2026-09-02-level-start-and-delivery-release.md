# Level start ("muster") and the delivery release — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A level opens held — the crew musters out of the town hall and lines up behind a translucent Start card, and the caravan's hatch stays shut until the player opens it.

**Architecture:** One constructor option, `new Game(def, seed, { held: true })`, sets both locks. `Game.phase` gates the whole tick so `time` never advances during the muster; `Game.shipping` gates the one goal-dispatch decision in `schedule()`. Everything the player sees is derived from those two fields — never stored, never mirrored.

**Tech Stack:** TypeScript, Vite 8 (rolldown), vanilla DOM + canvas, no framework. Headless tests are plain `node tests/*.mjs`; browser tests are `playwright-core` driving Chromium against `npm run preview`.

**Spec:** `docs/superpowers/specs/2026-09-02-level-start-and-delivery-release-design.md`

## Global Constraints

- **No unseeded randomness and no wall-clock read on the tick path.** `Math.random()`, `Date.now()`, `performance.now()` and `new Date()` are all swept out of `src/game/**` and `src/engine/**` by `tests/unit.mjs`. Nothing in this plan may add one.
- **`this.rand` has exactly two call sites, both in `tryAssignWander`.** `tests/unit.mjs` counts the identifier across every swept file and expects 2. Do not add a third, and do not pass `this.rand` to a helper.
- **Do not touch `spawnWorker`'s `randFx` draw for `facing`.** `tests/unit.mjs` samples `facing` and `animT` at spawn — before the first tick — as its proof that the cosmetic stream diverges on a new seed.
- **The sim never calls `t()`.** Levels and events carry keys; only the display layer translates (`src/engine/i18n.ts` header).
- **Copy calls the group the crew** (`crew` · `Trupp`), never the species. `tests/terminology.mjs` walks both copy tables.
- **Every new i18n key needs both `en` and `de`.** The table is flat `[en, de]` pairs in `src/engine/i18n.ts`.
- **`npm run build` is `tsc --noEmit && vite build`.** It must stay green after every task.
- Commit after every task. Never commit a red tree.

---

### Task 1: The muster phase in the sim

**Files:**
- Modify: `src/game/sim.ts` (field block ~line 203, constructor ~line 272, new methods after `spawnWorker` ~line 1170, `tick` ~line 2587)
- Create: `tests/held.mjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Game.phase: 'muster' | 'run'` — public field, default `'run'`.
  - `new Game(level: LevelDef, seed?: string | number, opts?: { held?: boolean })` — `held: true` sets `phase = 'muster'`.
  - `Game.begin(): void` — flips `'muster'` → `'run'`; a no-op when already running.

- [ ] **Step 1: Write the failing test**

Create `tests/held.mjs`:

```js
// The muster phase: a level opens HELD — the crew walks out of the town hall and
// lines up, and NOTHING else in the world moves until begin(). The default is
// 'run', which is what keeps the fifteen play-to-a-win suites working; that
// default is asserted here rather than trusted.
import { bundleExports } from './bundle.mjs';

const { Game, LEVELS } = await bundleExports(`
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
`);

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failures++;
}

const L1 = LEVELS[0];
const line = (g) => g.workers.map((w) => `${w.cx},${w.cy}`).join(' ');
const step = (g, seconds) => {
  for (let i = 0; i < Math.round(seconds * 30); i++) g.tick(1 / 30);
};

// ---- the default is 'run' ---------------------------------------------------
// This is the guard for tests/campaign1-5, unit, hoist, digging, ramp, terrain,
// caravan and the editor soak: they all build `new Game(def)` and tick straight
// into a scripted playthrough. A muster default would stall every one of them,
// and the failure would read as a hauling bug.
const plain = new Game(L1);
check('default phase is run', plain.phase === 'run');
step(plain, 2);
check('a default game runs its clock', plain.time > 1.9);

// ---- held opens in muster ---------------------------------------------------
const held = new Game(L1, 'seed-a', { held: true });
check('held opens in muster', held.phase === 'muster');

step(held, 10);
check('the clock does not move in muster', held.time === 0);
check('the day does not move in muster', held.timeOfDay === plain.timeOfDay);
check('nobody is given work in muster', held.workers.every((w) => w.task === null));
check('nobody joins mid-line-up', held.workers.length === (L1.startWorkers ?? 4));
check('everyone finished the walk', held.workers.every((w) => w.stepIdx >= w.path.length));
check(
  'the crew stands on distinct cells',
  new Set(held.workers.map((w) => `${w.cx},${w.cy}`)).size === held.workers.length
);
check('nobody is stuck between tiles', held.workers.every((w) => w.px === w.cx && w.py === w.cy));

// ---- the line is derived, not drawn ----------------------------------------
// A stream wired to a constant replays perfectly while ignoring the seed, so the
// claim that matters is that two DIFFERENT seeds muster identically.
const a = new Game(L1, 'seed-a', { held: true });
const b = new Game(L1, 'seed-zzzz', { held: true });
step(a, 10);
step(b, 10);
check('different seeds muster identically', line(a) === line(b));

// ---- begin() starts the level ----------------------------------------------
held.begin();
check('begin runs the level', held.phase === 'run');
step(held, 5);
check('the clock moves after begin', held.time > 4.9);
check('the crew takes work after begin', held.workers.some((w) => w.task !== null));
check('begin on a running game is a no-op', (held.begin(), held.phase === 'run'));

console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it to make sure it fails**

Add the script first so the command exists — in `package.json`, after the `"test:hoist"` line:

```json
    "test:held": "node tests/held.mjs",
```

Run: `npm run test:held`
Expected: FAIL — `default phase is run` fails because `Game.phase` is `undefined`.

- [ ] **Step 3: Add the `phase` field and the `held` option**

In `src/game/sim.ts`, in the field block, directly under `paused = false;` (~line 203):

```ts
  // A level opens HELD (see docs/superpowers/specs/2026-09-02-level-start-and-
  // delivery-release-design.md): the crew musters out of the town hall, lines up
  // in front of it, and nothing else in the world moves until the player presses
  // Start. `time` does not advance, so the medal clock, the weather schedule, the
  // convoy window and the rising tide all begin at Start rather than at the moment
  // the level was built.
  //
  // The default is 'run', deliberately. About fifteen headless suites build
  // `new Game(def)` and tick straight into a scripted playthrough; a muster default
  // would stall every one of them, and the failure would read as a hauling bug.
  // `main.ts` opts in with { held: true }, and tests/held.mjs asserts the default
  // rather than trusting the convention.
  phase: 'muster' | 'run' = 'run';
```

Change the constructor signature and tail (~line 272 and ~line 288):

```ts
  constructor(level: LevelDef, seed: string | number = level.id, opts?: { held?: boolean }) {
```

```ts
    const startWorkers = level.startWorkers ?? 4;
    for (let i = 0; i < startWorkers; i++) this.spawnWorker(true);
    if (opts?.held) {
      this.phase = 'muster';
      this.startMuster();
    }
  }
```

- [ ] **Step 4: Add `startMuster()` and `begin()`**

In `src/game/sim.ts`, immediately after the `spawnWorker` method (~line 1170):

```ts
  // The muster line: worker i walks to the i-th usable cell of a run that grows
  // outward from the town hall's left edge. The offsets are DERIVED FROM THE INDEX,
  // never drawn — `tests/unit.mjs` counts the behavioural stream's readers and
  // expects the wander's two, so a die rolled here reds the determinism guard.
  //
  // A cell with no floor, or one the worker cannot reach, is skipped rather than
  // forced. On a cramped map (a buried caravan, a hall on a cliff edge) the line
  // degrades to the crew standing at the door, which is exactly the picture the
  // game had before this existed — never an exception, never a throw.
  private startMuster(): void {
    const th = this.townhall;
    const floor = th.y + FOOTPRINTS.townhall.h - 1;
    const offsets = [0, 1, 2, 3, -1, 4, -2, 5, -3, 6, -4, 7];
    let next = 0;
    for (const w of this.workers) {
      while (next < offsets.length) {
        const spot = settle(this.world, th.x + offsets[next], floor);
        next++;
        if (!spot) continue;
        if (spot.x === w.cx && spot.y === w.cy) break; // already standing on it
        const path = findPath(this.world, this.transits, w.cx, w.cy, new Set([this.world.key(spot.x, spot.y)]), false);
        if (!path) continue;
        w.path = path.steps;
        w.stepIdx = 0;
        break;
      }
    }
  }

  // Start the run. Every task-less worker is snapped to its cell and its leftover
  // muster path cleared: the run loop only moves workers that HOLD a task, so a
  // worker left half-way between two tiles by a mid-walk Start would freeze there
  // until the scheduler happened to hand it a job.
  begin(): void {
    if (this.phase !== 'muster') return;
    this.phase = 'run';
    for (const w of this.workers) {
      if (w.task) continue;
      w.path = [];
      w.stepIdx = 0;
      w.px = w.cx;
      w.py = w.cy;
    }
  }
```

- [ ] **Step 5: Gate the tick**

In `src/game/sim.ts` `tick(dt)`, immediately after the existing `if (this.paused || this.won) { … return; }` block and **before** `this.time += dt;`:

```ts
    // A held level: the crew musters out and lines up, and nothing else moves.
    // `tickMove` is the ordinary mover — there is no second set of movement
    // physics here, and every existing rule (ladders, ramps, the fall cap)
    // applies to the walk out. `spawnTimer` is not touched either, so the crew
    // that musters is exactly `startWorkers`.
    if (this.phase === 'muster') {
      for (const w of this.workers) {
        if (w.spawnT > 0) {
          w.spawnT -= dt;
          continue;
        }
        if (w.stepIdx < w.path.length) this.tickMove(w, dt);
        else w.animT += dt;
      }
      this.tickParticles(dt);
      return;
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test:held`
Expected: PASS — every line `ok`, ending `all ok`.

- [ ] **Step 7: Prove nothing else moved**

Run: `npm run build && npm run test:unit && npm run test:campaign1 && npm run test:hoist`
Expected: all PASS. `test:unit` is the one that matters most — it is the determinism sweep.

- [ ] **Step 8: Commit**

```bash
git add src/game/sim.ts tests/held.mjs package.json
git commit -m "feat(sim): a level can open held, with the crew mustering out

new Game(def, seed, { held: true }) opens in a muster phase: the crew
walks out of the town hall and lines up, and the tick advances nothing
else — not time, not the weather schedule, not the convoy window, not
the tide, not the scheduler. begin() starts the run.

The default stays 'run' so the fifteen suites that build new Game(def)
and tick straight into a scripted playthrough are untouched, and
tests/held.mjs asserts that default rather than trusting it."
```

---

### Task 2: The delivery release in the sim

**Files:**
- Modify: `src/game/sim.ts` (field block, new method, goal-dispatch gate ~line 1590)
- Modify: `tests/held.mjs`

**Interfaces:**
- Consumes: nothing from Task 1 (`shipping` is independent of `phase` until Task 6).
- Produces:
  - `Game.shipping: boolean` — public field, default `true`.
  - `Game.setShipping(on: boolean): void`.

- [ ] **Step 1: Write the failing test**

Append to `tests/held.mjs`, before the final `console.log`:

```js
// ---- the delivery release --------------------------------------------------
// Level 3 is the reported bug in its purest form: startStock is
// { log: 6, plank: 6, stone: 2 }, the order sheet wants 6 planks, and the caravan
// stands at the west edge AT GRADE (levels.ts: `goal(g, 0)`) — so the crew empties
// the store into it on the first schedule().
//
// NOT level 2, which looks like the obvious fixture and is not one: its caravan sits
// up on the shrine ledge (`goal(g, 28)`), reachable only by a lift that is the
// level's own new-verb lesson and does not exist at t=0. Nothing is ever dispatched
// there, so a shut-hatch assertion on level 2 would pass for the wrong reason.
const L3 = LEVELS[2];

const openHatch = new Game(L3);
step(openHatch, 200);
check(
  'control: an open hatch ships the starting stock',
  openHatch.objectives.some((o) => o.delivered > 0)
);

const shut = new Game(L3);
shut.setShipping(false);
check('setShipping(false) shuts the hatch', shut.shipping === false);
step(shut, 200);
check('a shut hatch delivers nothing', shut.objectives.every((o) => o.delivered === 0));
check('a shut hatch reserves nothing', shut.objectives.every((o) => o.inbound === 0));
check('the starting planks stay in store', shut.stock.plank >= (L3.startStock?.plank ?? 0));

// opening it lets the same store flow
shut.setShipping(true);
step(shut, 200);
check('opening the hatch ships the store', shut.objectives.some((o) => o.delivered > 0));

// the default is open — the fifteen scripted suites depend on it
check('shipping defaults to open', new Game(L1).shipping === true);
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:held`
Expected: FAIL — `setShipping(false) shuts the hatch` throws `shut.setShipping is not a function`.

- [ ] **Step 3: Add the field and the setter**

In `src/game/sim.ts`, directly under the `phase` field added in Task 1:

```ts
  // The caravan's hatch — the player's own release, separate from the keep floor.
  // `keep` is a ceiling on ONE ITEM the player is saving up; this says the ROAD is
  // shut, which is a property of the route and not of any item. The two compose:
  // keep decides how much of a good stays home, shipping decides whether anything
  // leaves at all.
  //
  // Two rules keep it honest, and both are one line away from a silent leak:
  //  - It gates at the single goal-dispatch decision in schedule(), NOT at the four
  //    candidate pushes under it. Loose ground items and a producer's output shelf
  //    reach the wagon without passing through the store, so a gate on the stock
  //    route alone leaks — the exact bug the keep floor shipped with.
  //  - It stays OUT of acceptingSinkCells. That function answers "could this item
  //    EVER be carried there"; the convoy window and the keep floor are excluded
  //    there because they are transient, and so is this.
  shipping = true;
```

Add the setter next to `setKeep` (~line 625):

```ts
  setShipping(on: boolean): void {
    this.shipping = on;
  }
```

- [ ] **Step 4: Gate the dispatch**

In `src/game/sim.ts` (~line 1590), change:

```ts
    const goal = this.convoyOpen ? this.goal : null;
```

to:

```ts
    const goal = this.convoyOpen && this.shipping ? this.goal : null;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:held`
Expected: PASS, ending `all ok`.

- [ ] **Step 6: Prove the running game is unchanged**

Run: `npm run build && npm run test:unit && npm run test:campaign1 && npm run test:campaign5 && npm run test:caravan`
Expected: all PASS, and the campaign completion times printed on the `ok` lines are unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/game/sim.ts tests/held.mjs
git commit -m "feat(sim): a delivery release gates every route to the caravan

Game.shipping joins the convoy window at the one goal-dispatch decision
in schedule(), so it shuts all four routes to the wagon — the store, a
loose ground item and a producer's output shelf — rather than only the
store route, which is the leak the keep floor shipped with.

It stays out of acceptingSinkCells for the same reason the convoy window
and the keep floor do: that function answers whether an item could ever
be carried there, and a shut hatch is transient.

Default is open, so nothing about a scripted run changes."
```

---

### Task 3: Turning back a haul already under way

**Files:**
- Modify: `src/game/sim.ts` (`Task` union ~line 71, `setShipping`, `tickMove` ~line 2165, pickup ~lines 1966 and 1993, new `divertToStock` + `sinkRefused`)
- Modify: `tests/held.mjs`

**Interfaces:**
- Consumes: `Game.setShipping(on)` and `Game.shipping` from Task 2.
- Produces: no new public API. `Task`'s `haul` variant gains `divert?: boolean` (module-private type).

- [ ] **Step 1: Write the failing test**

Append to `tests/held.mjs`, before the final `console.log`:

```js
// ---- turning back a haul already under way ---------------------------------
// The keep floor sets the precedent ("raising the floor turns back a haul already
// heading out"), not the convoy's "stops dispatch, not cargo": the reason a player
// shuts the hatch is that they still need the material.
//
// Mass is counted by CENSUS, never by reading two containers. tests/hoist.mjs paid
// for this lesson: a unit lives in stock, loose on the ground, in a worker's hands,
// or in one of four building buckets — and NOT in the *In reservations, which are
// inbound promises that double-count the hauler already holding it.
// L3 is already declared above by the delivery-release block; do not redeclare it.
function census(g, item) {
  let n = g.stock[item];
  for (const gi of g.groundItems) if (gi.item === item) n++;
  for (const w of g.workers) if (w.carrying === item) n++;
  for (const b of g.buildings) {
    n += b.inputs[item] ?? 0;
    n += b.outputs[item] ?? 0;
    n += b.hoistUpper[item] ?? 0;
    n += b.hoistLower[item] ?? 0;
  }
  for (const o of g.objectives) if (o.item === item) n += o.delivered;
  return n;
}

// prove the census itself counts the store and a worker's hands
{
  const g = new Game(L3);
  const before = census(g, 'plank');
  check('census counts the starting store', before === (L3.startStock?.plank ?? 0));
  step(g, 30);
  check('census is conserved while planks are carried', census(g, 'plank') === before);
}

// find a hauler carrying a PLANK to the wagon, then shut the hatch.
//
// The item is pinned to plank on purpose. Level 3 carries a miner AND three veins,
// so its stone and iron censuses legitimately GROW while a node is harvested, and a
// strict-equality mass check on either would flap. Nothing on level 3 can make a
// plank — the sawmill is a tool the player must build, the level pre-builds none,
// and no scripted player builds one here — so the plank census is fixed at
// startStock for the whole run.
{
  const g = new Game(L3);
  const goalHaul = () =>
    g.workers.find(
      (w) =>
        w.task?.kind === 'haul' &&
        w.task.sink.t === 'goal' &&
        w.task.phase === 'toSink' &&
        w.carrying === 'plank'
    );
  let w = null;
  for (let i = 0; i < 30 * 120 && !w; i++) {
    g.tick(1 / 30);
    w = goalHaul();
  }
  check('found a hauler carrying a plank to the wagon', w !== null);

  const item = 'plank';
  check('no sawmill exists, so the plank census is fixed', !g.buildings.some((b) => b.kind === 'sawmill'));
  const mass = census(g, item);
  g.setShipping(false);

  // the mark waits for a whole cell: mid-step it is set but not yet acted on.
  // This is the lift-ride hazard tested through its own predicate — during a ride
  // py travels while cy stays behind, and re-pathing there would snap the rider
  // down to the foot of the mast with nothing in the log.
  if (w.px !== w.cx || w.py !== w.cy) {
    g.tick(1 / 600);
    check('a mid-step haul is marked but not yet turned', w.task.sink.t === 'goal' && w.task.divert === true);
  }

  for (let i = 0; i < 30 * 60; i++) {
    g.tick(1 / 30);
    if (census(g, item) !== mass) break;
  }
  check('mass is conserved through the turn', census(g, item) === mass);
  check('nothing reached the wagon after the hatch shut', g.objectives.every((o) => o.delivered === 0));
  check('the goal reservations are released', g.objectives.every((o) => o.inbound === 0));
  check('no task is still bound for the wagon', g.workers.every((x) => x.task?.kind !== 'haul' || x.task.sink.t !== 'goal'));
}

// re-opening before the mark is acted on leaves the haul on its route
{
  const g = new Game(L3);
  let w = null;
  for (let i = 0; i < 30 * 120 && !w; i++) {
    g.tick(1 / 30);
    w = g.workers.find((x) => x.task?.kind === 'haul' && x.task.sink.t === 'goal' && x.task.phase === 'toSink');
  }
  g.setShipping(false);
  g.setShipping(true);
  check('flipping twice leaves the haul alone', w.task.sink.t === 'goal' && !w.task.divert);
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:held`
Expected: FAIL — `a mid-step haul is marked but not yet turned` fails (`w.task.divert` is `undefined`) and `nothing reached the wagon after the hatch shut` fails, because an in-flight haul still delivers.

- [ ] **Step 3: Add `divert` to the haul task**

In `src/game/sim.ts`, in the `Task` union (~line 71):

```ts
type Task =
  | { kind: 'harvest'; nodeId: number }
  // `divert` is set by setShipping(false) on a haul bound for the caravan and
  // acted on by tickMove at the next WHOLE CELL. It is not a second sink: the
  // sink is rewritten only at the moment the turn actually happens.
  | { kind: 'haul'; phase: 'toSource' | 'toSink'; item: ItemType; source: Source; sink: Sink; divert?: boolean }
  | { kind: 'construct'; buildingId: number }
  | { kind: 'upgrade' }
  | { kind: 'dig'; tx: number; ty: number }
  | { kind: 'wander' };
```

- [ ] **Step 4: Mark the tasks in `setShipping`**

Replace the `setShipping` body written in Task 2:

```ts
  setShipping(on: boolean): void {
    if (this.shipping === on) return;
    this.shipping = on;
    for (const w of this.workers) {
      const task = w.task;
      if (task?.kind !== 'haul') continue;
      if (on) {
        // Re-opening before the mark was acted on leaves the haul on its route:
        // flipping the switch twice in a second must not cost a trip. A haul that
        // was ALREADY turned stays turned — its sink is the store now, and sending
        // it back to the wagon would be a third leg for one unit.
        task.divert = false;
      } else if (task.sink.t === 'goal') {
        task.divert = true;
      }
    }
  }
```

- [ ] **Step 5: Act on the mark at a whole cell**

In `src/game/sim.ts`, at the very top of `tickMove` (~line 2165), before `if (w.stepIdx >= w.path.length)`:

```ts
    // A haul turned back by the delivery switch re-routes at a WHOLE CELL, never
    // mid-step. The equality is exact rather than approximate: at every step
    // boundary tickMove assigns px/py and cx/cy from one value (see the walk
    // branch below). During a lift ride or a rope slide py travels while cy stays
    // at the base, so this simply waits for the car to land — turning there would
    // re-path from cx/cy and snap the rider back down the mast, with nothing in
    // the log to say why.
    if (w.task?.kind === 'haul' && w.task.divert && w.px === w.cx && w.py === w.cy) {
      this.divertToStock(w);
    }
```

- [ ] **Step 6: Add `divertToStock` and `sinkRefused`**

In `src/game/sim.ts`, immediately before `private repath(w: Worker)` (~line 2264):

```ts
  // Every reason a haul must not continue to its sink, in one place, re-read at the
  // moment it matters rather than trusted from dispatch time. Two readers: the
  // pickup below and divertToStock. Adding the next gate HERE is what keeps it from
  // reaching only half the routes, which is the mistake the keep floor made.
  private sinkRefused(task: Extract<Task, { kind: 'haul' }>): boolean {
    if (task.sink.t === 'stock') return false;
    if (task.sink.t === 'goal' && !this.shipping) return true;
    return this.spare(task.item) < 0;
  }

  // Turn a haul bound for the caravan back into the store. Follows the keep floor's
  // precedent ("raising the floor turns back a haul already heading out"), not the
  // convoy's "stops dispatch, not cargo": the reason a player shuts the hatch is
  // that they still need the material, and a switch that lets a dozen units finish
  // their walk does not deliver on that.
  private divertToStock(w: Worker): void {
    const task = w.task;
    if (task?.kind !== 'haul') return;
    task.divert = false;
    if (task.sink.t === 'stock') return;
    if (task.phase === 'toSource') {
      // Nothing in hand yet — the unit is still at its source, so there is nothing
      // to carry home. Drop the job; abortTask unreserves both ends, and the next
      // schedule() re-dispatches the unit to the store if that is where it belongs.
      this.abortTask(w);
      return;
    }
    this.unreserveSink(task.sink, task.item); // returns objectives[].inbound to truth
    task.sink = { t: 'stock' };
    const cells = this.sinkCells(task.sink);
    const path = cells ? findPath(this.world, this.transits, w.cx, w.cy, cells, w.carrying !== null) : null;
    if (!path) {
      this.abortTask(w); // drops what they hold where they stand — the sim's fallback everywhere
      return;
    }
    task.phase = 'toSink';
    w.path = path.steps;
    w.stepIdx = 0;
  }
```

- [ ] **Step 7: Re-read the gate at pickup**

Two edits inside the pickup branch of `arriveAtTaskTarget`.

First, the stock source (~line 1966) — add the hatch to the abort condition:

```ts
            // A shut hatch aborts a stock-sourced haul exactly the way the keep
            // floor does: the unit is in the store and simply stays there.
            if (!(task.sink.t === 'goal' && !this.shipping) && this.stock[task.item] - this.keep[task.item] > 0) {
```

Second, the ground/output re-route (~line 1993) — read the shared predicate instead of the floor alone:

```ts
          if (task.source.t !== 'stock' && this.sinkRefused(task)) {
            this.unreserveSink(task.sink, task.item);
            task.sink = { t: 'stock' };
          }
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm run test:held`
Expected: PASS, ending `all ok`.

- [ ] **Step 9: Prove the keep floor still behaves**

Run: `npm run build && npm run test:unit && npm run test:hoist && npm run test:campaign1 && npm run test:campaign3`
Expected: all PASS. `test:unit`'s reserve block is the keep floor's own guard — the pickup edits are the risky part of this task, and that block is what proves they did not change it.

- [ ] **Step 10: Commit**

```bash
git add src/game/sim.ts tests/held.mjs
git commit -m "feat(sim): shutting the hatch turns a haul already under way back

setShipping(false) marks every haul bound for the caravan, and tickMove
acts on the mark at the next whole cell. The predicate is exact: during
a lift ride py travels while cy stays at the base, so re-pathing there
would snap the rider back down the mast with nothing in the log.

The pickup re-read now goes through one shared predicate, so the next
gate added there cannot reach only half the routes."
```

---

### Task 4: Prepare the browser suites and the trailer

This lands **before** `held: true` does. `begin()` on a running game and `setShipping(true)` on an open hatch are both no-ops, so every call site can be prepared while the suites stay green — and the switch-on commit in Task 5 then breaks nothing.

**Files:**
- Modify: `src/main.ts` (the `__smallhands` hook, ~line 1422)
- Create: `tests/enter.mjs`
- Modify — **19 world-map entry points** (Step 3a), one line each: `tests/audio-smoke.mjs:67`, `tests/autopause.mjs:42`, `tests/biome-hills.mjs:118`, `tests/caravan-shot.mjs:19`, `tests/clock.mjs:73`, `tests/drag-tooltip.mjs:42`, `tests/e2e.mjs:39`, `tests/editor-generator.mjs:96`, `tests/editor-generator.mjs:252`, `tests/hover-tooltip.mjs:48`, `tests/i18n.mjs:47`, `tests/mobile.mjs:118`, `tests/report-e2e.mjs:56`, `tests/restart-scenery.mjs:39`, `tests/teaser-caption.mjs:145`, `tests/vale-visual.mjs:78`, `tests/version.mjs:105`, `tests/weather-visual.mjs:31`, `tests/worldmap.mjs:217`
- Modify — **16 hook re-stage points** (Step 3b), listed in the table there. Seven files appear in both lists; they need both edits.
- Modify: `tools/trailer/page-lib.mjs`, `tools/trailer/render-teaser.mjs`

**Interfaces:**
- Consumes: `Game.begin()` (Task 1), `Game.setShipping(on)` (Task 2).
- Produces:
  - `window.__smallhands.begin(): void` and `window.__smallhands.setShipping(on: boolean): void`.
  - `tests/enter.mjs` → `beginRun(page): Promise<void>`.
  - `window.__H.start(idx)` in the trailer page lib.

- [ ] **Step 1: Expose the two calls on the debug hook**

In `src/main.ts`, in the `__smallhands` object (~line 1422), after `setTool,`:

```ts
    // Start a held level and open the caravan's hatch. Both are no-ops on a level
    // that is already running with an open hatch, which is what lets the browser
    // suites and the trailer call them unconditionally.
    begin: () => game?.begin(),
    setShipping: (on: boolean) => game?.setShipping(on),
```

- [ ] **Step 2: Write the helper**

Create `tests/enter.mjs`:

```js
// Every browser suite enters a level its own way — page.click, page.tap,
// locator().first().click(), a click inside page.evaluate, and two suites that
// join the flow half-way with their own assertions in between. There is no one
// entry sequence to extract, so this helper covers only the part they all share
// now that a level opens HELD: start the run and open the caravan's hatch.
//
// Both calls are no-ops on a level that is already running with an open hatch, so
// a suite may call this whether or not the level it entered musters.
export async function beginRun(page) {
  await page.waitForFunction(() => window.__smallhands?.begin, { timeout: 8000 });
  await page.evaluate(() => {
    window.__smallhands.begin();
    window.__smallhands.setShipping(true);
  });
}
```

- [ ] **Step 3a: Call the helper at each of the 19 entry points**

In each of the 19 sites listed under **Files**, add the import at the top of the file (beside the other imports):

```js
import { beginRun } from './enter.mjs';
```

and insert immediately after that file's `pop-play` line:

```js
await beginRun(page);
```

- [ ] **Step 3b: Begin at each of the 16 places a suite re-stages a level through the hook**

Entering through the world map is not the only way in: eleven suites also call `startLevel` /
`startCustomLevel` on the hook to jump to another level mid-run, and each of those re-musters.

At **every one of these sites**, add the two calls **inside the same `page.evaluate`**, immediately
after the `startLevel` / `startCustomLevel` call:

```js
window.__smallhands.begin();
window.__smallhands.setShipping(true);
```

Inside the same evaluate matters, and not only for tidiness: no tick can run between the two
statements, so zero muster ticks elapse and the crew is at its spawn cells — byte-identical to today.
Calling `await beginRun(page)` on the next line instead lets an unknown number of animation frames
run first, which is exactly what would make `tests/restart-scenery.mjs` (a draw-set comparison across
two boots) flap.

| File | Line | Call |
|---|---|---|
| `tests/biome-hills.mjs` | 95 | `sh.startCustomLevel(data, { playtest: true });` |
| `tests/biome-hills.mjs` | 134 | `window.__smallhands.startLevel(i);` |
| `tests/clock.mjs` | 113 | `window.__smallhands.startLevel(0)` |
| `tests/clock.mjs` | 156 | `window.__smallhands.startLevel(i)` |
| `tests/drag-tooltip.mjs` | 67 | `startLevel(lvl);` |
| `tests/e2e.mjs` | 157 | `window.__smallhands.startLevel(1);` |
| `tests/editor-generator.mjs` | 116 | `sh.startCustomLevel(data, {});` |
| `tests/editor-generator.mjs` | 172 | `sh.startCustomLevel(data, {});` |
| `tests/editor-generator.mjs` | 259 | `sh.startCustomLevel(data, {});` |
| `tests/hover-tooltip.mjs` | 64 | `startLevel(0);` |
| `tests/mobile.mjs` | 389 | `window.__smallhands.startLevel(i)` |
| `tests/restart-scenery.mjs` | 66 | `sh.startCustomLevel(d, { playtest: true });` |
| `tests/teaser-caption.mjs` | 60 | `run: () => window.__smallhands.startLevel(i)` |
| `tests/teaser-caption.mjs` | 65 | `SH.startCustomLevel(SH.generateVerifiedLevel(…), {});` |
| `tests/vale-visual.mjs` | 49 | `sh.startCustomLevel(data, { playtest: true });` |
| `tests/weather-visual.mjs` | 35 | `window.__smallhands.startLevel(5)` |

Three of these need the surrounding expression reshaped rather than a line inserted:

`tests/clock.mjs:113` and `tests/weather-visual.mjs:35` are one-expression arrows — give them a body:

```js
await page.evaluate(() => {
  const S = window.__smallhands;
  S.startLevel(0);
  S.begin();
  S.setShipping(true);
});
```

`tests/teaser-caption.mjs:60` is an arrow inside an array literal:

```js
    ...Array.from({ length: 60 }, (_, i) => ({
      generated: false,
      run: () => {
        const S = window.__smallhands;
        S.startLevel(i);
        S.begin();
        S.setShipping(true);
      },
    })),
```

Note that `sh` captured before a re-stage keeps working: the hook's `begin` and `setShipping` are
arrows over `main.ts`'s module-level `game`, so they act on the level that is live now, not on the
one the captured object was built for.

- [ ] **Step 4: Run every touched suite**

Run in one terminal: `npm run build && npm run preview`
Run in another:

```bash
for s in e2e mobile autopause clock worldmap i18n version report-e2e restart-scenery \
         drag-tooltip hover-tooltip audio-smoke caravan-shot weather-visual \
         biome-hills vale-visual teaser-caption; do
  echo "=== $s ==="; npm run "test:$s" || echo "FAILED: $s"
done
node tests/editor-generator.mjs || echo "FAILED: editor-generator"
```

`editor-generator` has no `test:` script — it is run directly, as above.

Expected: every suite PASSes exactly as it did before this task — nothing has changed yet, and that is the point. `restart-scenery` is the one to watch: it compares draw sets across two boots, so if the muster leaked a single tick into either boot it reds here rather than somewhere subtle later.

- [ ] **Step 5: Prepare the trailer**

In `tools/trailer/page-lib.mjs`, beside the other `window.__H` helpers (after `ff`):

```js
    // The teaser stages levels straight through startLevel/startCustomLevel, which
    // open HELD. A teaser is a recording of the game running, so every scene begins
    // at once and ships from the first frame.
    start(idx) {
      window.__smallhands.startLevel(idx);
      window.__smallhands.begin();
      window.__smallhands.setShipping(true);
    },
    startCustom(data, opts) {
      window.__smallhands.startCustomLevel(data, opts ?? {});
      window.__smallhands.begin();
      window.__smallhands.setShipping(true);
    },
```

In `tools/trailer/render-teaser.mjs`, replace each `SH.startLevel(n)` with `window.__H.start(n)` (lines 163, 181, 214, 247, 280, 320, 342, 369, 406, 469) and `SH.startCustomLevel(data, {})` with `window.__H.startCustom(data, {})` (line 451).

- [ ] **Step 6: Run the trailer**

Run: `npm run trailer`
Expected: it completes and writes its frames exactly as before.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts tests/ tools/trailer/
git commit -m "test: prepare every browser entry point for a held level

begin() and setShipping() join the __smallhands hook, and each of the 19
browser entry sites plus the trailer's scene staging now calls them.

Both are no-ops today — a running level with an open hatch — so every
suite stays green. Landing this before held: true means the switch-on
commit breaks nothing.

The entry sequences themselves are deliberately NOT unified: they use
click, tap, locator().first().click() and a click inside evaluate, and
two join the flow half-way with assertions in between."
```

---

### Task 5: The Start card

**Files:**
- Modify: `src/main.ts` (`startGame` ~line 1389/1396, `resumeGame` ~line 320, the blur guard ~line 350, `attachHud` ~line 1290, keydown ~line 2256)
- Modify: `src/game/ui.ts` (`setSpeed`)
- Modify: `src/engine/i18n.ts`
- Modify: `src/style.css`
- Create: `tests/levelstart.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `Game.phase`, `Game.begin()` (Task 1); `window.__smallhands.begin` (Task 4).
- Produces:
  - `syncReadyOverlay(): void` in `main.ts` — module-private.
  - DOM contract for the tests: `.ready-overlay` (the layer), `.ready-card` (the card), `.ready-btn` (the button).
  - `Hud.setHeld(held: boolean): void`.

- [ ] **Step 1: Write the failing test**

Create `tests/levelstart.mjs`:

```js
// The Start card: a level opens held, the player can look around behind the card,
// and Start begins the run. The three failures this guards are all silent ones —
// an overlay that eats the camera drag, a card that clearOverlay() removes and
// nobody puts back, and a pause button on a level that has not begun.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { beginRun } from './enter.mjs';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const found = execSync('ls /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1')
      .toString()
      .trim();
    if (found) return found;
  } catch {
    // fall through to playwright default resolution
  }
  return undefined;
}

let failed = false;
function check(label, cond) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failed = true;
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(BASE_URL);
await page.waitForTimeout(800);
await page.click('.fd-play');
await page.waitForTimeout(300);
await page.click('.map-node:not(:disabled)');
await page.click('.map-popover .pop-play');
await page.waitForTimeout(400);

// ---- the level opens held ---------------------------------------------------
check('the level opens in muster', await page.evaluate(() => window.__smallhands.game.phase === 'muster'));
check('the Start card is up', (await page.locator('.ready-overlay').count()) === 1);
check('the card names the level', ((await page.textContent('.ready-card')) ?? '').length > 10);

// the clock really is frozen — not merely paused
const t0 = await page.evaluate(() => window.__smallhands.game.time);
await page.waitForTimeout(700);
check('the run clock is frozen', (await page.evaluate(() => window.__smallhands.game.time)) === t0);

// ---- looking around still works ---------------------------------------------
// The whole point of the card is that the player can read the map behind it, so
// the overlay must not take the pointer. A full-screen .overlay does by default.
check(
  'the card layer does not take the pointer',
  await page.evaluate(() => getComputedStyle(document.querySelector('.ready-overlay')).pointerEvents === 'none')
);
check(
  'the button does take the pointer',
  await page.evaluate(() => getComputedStyle(document.querySelector('.ready-btn')).pointerEvents !== 'none')
);
const cam0 = await page.evaluate(() => window.__smallhands.cam.x);
await page.keyboard.down('d');
await page.waitForTimeout(400);
await page.keyboard.up('d');
check('the camera still pans behind the card', (await page.evaluate(() => window.__smallhands.cam.x)) !== cam0);

// ---- the crew musters --------------------------------------------------------
check(
  'nobody is given work while held',
  await page.evaluate(() => window.__smallhands.game.workers.every((w) => w.task === null))
);

// ---- the speed control is off ------------------------------------------------
check(
  'the speed control is disabled while held',
  await page.evaluate(() => !!document.querySelector('.island .speed-trigger')?.hasAttribute('disabled'))
);
await page.keyboard.press(' ');
await page.waitForTimeout(60);
check('Space does not pause a held level', await page.evaluate(() => window.__smallhands.game.phase === 'run'));

// Space started it. Re-enter to test the options round trip from a held level.
await page.evaluate(() => window.__smallhands.startLevel(0));
await page.waitForTimeout(300);
check('a fresh level is held again', await page.evaluate(() => window.__smallhands.game.phase === 'muster'));

// ---- the card survives the options round trip --------------------------------
// showOptions calls clearOverlay(), which removes every .overlay. Without
// syncReadyOverlay the player closes the options menu and finds a level stuck in
// muster with no way to start it: a softlock that throws nothing and logs nothing.
// The island's menu popover holds four rows in this order: levels · restart ·
// options · report. The divider between them is a div, so the .menu-item locator
// counts only the buttons.
await page.click('.island .menu-trigger');
await page.waitForTimeout(150);
await page.locator('.menu-pop .menu-item').nth(2).click();
await page.waitForTimeout(300);
check('the options menu opened', (await page.locator('.options-box').count()) === 1);
await page.click('.options-box .big-btn'); // Back → resumeGame
await page.waitForTimeout(300);
check('the Start card comes back after the options menu', (await page.locator('.ready-overlay').count()) === 1);
check('still held after the options menu', await page.evaluate(() => window.__smallhands.game.phase === 'muster'));

// ---- the button starts the run -----------------------------------------------
await page.click('.ready-btn');
await page.waitForTimeout(300);
check('the Start card is gone', (await page.locator('.ready-overlay').count()) === 0);
check('the level runs', await page.evaluate(() => window.__smallhands.game.phase === 'run'));
check('the speed control is live again', await page.evaluate(() => !document.querySelector('.island .speed-trigger')?.hasAttribute('disabled')));
await page.waitForTimeout(600);
check('the run clock moves', (await page.evaluate(() => window.__smallhands.game.time)) > 0.3);

// ---- beginRun still works from the hook --------------------------------------
await page.evaluate(() => window.__smallhands.startLevel(0));
await page.waitForTimeout(300);
await beginRun(page);
check('the hook starts a held level too', await page.evaluate(() => window.__smallhands.game.phase === 'run'));

await browser.close();
console.log(failed ? '\nFAILURES' : '\nall ok');
process.exit(failed ? 1 : 0);
```

Add to `package.json`, after `"test:autopause"`:

```json
    "test:levelstart": "node tests/levelstart.mjs",
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run build && npm run preview` in one terminal, then `npm run test:levelstart`
Expected: FAIL at `the level opens in muster` — `main.ts` does not pass `held` yet.

- [ ] **Step 3: Add the copy**

In `src/engine/i18n.ts`, beside the `hud.deliver` entry (~line 331):

```ts
  // The Start card. The card addresses the CREW (the group), never the species —
  // see docs/architecture.md's terminology table, which tests/terminology.mjs walks.
  'ready.title': ['Your crew is ready', 'Dein Trupp steht bereit'],
  'ready.sheet': ['The caravan wants', 'Die Karawane will'],
  'ready.btn': ['▶ Start', '▶ Los'],
  'ready.hint': ['Look around first — drag to pan, scroll to zoom', 'Sieh dich erst um — ziehen zum Schwenken, scrollen zum Zoomen'],
```

- [ ] **Step 4: Style the card**

In `src/style.css`, after the `.resume-box` rules (~line 903):

```css
/* The Start card. It sits on a full-screen .overlay, so two things have to be
   undone: the heavy scrim (the player is here to READ the level behind it) and
   the pointer capture (the camera drag has to reach the canvas). Only the card
   itself takes the pointer. */
.ready-overlay {
  z-index: 20;
  background: rgba(10, 14, 22, 0.28);
  pointer-events: none;
}
.ready-card {
  pointer-events: auto;
  padding: 20px 26px;
  max-width: min(420px, 90vw);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  background: rgba(18, 24, 34, 0.86);
  border-color: var(--accent);
}
.ready-title { font-size: 20px; font-weight: 800; color: var(--accent); }
.ready-name { font-size: 16px; font-weight: 700; }
.ready-desc { font-size: 14px; color: var(--text-dim); line-height: 1.5; }
.ready-sheet { display: flex; gap: 14px; align-items: center; justify-content: center; }
.ready-sheet span { display: inline-flex; align-items: center; gap: 4px; }
.ready-hint { font-size: 12px; color: var(--text-dim); }
```

- [ ] **Step 5: Build and show the card**

In `src/main.ts`, add above `startGame` (~line 1388):

```ts
// The Start card is DERIVED, never held. showOptions, the report overlay and a
// language change all call clearOverlay(), which removes every .overlay — so the
// card cannot simply be created once and left there. Everything that clears
// overlays calls this afterwards, and the card is on screen exactly while the
// level is. Same rule as the wagon in caravan-look.ts: the picture reads the
// state, it does not remember it.
function syncReadyOverlay(): void {
  uiRoot.querySelector('.ready-overlay')?.remove();
  if (!game || game.phase !== 'muster') return;
  const ov = document.createElement('div');
  ov.className = 'overlay ready-overlay';
  const card = document.createElement('div');
  card.className = 'panel ready-card';
  const title = document.createElement('div');
  title.className = 'ready-title';
  title.textContent = t('ready.title');
  const name = document.createElement('div');
  name.className = 'ready-name';
  name.textContent = t(game.level.name);
  const desc = document.createElement('div');
  desc.className = 'ready-desc';
  desc.textContent = t(game.level.desc);
  const sheet = document.createElement('div');
  sheet.className = 'ready-sheet';
  for (const o of game.objectives) {
    const s = document.createElement('span');
    s.textContent = `${t(`item.${o.item}`)} ${o.amount}`;
    sheet.appendChild(s);
  }
  const btn = document.createElement('button');
  btn.className = 'big-btn ready-btn';
  btn.textContent = t('ready.btn');
  btn.onclick = () => beginRun();
  const hint = document.createElement('div');
  hint.className = 'ready-hint';
  hint.textContent = t('ready.hint');
  for (const n of [title, name, desc, sheet, btn, hint]) card.appendChild(n);
  ov.appendChild(card);
  uiRoot.appendChild(ov);
  btn.focus();
}

// Start the run: the sim leaves the muster, the card goes, and the speed control
// comes back to life.
function beginRun(): void {
  if (!game || game.phase !== 'muster') return;
  game.begin();
  audio.click();
  syncReadyOverlay();
  hud?.setHeld(false);
}
```

- [ ] **Step 6: Wire the three call sites**

In `src/main.ts` `startGame`, change the `Game` construction (~line 1396):

```ts
  game = new Game(def, randomSeed(), { held: true });
```

and after `hud!.setSpeed(speed);` (~line 1408) add:

```ts
  hud!.setHeld(true);
```

and after `syncMusic();` (~line 1413) add:

```ts
  syncReadyOverlay();
```

In `resumeGame` (~line 320), after `setSpeed(prevSpeed > 0 ? prevSpeed : 1);`:

```ts
  syncReadyOverlay(); // the options/report overlay took the card with it
  hud?.setHeld(game?.phase === 'muster');
```

In `attachHud` (~line 1290), at the very end of the function, after `hud.setActiveTool(hover.tool);`:

```ts
  // A language change calls attachHud() on a live game (applyLanguage, main.ts:417),
  // and the Hud constructor does root.innerHTML = '' — so BOTH the speed lock and
  // the card have to be re-derived here, not only the lock. syncReadyOverlay
  // removes before it creates, so calling it twice during startGame is harmless.
  hud.setHeld(game!.phase === 'muster');
  syncReadyOverlay();
```

- [ ] **Step 7: Suppress auto-pause and re-route the keyboard**

In `src/main.ts`, in `autoPauseOnFocusLoss` — find the early return `if (speed === 0) return;` (~line 352) and add above it:

```ts
  if (game?.phase === 'muster') return; // already held; a resume dialog on top of the Start card is two dialogs
```

In the keydown handler, immediately after the `.resume-overlay` guard (~line 2256):

```ts
  // A held level has one key: Start. No tool keys (nothing can be paid for yet)
  // and no pause (there is nothing running to pause).
  if (game.phase === 'muster') {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      beginRun();
    }
    return;
  }
```

- [ ] **Step 8: Disable the speed control while held**

In `src/game/ui.ts`, add next to `setSpeed` (~line 1315):

```ts
  // A pause button on a level that has not begun is a control with nothing to do,
  // and pressing it would freeze the muster with no way to read why.
  setHeld(held: boolean): void {
    this.speedTrigger.toggleAttribute('disabled', held);
    this.root.classList.toggle('held', held);
  }
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm run build && npm run preview`, then `npm run test:levelstart`
Expected: PASS, ending `all ok`.

- [ ] **Step 10: Run everything the switch-on could break**

Run: `npm run test:e2e && npm run test:mobile && npm run test:autopause && npm run test:clock && npm run test:i18n && npm run test:report-e2e && npm run test:restart-scenery && npm run test:terminology`
Expected: all PASS — Task 4 prepared every one of them.

- [ ] **Step 11: Commit**

```bash
git add src/main.ts src/game/ui.ts src/engine/i18n.ts src/style.css tests/levelstart.mjs package.json
git commit -m "feat: a level opens behind a Start card

The crew musters out of the town hall and lines up; the run clock, the
weather, the convoy window and the tide all wait. The player pans, reads
the order sheet, and presses Start.

Three details are one line away from a silent bug, and each has a test:
the overlay must not take the pointer (or the camera drag it exists to
allow is dead), the card must be re-derived after anything that calls
clearOverlay (or the options menu softlocks the level), and auto-pause
must stand down while held (or focus loss stacks two dialogs)."
```

---

### Task 6: The delivery switch on screen

**Files:**
- Modify: `src/game/sim.ts` (the `held` option also shuts the hatch)
- Modify: `src/game/ui.ts` (`buildTopbar` ~line 274, `update` ~line 1450, `renderBuildingBody` ~line 928, `renderMiscBody` ~line 1095)
- Modify: `src/game/render.ts` (`drawCaravan` ~line 1149)
- Modify: `src/engine/i18n.ts`
- Modify: `src/style.css`
- Modify: `tests/levelstart.mjs`

**Interfaces:**
- Consumes: `Game.shipping`, `Game.setShipping(on)` (Tasks 2–3); `Game.phase` (Task 1).
- Produces: DOM contract `.ship-row` (the HUD row, itself the button).

- [ ] **Step 1: Write the failing test**

Append to `tests/levelstart.mjs`, before `await browser.close();`:

```js
// ---- the delivery switch ----------------------------------------------------
await page.evaluate(() => window.__smallhands.startLevel(1)); // level 2: the order wants what you start with
await page.waitForTimeout(300);
check('a held level opens with the hatch shut', await page.evaluate(() => window.__smallhands.game.shipping === false));
await page.click('.ready-btn');
await page.waitForTimeout(300);
check('Start does not open the hatch', await page.evaluate(() => window.__smallhands.game.shipping === false));

check('the HUD says the hatch is shut', (await page.locator('.ship-row.shut').count()) === 1);
await page.waitForTimeout(2500);
check(
  'a shut hatch delivers nothing',
  await page.evaluate(() => window.__smallhands.game.objectives.every((o) => o.delivered === 0))
);

await page.click('.ship-row');
await page.waitForTimeout(120);
check('the HUD row opens the hatch', await page.evaluate(() => window.__smallhands.game.shipping === true));
check('the row stops reading shut', (await page.locator('.ship-row.shut').count()) === 0);

await page.click('.ship-row');
await page.waitForTimeout(120);
check('the HUD row shuts it again', await page.evaluate(() => window.__smallhands.game.shipping === false));
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run build && npm run preview`, then `npm run test:levelstart`
Expected: FAIL at `a held level opens with the hatch shut` — `held` sets only `phase` today.

- [ ] **Step 3: Let `held` shut the hatch**

In `src/game/sim.ts`, in the constructor tail:

```ts
    if (opts?.held) {
      this.phase = 'muster';
      this.shipping = false;
      this.startMuster();
    }
```

- [ ] **Step 4: Add the copy**

In `src/engine/i18n.ts`, beside the `convoy.*` entries (~line 361):

```ts
  // The delivery release. The row is its own button, so the copy has to say both
  // what is true now and what a click does.
  'ship.on': ['📦 <b>Delivery open</b> — click to hold goods back', '📦 <b>Lieferung offen</b> — klicken, um Ware zu halten'],
  'ship.off': ['🔒 <b>Delivery held</b> — click to load the caravan', '🔒 <b>Lieferung gehalten</b> — klicken, um die Karawane zu beladen'],
  'ship.title': [
    'The road to the caravan. While it is held, nothing is dispatched to the wagon and goods already on their way turn back to the store. Your keep dials still decide how much of each good stays home.',
    'Die Straße zur Karawane. Solange sie gehalten wird, geht nichts zum Wagen, und Ware, die schon unterwegs ist, kehrt ins Lager um. Wie viel von jedem Gut zu Hause bleibt, entscheiden weiter deine Halten-Regler.',
  ],
  'ship.btnOpen': ['Open the delivery', 'Lieferung freigeben'],
  'ship.btnHold': ['Hold the delivery', 'Lieferung halten'],
```

- [ ] **Step 5: Add the HUD row**

In `src/game/ui.ts`, add the field beside `convoyRow` (~line 180):

```ts
  private shipRow: HTMLElement | null = null;
  private shipSig = '';
```

In `buildTopbar`, directly after the `if (this.game.level.convoy) { … }` block (~line 274) and before `this.collapsible(obj, h);`:

```ts
    // The delivery release, under the order it gates. This is where the player is
    // already looking when they ask why nothing arrives, so the answer and the
    // control are the same element.
    this.shipRow = el('div', 'ship-row', obj);
    this.shipRow.title = t('ship.title');
    this.shipRow.onclick = () => {
      this.cbs.onShipping(!this.game.shipping);
      this.livePanel?.render(); // the wagon's own panel carries the same switch
    };
```

The HUD does not own the sim or the audio — it reports through callbacks. Add the callback to the
`HudCallbacks` interface (`src/game/ui.ts:109`), beside `onRestart`:

```ts
  onShipping: (on: boolean) => void;
```

and implement it in `src/main.ts`'s `attachHud` callback object, beside `onUpgrade`:

```ts
    onShipping: (on) => {
      game!.setShipping(on);
      // opening is the neutral surface; holding is a latch falling shut
      audio.click(on ? 'wood' : 'metal');
      hud?.update();
    },
```

In `update()`, after the `convoyRow` block (~line 1450):

```ts
    if (this.shipRow) {
      const sig = g.shipping ? 'on' : 'off';
      if (sig !== this.shipSig) {
        this.shipSig = sig;
        this.shipRow.classList.toggle('shut', !g.shipping);
        this.shipRow.innerHTML = t(g.shipping ? 'ship.on' : 'ship.off');
      }
    }
```

- [ ] **Step 6: Add the control to the wagon's panel**

In `src/game/ui.ts`, change the `renderMiscBody` signature and its one call site.

Call site (~line 928), inside `renderBuildingBody`:

```ts
    this.renderMiscBody(tip, b, interactive);
```

Signature (~line 1095):

```ts
  private renderMiscBody(tip: HTMLElement, b: Building, interactive: boolean): void {
```

At the end of the `else if (b.kind === 'goal')` branch, after the convoy line (~line 1122):

```ts
      // The same switch as the HUD row — the wagon is the other place the player
      // asks the question. Both read Game.shipping; neither keeps a copy.
      if (interactive) {
        const btn = el('button', 'tt-btn', tip);
        btn.textContent = t(g.shipping ? 'ship.btnHold' : 'ship.btnOpen');
        btn.onclick = () => {
          this.cbs.onShipping(!g.shipping);
          this.livePanel?.render();
        };
      } else {
        const verb = t(this.hoverOk ? 'producer.verbClick' : 'producer.verbTap');
        const key = g.shipping ? 'ship.btnHold' : 'ship.btnOpen';
        el('div', 'tt-desc tt-action', tip).textContent = `▸ ${t(key)} (${verb})`;
      }
```

- [ ] **Step 7: Draw the lock on the dock**

In `src/game/render.ts` `drawCaravan`, after the progress-bar block at the end of the method:

```ts
    // A shut hatch, drawn on the DOCK and not on the wagon: on a convoy level the
    // wagon drives away, and the sign that says "not now" has to stay behind. That
    // is the split the two sprites exist for.
    if (!game.shipping) {
      const lx = px + 3;
      const ly = py - 19;
      ctx.strokeStyle = '#2a1c16';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(lx + 4, ly + 4, 2.6, Math.PI, 0); // shackle
      ctx.stroke();
      ctx.fillStyle = '#e0b060';
      ctx.fillRect(lx, ly + 4, 8, 6); // body
      ctx.fillStyle = '#2a1c16';
      ctx.fillRect(lx + 3.5, ly + 6, 1, 2); // keyhole
    }
```

- [ ] **Step 8: Style the row**

In `src/style.css`, beside the `.convoy-row` rules (search for `.convoy-row`):

```css
.ship-row {
  margin-top: 4px;
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.05);
}
.ship-row:hover { background: rgba(255, 255, 255, 0.11); }
.ship-row.shut { color: var(--danger); background: rgba(200, 70, 55, 0.14); }
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm run build && npm run preview`, then `npm run test:levelstart`
Expected: PASS, ending `all ok`.

- [ ] **Step 10: Run the suites that read the HUD and the caravan**

Run: `npm run test:caravan && npm run test:caravan-shot && npm run test:hover-tooltip && npm run test:i18n && npm run test:terminology && npm run test:mobile`
Expected: all PASS. `test:caravan-shot` writes to `tests/.caravan-out/` — open the images and confirm the lock reads at the dock's size.

- [ ] **Step 11: Commit**

```bash
git add src/game/sim.ts src/game/ui.ts src/game/render.ts src/engine/i18n.ts src/style.css tests/levelstart.mjs
git commit -m "feat: the delivery release on screen, and held levels start shut

The switch appears on three surfaces and none of them keeps a copy: a
row under the order sheet that is its own button, the same control on
the wagon's inspect panel, and a lock drawn on the DOCK — not on the
wagon, which drives away on a convoy level.

held: true now also shuts the hatch. It waited until this commit so no
intermediate build could ship a level whose caravan cannot be opened."
```

---

### Task 7: Stamp the release in the bug report

**Files:**
- Modify: `src/game/report.ts` (run interface ~line 71, snapshot ~line 264, markdown table ~line 402)
- Modify: `tests/report.mjs`

**Interfaces:**
- Consumes: `Game.shipping`.
- Produces: `report.run.shipping: boolean` and a `| delivery |` row in the Run state table.

- [ ] **Step 1: Write the failing test**

In `tests/report.mjs`, beside the seed assertion (~line 103):

```js
  // "Nothing is being delivered" is the report this feature will produce. Without
  // the switch in the run table, such a report cannot be told apart from a real
  // hauling failure.
  check(
    'the run table stamps the delivery release',
    md.includes('| delivery |') && data.run.shipping === g.shipping
  );
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm run test:report`
Expected: FAIL — `the run table stamps the delivery release`.

- [ ] **Step 3: Add the field**

In `src/game/report.ts`, in the `run` interface directly under `seed` (~line 72):

```ts
    shipping: boolean; // the player's delivery release — a shut hatch looks exactly like broken hauling
```

In the snapshot object directly under `seed: game.seed,` (~line 265):

```ts
      shipping: game.shipping,
```

In the markdown table directly under the seed row (~line 402):

```ts
  push(`| delivery | ${run.shipping ? 'open' : 'held (nothing is dispatched to the caravan)'} |`);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:report && npm run test:report-e2e`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/report.ts tests/report.mjs
git commit -m "feat(report): stamp the delivery release in the run table

A shut hatch and broken hauling produce the same bug report. The switch
goes in beside the seed, which is the other thing a reader needs before
they can reproduce what the player saw."
```

---

### Task 8: A campaign proof through the new door, and the architecture note

**Files:**
- Modify: `tests/campaign1.mjs`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing new.

- [ ] **Step 1: Run level 1's proof through the held path**

In `tests/campaign1.mjs`, in `runLevel`, change the construction and give the scripted player two opening moves:

```js
function runLevel(def, steps, maxTime) {
  // Level 1 is played through the door a real player uses: the level opens held,
  // and the crew is mustered out and the caravan opened before anything else. The
  // other levels build the game plainly, so the proofs stay a proof of the SIM.
  // Without at least one of them passing this way, a scripted run could stay green
  // while every real player is stuck behind a shut hatch.
  const held = def.id === 1;
  const g = new Game(def, undefined, { held });
  if (held) {
    g.begin();
    g.setShipping(true);
  }
  const pending = [...steps];
  // …unchanged from here
```

`new Game(def, undefined, { held })` keeps the seed default: a default parameter applies to an
explicit `undefined`, so this is still `seed = level.id` and the proof stays as reproducible as it
was.

- [ ] **Step 2: Run the proof and read the printed times**

Run: `npm run test:campaign1`
Expected: PASS, and the printed completion times for levels 1–4 are the same as before this change (the muster does not advance `time`, and the hatch is opened at t=0). If level 1's time moved, something in the muster is leaking into the run — stop and find it rather than re-baselining.

- [ ] **Step 3: Write the architecture note**

In `docs/architecture.md`, add a new section after **"The keep floor is a target, not only a ceiling"**:

```markdown
## A level opens held (level start & the delivery release)

Two locks, one constructor option: `new Game(def, seed, { held: true })` sets
`phase = 'muster'` **and** `shipping = false`. `main.ts` is the only caller that passes it — the
front-door backdrop, `verifyLevel` and every headless suite build a plain `new Game(def)` and get
today's behaviour. That inverted default is deliberate and is the single most load-bearing decision
here: about fifteen play-to-a-win suites tick straight into a scripted run, and a locked default
would stall all of them with a failure that reads as a hauling bug. `tests/held.mjs` **asserts** the
default rather than trusting the convention.

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
  **all four** routes to the wagon — the store, a loose ground item, and a producer's output shelf.
  Gating the stock route alone is the leak the keep floor shipped with. It stays out of
  `acceptingSinkCells` for the same reason the convoy window and the floor do: that function answers
  "could this item *ever* be carried there", and a shut hatch is transient.
- **Shutting the hatch turns cargo back, and it turns back at a whole cell.** This follows the keep
  floor's precedent, not the convoy's "stops dispatch, not cargo" — the reason a player shuts it is
  that they still need the material. `setShipping(false)` marks the tasks; `tickMove` acts on the
  mark only while `w.px === w.cx && w.py === w.cy`. The equality is exact because every step boundary
  assigns both from one value; during a lift ride `py` travels while `cy` stays at the base, and
  re-pathing there would snap the rider down to the foot of the mast with nothing in the log.
- **Every surface is derived.** The Start card is rebuilt by `syncReadyOverlay()` from
  `game.phase`, because `showOptions`, the report overlay and a language change all call
  `clearOverlay()` — a card created once and left there is removed by the options menu, and the level
  is then stuck in muster with no way to start it. The lock is drawn on `goal_dock`, never on `goal`,
  because the wagon drives away on a convoy level and the sign has to stay.

`npm run test:held` is the headless guard (the defaults, the frozen clock, the derived line-up, the
shut hatch, and mass conservation through a turn-back counted by census rather than by two
containers); `npm run test:levelstart` is the browser guard, and its three most valuable assertions
are the ones for failures that throw nothing: the overlay must not take the pointer, the card must
survive the options round trip, and auto-pause must stand down while held.
```

- [ ] **Step 4: Run the whole suite**

Run:

```bash
npm run build
for s in unit held terrain motion hoist caravan campaign1 campaign2 campaign3 campaign4 campaign5 \
         digging report terminology i18n version weather biome-light dailylog devmode maplayout \
         frontdoor-data audio-smoke tool-labels landing gen-biome; do
  echo "=== $s ==="; npm run "test:$s" || echo "FAILED: $s"
done
```

then, with `npm run preview` running:

```bash
for s in e2e mobile autopause levelstart clock worldmap report-e2e restart-scenery \
         drag-tooltip hover-tooltip landing-shot frontdoor-mobile teaser-embed \
         i18n version caravan-shot weather-visual biome-hills vale-visual teaser-caption; do
  echo "=== $s ==="; npm run "test:$s" || echo "FAILED: $s"
done
node tests/editor-generator.mjs || echo "FAILED: editor-generator"
npm run trailer || echo "FAILED: trailer"
```

Expected: no `FAILED:` lines.

- [ ] **Step 5: Commit**

```bash
git add tests/campaign1.mjs docs/architecture.md
git commit -m "test+docs: play level 1's proof through the held door

Campaign 1's level 1 now builds with held: true and opens the caravan as
its first scripted move, so at least one proof passes through the door a
real player uses. Its printed time is unchanged — the muster does not
advance the run clock.

docs/architecture.md gains the section: why the default is 'run', why
the release gates the route where the keep floor gates the item, and why
the turn-back waits for a whole cell."
```

---

## Notes for the executor

- **The riskiest edit in the whole plan is Task 3, Step 7** — the two pickup lines. They sit inside the keep floor's own logic, and the guard for them is `tests/unit.mjs`'s reserve block. Run it before and after.
- **`tests/held.mjs` grows across Tasks 1, 2 and 3.** Do not split it; the census helper in Task 3 reads the game built in the same file.
- **Selectors in `tests/levelstart.mjs` are asserted against real markup.** If one does not match (the options button is the likely one), read `src/game/ui.ts` and fix the test — a wrong selector is a test bug, not a reason to change the HUD.
- **If a campaign proof's printed completion time moves, stop.** Those numbers are the repo's only difficulty telemetry (`docs/architecture.md`, "Curve intent"). The muster must not touch them.
