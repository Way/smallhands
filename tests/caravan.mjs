// Headless checks for the goal caravan's look (card #71): the crate load that
// tells the order sheet, and the departure roll that must never contradict the
// sim's dock window. Bundles the TS sources with rolldown (see bundle.mjs), so
// it runs with plain `node` and no browser.
//
// The sprite itself needs a canvas and cannot be asserted here; what CAN rot
// silently is the arithmetic behind it, and the copy that names the thing.
import { bundleExports } from './bundle.mjs';
import { D } from '../src/engine/i18n.ts';

const { Game, LEVELS, caravanRoll, crateLoad, CARAVAN_CRATES, CARAVAN_TRIP, CARAVAN_ROLL_TIME, CRATE_SPOTS, CRATE_PX } =
  await bundleExports(`
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
  export { caravanRoll, crateLoad, CARAVAN_CRATES, CARAVAN_TRIP, CARAVAN_ROLL_TIME, CRATE_SPOTS, CRATE_PX } from './src/game/caravan-look.ts';
`);

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}`); failures++; }
}

// ---- the crate load is the order sheet -------------------------------------
{
  check('an untouched order shows no crates', crateLoad(0, 6) === 0);
  // The first delivery HAS to move the pile. Rounding alone hides deliveries 1
  // and 2 of a 20-unit order, and a load that does not budge reads as a bug in
  // the hauling, not as a rounding choice.
  check('the first delivery of a big order loads a crate', crateLoad(1, 40) === 1);
  check('a full order loads every crate', crateLoad(6, 6) === CARAVAN_CRATES);
  check('an overfilled order still loads exactly the full stack', crateLoad(9, 6) === CARAVAN_CRATES);
  // ...and the mirror of that: a full stack must MEAN full, or the player reads
  // "loaded" off a wagon the caravan will not leave with.
  let everFullEarly = false;
  let prev = 0;
  let monotone = true;
  for (let d = 0; d <= 40; d++) {
    const n = crateLoad(d, 40);
    if (d < 40 && n === CARAVAN_CRATES) everFullEarly = true;
    if (n < prev) monotone = false;
    prev = n;
  }
  check('the stack is never full before the order is', !everFullEarly);
  check('the stack never shrinks as deliveries land', monotone);
  check('an empty order sheet cannot divide by zero', crateLoad(0, 0) === 0 && crateLoad(3, 0) === 0);

  // The pile must stack UPWARDS in order, or a growing load looks like it is
  // being rearranged; and every crate has to sit inside the wagon's open rear
  // (screen x 10..23, y 4..24 of the footprint) or it floats outside the canvas.
  check('the cap is the layout, so the two cannot disagree', CARAVAN_CRATES === CRATE_SPOTS.length);
  let stacksUp = true;
  let inside = true;
  for (let i = 0; i < CRATE_SPOTS.length; i++) {
    const [x, y] = CRATE_SPOTS[i];
    if (i > 0 && y > CRATE_SPOTS[i - 1][1]) stacksUp = false;
    if (x < 10 || y < 4 || x + CRATE_PX > 24 || y + CRATE_PX > 25) inside = false;
  }
  check('the load stacks bottom-first', stacksUp);
  check('every crate sits inside the wagon\'s open rear', inside);
}

// ---- the roll agrees with the dock window ----------------------------------
{
  // No schedule: the wagon simply stands there, for every level that has none.
  const parked = caravanRoll(undefined, true, Infinity);
  check('without a convoy schedule the wagon is parked and solid', parked.shift === 0 && parked.alpha === 1 && !parked.rolling);

  const win = { open: 30, closed: 25 };
  const arriving = caravanRoll(win, true, win.open - 0.1); // 0.1s into the open window
  const settled = caravanRoll(win, true, 5); // late in the open window
  const leaving = caravanRoll(win, false, win.closed - 0.1); // 0.1s after it closed
  const gone = caravanRoll(win, false, 1); // late in the closed window

  check('the wagon rolls IN when the window opens', arriving.shift > CARAVAN_TRIP * 0.8 && arriving.rolling);
  check('the wagon is parked once the arrival roll is done', settled.shift === 0 && settled.alpha === 1 && !settled.rolling);
  check('the wagon rolls OUT when the window closes', leaving.shift > 0 && leaving.shift < CARAVAN_TRIP * 0.2 && leaving.rolling);
  check('the wagon is out of sight late in the closed window', gone.shift === CARAVAN_TRIP && gone.alpha === 0 && !gone.rolling);

  // A window shorter than the roll must not teleport the wagon: the slide is
  // clamped into the window it belongs to and still ends parked.
  const tiny = { open: 1, closed: 1 };
  const mid = caravanRoll(tiny, true, 0.5);
  const end = caravanRoll(tiny, true, 0);
  check('a window shorter than the roll still completes its arrival', mid.shift > 0 && end.shift === 0);

  // The honesty property, checked against the sim rather than by hand: the sim
  // only dispatches to the goal while `convoyOpen`, so a wagon standing ON the
  // dock (shift 0, fully solid) must mean the window is open — otherwise the
  // picture shows a wagon quietly refusing cargo. And a wagon that is GONE must
  // mean it is closed.
  const def = LEVELS.find((l) => l.convoy);
  check('found a campaign level with a convoy window', !!def);
  const g = new Game(def);
  let parkedWhileClosed = 0;
  let goneWhileOpen = 0;
  let sawBoth = { parked: false, gone: false };
  const dt = 1 / 30;
  // three full cycles, so both edges are crossed more than once
  const ticks = Math.ceil((3 * (def.convoy.open + def.convoy.closed)) / dt);
  for (let i = 0; i < ticks; i++) {
    g.tick(dt);
    const r = caravanRoll(g.level.convoy, g.convoyOpen, g.convoyRemaining);
    if (r.shift === 0 && r.alpha === 1) {
      sawBoth.parked = true;
      if (!g.convoyOpen) parkedWhileClosed++;
    }
    if (r.alpha === 0) {
      sawBoth.gone = true;
      if (g.convoyOpen) goneWhileOpen++;
    }
  }
  check('the run covered both a parked and a departed wagon', sawBoth.parked && sawBoth.gone);
  check('the wagon never stands on the dock while the window is shut', parkedWhileClosed === 0);
  check('the wagon is never out of sight while the window is open', goneWhileOpen === 0);
  // Across every shipped window, not just this one: the roll is clamped so a
  // short window still works, but a level whose window is barely longer than the
  // animation would show a wagon that only ever slides.
  const shortest = Math.min(...LEVELS.filter((l) => l.convoy).flatMap((l) => [l.convoy.open, l.convoy.closed]));
  check(`the roll fits every shipped window (shortest ${shortest}s)`, CARAVAN_ROLL_TIME < shortest / 3);
}

// ---- copy: the goal is named after what it is ------------------------------
{
  // Straight from the table — no bundling needed (see tests/terminology.mjs).
  const [en, de] = D['building.goal'];
  check('the goal is called a caravan in EN', /caravan/i.test(en));
  check('the goal is called a Karawane in DE', /karawane/i.test(de));
  const desc = D['goal.desc'];
  check('goal.desc exists in both languages', Array.isArray(desc) && desc.length === 2 && desc.every((s) => s.length > 20));
}

console.log(failures ? `\n  ${failures} failure(s)` : '\n  all caravan checks passed');
process.exit(failures ? 1 : 0);
