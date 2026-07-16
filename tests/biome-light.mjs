// Deterministic guards for the per-biome light model and the `vale` biome.
//
// The interesting claim is a NEGATIVE one — that adding a sixth biome changed
// nothing about the other five — so these are invariants rather than snapshots.
// A rendered-frame hash can't prove it: treetop sway (`0.8 * wind` in drawNodes)
// is deliberately not gated on reduced motion, so no two frames are ever equal.
// These oracles are exact instead.
//
//   node tests/biome-light.mjs
import { bundleExports } from './bundle.mjs';

const mod = await bundleExports(`
  export { BIOMES, GENERATED_BIOMES, BIOME_LOOK, BIOME_TREE, treeSprite } from './src/engine/biomes.ts';
  export { generateVerifiedLevel } from './src/game/generator.ts';
`);
const { BIOMES, GENERATED_BIOMES, BIOME_LOOK, BIOME_TREE, treeSprite, generateVerifiedLevel } = mod;

let failures = 0;
const check = (name, cond) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failures++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The five biomes that existed before `vale`. Everything below is about proving
// this set is untouched.
const CLASSIC = ['meadow', 'autumn', 'chalk', 'redrock', 'slate'];

console.log('\nlight model — classic biomes keep the literal neutrals drawTerrain hardcoded');
for (const b of CLASSIC) {
  const l = BIOME_LOOK[b];
  check(`${b}: sun is white, ambient is black, deep is 8,10,18`,
    eq(l.sun, [255, 255, 255]) && eq(l.ambient, [0, 0, 0]) && eq(l.deep, [8, 10, 18]));
}
// This is the whole zero-regression argument: drawTerrain builds every overlay
// as rgba(<tint>, <same alpha as before>). With these tints the strings come
// back out as rgba(255,255,255,a) / rgba(0,0,0,a) / rgba(8,10,18,a) — exactly
// the literals the code used to hardcode. Same colour, same alpha, same rect.

console.log('\nsnowcaps — vale is a valley, not a highland');
// Only the slate highlands wear a snowline. vale sharing it would cap a biome
// whose whole identity is sunlit green with white, which is how it first looked.
check('slate still owns the only snowline', BIOME_LOOK.slate.snowcaps === true);
check('vale has no snowline', BIOME_LOOK.vale.snowcaps === false);

console.log('\ngenerator — adding a biome must not repaint existing seeds');
check('vale is registered as a biome', BIOMES.includes('vale'));
check('vale is NOT in the generator pool', !GENERATED_BIOMES.includes('vale'));
// `rng.pick` maps one seed value through the list length. The pool being byte-
// identical to the pre-change BIOMES list is what makes every seed's biome
// provably unchanged — including the shared daily-challenge seed.
check('generator pool is exactly the pre-change BIOMES list', eq([...GENERATED_BIOMES], CLASSIC));

// Belt and braces: actually generate across seeds and confirm none can land on
// vale, and that the pick stays inside the frozen pool.
const seeds = ['daily-1', 'daily-2', 'ala-reference', 'seed-42', 'zzz', 'a', 'hello-world', '2026-07-16'];
const picked = seeds.map((s) => generateVerifiedLevel({ seed: s, difficulty: 2 }).biome);
check(`no generated seed lands on vale (${[...new Set(picked)].join(',')})`, !picked.includes('vale'));
check('every generated biome is inside the frozen pool', picked.every((b) => GENERATED_BIOMES.includes(b)));

// Same seed twice = same biome; guards the pick against incidental rng drift.
const twice = generateVerifiedLevel({ seed: 'ala-reference', difficulty: 2 }).biome;
check('generation is seed-stable', twice === picked[2]);

console.log('\nvale wiring');
check('vale has its own tree silhouette', treeSprite('vale') === 'tree_vale');
check('vale tree is not the classic broadleaf', BIOME_TREE.vale && treeSprite('vale') !== treeSprite('meadow'));
check('classic tree mapping untouched', treeSprite('meadow') === 'tree' && treeSprite('slate') === 'tree_pine' && treeSprite('chalk') === 'tree_palm');
check('vale spends the light model (warm sun over cool ambient)',
  BIOME_LOOK.vale.sun[0] > BIOME_LOOK.vale.sun[2] && BIOME_LOOK.vale.ambient[2] > BIOME_LOOK.vale.ambient[0]);

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
