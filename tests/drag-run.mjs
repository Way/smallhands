// Headless checks for the drag-stack build feature (Ladder/Ramp/Bridge runs +
// runPlan affordability). Bundles the TS sim with esbuild (a vite dep) and
// imports it from a data URL, so it runs with plain `node`.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const res = await build({
  stdin: {
    contents: `
      export { World, ladderRunCells, rampRunCells, bridgeRunCells } from './src/game/world.ts';
      export { T } from './src/game/types.ts';
      export { Game } from './src/game/sim.ts';
      export { LEVELS } from './src/game/levels.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64'));
const { World, ladderRunCells, rampRunCells, bridgeRunCells, T, Game, LEVELS } = mod;

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}`);
  if (!cond) failures++;
}

// A 12x12 world: solid floor on rows 10-11, a wall column at x=6 (rows 4-9),
// air everywhere else. Ladders attach to the wall at x=5.
function wallWorld() {
  const w = new World(12, 12);
  for (let x = 0; x < w.w; x++) { w.set(x, 10, T.ROCK); w.set(x, 11, T.ROCK); }
  for (let y = 4; y <= 9; y++) w.set(6, y, T.ROCK);
  return w;
}

// --- Task 1: ladderRunCells (vertical column) ---
{
  const w = wallWorld();
  // ascend the wall from the floor: anchor (5,9) up to (5,4) => 6 cells, all x=5
  const up = ladderRunCells(w, 5, 9, 5, 4);
  check('ladder ascends the wall for 6 cells',
    up.length === 6 && up.every((c) => c.x === 5) &&
    up[0].y === 9 && up[5].y === 4);

  // a single click (no drag) is a run of length 1
  check('ladder single tile', ladderRunCells(w, 5, 9, 5, 9).length === 1);

  // horizontal drag is ignored — the column snaps to the anchor's x
  const snap = ladderRunCells(w, 5, 9, 2, 9);
  check('ladder ignores horizontal drag', snap.length === 1 && snap[0].x === 5);

  // stop at the first non-air cell
  const w2 = wallWorld();
  w2.set(5, 7, T.ROCK); // block the shaft mid-climb
  check('ladder run stops at solid', ladderRunCells(w2, 5, 9, 5, 4).length === 2);

  // descending stops when it hits the floor
  const down = ladderRunCells(w, 5, 4, 5, 11);
  check('ladder descends and stops at floor', down.length === 6 &&
    down[0].y === 4 && down[5].y === 9);

  // a floating anchor (no wall/ground/ladder) yields nothing
  check('ladder floating anchor invalid', ladderRunCells(w, 2, 3, 2, 1).length === 0);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
