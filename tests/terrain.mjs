// Headless property tests for procedurally generated terrain. The micro-relief
// pass must never break the movement contract, so these assertions pin it down
// across a seed × difficulty matrix:
//   1. determinism — the same seed builds the same level, byte for byte
//   2. every roll passes the static solvability verifier
//   3. the step invariant — adjacent surface columns differ by 0, 1 (walkable
//      by everyone, cargo included) or >= 3 (a deliberate cliff, liftable);
//      NEVER exactly 2, the awkward middle that blocks cargo but is too short
//      for a lift or rope
//   4. town hall and caravan sit on dead-flat reserved pads
//   5. every cliff keeps a clean face a cargo lift can actually be built on
//   6. the relief pass does something — hills exist somewhere in the matrix
//
// Bundles the TypeScript sources (see bundle.mjs) and runs with plain `node`.
import { bundleExports } from './bundle.mjs';

const mod = await bundleExports(`
  export { generateLevel, generateVerifiedLevel } from './src/game/generator.ts';
  export { worldFromData, verifyLevel, blankLevelData, encodeTiles, decodeTiles } from './src/game/leveldata.ts';
  export { liftTopFor } from './src/game/world.ts';
  export { BIOMES } from './src/engine/biomes.ts';
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
`);
const { generateLevel, generateVerifiedLevel, worldFromData, verifyLevel, liftTopFor, BIOMES, blankLevelData, encodeTiles, decodeTiles, Game, LEVELS } = mod;

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}`);
    failures++;
  }
}

// topmost solid row per column
function surfaceRows(world) {
  const surf = [];
  for (let x = 0; x < world.w; x++) {
    let sy = world.h;
    for (let y = 0; y < world.h; y++) {
      if (world.isSolid(x, y)) {
        sy = y;
        break;
      }
    }
    surf.push(sy);
  }
  return surf;
}

const seeds = ['oak-brook-101', 'fern-gale-202', 'moss-clay-303', 'flint-dew-404', 'ember-wren-505', 'ridge-pine-606'];
const difficulties = [1, 2, 3, 4, 5];

let reliefSteps = 0; // |diff| === 1 counts across the whole matrix
let cliffCount = 0;
let motifLevels = 0; // levels whose description names a shape motif

for (const seed of seeds) {
  for (const d of difficulties) {
    const label = `${seed} d${d}`;

    // 1. determinism
    const a = generateLevel({ seed, difficulty: d });
    const b = generateLevel({ seed, difficulty: d });
    check(`${label}: deterministic (tiles + biome)`, a.tiles === b.tiles && a.biome === b.biome);
    check(`${label}: biome is a known biome`, BIOMES.includes(a.biome));

    // 2. the verified roll passes the verifier with no problems
    const data = generateVerifiedLevel({ seed, difficulty: d });
    const report = verifyLevel(data);
    check(`${label}: verifies (${report.problems.join('; ') || 'clean'})`, report.ok);
    if (/mesa|canyon|ridge|terraced/.test(data.desc)) motifLevels++;

    const world = worldFromData(data);
    const surf = surfaceRows(world);

    // 3. the step invariant: 0/1 walkable, >= 3 deliberate, never exactly 2
    let badStep = -1;
    for (let x = 0; x + 1 < world.w; x++) {
      const diff = Math.abs(surf[x] - surf[x + 1]);
      if (diff === 1) reliefSteps++;
      if (diff === 2) {
        badStep = x;
        break;
      }
    }
    check(`${label}: no 2-tile surface steps${badStep >= 0 ? ` (at x=${badStep})` : ''}`, badStep < 0);

    // 4. flat pads under the town hall and the caravan
    const flatUnder = (bx, w) => {
      for (let x = bx; x < bx + w - 1; x++) if (surf[x] !== surf[x + 1]) return false;
      return true;
    };
    check(`${label}: town hall pad is flat`, flatUnder(data.townhall.x, 4));
    check(`${label}: caravan pad is flat`, flatUnder(data.goal.x, 4));

    // 5. every cliff (>= 3 rise) keeps a face a cargo lift can be built on
    let liftless = -1;
    for (let x = 0; x + 1 < world.w; x++) {
      const dl = surf[x] - surf[x + 1]; // > 0 when the right column is higher
      if (Math.abs(dl) < 3) continue;
      cliffCount++;
      const lowX = dl > 0 ? x : x + 1;
      const standY = surf[lowX] - 1;
      if (liftTopFor(world, lowX, standY) === null) {
        liftless = lowX;
        break;
      }
    }
    check(`${label}: every cliff face takes a lift${liftless >= 0 ? ` (fails at x=${liftless})` : ''}`, liftless < 0);
  }
}

// 6. the relief pass exists: rolling ground somewhere in the matrix
check(`relief produces 1-tile banks across the matrix (${reliefSteps} found)`, reliefSteps > 20);
check(`the matrix still produces cliffs (${cliffCount} found)`, cliffCount > 10);
// 7. the motif grammar exists: mesas/canyons/ridges/terraces show up and
// (via checks 3+5 above) obey the same invariants as plain cliffs
check(`shape motifs appear across the matrix (${motifLevels} levels)`, motifLevels > 5);

// 8. water containment: no pool may float in mid-air or sit on a treetop.
// Every water cell needs support below and banks (or more water) beside.
const T_AIR = 0;
const T_WATER = 8;
function floatingWater(w) {
  let bad = 0;
  const open = (nx, ny) => nx >= 0 && nx < w.w && ny >= 0 && ny < w.h && w.get(nx, ny) === T_AIR;
  for (let y = 0; y < w.h; y++) {
    for (let x = 0; x < w.w; x++) {
      if (w.get(x, y) !== T_WATER) continue;
      if (open(x, y + 1) || open(x - 1, y) || open(x + 1, y)) bad++;
    }
  }
  return bad;
}

// every hand-authored campaign water body is a consistent table
for (const def of LEVELS) {
  const g = new Game(def);
  const bad = floatingWater(g.world);
  check(`campaign "${def.name}": water is contained (${bad} floating)`, bad === 0);
}

// generated levels carry no water at all — the scenic waterfall never invents one
{
  const data = generateVerifiedLevel({ seed: 'no-water-ever', difficulty: 4 });
  const world = worldFromData(data);
  let waters = 0;
  for (let i = 0; i < world.tiles.length; i++) if (world.tiles[i] === T_WATER) waters++;
  check('generated terrain contains no water tiles', waters === 0);
}

// the rising tide stays a consistent table, rise after rise
{
  const def = LEVELS.find((l) => l.flood);
  check('a flood level exists to test', !!def);
  const g = new Game(def);
  let ok = true;
  for (let i = 0; i < 4; i++) {
    g.riseWater();
    if (floatingWater(g.world) > 0) ok = false;
  }
  check('flood water stays contained through 4 rises', ok);
}

// the verifier warns about a floating pool in an imported code…
{
  const data = blankLevelData(48, 24);
  const tiles = decodeTiles(data.tiles, 48 * 24);
  tiles[6 * 48 + 30] = T_WATER; // a lone water cube hovering mid-air
  data.tiles = encodeTiles(tiles);
  const rep = verifyLevel(data);
  check('verifier warns about floating water', rep.warnings.some((m) => /water|Wasser/i.test(m)));
}
// …and stays quiet for a properly dug-in pool
{
  const data = blankLevelData(48, 24);
  const tiles = decodeTiles(data.tiles, 48 * 24);
  for (const x of [34, 35, 36]) tiles[16 * 48 + x] = T_WATER; // surface row: dirt below, banks beside
  data.tiles = encodeTiles(tiles);
  const rep = verifyLevel(data);
  check('a dug-in pool raises no water warning', !rep.warnings.some((m) => /water|Wasser/i.test(m)));
}

console.log(failures === 0 ? `\nterrain: all checks passed` : `\nterrain: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
