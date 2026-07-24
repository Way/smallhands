// Headless checks for the Ramp/Bridge feature. Bundles the TS sim with
// rolldown (see bundle.mjs) and imports it from a data URL, so it runs with
// plain `node`.
import { bundleExports } from './bundle.mjs';

const mod = await bundleExports(`
  export { World } from './src/game/world.ts';
  export { findPath } from './src/game/nav.ts';
  export { T } from './src/game/types.ts';
  export { canPlaceRamp, rampRunCells, bridgeRunCells, rampFacesLeft, rampCellsFaceLeft, ropeDropFor, liftTopFor } from './src/game/world.ts';
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
  export { TOOL_DEFS } from './src/game/types.ts';
  export { t } from './src/engine/i18n.ts';
  export { verifyLevel, blankLevelData, encodeTiles, decodeTiles } from './src/game/leveldata.ts';
`);
const { World, findPath, T, canPlaceRamp, rampRunCells, bridgeRunCells, rampFacesLeft, rampCellsFaceLeft, ropeDropFor, liftTopFor, Game, LEVELS, TOOL_DEFS, verifyLevel, blankLevelData, encodeTiles, decodeTiles, t } = mod;

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

// --- Gap fill: a lone ramp dropped into a gap between two diagonal ramp tiles
// must anchor off them. Ramps chain diagonally, so the gap tile is diagonally
// (not horizontally) adjacent to its neighbours. ---
{
  const { w, surfaceY } = stepWorld();
  // ascending 45° chain on the flat-left ground: (5,13) anchor, (6,12), (7,11).
  // Place only the two ends, leaving (6,12) as an open gap.
  w.set(5, surfaceY - 1, T.RAMP); // (5,13) sits on the grass at (5,14)
  w.set(7, surfaceY - 3, T.RAMP); // (7,11)
  // the gap tile is diagonally adjacent to a ramp both down-left and up-right
  check('gap between diagonal ramps is a valid anchor',
    canPlaceRamp(w, 6, surfaceY - 2, null) === true);
  // a single tap places it (rampRunCells with ax===tx uses the anchor rule)
  check('rampRunCells fills the diagonal gap',
    rampRunCells(w, 6, surfaceY - 2, 6, surfaceY - 2).length === 1);
  // still floating: a ramp diagonally adjacent to nothing solid or ramp stays invalid
  check('lone floating diagonal is still invalid',
    canPlaceRamp(w, 15, surfaceY - 6, null) === false);
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

// --- Ramp climbability: an ascending run must stop where a low ceiling blocks
// the hop between tiles, so it never places tiles a loaded hauler can't reach. ---
{
  const w = new World(24, 20);
  const surfaceY = 14, ax = 8;
  for (let x = 0; x < w.w; x++)
    for (let y = 0; y < w.h; y++) w.set(x, y, y < surfaceY ? T.AIR : y === surfaceY ? T.GRASS : T.DIRT);

  // Open sky: the full 45° run builds.
  const open = rampRunCells(w, ax, surfaceY - 1, ax + 3, surfaceY - 4);
  check('ramp run builds fully with clear headroom', open.length === 4);

  // A low ceiling two cells above the anchor no longer clips the run: the hauler
  // walks the ramp tiles themselves, which needs only the one cell of clearance
  // canPlaceRamp already demands (card #59 — the old "transit headroom" rule was
  // written for the walk-on-top-only era and truncated climbable runs).
  w.set(ax, surfaceY - 3, T.ROCK); // (8,11): two above the anchor
  const lowRoof = rampRunCells(w, ax, surfaceY - 1, ax + 3, surfaceY - 4);
  check('ramp run is not clipped by a low ceiling over the anchor', lowRoof.length === 4);
  for (const c of lowRoof) w.set(c.x, c.y, T.RAMP);
  check('every tile of the low-ceiling run is reachable loaded',
    lowRoof.every((c) => findPath(w, [], ax - 2, surfaceY - 1, new Set([w.key(c.x, c.y)]), true) !== null));

  // A descending drag off a plateau edge still lays its full run.
  // Plateau on the left (ground top at 10) dropping to a lower shelf on the right;
  // anchor hangs off the plateau edge and the run descends down-right.
  const w2 = new World(24, 20);
  const highY = 10, lowY = 15;
  for (let x = 0; x < w2.w; x++) {
    const top = x <= ax ? highY : lowY;
    for (let y = 0; y < w2.h; y++) w2.set(x, y, y < top ? T.AIR : y === top ? T.GRASS : T.DIRT);
  }
  w2.set(ax + 1, highY - 2, T.ROCK); // a low roof over the anchor must not matter
  const down = rampRunCells(w2, ax + 1, highY, ax + 4, highY + 3);
  check('descending ramp run lays its full length', down.length === 4);
}

// --- Task 3: tool defs + sim placers ---
{
  const ramp = TOOL_DEFS.find((t) => t.id === 'ramp');
  const bridge = TOOL_DEFS.find((t) => t.id === 'platform');
  check('ramp tool defined, 1 plank', !!ramp && ramp.cost && ramp.cost.plank === 1);
  check('platform tool relabelled Bridge', !!bridge && t('tool.platform.label') === 'Bridge');

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

// --- Auto-rotate: a ramp's facing follows its chain, and a standalone ramp
// leans toward whichever side the terrain edge is on (card #46). facing is
// render-only: true = climbs LEFT (mirrored art), false = climbs RIGHT. ---
{
  // Standalone tile against a ledge on one side, air on the other.
  const wl = new World(20, 20);
  wl.set(5, 10, T.ROCK); // wall on the LEFT of the ramp cell (6,10)
  check('standalone ramp with edge on the left climbs left',
    rampFacesLeft(wl, 6, 10) === true);

  const wr = new World(20, 20);
  wr.set(7, 10, T.ROCK); // wall on the RIGHT of the ramp cell (6,10)
  check('standalone ramp with edge on the right climbs right',
    rampFacesLeft(wr, 6, 10) === false);

  // A higher ledge (edge diagonally above) counts too — a +1 step up-left.
  const wd = new World(20, 20);
  wd.set(5, 9, T.ROCK); // ledge top-left of (6,10)
  check('standalone ramp leans toward a raised left ledge',
    rampFacesLeft(wd, 6, 10) === true);

  // Chains win over terrain: a "/" run climbs right even with a wall on its left.
  const ws = new World(20, 20);
  ws.set(5, 12, T.RAMP); ws.set(6, 11, T.RAMP); ws.set(7, 10, T.RAMP); // "/" up-right
  ws.set(5, 11, T.ROCK); // a left wall that must NOT flip the chain tile
  check('"/" chain climbs right despite a wall on the left',
    rampFacesLeft(ws, 6, 11) === false);

  // A "\" run (up-left / down-right) climbs left along the whole face.
  const wb = new World(20, 20);
  wb.set(5, 10, T.RAMP); wb.set(6, 11, T.RAMP); wb.set(7, 12, T.RAMP); // "\" down-right
  check('"\\" chain climbs left', rampFacesLeft(wb, 6, 11) === true);

  // Ambiguous standalone (edge on both sides) keeps the default right art.
  const wa = new World(20, 20);
  wa.set(5, 10, T.ROCK); wa.set(7, 10, T.ROCK);
  check('standalone ramp with edges on both sides defaults to climb right',
    rampFacesLeft(wa, 6, 10) === false);

  // Drag-preview facing reads the run's actual laid-out cells (one slope face).
  const wp = new World(20, 20);
  const up = [{ x: 6, y: 12 }, { x: 7, y: 11 }, { x: 8, y: 10 }]; // "/" up-right
  const dn = [{ x: 6, y: 10 }, { x: 7, y: 11 }, { x: 8, y: 12 }]; // "\" down-right
  check('drag preview: "/" run climbs right', rampCellsFaceLeft(wp, up) === false);
  check('drag preview: "\\" run climbs left', rampCellsFaceLeft(wp, dn) === true);

  // A run that truncates to a single tile settles by the same standalone
  // terrain-edge rule the renderer uses — so the preview must NOT read the drag
  // direction (which would flip the lone tile on release). Regression for the
  // diagonal-drag-into-a-wall collapse.
  const wc = new World(20, 20);
  const surfaceY = 14;
  for (let x = 0; x < wc.w; x++)
    for (let y = 0; y < wc.h; y++) wc.set(x, y, y < surfaceY ? T.AIR : y === surfaceY ? T.GRASS : T.DIRT);
  wc.set(5, surfaceY - 1, T.ROCK); // a wall directly left of the anchor at (6, surfaceY-1)
  // Drag down-right into the ground: the next cell hits solid, so the run is 1 tile.
  const clipped = rampRunCells(wc, 6, surfaceY - 1, 9, surfaceY + 2);
  check('diagonal drag into terrain truncates to one tile', clipped.length === 1);
  // dx===dy for that drag would say "climb left"; the lone tile actually settles
  // by the edge rule (wall on the left → also climb left here, but via the same
  // path the renderer takes), so preview and settle agree.
  check('truncated 1-tile preview matches the settled facing',
    rampCellsFaceLeft(wc, clipped) === rampFacesLeft(wc, clipped[0].x, clipped[0].y));

  // And when the edge rule disagrees with the drag vector, the preview follows
  // the edge rule (settle), not the vector: wall on the RIGHT, drag down-right.
  const wc2 = new World(20, 20);
  for (let x = 0; x < wc2.w; x++)
    for (let y = 0; y < wc2.h; y++) wc2.set(x, y, y < surfaceY ? T.AIR : y === surfaceY ? T.GRASS : T.DIRT);
  wc2.set(7, surfaceY - 1, T.ROCK); // wall up-right of the anchor at (6, surfaceY-1)
  const clip2 = rampRunCells(wc2, 6, surfaceY - 1, 9, surfaceY + 2);
  check('drag-into-right-wall truncates to one tile', clip2.length === 1);
  check('truncated tile climbs right (edge rule wins over the "\\" drag vector)',
    rampCellsFaceLeft(wc2, clip2) === false);
}

// --- Walkable diagonal (card #59): a ramp tile is passable AND standable, so it
// never walls off the row it stands in — a smallhand walks the slope itself
// instead of only the flat cell above it. ---
{
  const surfaceY = 14;
  const flat = () => {
    const w = new World(24, 20);
    for (let x = 0; x < w.w; x++)
      for (let y = 0; y < w.h; y++) w.set(x, y, y < surfaceY ? T.AIR : y === surfaceY ? T.GRASS : T.DIRT);
    return w;
  };

  const w = flat();
  w.set(10, surfaceY - 1, T.RAMP); // a lone ramp tile standing on the grass
  check('a ramp cell is passable', w.isPassable(10, surfaceY - 1) === true);
  check('a ramp cell is standable (you walk the slope itself)',
    w.isStandable(10, surfaceY - 1) === true);

  // A mid-chain tile has nothing under it — its own slope carries the walker.
  const wc = flat();
  wc.set(8, surfaceY - 1, T.RAMP);
  wc.set(9, surfaceY - 2, T.RAMP);
  wc.set(10, surfaceY - 3, T.RAMP);
  check('a mid-chain ramp tile stands on its own slope',
    wc.get(9, surfaceY - 1) === T.AIR && wc.isStandable(9, surfaceY - 2) === true);

  // A loaded hauler crossing flat ground walks THROUGH the ramp cell rather than
  // hopping over its top — the ramp is a slope in the floor, not a wall.
  const across = findPath(w, [], 7, surfaceY - 1, new Set([w.key(13, surfaceY - 1)]), true);
  check('a loaded hauler crosses a ramp on flat ground', across !== null);
  check('the crossing passes through the ramp cell, not over it',
    !!across && across.steps.some((s) => s.x === 10 && s.y === surfaceY - 1 && s.kind === 'walk'));

  // Falling bodies still land ON a ramp — passable must not mean see-through.
  check('a ramp still catches a fall', findPath(w, [], 10, surfaceY - 4,
    new Set([w.key(10, surfaceY - 1)]), false) !== null);
}

// --- Switchback stacks (card #59): reversing legs gain height in a tight
// footprint. The upper leg anchors on the cell directly ABOVE the lower leg's
// top tile, so the turn only works because ramp tiles are walkable. ---
{
  const surfaceY = 16;
  const w = new World(24, 22);
  for (let x = 0; x < w.w; x++)
    for (let y = 0; y < w.h; y++) w.set(x, y, y < surfaceY ? T.AIR : y === surfaceY ? T.GRASS : T.DIRT);

  // leg 1: three tiles up-LEFT off the ground, (12,15) → (10,13)
  const leg1 = rampRunCells(w, 12, surfaceY - 1, 10, surfaceY - 3);
  check('switchback leg 1 lays 3 tiles up-left', leg1.length === 3);
  for (const c of leg1) w.set(c.x, c.y, T.RAMP);

  // leg 2: reverse direction — four tiles up-RIGHT anchored on the cell directly
  // above leg 1's top tile, (10,12) → (13,9)
  const leg2 = rampRunCells(w, 10, surfaceY - 4, 13, surfaceY - 7);
  check('switchback leg 2 lays 4 tiles up-right off the lower leg', leg2.length === 4);
  for (const c of leg2) w.set(c.x, c.y, T.RAMP);

  // The stack climbs 7 rows inside 4 columns; a single 45° run would need 7.
  const cols = new Set([...leg1, ...leg2].map((c) => c.x));
  check('the switchback climbs 7 rows within 4 columns',
    cols.size === 4 && leg1[0].y - leg2[leg2.length - 1].y === 6);

  // A LOADED hauler climbs the whole zigzag: ground → the cell atop leg 2.
  const top = new Set([w.key(13, surfaceY - 8)]);
  check('a loaded hauler climbs the switchback', findPath(w, [], 16, surfaceY - 1, top, true) !== null);
  // …and back down again (ramps carry cargo both ways, card #48).
  const ground = new Set([w.key(16, surfaceY - 1)]);
  check('a loaded hauler descends the switchback',
    findPath(w, [], 13, surfaceY - 8, ground, true) !== null);

  // Facing: each leg reads as one slope face, so the turn is a peak — the lower
  // leg climbs left into it, the upper leg climbs right out of it.
  check('switchback lower leg climbs left', leg1.every((c) => rampFacesLeft(w, c.x, c.y) === true));
  check('switchback upper leg climbs right', leg2.every((c) => rampFacesLeft(w, c.x, c.y) === false));
}

// --- A ramp cell is walkable floor, not a building site. Anchors gate on
// isStandable, which a ramp tile now satisfies — so they must exclude built
// structure tiles explicitly, or a rope/hoist/lift lands inside a ramp and is
// orphaned the moment that ramp is demolished (card #59 review). ---
{
  // plateau on the left (top row 11) dropping to low ground on the right (top 20)
  const cliff = () => {
    const w = new World(26, 24);
    for (let x = 0; x < w.w; x++) {
      const top = x <= 11 ? 11 : 20;
      for (let y = 0; y < w.h; y++) w.set(x, y, y < top ? T.AIR : y === top ? T.GRASS : T.DIRT);
    }
    return w;
  };

  const wr = cliff();
  check('bare cliff edge is a rope anchor (control)', ropeDropFor(wr, 11, 10) !== null);
  wr.set(11, 10, T.RAMP); // a ramp tile laid on the very edge cell
  check('a ramp cell is not a rope/hoist anchor', ropeDropFor(wr, 11, 10) === null);

  const wl = cliff();
  check('bare ground beside the wall is a lift base (control)', liftTopFor(wl, 12, 19) !== null);
  wl.set(12, 19, T.RAMP);
  check('a ramp cell is not a lift base', liftTopFor(wl, 12, 19) === null);
  wl.set(12, 19, T.LADDER); // same reasoning — ropeDropFor already refused ladders
  check('a ladder cell is not a lift base', liftTopFor(wl, 12, 19) === null);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
