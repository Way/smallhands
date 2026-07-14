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
  export { worldFromData, verifyLevel } from './src/game/leveldata.ts';
  export { liftTopFor } from './src/game/world.ts';
  export { BIOMES } from './src/engine/biomes.ts';
`);
const { generateLevel, generateVerifiedLevel, worldFromData, verifyLevel, liftTopFor, BIOMES } = mod;

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

console.log(failures === 0 ? `\nterrain: all checks passed` : `\nterrain: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
