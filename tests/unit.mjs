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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
