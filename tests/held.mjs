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

console.log(failures ? `\n${failures} failure(s)` : '\nall ok');
process.exit(failures ? 1 : 0);
