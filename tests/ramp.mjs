// Headless checks for the Ramp/Bridge feature. Bundles the TS sim with esbuild
// (a vite dep) and imports it from a data URL, so it runs with plain `node`.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const res = await build({
  stdin: {
    contents: `
      export { World } from './src/game/world.ts';
      export { findPath } from './src/game/nav.ts';
      export { T } from './src/game/types.ts';
      export { canPlaceRamp, rampRunCells, bridgeRunCells } from './src/game/world.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64'));
const { World, findPath, T, canPlaceRamp, rampRunCells, bridgeRunCells } = mod;

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}`);
  if (!cond) failures++;
}

// Build a flat world with a +2 step up at column stepX, then hand-place a 45°
// ramp of RAMP tiles and confirm a CARRYING worker can climb it.
function stepWorld() {
  const w = new World(24, 20);
  const surfaceY = 14, stepX = 10;
  for (let x = 0; x < w.w; x++) {
    const sy = x < stepX ? surfaceY : surfaceY - 2; // +2 ledge on the right
    for (let y = 0; y < w.h; y++) w.set(x, y, y < sy ? T.AIR : y === sy ? T.GRASS : T.DIRT);
  }
  return { w, surfaceY, stepX };
}

// --- Task 1: RAMP is floor support; a ramp staircase is climbable while carrying ---
{
  const { w, surfaceY, stepX } = stepWorld();
  // an air cell is not support; the same cell as RAMP is
  check('AIR is not support', w.isSupport(2, 2) === false);
  w.set(2, 2, T.RAMP);
  check('RAMP is floor support', w.isSupport(2, 2) === true);
  w.set(2, 2, T.AIR);

  // control: bare +2 step is NOT climbable while carrying
  const start = new Set([w.key(stepX, surfaceY - 3)]); // standable on the ledge (10,11)
  const bare = findPath(w, [], stepX - 3, surfaceY - 1, start, true);
  check('bare +2 step: no carry path (control)', bare === null);

  // ramp: two support tiles forming a 45° staircase up to the ledge. Standing on
  // top of them gives cells (stepX-2, surfaceY-2) then (stepX-1, surfaceY-3),
  // from which the worker walks flat onto the ledge at (stepX, surfaceY-3).
  w.set(stepX - 2, surfaceY - 1, T.RAMP); // (8,13) -> stand (8,12)
  w.set(stepX - 1, surfaceY - 2, T.RAMP); // (9,12) -> stand (9,11)
  const withRamp = findPath(w, [], stepX - 3, surfaceY - 1, start, true);
  check('ramp staircase: carry path exists', withRamp !== null);
}

// --- Task 2: placement logic ---
{
  const { w, surfaceY, stepX } = stepWorld();
  // anchor on the ground (solid below) is valid; floating anchor is not
  check('anchor on ground valid', canPlaceRamp(w, stepX - 2, surfaceY - 1, null) === true);
  check('floating anchor invalid', canPlaceRamp(w, stepX - 2, surfaceY - 5, null) === false);
  // a diagonal chain step from a previous ramp tile is valid; a straight step is not
  check('diagonal chain valid', canPlaceRamp(w, stepX - 1, surfaceY - 2, { x: stepX - 2, y: surfaceY - 1 }) === true);
  check('non-diagonal chain invalid', canPlaceRamp(w, stepX - 1, surfaceY - 1, { x: stepX - 2, y: surfaceY - 1 }) === false);

  // an ascending 45° run of length 2 into the ledge
  const up = rampRunCells(w, stepX - 2, surfaceY - 1, stepX, surfaceY - 3);
  check('rampRunCells ascends 45 for 3 cells', up.length === 3 &&
    up[0].x === stepX - 2 && up[0].y === surfaceY - 1 &&
    up[1].x === stepX - 1 && up[1].y === surfaceY - 2 &&
    up[2].x === stepX && up[2].y === surfaceY - 3);
  // run stops at the first solid cell: dragging down-left off the ledge into the
  // terrace body places only the anchor before the next cell hits grass
  check('rampRunCells stops at solid', rampRunCells(w, stepX + 1, surfaceY - 3, stepX - 2, surfaceY).length === 1);

  // bridge: horizontal run along a row anchored to the ledge edge
  const br = bridgeRunCells(w, stepX, surfaceY - 3, stepX + 3, surfaceY - 3);
  check('bridgeRunCells is horizontal', br.length >= 1 && br.every((c) => c.y === surfaceY - 3));
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
