// Headless checks for the Counterweight Hoist — no browser needed.
// Two angles:
//   1. the cycle rule truth table ("the heavier side sinks", strict
//      inequality, stone = weight 2, storm brake, unload positions);
//   2. a scripted end-to-end level: planks at the bottom, the caravan on a
//      plateau, loose stone up top — the hoist must raise the planks with
//      auto-requested ballast and the level must be WON.
import { bundleExports } from './bundle.mjs';

const mod = await bundleExports(`
  export { Game } from './src/game/sim.ts';
  export { T, ITEM_WEIGHT, HOIST_CYCLE, HOIST_CAR_CAPACITY, carWeight } from './src/game/types.ts';
`);
const { Game, T, ITEM_WEIGHT, HOIST_CYCLE, carWeight } = mod;

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}`);
    failures++;
  }
}

const DT = 1 / 60;
const run = (game, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) game.tick(DT);
};

// Shared geometry: a valley (with the town hall) and a plateau filling the
// right half. The hoist hangs over the plateau's LEFT face (x=13) straight
// into the valley. Empty hands reach the top through a floor-level tunnel in
// the plateau's base to an interior ladder shaft (x=20) — a route cargo can
// never take, so goods only come back up via the hoist under test.
const FLOOR = 14; // first solid row of the valley floor
const TOP = 7; // first solid row of the plateau
const POST = 14; // the plateau's left-edge cell carries the hoist post
function makeLevel(extra = {}) {
  return {
    id: 990,
    name: 'Ballast Test',
    desc: '',
    width: 24,
    height: 18,
    objectives: [],
    startWorkers: 0,
    build: (g) => {
      const { world } = g;
      for (let x = 0; x < 24; x++) {
        for (let y = FLOOR; y < 18; y++) world.set(x, y, y === FLOOR ? T.GRASS : T.DIRT);
      }
      for (let x = 14; x < 24; x++) {
        for (let y = TOP; y < FLOOR; y++) world.set(x, y, y === TOP ? T.GRASS : T.DIRT);
      }
      for (let x = 14; x < 20; x++) world.set(x, FLOOR - 1, T.AIR); // the tunnel
      for (let y = TOP - 1; y < FLOOR; y++) world.set(20, y, T.LADDER); // the shaft
      g.addBuilding('townhall', 2, FLOOR - 3, true);
    },
    ...extra,
  };
}

// a ready hoist on the plateau's cliff edge, cars pre-loaded by hand
function makeHoist(game, upper, lower) {
  const b = game.addBuilding('hoist', POST, TOP - 1, true);
  b.ropeSide = -1;
  b.ropeBottomY = FLOOR - 1;
  b.hoistUpper = { ...upper };
  b.hoistLower = { ...lower };
  return b;
}

// ---- the rule: THE HEAVIER SIDE SINKS -----------------------------------------

console.log('cycle truth table');
{
  check('stone weighs 2, everything else 1', ITEM_WEIGHT.stone === 2 && ITEM_WEIGHT.plank === 1);
  check('carWeight sums by weight', carWeight({ stone: 2, plank: 1 }) === 5);

  // balanced pulley: 1 stone (2) vs 2 planks (2) — must NOT move
  let g = new Game(makeLevel());
  let b = makeHoist(g, { stone: 1 }, { plank: 2 });
  run(g, 1);
  check('a balanced pulley does not move (strict inequality)', !b.hoistBusy);

  // lighter top: must not move either
  g = new Game(makeLevel());
  b = makeHoist(g, { plank: 1 }, { stone: 1 });
  run(g, 1);
  check('a lighter top car does not sink', !b.hoistBusy);

  // heavier top: cycles, and unloads both cars at the opposite stations
  g = new Game(makeLevel());
  b = makeHoist(g, { stone: 1 }, { plank: 1 });
  run(g, 0.5);
  check('a heavier top car starts the cycle', b.hoistBusy);
  run(g, HOIST_CYCLE + 0.5);
  check(
    'the cycle ends with both cars empty',
    !b.hoistBusy && carWeight(b.hoistUpper) === 0 && carWeight(b.hoistLower) === 0
  );
  const stoneAtBottom = g.groundItems.some((gi) => gi.item === 'stone' && gi.y === FLOOR - 1);
  const plankAtTop = g.groundItems.some((gi) => gi.item === 'plank' && gi.y === TOP - 1);
  check('ballast lands below, cargo lands on top (mass conserved)', stoneAtBottom && plankAtTop);

  // one item alone in the top car beats an empty bottom car (downhill is free)
  g = new Game(makeLevel());
  b = makeHoist(g, { log: 1 }, {});
  run(g, 0.5);
  check('downhill needs no ballast (1 vs empty cycles)', b.hoistBusy);

  // storm brake: same load, but a storm locks the wheel
  g = new Game(makeLevel({ weather: [{ kind: 'storm', duration: 9999 }] }));
  b = makeHoist(g, { stone: 1 }, {});
  run(g, 1);
  check('the storm brake blocks the cycle', !b.hoistBusy);

  // inbound loads hold the wheel: ballast must not ride down alone while its
  // cargo is still on a hauler's back
  g = new Game(makeLevel());
  b = makeHoist(g, { stone: 1 }, {});
  b.hoistLowerIn = { plank: 1 };
  run(g, 1);
  check('an inbound load holds the wheel', !b.hoistBusy);

  // routing toggles are exclusive per item (no perpetual motion)
  g = new Game(makeLevel());
  b = makeHoist(g, {}, {});
  g.toggleHoistRoute(b.id, 'lower', 'plank');
  check('send-up toggle sets', b.hoistSendUp.plank === true);
  g.toggleHoistRoute(b.id, 'upper', 'plank');
  check('send-down flips the send-up off (exclusive)', b.hoistSendDown.plank === true && !b.hoistSendUp.plank);
}

// ---- end-to-end: raise planks up a 7-tile cliff with stone ballast --------------

const BALLAST_COUNT = 4; // loose stones seeded on the plateau, the run's whole stone supply

function ballastLevel() {
  return makeLevel({
    objectives: [{ item: 'plank', amount: 2 }],
    startWorkers: 5,
    startRoles: { hauler: 3, builder: 2 },
    startStock: { plank: 8, iron: 2 },
    build: (g) => {
      makeLevel().build(g);
      g.addBuilding('goal', 16, TOP - 3, true);
      // loose stone on the plateau — the only ballast within reach of the top
      for (let i = 0; i < BALLAST_COUNT; i++) {
        g.groundItems.push({ id: g.id(), item: 'stone', x: 15, y: TOP - 1, reserved: false, bounce: 0 });
      }
    },
  });
}

// Set the scripted level up and hand back the pieces, unplayed.
function armBallastLevel(seed) {
  const level = ballastLevel();
  const g = seed === undefined ? new Game(level) : new Game(level, seed);
  g.thLevel = 2; // hoist gate
  const placed = g.placeHoist(POST, TOP - 1);
  const b = g.hoists[0];
  if (b) g.toggleHoistRoute(b.id, 'lower', 'plank'); // route: planks ride UP
  return { g, b, placed };
}

// Play it to the win, one sim-second at a time.
function playBallastLevel(seed) {
  const { g, b, placed } = armBallastLevel(seed);
  let builtAt = -1;
  let wonAt = -1;
  for (let s = 0; s < 360 && wonAt < 0; s++) {
    run(g, 1);
    if (builtAt < 0 && b?.state === 'ready') builtAt = s;
    if (g.won) wonAt = s;
  }
  return { g, b, placed, builtAt, wonAt };
}

// Every place a stone can legitimately be at the instant the level is won. The
// win breaks the loop mid-tick-stream, so a relocated stone is just as likely to
// be in a hauler's hands or riding a car as it is to be lying on the valley
// floor — a census that only reads the ground and the stockpile mistakes a stone
// in transit for a stone destroyed (that was this suite's 1-in-20 flake, #65).
function stoneCensus(g) {
  const stock = g.stock.stone ?? 0;
  const ground = g.groundItems.filter((gi) => gi.item === 'stone');
  const hands = g.workers.filter((w) => w.carrying === 'stone').length;
  // The same four buckets the sim's own per-building accounting counts (see
  // `locateItem` in sim.ts): a machine's inputs/outputs and the two hoist cars.
  // Deliberately NOT hoistUpperIn/hoistLowerIn — those are inbound *reservations*
  // and double-count the stone already counted in its hauler's hands. No building
  // on this scripted level takes stone today, but leaving the buckets out is the
  // very omission that made the old check flaky, so count them anyway.
  const inBuildings = g.buildings.reduce(
    (n, b) => n + (b.inputs.stone ?? 0) + (b.outputs.stone ?? 0) + (b.hoistUpper.stone ?? 0) + (b.hoistLower.stone ?? 0),
    0
  );
  return {
    stock,
    hands,
    inBuildings,
    onShelf: ground.filter((gi) => gi.y <= TOP).length, // still up on the plateau, unused
    inValley: ground.filter((gi) => gi.y > TOP).length,
    total: stock + ground.length + hands + inBuildings,
  };
}

console.log('scripted ballast level');
{
  const { g, b, placed, builtAt, wonAt } = playBallastLevel();
  check('hoist placed on the cliff edge', placed);
  check('the cars hang over the left drop to the valley', !!b && b.ropeSide === -1 && b.ropeBottomY === FLOOR - 1);
  check('a builder raises the hoist', builtAt >= 0);
  check(`the level is WON (planks up the cliff via ballast)${wonAt >= 0 ? ` in ${wonAt}s` : ''}`, wonAt >= 0);
  // mass conserved: the ballast is not consumed — every stone is still somewhere,
  // and at least one of them has left the plateau to ride the hoist down
  const c = stoneCensus(g);
  check(`ballast not destroyed (${c.total}/${BALLAST_COUNT} stones accounted for)`, c.total === BALLAST_COUNT);
  check(
    `ballast really relocated (valley ${c.inValley}, stock ${c.stock}, hands ${c.hands}, machines ${c.inBuildings})`,
    c.inValley + c.stock + c.hands + c.inBuildings > 0
  );
}

// The census itself, container by container. This is the defect the flake was —
// a bucket the count forgot — and it is checked directly here rather than through
// a scheduling coincidence, so it cannot rot when sim timing shifts.
console.log('stone census counts every container (#65)');
{
  const g = new Game(makeLevel({ startWorkers: 1, startRoles: { hauler: 1 } }));
  check('a fresh level holds no stone at all', stoneCensus(g).total === 0);

  g.stock.stone = 1;
  check('stockpiled stone counts', stoneCensus(g).total === 1);

  g.groundItems.push({ id: g.id(), item: 'stone', x: 15, y: TOP - 1, reserved: false, bounce: 0 });
  const onGround = stoneCensus(g);
  check('loose stone counts, and on the plateau reads as on-shelf', onGround.total === 2 && onGround.onShelf === 1);

  g.workers[0].carrying = 'stone';
  check('stone in a hauler\'s hands counts', stoneCensus(g).hands === 1 && stoneCensus(g).total === 3);

  const b = makeHoist(g, { stone: 1 }, {});
  check('stone riding a hoist car counts', stoneCensus(g).inBuildings === 1 && stoneCensus(g).total === 4);

  g.townhall.inputs.stone = 1;
  check('stone in a machine\'s buffer counts', stoneCensus(g).inBuildings === 2 && stoneCensus(g).total === 5);

  // the one bucket that must NOT be counted: an inbound reservation is a promise
  // about the stone already counted in its hauler's hands, not a second stone
  b.hoistUpperIn = { stone: 1 };
  check('an inbound reservation adds nothing (it would double-count)', stoneCensus(g).total === 5);
}

// The flake's instant, found rather than pinned. The old check failed whenever the
// win happened to land while the ballast was in transit with nothing yet in the
// valley or the stockpile — about 1 run in 20. Pinning a seed that wins on such a
// tick is pinning an emergent trajectory: the first attempt (seed 30) was retired
// by an unrelated change to the draw order within a day, and the red read like a
// ballast bug rather than "re-pin me".
//
// Scanning removes the coincidence entirely. Every run passes *through* that state
// on its way — the first stone to move is in a hauler's hands or riding a car
// before any stone has landed — so the suite steps the run tick by tick, checks
// mass at every single tick (a stricter contract than checking it once at the win),
// and asserts that the run really does reach the state the old assertion mislabelled.
// Nothing here depends on when the win falls, so nothing here can rot.
// Several trajectories, not one: the scan no longer cares when the win lands, so
// breadth is nearly free (~2.5k ticks each) and each message names its seed.
console.log('mass is conserved at every tick, including mid-haul (#65)');
for (const seed of [undefined, 7, 42]) {
  const label = seed === undefined ? 'default seed' : `seed ${seed}`;
  const { g } = armBallastLevel(seed);
  let leakAt = -1; // first tick where a stone went missing
  let midHaul = null; // first tick with ballast in transit and nothing landed
  let ticks = 0;
  for (let i = 0; i < 360 * 60 && !g.won; i++) {
    g.tick(DT);
    ticks++;
    const c = stoneCensus(g);
    if (leakAt < 0 && c.total !== BALLAST_COUNT) leakAt = i;
    if (!midHaul && c.inValley === 0 && c.stock === 0 && c.hands + c.inBuildings > 0) {
      midHaul = { at: +(i * DT).toFixed(1), ...c };
    }
  }
  check(`${label}: the level is WON (${(ticks * DT).toFixed(0)}s of ticks)`, g.won);
  check(
    leakAt < 0
      ? `${label}: every stone is accounted for on all ${ticks} ticks`
      : `${label}: stone went missing at tick ${leakAt} (${(leakAt * DT).toFixed(1)}s)`,
    leakAt < 0
  );
  check(
    midHaul
      ? `${label}: passes through the mid-haul instant at ${midHaul.at}s (hands ${midHaul.hands}, machines ${midHaul.inBuildings}, valley 0, stock 0)`
      : `${label}: never carried ballast before something landed — the flake state is unreachable here, so this run no longer covers it`,
    !!midHaul
  );
  check(
    `${label}: …and the census accounts for all ${BALLAST_COUNT} stones at that instant`,
    midHaul?.total === BALLAST_COUNT
  );
}

console.log(failures ? `\n${failures} FAILURES` : '\nall ok');
process.exit(failures ? 1 : 0);
