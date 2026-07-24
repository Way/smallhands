// Headless tests for the Campaign-4 digging loop: workshop craft, the Digger
// task, canDig rules, repath through opened terrain, and a full solve of the
// showcase level. Bundles the TS sources with rolldown (same trick as unit.mjs).
import { bundleExports } from './bundle.mjs';

const mod = await bundleExports(`
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
  export { canDig, digRunCells } from './src/game/world.ts';
  export { findPath } from './src/game/nav.ts';
  export { T, ROLES, RECIPES, DIG_TIME } from './src/game/types.ts';
`);
const { Game, LEVELS, canDig, findPath, T, ROLES, RECIPES, DIG_TIME } = mod;

let failures = 0;
function check(name, cond) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

// ---- helpers ----------------------------------------------------------------
// a flat solid surface tile clear of buildings, with a standable cell beside it
function digSite(g) {
  const W = g.world;
  for (let x = 4; x < W.w - 4; x++) {
    if (g.buildings.some((b) => x >= b.x - 2 && x <= b.x + 5)) continue;
    for (let y = 2; y < W.h - 3; y++) {
      if (W.isSolid(x, y) && W.get(x, y) !== T.BEDROCK && W.get(x, y - 1) === T.AIR) {
        for (const sx of [x - 1, x + 1]) {
          const sy = W.isStandable(sx, y) ? y : W.isStandable(sx, y - 1) ? y - 1 : null;
          if (sy !== null) return { x, y, sx, sy };
        }
      }
    }
  }
  return null;
}
function pinDigger(g, sx, sy) {
  const w = g.workers[0];
  w.role = 'digger';
  w.cx = sx; w.cy = sy; w.px = sx; w.py = sy;
  w.task = null; w.working = false; w.path = []; w.stepIdx = 0; w.carrying = null; w.hasShovel = false;
  for (let i = 1; i < g.workers.length; i++) g.workers[i].role = 'hauler';
  g.desiredRoles = { hauler: 0, builder: 0, woodcutter: 0, miner: 0, digger: 1 };
  return w;
}
const run = (g, secs, dt = 1 / 60) => { for (let i = 0; i < secs / dt; i++) g.tick(dt); };

// ---- the Workshop crafts a shovel from plank + iron -------------------------
{
  check('RECIPES.workshop is plank+iron -> shovel', !!RECIPES.workshop &&
    RECIPES.workshop.inputs.plank === 1 && RECIPES.workshop.inputs.iron === 1 &&
    RECIPES.workshop.outputs.shovel === 1);
  const g = new Game(LEVELS[0]);
  const b = g.addBuilding('workshop', 4, 15, true); // ready workshop
  b.inputs = { plank: 1, iron: 1 };
  run(g, 6);
  check('a ready workshop turns plank+iron into a shovel',
    (b.outputs.shovel ?? 0) + (g.stock.shovel ?? 0) >= 1);
}

// ---- a Digger WITHOUT a shovel cannot dig -----------------------------------
{
  const g = new Game(LEVELS[0]);
  const s = digSite(g);
  check('found a dig site (setup)', !!s);
  pinDigger(g, s.sx, s.sy);
  g.stock.shovel = 0;
  g.paintDigRun(s.x, s.y, s.x, s.y);
  run(g, 6);
  check('no shovel: the tile stays solid', g.world.isSolid(s.x, s.y));
  check('no shovel: the order persists', g.digOrders.size === 1);
  check('no shovel: the digger never equips', g.workers[0].hasShovel === false);
}

// ---- a KEPT shovel is not a shovel the sim may claim (card #64) -------------
// Equipping a Digger takes the shovel out of the store for good, so it obeys the
// keep floor like every other autonomous consumer: reserve the only shovel and
// the dig waits until the player releases it.
{
  const g = new Game(LEVELS[0]);
  const s = digSite(g);
  const w = pinDigger(g, s.sx, s.sy);
  g.stock.shovel = 1;
  g.setKeep('shovel', 1);
  g.paintDigRun(s.x, s.y, s.x, s.y);
  run(g, 6);
  check('kept shovel: the digger never equips it', w.hasShovel === false);
  check('kept shovel: it is still in store', g.stock.shovel === 1);
  check('kept shovel: the tile stays solid', g.world.isSolid(s.x, s.y));

  g.setKeep('shovel', 0); // the player releases it
  run(g, 8);
  check('released: the digger equips and digs', w.hasShovel === true && !g.world.isSolid(s.x, s.y));
}

// ---- an assigned Digger removes the tile only after DIG_TIME elapses --------
{
  const g = new Game(LEVELS[0]);
  const s = digSite(g);
  const w = pinDigger(g, s.sx, s.sy);
  g.stock.shovel = 1;
  g.paintDigRun(s.x, s.y, s.x, s.y);
  const need = DIG_TIME[g.world.get(s.x, s.y)] ?? 2;
  run(g, 0.5); // assigned + arrived + digging, but well under DIG_TIME
  check('digger equipped a shovel from stock', w.hasShovel === true && g.stock.shovel === 0);
  check('the tile is NOT removed before DIG_TIME', g.world.isSolid(s.x, s.y));
  run(g, need + 1); // now past DIG_TIME
  check('the tile IS removed after DIG_TIME', g.world.get(s.x, s.y) === T.AIR);
  check('the order clears when the tile is dug', g.digOrders.size === 0);
}

// ---- canDig rejects BEDROCK, world edges, and tiles under a building --------
{
  const g = new Game(LEVELS[0]);
  const W = g.world;
  check('world edge (x=0) is not diggable', canDig(W, g.buildings, 0, 5) === false);
  check('bottom row (bedrock/edge) is not diggable', canDig(W, g.buildings, 5, W.h - 1) === false);
  // a solid non-bedrock tile with an open face IS diggable (sanity)
  const s = digSite(g);
  check('a normal exposed tile is diggable', canDig(W, g.buildings, s.x, s.y) === true);
  // the support tile directly under the town hall is protected
  const th = g.townhall;
  const gx = th.x + 1, gy = th.y + 3; // FOOTPRINTS.townhall.h === 3
  check('the tile under a building is not diggable', canDig(W, g.buildings, gx, gy) === false);
}

// ---- a route opens once a blocking tile is dug (repath through new terrain) --
{
  const g = new Game(LEVELS[0]);
  const W = g.world;
  // find a solid wall tile with standable ground either side at the same row
  let wall = null;
  for (let x = 3; x < W.w - 3 && !wall; x++) {
    for (let y = 3; y < W.h - 2; y++) {
      // a solid, floored pillar with a standable air cell on either side: dig it
      // and the two sides connect at the same row
      if (W.isSolid(x, y) && W.get(x, y) !== T.BEDROCK && W.isSupport(x, y + 1) &&
          W.isStandable(x - 1, y) && W.isStandable(x + 1, y) &&
          W.get(x - 1, y) === T.AIR && W.get(x + 1, y) === T.AIR) { wall = { x, y }; break; }
    }
  }
  // fall back: carve a tiny test wall (with a floor under it) if none is handy
  if (!wall) {
    const y = 10;
    W.set(4, y + 1, T.ROCK); W.set(5, y + 1, T.ROCK); W.set(6, y + 1, T.ROCK); // floor
    W.set(5, y, T.ROCK); // the pillar to dig; sides (4,y)/(6,y) stay AIR
    wall = { x: 5, y };
  }
  const left = W.key(wall.x - 1, wall.y);
  const before = findPath(W, g.transits, wall.x + 1, wall.y, new Set([left]), false);
  W.set(wall.x, wall.y, T.AIR); // a digger opens the wall
  const after = findPath(W, g.transits, wall.x + 1, wall.y, new Set([left]), false);
  check('opening a dug tile creates a walkable route', !!after && (before === null || after.cost <= before.cost));
}

// ---- the Campaign-4 showcase level is solvable by digging -------------------
{
  const def = LEVELS.find((l) => l.id === 13);
  check('campaign-4 level exists', !!def && def.campaign === 4);
  const g = new Game(def);
  const air = (x, y) => g.world.get(x, y) === T.AIR;
  const steps = [
    { done: false, when: () => true, do: () => g.placeBuilding('workshop', 21, 14) },
    { done: false, when: () => g.stock.shovel >= 1 || g.equippedDiggers() >= 1, do: () => g.paintDigRun(30, 16, 30, 19) },
    { done: false, when: () => air(30, 19), do: () => g.paintDigRun(31, 19, 37, 19) },
    // ladder the shaft so empty miners can climb down to the seam — no free hop
    // down a 4-tile shaft any more (#48). The dug column reads as rock-walled air.
    { done: false, when: () => air(30, 19), do: () => g.placeLadderRun(30, 16, 30, 19) },
    { done: false, when: () => air(34, 19), do: () => g.toggleMark(34, 19) },
  ];
  let t = 0; const dt = 1 / 30;
  while (t < 260 && !g.won) {
    for (const s of steps) if (!s.done && s.when()) { s.do(); s.done = true; }
    g.tick(dt); t += dt;
  }
  check('digging opens the sealed seam', air(34, 19));
  check('4 iron are mined and delivered', g.objectives[0].delivered >= 4);
  check('the level is won by digging', g.won);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
