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
      export { Game } from './src/game/sim.ts';
      export { LEVELS } from './src/game/levels.ts';
      export { TOOL_DEFS } from './src/game/types.ts';
      export { verifyLevel, blankLevelData, encodeTiles, decodeTiles } from './src/game/leveldata.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64'));
const { World, findPath, T, canPlaceRamp, rampRunCells, bridgeRunCells, Game, LEVELS, TOOL_DEFS, verifyLevel, blankLevelData, encodeTiles, decodeTiles } = mod;

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

// --- Bridge spans an open gap: the run must chain deck-to-deck, not re-check
// each tile against the untouched world (which stops after the anchor). ---
{
  // Flat ground with a 5-wide bottomless pit at columns gapL..gapR.
  const w = new World(24, 20);
  const surfaceY = 14, gapL = 8, gapR = 12;
  for (let x = 0; x < w.w; x++) {
    for (let y = 0; y < w.h; y++) {
      if (x >= gapL && x <= gapR) { w.set(x, y, T.AIR); continue; } // open pit
      w.set(x, y, y < surfaceY ? T.AIR : y === surfaceY ? T.GRASS : T.DIRT);
    }
  }

  // Drag a bridge from the left rim across the whole pit to the right rim.
  const span = bridgeRunCells(w, gapL, surfaceY, gapR, surfaceY);
  check('bridge spans a 5-wide gap (chains deck-to-deck)',
    span.length === 5 && span.every((c) => c.y === surfaceY) &&
    span[0].x === gapL && span[4].x === gapR);

  // Dragging past the far rim stops at the first solid cell (no overwrite).
  const clipped = bridgeRunCells(w, gapL, surfaceY, gapL + 7, surfaceY);
  check('bridge run stops at the far solid rim', clipped.length === 5);

  // A mid-air anchor with no solid/deck contact still starts nothing.
  check('floating bridge anchor places nothing',
    bridgeRunCells(w, gapL + 1, surfaceY, gapR, surfaceY).length === 0);

  // End-to-end through the sim: a plank is charged per spanning tile. Rebuild the
  // same pit inside the game's own world (matching its dimensions) so placeBridgeRun
  // runs the real charge/place path.
  const g = new Game(LEVELS[0]);
  const gsY = g.world.h - 6;
  for (let x = 0; x < g.world.w; x++) {
    for (let y = 0; y < g.world.h; y++) {
      if (x >= gapL && x <= gapR) { g.world.set(x, y, T.AIR); continue; }
      g.world.set(x, y, y < gsY ? T.AIR : y === gsY ? T.GRASS : T.DIRT);
    }
  }
  g.stock.plank = 10;
  const placed = g.placeBridgeRun(gapL, gsY, gapR, gsY);
  check('placeBridgeRun bridges the gap: 5 tiles placed', placed === 5);
  check('placeBridgeRun laid PLATFORM across the pit',
    g.world.get(gapL, gsY) === T.PLATFORM && g.world.get(gapR, gsY) === T.PLATFORM);
  check('placeBridgeRun charged a plank per tile', g.stock.plank === 5);
}

// --- Task 3: tool defs + sim placers ---
{
  const ramp = TOOL_DEFS.find((t) => t.id === 'ramp');
  const bridge = TOOL_DEFS.find((t) => t.id === 'platform');
  check('ramp tool defined, 1 plank', !!ramp && ramp.cost && ramp.cost.plank === 1);
  check('platform tool relabelled Bridge', !!bridge && bridge.label === 'Bridge');

  // placeRampRun charges a plank per placed tile and lays RAMP tiles.
  // Columns 12-29 of Level 1 are one flat run, so pick a safe column there.
  const g = new Game(LEVELS[0]);
  g.stock.plank = 10;
  const col = 20;
  const sfc = (() => { for (let y = 0; y < g.world.h; y++) if (g.world.isSolid(col, y)) return y - 1; return 0; })();
  const placed = g.placeRampRun(col, sfc, col + 3, sfc - 3);
  check('placeRampRun places >=2 tiles', placed >= 2);
  check('placeRampRun laid RAMP tiles', g.world.get(col, sfc) === T.RAMP);
  check('placeRampRun charged planks', g.stock.plank === 10 - placed);

  // demolish removes a ramp and refunds like a platform
  const before = g.stock.plank;
  check('demolish ramp ok', g.demolish(col, sfc) === true && g.world.get(col, sfc) === T.AIR);
  check('demolish ramp refunds a plank', g.stock.plank === before + 1);
}

// --- Task 3 (fix): placeRampRun stops when planks run out ---
{
  const g = new Game(LEVELS[0]);
  g.stock.plank = 2; // only enough for 2 of a 4-tile run
  const col = 20;
  const sfc = (() => { for (let y = 0; y < g.world.h; y++) if (g.world.isSolid(col, y)) return y - 1; return 0; })();
  const placed = g.placeRampRun(col, sfc, col + 3, sfc - 3);
  check('placeRampRun stops at unaffordable: places only 2', placed === 2);
  check('placeRampRun stops at unaffordable: spends exactly 2 planks', g.stock.plank === 0);
  check('placeRampRun stops at unaffordable: 3rd cell not placed', g.world.get(col + 2, sfc - 2) === T.AIR);
}

// --- Task 4: Level 4 offers Ramp; Level 2 does not ---
{
  const g4 = new Game(LEVELS[3]); // The Summit Beacon
  const g2 = new Game(LEVELS[1]); // The Cliff Shrine (lift-only)
  check('Level 4 allows ramp', g4.toolUnlocked('ramp') === true);
  check('Level 2 does NOT allow ramp', g2.toolUnlocked('ramp') === false);
  check('Level 4 has a ramp hint', (LEVELS[3].hints ?? []).some((h) => h.id === 'ramp'));
}

// --- Task 5: verifier treats RAMP as support (hand-placed ramps validate) ---
{
  const data = blankLevelData(64, 28);
  // decode the RLE tiles, drop a RAMP tile in a clearly-air surface cell far from
  // the town hall / goal footprints, then re-encode.
  const decoded = new Uint8Array(data.width * data.height);
  let i = 0;
  for (const part of data.tiles.split(',')) {
    const [t, n] = part.includes('x') ? part.split('x').map(Number) : [Number(part), 1];
    for (let k = 0; k < n && i < decoded.length; k++) decoded[i++] = t;
  }
  const standY = data.height - 8 - 1; // blankLevelData ground: 8 tiles, surface at height-8
  const airIdx = standY * data.width + 30; // (30, standY): air just above the surface
  decoded[airIdx] = T.RAMP;
  data.tiles = encodeTiles(decoded);
  const report = verifyLevel(data);
  const roundTrip = decodeTiles(data.tiles, data.width * data.height);
  check('ramp byte round-trips through encode/decode', roundTrip[airIdx] === T.RAMP);
  check('stray ramp adds no solvability problem', report.problems.length === 0);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
