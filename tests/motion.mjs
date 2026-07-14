// Headless checks for the look-physics layer (src/game/motion.ts) — no
// browser needed. Two angles:
//   1. the primitives (verlet rope, flights, squash) behave and stay bounded;
//   2. the firewall holds: the sim emits lookEvents breadcrumbs, the layer
//      drains them, reduced motion keeps the layer empty, and headless runs
//      (nobody draining) stay capped.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const res = await build({
  stdin: {
    contents: `
      export { MotionLayer, VerletRope, FELL_DUR } from './src/game/motion.ts';
      export { Game } from './src/game/sim.ts';
      export { LEVELS } from './src/game/levels.ts';
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
const { MotionLayer, VerletRope, FELL_DUR, Game, LEVELS } = mod;

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}`);
    failures++;
  }
}

// ---- verlet rope ------------------------------------------------------------

console.log('verlet rope');
{
  const rope = new VerletRope(100, 50, 100, 130, 6); // straight vertical, 5 segments of 16px
  const wind = () => 500; // constant push to the right
  for (let i = 0; i < 240; i++) rope.tick(1 / 60, wind);
  check('pinned head never moves', rope.x[0] === 100 && rope.y[0] === 50);
  check(
    'wind bows the rope off the straight line',
    Math.max(...[...rope.x].map((x) => Math.abs(x - 100))) > 2
  );
  let len = 0;
  for (let i = 1; i < rope.n; i++) len += Math.hypot(rope.x[i] - rope.x[i - 1], rope.y[i] - rope.y[i - 1]);
  check('constraints keep total length ~constant under wind', Math.abs(len - 80) < 8);

  const calm = new VerletRope(100, 50, 100, 130, 6);
  calm.grab(120, 90); // a hand pulls the middle sideways
  calm.tick(1 / 60, () => 0);
  const grabbed = [...calm.x].some((x) => x === 120);
  check('a grabbed point sits at the hand', grabbed);
  calm.release();
  for (let i = 0; i < 600; i++) calm.tick(1 / 60, () => 0);
  check(
    'released rope settles back toward hanging straight',
    Math.max(...[...calm.x].map((x) => Math.abs(x - 100))) < 2
  );
}

// ---- flights ------------------------------------------------------------------

console.log('flight arcs');
{
  const m = new MotionLayer();
  const game = { lookEvents: [], buildings: [], workers: [], groundItems: [{ id: 7 }] };
  m.update(game, 0.9, { amp: 1, hz: 1 }, false); // attach (first update discards pre-attach events)
  game.lookEvents.push({ kind: 'item-flight', id: 7, item: 'log', fromX: 3, fromY: 2, toX: 5, toY: 6, delay: 0 });
  m.update(game, 1.0, { amp: 1, hz: 1 }, false);
  check('update drains the outbox', game.lookEvents.length === 0);
  const at0 = m.flightFor(7);
  check('flight starts at the source', at0 && Math.abs(at0.x - 3) < 1e-6 && Math.abs(at0.y - 2) < 1e-6);
  m.update(game, 1.2, { amp: 1, hz: 1 }, false);
  const mid = m.flightFor(7);
  const chordY = 2 + (6 - 2) * ((mid.x - 3) / 2); // straight-line y at the same progress
  check('mid-flight the item arcs above the chord', mid && mid.y < chordY);
  m.update(game, 9.0, { amp: 1, hz: 1 }, false);
  check('finished flight lands (static draw takes over)', m.flightFor(7) === null);
  check('landing kicked up dust', m.puffs.length > 0);

  const m2 = new MotionLayer();
  const g2 = { lookEvents: [], buildings: [], workers: [], groundItems: [{ id: 1 }] };
  m2.update(g2, -0.1, { amp: 1, hz: 1 }, false);
  g2.lookEvents.push({ kind: 'item-flight', id: 1, item: 'log', fromX: 0, fromY: 0, toX: 4, toY: 0, delay: 0.5 });
  m2.update(g2, 0, { amp: 1, hz: 1 }, false);
  check('delay-gated flight is hidden first', m2.flightFor(1) === 'hidden');
  m2.update(g2, 0.6, { amp: 1, hz: 1 }, false);
  const later = m2.flightFor(1);
  check('…then flies', later !== 'hidden' && later !== null);

  const m3 = new MotionLayer();
  const g3 = { lookEvents: [], buildings: [], workers: [], groundItems: [{ id: 2 }] };
  m3.update(g3, -0.1, { amp: 1, hz: 1 }, false);
  g3.lookEvents.push({ kind: 'item-flight', id: 2, item: 'log', fromX: 0, fromY: 0, toX: 4, toY: 0, delay: 0 });
  m3.update(g3, 0, { amp: 1, hz: 1 }, false);
  g3.groundItems.length = 0; // picked up mid-arc
  m3.update(g3, 0.05, { amp: 1, hz: 1 }, false);
  check('flight of a vanished item is dropped', m3.flightFor(2) === null);
}

// ---- fellings, squash, reduced motion ----------------------------------------

console.log('fellings, squash, reduced motion');
{
  const m = new MotionLayer();
  const game = { lookEvents: [], buildings: [], workers: [], groundItems: [] };
  m.update(game, -0.1, { amp: 1, hz: 1 }, false); // attach
  game.lookEvents.push({ kind: 'tree-felled', id: 42, x: 10, y: 5, dir: 1 });
  game.lookEvents.push({ kind: 'worker-land', id: 9, x: 4, y: 8, dist: 4 });
  m.update(game, 0, { amp: 1, hz: 1 }, false);
  check('fresh felling starts near upright', Math.abs(m.fellingFor(42) ?? 99) < 0.05);
  const sq0 = m.squashFor(9);
  check('landing squashes the worker', sq0 > 0.15);
  m.update(game, FELL_DUR / 2, { amp: 1, hz: 1 }, false);
  const midAngle = m.fellingFor(42);
  check('the trunk is mid-topple at half time', midAngle > 0.1 && midAngle < Math.PI / 2);
  m.update(game, FELL_DUR + 0.05, { amp: 1, hz: 1 }, false);
  check('felling ends after FELL_DUR (crash dust)', m.fellingFor(42) === null && m.puffs.length > 0);
  for (let t = FELL_DUR + 0.05; t < FELL_DUR + 2; t += 1 / 60) m.update(game, t, { amp: 1, hz: 1 }, false);
  check('squash decays back to rest', m.squashFor(9) === 0);

  const mr = new MotionLayer();
  const gr = { lookEvents: [], buildings: [], workers: [], groundItems: [] };
  mr.update(gr, -0.1, { amp: 1, hz: 1 }, true); // attach
  gr.lookEvents.push({ kind: 'item-sink', item: 'log', x: 2, y: 3 });
  mr.update(gr, 0, { amp: 1, hz: 1 }, true); // reduced motion
  check('reduced motion drains events but keeps the layer empty', gr.lookEvents.length === 0 && mr.ripples.length === 0);
}

// ---- the sim side: breadcrumbs + the headless cap ------------------------------

console.log('sim lookEvents');
{
  const game = new Game(LEVELS[0]);
  for (const n of game.nodes) n.marked = true;
  game.desiredRoles = { hauler: 1, builder: 0, woodcutter: 3, miner: 2 };
  for (let i = 0; i < 60 * 60; i++) game.tick(1 / 60); // one simulated minute, nobody draining
  const kinds = new Set(game.lookEvents.map((e) => e.kind));
  check('harvesting emits item-flight breadcrumbs', kinds.has('item-flight'));
  check('an exhausted tree emits tree-felled', kinds.has('tree-felled'));
  check('headless runs stay capped', game.lookEvents.length <= 200);
  const flights = game.lookEvents.filter((e) => e.kind === 'item-flight');
  check(
    'flights land on real ground-item cells (integers)',
    flights.every((e) => Number.isInteger(e.toX) && Number.isInteger(e.toY))
  );

  // rising flood: sinking goods leave a ripple breadcrumb (flood level = C2-L3)
  const floodLevel = LEVELS.find((l) => l.flood);
  if (floodLevel) {
    const fg = new Game(floodLevel);
    fg.lookEvents.length = 0;
    // drop items into the doomed lowlands, then raise the water over them
    const row = fg.level.flood.start;
    for (let x = 0; x < fg.world.w && fg.groundItems.length < 3; x++) {
      for (let y = row; y < fg.world.h; y++) {
        if (fg.world.isStandable(x, y)) {
          fg.groundItems.push({ id: fg.id(), item: 'log', x, y, reserved: false, bounce: 0 });
          break;
        }
      }
    }
    const had = fg.groundItems.length;
    while (fg.waterRow === null || fg.waterRow > fg.level.flood.min) {
      const before = fg.waterRow;
      fg.riseWater();
      if (fg.waterRow === before) break;
    }
    const sinks = fg.lookEvents.filter((e) => e.kind === 'item-sink').length;
    check('flooded goods emit item-sink breadcrumbs', had > 0 && sinks > 0);
  } else {
    check('flood level present for item-sink check', false);
  }
}

console.log(failures ? `\n${failures} FAILURES` : '\nall ok');
process.exit(failures ? 1 : 0);
