// Fast headless unit checks for pure sim logic — no browser needed.
// Bundles the TypeScript sources with esbuild (already a dev dep via vite) and
// imports the result from an in-memory data URL, so it runs with plain `node`.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const res = await build({
  stdin: {
    contents: `
      export { Game } from './src/game/sim.ts';
      export { LEVELS } from './src/game/levels.ts';
      export { canPlaceLadder } from './src/game/world.ts';
      export { T } from './src/game/types.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64')
);
const { Game, LEVELS, canPlaceLadder, T } = mod;

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}`);
    failures++;
  }
}

// Find two distinct valid ladder cells on level 1's terrain.
function findLadderCells(g, count) {
  const cells = [];
  for (let y = 0; y < g.world.h && cells.length < count; y++) {
    for (let x = 0; x < g.world.w && cells.length < count; x++) {
      if (canPlaceLadder(g.world, x, y)) cells.push({ x, y });
    }
  }
  return cells;
}

// ---- Ladders cost "1 wood": prefer a log, fall back to a plank -------------
// The reported softlock: after every tree is harvested and every log is sawn
// into planks, the player has planks but zero logs — ladders must still build.
// Logs stay the default so refined planks are left for the goal and platforms.
{
  const g = new Game(LEVELS[0]);
  const [cellA, cellB, cellC] = findLadderCells(g, 3);
  check('level 1 has valid ladder cells', cellA && cellB && cellC);

  // planks only, no logs — the "all trees cut to planks" state (the bug report)
  g.stock = { log: 0, plank: 5, stone: 0, iron: 0, spear: 0 };
  const builtFromPlank = g.placeLadder(cellA.x, cellA.y);
  check('ladder builds from a plank when no logs remain', builtFromPlank === true);
  check('building it consumed one plank', g.stock.plank === 4);
  check('the tile became a ladder', g.world.get(cellA.x, cellA.y) === T.LADDER);

  // demolish refunds a plank (never a log — that would be an infinite-plank loop)
  g.demolish(cellA.x, cellA.y);
  check('demolishing a ladder refunds a plank', g.stock.plank === 5);
  check('demolish mints no phantom log', g.stock.log === 0);

  // when both are on hand, a log is spent first and planks are left alone
  g.stock = { log: 5, plank: 3, stone: 0, iron: 0, spear: 0 };
  const builtFromLog = g.placeLadder(cellB.x, cellB.y);
  check('ladder builds when logs are available', builtFromLog === true);
  check('a log is spent before a plank', g.stock.log === 4);
  check('planks are untouched while a log exists', g.stock.plank === 3);

  // no wood of any kind — the build is refused
  g.stock = { log: 0, plank: 0, stone: 0, iron: 0, spear: 0 };
  const builtFromNothing = g.placeLadder(cellC.x, cellC.y);
  check('a ladder can NOT be built with no wood at all', builtFromNothing === false);
  check('the tile stays empty when refused', g.world.get(cellC.x, cellC.y) !== T.LADDER);
}

// ---- setKeep clamps to a sane integer range --------------------------------
{
  const g = new Game(LEVELS[0]);
  g.setKeep('stone', -5);
  check('setKeep floors negatives at 0', g.keep.stone === 0);
  g.setKeep('stone', 250);
  check('setKeep caps at 99', g.keep.stone === 99);
  g.setKeep('stone', 3.7);
  check('setKeep truncates to an integer', g.keep.stone === 3);
}

// ---- Reserve: haulers ship only the surplus above the floor ----------------
// Level 1's only haul work is delivering planks to the caravan (no marked
// nodes, no buildings), so plank deliveries are a clean probe of the gate.
{
  const g = new Game(LEVELS[0]); // objective: plank 8
  const plankObj = () => g.objectives.find((o) => o.item === 'plank');

  // floor at or above stock → no caravan haul is ever created
  g.stock.plank = 3;
  g.setKeep('plank', 5);
  for (let i = 0; i < 60 * 12; i++) g.tick(1 / 60); // 12s
  check('nothing ships while stock <= keep', plankObj().inbound + plankObj().delivered === 0);
  check('the reserved stock is untouched', g.stock.plank === 3);

  // drop the floor → the surplus (3 - 1) ships, and stock never dips below it
  g.setKeep('plank', 1);
  for (let i = 0; i < 60 * 25; i++) g.tick(1 / 60); // 25s
  check('surplus ships once the floor drops', plankObj().inbound + plankObj().delivered === 2);
  check('stock never falls below the floor', g.stock.plank >= 1);
}

// ---- Level 3 shape: stone is both the order and the build material ---------
{
  const g = new Game(LEVELS[2]); // objectives include stone 8; goal at west edge
  const stoneObj = () => g.objectives.find((o) => o.item === 'stone');

  // bank 6 stone (the TH Lv2 upgrade cost); only the surplus of a 10 stock ships
  g.stock.stone = 10;
  g.setKeep('stone', 6);
  for (let i = 0; i < 60 * 30; i++) g.tick(1 / 60); // 30s
  check('order stalls at the floor (ships 10-6=4)', stoneObj().delivered === 4);
  check('6 stone stay banked for building', g.stock.stone === 6);

  // release the floor → the order finishes (up to the 8 required)
  g.setKeep('stone', 0);
  for (let i = 0; i < 60 * 30; i++) g.tick(1 / 60); // 30s
  check('lowering the floor lets the order finish', stoneObj().delivered === 8);
  check('stock drops to the remainder (10-8=2)', g.stock.stone === 2);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
