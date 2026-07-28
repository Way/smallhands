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
  export { weatherLook, biomeSky, biomeHills, mixRgb, HILL_SKY_MIX } from './src/game/weather-look.ts';
`);
const {
  BIOMES, GENERATED_BIOMES, BIOME_LOOK, BIOME_TREE, treeSprite, generateVerifiedLevel,
  weatherLook, biomeSky, biomeHills, mixRgb, HILL_SKY_MIX,
} = mod;

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

console.log('\ntreeline — every biome declares its distant crest dressing');
// This was an allowlist in drawBackground (`biome === 'meadow' || 'autumn' ||
// 'slate'`), so vale silently opted OUT and got the bare ridge meant for the
// arid biomes. Now it is data, and TreeLine being a required field means a new
// biome cannot forget to choose. Pin the classic five to what they rendered.
check('meadow: blobs', BIOME_LOOK.meadow.treeline === 'blobs');
check('autumn: blobs', BIOME_LOOK.autumn.treeline === 'blobs');
check('slate: conifers', BIOME_LOOK.slate.treeline === 'conifers');
check('chalk: bare ridge (arid)', BIOME_LOOK.chalk.treeline === 'none');
check('redrock: bare ridge (arid)', BIOME_LOOK.redrock.treeline === 'none');
check('vale: blobs — the lushest biome must not get a bare ridge', BIOME_LOOK.vale.treeline === 'blobs');
check('every biome declares a valid treeline', BIOMES.every((b) => ['blobs', 'conifers', 'none'].includes(BIOME_LOOK[b].treeline)));
// Only the arid pair goes bare — a green biome getting 'none' is the bug.
check('no green biome has a bare ridge', BIOMES.filter((b) => BIOME_LOOK[b].treeline === 'none').sort().join(',') === 'chalk,redrock');

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

// ---- distant atmosphere (card #76) ------------------------------------------
//
// Nothing used to pin the parallax hills, and the numbers made a fool of the
// eye: `redrock` mixed a terracotta tint 40% into a base so green that the
// result was still green, so its horizon read meadow while its ground read
// desert. Assert on the real functions the renderer calls — a copy of the mix
// here would drift from drawSky and go on passing while the screen was wrong.
console.log('\ndistant atmosphere — a biome tints the weather look, and the tint has to win');

const WEATHERS = ['clear', 'rain', 'storm'];
// The three layers drawDistantTerrain paints, in the order the renderer builds
// them: the horizon range drowned in sky, the midground ridge barely, the near
// scrub line not at all.
const layers = (biome, kind) => {
  const look = weatherLook(kind);
  const bl = BIOME_LOOK[biome];
  const hills = biomeHills(look, bl);
  const skyMid = biomeSky(look, bl)[1];
  return {
    horizon: mixRgb(hills[0], skyMid, HILL_SKY_MIX.horizon),
    mid: mixRgb(hills[0], skyMid, HILL_SKY_MIX.mid),
    near: hills[1],
  };
};

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const hue = (c) => {
  const [r, g, b] = c.map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.004) return null; // grey has no hue to be wrong about
  const h = 60 * (mx === r ? (((g - b) / d) + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return h;
};
// The band a sage/meadow green falls in. Wide enough to catch the bug (redrock's
// horizon sat at 153°, its midground at 76-153°) and to leave the genuinely
// green biomes inside it.
const GREEN = [100, 200];
const isGreen = (c) => { const h = hue(c); return h !== null && h >= GREEN[0] && h <= GREEN[1]; };

// WHICH biomes must obey it is derived, not listed — a list is what let this
// bug exist. The condition is the one that actually made redrock wrong: its
// country has no green in it at all. Both halves have to hold:
//
//   - the bedrock is RED — stone far warmer than it is cool (redrock's #b05a38
//     is 120 units of R over B; every other biome's rock is within ~22 of
//     neutral or outright cool), and
//   - the grass is DRY — blades outside the green band (redrock's olive #9aa04b
//     sits at 64°).
//
// That is what rules `chalk` out of this card without an exemption: chalk grows
// green grass over pale stone, so green downs behind its white cliffs agree with
// its foreground. `autumn` is out for the same reason from the other side — its
// rock is neutral grey-brown and real autumn country keeps green in the
// distance. Only redrock had a horizon from a different landscape.
//
// A future desert biome is covered the day it is added, which is the point.
const arid = (b) => {
  const st = hex(BIOME_LOOK[b].stone.r);
  return st[0] - st[2] >= 60 && !isGreen(hex(BIOME_LOOK[b].blades.g));
};
for (const b of BIOMES) {
  const st = hex(BIOME_LOOK[b].stone.r);
  if (!arid(b)) {
    // Reported, not asserted — the hue every other biome's far range comes out
    // at, so the next palette pass can see the whole set at once. `autumn`
    // sitting at ~154° here is a known, milder version of this card's complaint;
    // it was left alone deliberately rather than overlooked.
    const h = hue(layers(b, 'clear').horizon);
    console.log(`  --   ${b}: not arid (rock R-B=${st[0] - st[2]}, grass ${Math.round(hue(hex(BIOME_LOOK[b].blades.g)))}°) — clear horizon ${h === null ? 'grey' : Math.round(h) + '°'}`);
    continue;
  }
  for (const kind of WEATHERS) {
    const L = layers(b, kind);
    for (const name of ['horizon', 'mid', 'near']) {
      const h = hue(L[name]);
      check(
        `${b} (arid: rock R-B=${st[0] - st[2]}, dry grass) under ${kind}: ${name} is not green (${h === null ? 'grey' : Math.round(h) + '°'})`,
        !isGreen(L[name])
      );
    }
  }
}
check('the arid rule selects at least one biome (a rule that matches nothing guards nothing)', BIOMES.some(arid));

// The other half of the trade-off, and the reason redrock's amount is 0.85 and
// not 1: the near scrub line gets no sky mix, so the biome tint is the ONLY
// thing colouring it. Push the tint to full and every weather look mixes to the
// same colour there — the storm stops darkening the one layer closest to the
// player. Guard the darkening itself, on every biome, so a future "make it
// redder" pass cannot quietly flatten the weather.
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
for (const b of BIOMES) {
  for (const name of ['horizon', 'mid', 'near']) {
    const d = lum(layers(b, 'clear')[name]) - lum(layers(b, 'storm')[name]);
    check(`${b}: storm still darkens the ${name} layer (dL=${d.toFixed(1)})`, d >= 8);
  }
}

// A tint that does nothing must say so. `chalk` used to claim hillTintAmt 0.25
// toward [150,190,170] — a colour within three units of the weather look's own
// hills, so it moved the picture by less than one unit per channel while
// reading, in the data, like a knob someone had tuned. Anything that survives
// this check is either off or actually doing something.
for (const b of BIOMES) {
  const bl = BIOME_LOOK[b];
  if (bl.hillTintAmt === 0) { console.log(`  --   ${b}: no hill tint (weather look untouched)`); continue; }
  const moved = Math.max(...WEATHERS.flatMap((kind) => {
    const look = weatherLook(kind);
    return biomeHills(look, bl).flatMap((c, i) => c.map((v, j) => Math.abs(v - look.hills[i][j])));
  }));
  check(`${b}: its hill tint actually moves the hills (max ${moved.toFixed(1)} per channel)`, moved >= 8);
}

// The five biomes card #76 did not touch, pinned exactly, under every weather
// look — the same zero-regression argument the light model above makes: a
// palette pass aimed at redrock must not move anybody else. `chalk` belongs in
// here rather than in the fix: it was examined (see the note on its tint in
// biomes.ts) and left exactly as it rendered.
// Both hill layers, in WEATHERS order. Every biome except redrock is listed and
// every entry is compared — no "pin what is listed" escape hatch, or the table
// stops guarding the moment someone deletes a row from it.
const UNTOUCHED = {
  meadow: [[[143, 199, 168], [111, 174, 140]], [[122, 163, 146], [92, 138, 116]], [[95, 125, 112], [72, 100, 90]]],
  autumn: [[[154.55, 177.65, 134.4], [133.75, 161.4, 116.2]], [[140.9, 154.25, 120.1], [121.4, 138, 100.6]], [[123.35, 129.55, 98], [108.4, 113.3, 83.7]]],
  chalk: [[[144.75, 196.75, 168.5], [120.75, 178, 147.5]], [[129, 169.75, 152], [106.5, 151, 129.5]], [[108.75, 141.25, 126.5], [91.5, 122.5, 110]]],
  slate: [[[133.1, 181.3, 162.6], [110.7, 163.8, 143]], [[118.4, 156.1, 147.2], [97.4, 138.6, 126.2]], [[99.5, 129.5, 123.4], [83.4, 112, 108]]],
  vale: [[[145.1, 200.8, 159.6], [122.7, 183.3, 140]], [[130.4, 175.6, 144.2], [109.4, 158.1, 123.2]], [[111.5, 149, 120.4], [95.4, 131.5, 105]]],
};
const close = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 0.01);
check('the pin table covers every biome except the one this card changed',
  eq(Object.keys(UNTOUCHED).sort(), BIOMES.filter((b) => b !== 'redrock').sort()));
for (const [b, want] of Object.entries(UNTOUCHED)) {
  const ok = want.length === WEATHERS.length && WEATHERS.every((kind, i) => {
    const got = biomeHills(weatherLook(kind), BIOME_LOOK[b]);
    return close(got[0], want[i][0]) && close(got[1], want[i][1]);
  });
  check(`${b}'s hills are unchanged under every weather look`, ok);
}

console.log('\nvale wiring');
check('vale has its own tree silhouette', treeSprite('vale') === 'tree_vale');
check('vale tree is not the classic broadleaf', BIOME_TREE.vale && treeSprite('vale') !== treeSprite('meadow'));
check('classic tree mapping untouched', treeSprite('meadow') === 'tree' && treeSprite('slate') === 'tree_pine' && treeSprite('chalk') === 'tree_palm');
check('vale spends the light model (warm sun over cool ambient)',
  BIOME_LOOK.vale.sun[0] > BIOME_LOOK.vale.sun[2] && BIOME_LOOK.vale.ambient[2] > BIOME_LOOK.vale.ambient[0]);

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
