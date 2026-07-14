// Headless checks for the drag-stack build feature (Ladder/Ramp/Bridge runs +
// runPlan affordability). Bundles the TS sim with rolldown (see bundle.mjs)
// and imports it from a data URL, so it runs with plain `node`.
import { bundleExports } from './bundle.mjs';

const mod = await bundleExports(`
  export { World, ladderRunCells, rampRunCells, bridgeRunCells } from './src/game/world.ts';
  export { T } from './src/game/types.ts';
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
`);
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

// --- Task 2: runPlan affordability + placement ---
{
  // ladder run of 6 up the wall; wood pooled (log first, then plank)
  const g = new Game(LEVELS[0]);
  g.world = wallWorld();
  g.stock.log = 2; g.stock.plank = 1;
  const lp = g.runPlan('ladder', 5, 9, 5, 4);
  check('ladder plan: 6 cells', lp.cells.length === 6);
  check('ladder plan: affordable = log+plank', lp.affordable === 3);
  check('ladder plan: cost is log-then-plank mix', lp.cost.log === 2 && lp.cost.plank === 1);
  check('ladder plan: row pools wood under log icon',
    lp.rows.length === 1 && lp.rows[0].item === 'log' &&
    lp.rows[0].have === 3 && lp.rows[0].need === 6 && lp.rows[0].short === true);

  // plenty of planks, no logs => all 6 from planks
  const g2 = new Game(LEVELS[0]);
  g2.world = wallWorld();
  g2.stock.log = 0; g2.stock.plank = 10;
  const lp2 = g2.runPlan('ladder', 5, 9, 5, 4);
  check('ladder plan: planks cover the run', lp2.affordable === 6 && lp2.cost.plank === 6 && lp2.cost.log === undefined);
  check('ladder plan: affordable run not short', lp2.rows[0].short === false);

  // placement lays only the affordable prefix and charges the mix
  const g3 = new Game(LEVELS[0]);
  g3.world = wallWorld();
  g3.stock.log = 2; g3.stock.plank = 1;
  const placed = g3.placeLadderRun(5, 9, 5, 4);
  check('placeLadderRun places affordable count', placed === 3);
  check('placeLadderRun spends all wood', g3.stock.log === 0 && g3.stock.plank === 0);
  check('placeLadderRun fills the affordable prefix',
    g3.world.get(5, 9) === T.LADDER && g3.world.get(5, 8) === T.LADDER &&
    g3.world.get(5, 7) === T.LADDER && g3.world.get(5, 6) === T.AIR);

  // bridge run: 1 plank per tile, clamps to stock
  const g4 = new Game(LEVELS[0]);
  g4.world = wallWorld();
  g4.stock.plank = 3;
  const bp = g4.runPlan('platform', 5, 4, 2, 4); // anchor touches the wall, run left
  check('bridge plan: 4 cells', bp.cells.length === 4);
  check('bridge plan: affordable clamps to planks', bp.affordable === 3 && bp.cost.plank === 3);
  check('bridge plan: row shows plank need vs have',
    bp.rows[0].item === 'plank' && bp.rows[0].have === 3 && bp.rows[0].need === 4 && bp.rows[0].short === true);
  const placedB = g4.placeBridgeRun(5, 4, 2, 4);
  check('placeBridgeRun places affordable count', placedB === 3 && g4.stock.plank === 0);
  check('placeBridgeRun fills the affordable prefix',
    g4.world.get(5, 4) === T.PLATFORM && g4.world.get(4, 4) === T.PLATFORM &&
    g4.world.get(3, 4) === T.PLATFORM && g4.world.get(2, 4) === T.AIR);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
