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
// This is the guard for tests/campaign2-5, unit, hoist, digging, ramp, terrain,
// caravan and the editor soak, plus three of tests/campaign1.mjs's four levels:
// they all build `new Game(def)` and tick straight into a scripted playthrough.
// (Campaign1's level 1 is the deliberate exception — it plays through the held
// door itself, as the one play-to-a-win proof of the entry a real player uses.)
// A muster default would stall every one of them, and the failure would read
// as a hauling bug.
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
// Real productive work needs a player action this level never got (flag a
// tree, place a sawmill blueprint) — L1 has none at t=0 — so the only path
// to a task here is tryAssignWander, a 1.5%-per-attempt draw on `rand`.
// Checking the state at one fixed instant is exactly the anti-pattern this
// codebase's own docs warn against (docs/architecture.md, "the sim is
// deterministic": "Assert on state, not on the instant... Scan for such an
// instant, don't pin a seed to it"): for seed 'seed-a' that draw lands at
// t≈6.03s, a beat past the 5s mark checked above, so a snapshot at 5s alone
// misses it. Scan every tick over a generous window instead — the same
// shape tests/hoist.mjs uses, and for the same reason: an instant sampled
// once is a coin flip, not a proof.
let tookWork = held.workers.some((w) => w.task !== null);
for (let i = 0; i < 30 * 20 && !tookWork; i++) {
  held.tick(1 / 30);
  tookWork = held.workers.some((w) => w.task !== null);
}
check('the crew takes work after begin', tookWork);
check('begin on a running game is a no-op', (held.begin(), held.phase === 'run'));

// ---- the delivery release --------------------------------------------------
// Level 3 is the reported bug in its purest form: it has enough starting stock
// that the crew immediately begins hauling to the caravan, so a 250-second run
// shows delivery with shipping = true and nothing with shipping = false.
const L3 = LEVELS[2];

const openHatch = new Game(L3);
step(openHatch, 250);
check(
  'control: an open hatch ships the starting stock',
  openHatch.objectives.some((o) => o.delivered > 0)
);

const shut = new Game(L3);
shut.setShipping(false);
check('setShipping(false) shuts the hatch', shut.shipping === false);
step(shut, 250);
check('a shut hatch delivers nothing', shut.objectives.every((o) => o.delivered === 0));
check('a shut hatch reserves nothing', shut.objectives.every((o) => o.inbound === 0));
check('the starting stock stays in store', shut.stock.plank >= (L3.startStock?.plank ?? 0));

// opening it lets the same store flow
shut.setShipping(true);
step(shut, 250);
check('opening the hatch ships the store', shut.objectives.some((o) => o.delivered > 0));

// the default is open — the fifteen scripted suites depend on it
check('shipping defaults to open', new Game(L1).shipping === true);

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

  // `check` only counts a failure, it does not abort — without this guard a timed-out
  // search would go on to dereference a null `w` below and kill the file with a raw
  // TypeError instead of a clean `N failure(s)` line.
  if (w) {
    const item = 'plank';
    check('no sawmill exists, so the plank census is fixed', !g.buildings.some((b) => b.kind === 'sawmill'));

    // Walk the worker off its cell in small steps rather than hoping the run happens
    // to catch one mid-step: the sim is deterministic, so a conditional here either
    // always runs or never does — and it never did. (docs/architecture.md: "scan for
    // such an instant, don't pin a seed to it".)
    for (let i = 0; i < 100 && w.px === w.cx && w.py === w.cy; i++) g.tick(1 / 600);
    check('the worker is mid-step', w.px !== w.cx || w.py !== w.cy);

    const mass = census(g, item);
    g.setShipping(false);

    // A 1/600s tick cannot complete a step at WALK_SPEED, so this catches the mark
    // before either whole-cell arrival point (tickMove's top-of-tick check, and
    // settleArrival at the two places tickMove lands a worker) has any chance to act
    // on it: the mark is set but the haul has not yet turned. This is the lift-ride
    // hazard tested through its own predicate — during a ride py travels while cy
    // stays behind, and re-pathing there would snap the rider down to the foot of
    // the mast with nothing in the log.
    g.tick(1 / 600);
    check('a mid-step haul is marked but not yet turned', w.task.sink.t === 'goal' && w.task.divert === true);

    for (let i = 0; i < 30 * 60; i++) {
      g.tick(1 / 30);
      if (census(g, item) !== mass) break;
    }
    check('mass is conserved through the turn', census(g, item) === mass);
    check('nothing reached the wagon after the hatch shut', g.objectives.every((o) => o.delivered === 0));
    check('the goal reservations are released', g.objectives.every((o) => o.inbound === 0));
    check('no task is still bound for the wagon', g.workers.every((x) => x.task?.kind !== 'haul' || x.task.sink.t !== 'goal'));

    // A worker mid-route (not on its last step) never proves the arrival-point divert:
    // completing an ordinary step just advances stepIdx, it never calls
    // arriveAtTaskTarget. Only a worker mid-step on its FINAL leg reaches the walk
    // branch's step-completion call, the one place besides tickMove's top-of-tick
    // check that can hand a haul to arriveAtTaskTarget — and it must turn the mark
    // into a reroute there too, not let a landing slip through in the same tick.
    const g2 = new Game(L3);
    const plankObj2 = () => g2.objectives.find((o) => o.item === 'plank');
    let w2 = null;
    for (let i = 0; i < 30 * 120 && !w2; i++) {
      g2.tick(1 / 30);
      w2 = g2.workers.find(
        (x) =>
          x.task?.kind === 'haul' &&
          x.task.sink.t === 'goal' &&
          x.task.phase === 'toSink' &&
          x.carrying === 'plank' &&
          x.stepIdx === x.path.length - 1 &&
          (x.px !== x.cx || x.py !== x.cy)
      );
    }
    check('found a hauler mid-step on its final leg to the wagon', w2 !== null);
    if (w2) {
      const deliveredBefore = plankObj2().delivered;
      g2.setShipping(false);
      // Tick through the landing at a normal rate: whichever tick this step
      // completes on, the arrival-point divert must catch it before
      // arriveAtTaskTarget can deposit into the objective.
      for (let i = 0; i < 30 * 5; i++) g2.tick(1 / 30);
      check('a haul on its final step still turns back, not delivers', plankObj2().delivered === deliveredBefore);
    }
  }
}

// re-opening before the mark is acted on leaves the haul on its route
{
  const g = new Game(L3);
  let w = null;
  for (let i = 0; i < 30 * 120 && !w; i++) {
    g.tick(1 / 30);
    w = g.workers.find((x) => x.task?.kind === 'haul' && x.task.sink.t === 'goal' && x.task.phase === 'toSink');
  }
  check('found a hauler heading to the wagon', w !== null);
  if (w) {
    g.setShipping(false);
    g.setShipping(true);
    check('flipping twice leaves the haul alone', w.task.sink.t === 'goal' && !w.task.divert);
  }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
process.exit(failures ? 1 : 0);
