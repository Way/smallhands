// Headless checks for the world-map layout data: every campaign in LEVELS has
// a territory with slot headroom, and the pure helpers behave. Bundles the TS
// sources with rolldown (same trick as tests/unit.mjs — if these build options
// diverge from that file's, copy its options verbatim).
import { bundleExports } from './bundle.mjs';

const mod = await bundleExports(`
  export { MAP_LAYOUT, VIEW_W, VIEW_H, nodePositions, journeyPoints } from './src/game/maplayout';
  export { LEVELS } from './src/game/levels';
`);
const { MAP_LAYOUT, VIEW_W, VIEW_H, nodePositions, journeyPoints, LEVELS } = mod;

let failures = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
};

// one territory per campaign present in LEVELS, with slot headroom
const counts = new Map();
for (const l of LEVELS) {
  const c = l.campaign ?? 1;
  counts.set(c, (counts.get(c) ?? 0) + 1);
}
for (const [c, n] of counts) {
  const terr = MAP_LAYOUT.find((t) => t.campaign === c);
  check(`campaign ${c} has a territory`, !!terr);
  check(`campaign ${c}: slots (${terr?.nodes.length}) >= levels (${n})`, (terr?.nodes.length ?? 0) >= n);
}

// every authored point stays inside the viewBox
const inBox = (p) => p.x >= 0 && p.x <= VIEW_W && p.y >= 0 && p.y <= VIEW_H;
check('all node slots inside viewBox', MAP_LAYOUT.every((t) => t.nodes.every(inBox)));

// slot lookup returns the authored points…
const four = nodePositions(1, 4);
check(
  'nodePositions(1, 4) returns the 4 authored slots',
  four.length === 4 && four[3].x === MAP_LAYOUT[0].nodes[3].x && four[3].y === MAP_LAYOUT[0].nodes[3].y
);

// …and extends past the end instead of crashing (with a console.warn)
let warned = false;
const origWarn = console.warn;
console.warn = () => { warned = true; };
const many = nodePositions(1, MAP_LAYOUT[0].nodes.length + 2);
console.warn = origWarn;
check('overflow extends along the last segment', many.length === MAP_LAYOUT[0].nodes.length + 2);
check('overflow warns', warned);

// the journey line threads every level once, in campaign order
const journey = journeyPoints(counts);
check('journey visits every level once', journey.length === LEVELS.length);

process.exit(failures ? 1 : 0);
