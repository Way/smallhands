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

console.log('scripted ballast level');
{
  const level = makeLevel({
    objectives: [{ item: 'plank', amount: 2 }],
    startWorkers: 5,
    startRoles: { hauler: 3, builder: 2 },
    startStock: { plank: 8, iron: 2 },
    build: (g) => {
      makeLevel().build(g);
      g.addBuilding('goal', 16, TOP - 3, true);
      // loose stone on the plateau — the only ballast within reach of the top
      for (let i = 0; i < 4; i++) {
        g.groundItems.push({ id: g.id(), item: 'stone', x: 15, y: TOP - 1, reserved: false, bounce: 0 });
      }
    },
  });

  const g = new Game(level);
  g.thLevel = 2; // hoist gate
  const placed = g.placeHoist(POST, TOP - 1);
  check('hoist placed on the cliff edge', placed);
  const b = g.hoists[0];
  check('the cars hang over the left drop to the valley', !!b && b.ropeSide === -1 && b.ropeBottomY === FLOOR - 1);
  g.toggleHoistRoute(b.id, 'lower', 'plank'); // route: planks ride UP

  let builtAt = -1;
  let wonAt = -1;
  for (let s = 0; s < 360 && wonAt < 0; s++) {
    run(g, 1);
    if (builtAt < 0 && b.state === 'ready') builtAt = s;
    if (g.won) wonAt = s;
  }
  check('a builder raises the hoist', builtAt >= 0);
  check(`the level is WON (planks up the cliff via ballast)${wonAt >= 0 ? ` in ${wonAt}s` : ''}`, wonAt >= 0);
  // mass conserved: the ballast is not consumed — it ends up in the valley,
  // either still loose on the floor or already collected into the stockpile
  check(
    'ballast really relocated, not destroyed',
    g.stock.stone > 0 || g.groundItems.some((gi) => gi.item === 'stone' && gi.y > TOP)
  );
}

console.log(failures ? `\n${failures} FAILURES` : '\nall ok');
process.exit(failures ? 1 : 0);
