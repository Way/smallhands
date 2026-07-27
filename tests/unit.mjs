// Fast headless unit checks for pure sim logic — no browser needed.
// Bundles the TypeScript sources with rolldown (see bundle.mjs) and imports
// the result from an in-memory data URL, so it runs with plain `node`.
import { readdirSync, readFileSync } from 'node:fs';
import { bundleExports } from './bundle.mjs';

const mod = await bundleExports(`
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
  export { canPlaceLadder } from './src/game/world.ts';
  export { findPath, nodeApproachCells } from './src/game/nav.ts';
  export { T, fmtTime, fmtClock, DAY_HOUR, NIGHT_HOUR, nightAmountAt, NIGHT_WORK_DARK } from './src/game/types.ts';
  export { t, setLang, getLang } from './src/engine/i18n.ts';
  export { exportAllData, importAllData } from './src/engine/save.ts';
  export { blankLevelData } from './src/game/leveldata.ts';
`);
const { Game, LEVELS, canPlaceLadder, findPath, nodeApproachCells, T, fmtTime, fmtClock, DAY_HOUR, NIGHT_HOUR, nightAmountAt, NIGHT_WORK_DARK, t, setLang, getLang, exportAllData, importAllData, blankLevelData } = mod;

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}`);
    failures++;
  }
}

// Find two distinct valid ladder cells on level 1's terrain.
function findLadderCells(g, count) {
  const cells = [];
  for (let y = 0; y < g.world.h && cells.length < count; y++) {
    for (let x = 0; x < g.world.w && cells.length < count; x++) {
      if (canPlaceLadder(g.world, x, y)) cells.push({ x, y });
    }
  }
  return cells;
}

// ---- Ladders cost "1 wood": prefer a log, fall back to a plank -------------
// The reported softlock: after every tree is harvested and every log is sawn
// into planks, the player has planks but zero logs — ladders must still build.
// Logs stay the default so refined planks are left for the goal and platforms.
{
  const g = new Game(LEVELS[0]);
  const [cellA, cellB, cellC] = findLadderCells(g, 3);
  check('level 1 has valid ladder cells', cellA && cellB && cellC);

  // planks only, no logs — the "all trees cut to planks" state (the bug report)
  g.stock = { log: 0, plank: 5, stone: 0, iron: 0, spear: 0 };
  const builtFromPlank = g.placeLadder(cellA.x, cellA.y);
  check('ladder builds from a plank when no logs remain', builtFromPlank === true);
  check('building it consumed one plank', g.stock.plank === 4);
  check('the tile became a ladder', g.world.get(cellA.x, cellA.y) === T.LADDER);

  // demolish refunds a plank (never a log — that would be an infinite-plank loop)
  g.demolish(cellA.x, cellA.y);
  check('demolishing a ladder refunds a plank', g.stock.plank === 5);
  check('demolish mints no phantom log', g.stock.log === 0);

  // when both are on hand, a log is spent first and planks are left alone
  g.stock = { log: 5, plank: 3, stone: 0, iron: 0, spear: 0 };
  const builtFromLog = g.placeLadder(cellB.x, cellB.y);
  check('ladder builds when logs are available', builtFromLog === true);
  check('a log is spent before a plank', g.stock.log === 4);
  check('planks are untouched while a log exists', g.stock.plank === 3);

  // no wood of any kind — the build is refused
  g.stock = { log: 0, plank: 0, stone: 0, iron: 0, spear: 0 };
  const builtFromNothing = g.placeLadder(cellC.x, cellC.y);
  check('a ladder can NOT be built with no wood at all', builtFromNothing === false);
  check('the tile stays empty when refused', g.world.get(cellC.x, cellC.y) !== T.LADDER);
}

// ---- setKeep clamps to a sane integer range --------------------------------
{
  const g = new Game(LEVELS[0]);
  g.setKeep('stone', -5);
  check('setKeep floors negatives at 0', g.keep.stone === 0);
  g.setKeep('stone', 250);
  check('setKeep caps at 99', g.keep.stone === 99);
  g.setKeep('stone', 3.7);
  check('setKeep truncates to an integer', g.keep.stone === 3);
}

// ---- Reserve: haulers ship only the surplus above the floor ----------------
// Level 1's only haul work is delivering planks to the caravan (no marked
// nodes, no buildings), so plank deliveries are a clean probe of the gate.
{
  const g = new Game(LEVELS[0]); // objective: plank 8
  const plankObj = () => g.objectives.find((o) => o.item === 'plank');

  // floor at or above stock → no caravan haul is ever created
  g.stock.plank = 3;
  g.setKeep('plank', 5);
  for (let i = 0; i < 60 * 12; i++) g.tick(1 / 60); // 12s
  check('nothing ships while stock <= keep', plankObj().inbound + plankObj().delivered === 0);
  check('the reserved stock is untouched', g.stock.plank === 3);

  // drop the floor → the surplus (3 - 1) ships, and stock never dips below it
  g.setKeep('plank', 1);
  for (let i = 0; i < 60 * 25; i++) g.tick(1 / 60); // 25s
  check('surplus ships once the floor drops', plankObj().inbound + plankObj().delivered === 2);
  check('stock never falls below the floor', g.stock.plank >= 1);
}

// ---- Reserve holds back loose & produced goods, not only stock --------------
// The floor must gate EVERY route to the caravan. Loose items on the ground and
// fresh workshop outputs can reach the goal WITHOUT passing through the
// stockpile; if those direct routes skip the floor, keep is silently ignored
// and everything ships (the reported bug: set a plank floor, yet every plank
// still gets delivered to target). Probe with loose planks on level 1.
{
  const g = new Game(LEVELS[0]); // objective: plank 8, caravan goal
  const plankObj = () => g.objectives.find((o) => o.item === 'plank');

  // empty store, floor of 3, and 5 loose planks dropped on a worker's own cell
  // (guaranteed standable + reachable). Without the fix these sail straight to
  // the caravan; with it three bank in store and only the surplus (2) ships.
  g.stock.plank = 0;
  g.setKeep('plank', 3);
  const spot = g.workers[0];
  for (let i = 0; i < 5; i++) {
    g.groundItems.push({ id: 70000 + i, item: 'plank', x: spot.cx, y: spot.cy, reserved: false, bounce: 0 });
  }
  for (let i = 0; i < 60 * 60; i++) g.tick(1 / 60); // 60s to settle

  check('loose planks bank to the floor, not the caravan', g.stock.plank === 3);
  check('only the surplus above the floor reaches the target',
    plankObj().inbound + plankObj().delivered === 2);
  check('no loose planks are left stranded', !g.groundItems.some((i) => i.item === 'plank'));
}

// ---- The floor is absolute: crafting can't eat the reserve either (card #64) -
// The reported bug: reserve 1 iron and the forge still swallows it — the floor
// gated only the caravan route, so every OTHER autonomous consumer (producer
// feed, hoist loading, the digger's shovel) walked straight past it. A kept unit
// must never leave the store on the sim's own initiative, whatever wants it.
{
  const g = new Game(LEVELS[2]); // level 3: forge site from the campaign proof
  const forge = g.addBuilding('forge', 15, 21, true); // 1 plank + 1 iron -> spear
  g.stock.iron = 2;
  g.stock.plank = 4;
  g.setKeep('iron', 1);

  let floorBroken = false;
  for (let i = 0; i < 60 * 40; i++) {
    g.tick(1 / 60);
    if (g.stock.iron < 1) floorBroken = true; // must hold every single frame
  }
  check('the store never dips below the iron floor while a forge is hungry', !floorBroken);
  check('the reserved iron is still in store', g.stock.iron === 1);
  check('only the surplus iron reached the forge',
    (forge.inputs.iron ?? 0) + (forge.outputs.spear ?? 0) + g.stock.spear >= 1);

  // releasing the floor is the ONLY thing that frees it
  g.setKeep('iron', 0);
  for (let i = 0; i < 60 * 40; i++) g.tick(1 / 60);
  check('lowering the floor releases the last iron to the forge', g.stock.iron === 0);
}

// ---- Loose goods bank to the floor instead of feeding a producer ------------
// A producer can be fed straight off the ground without the goods ever touching
// the stockpile, so that route has to honour the floor too — below the floor the
// loose units belong in the store, building the reserve up.
{
  const g = new Game(LEVELS[0]); // level 1: sawmill site from the campaign proof
  const saw = g.addBuilding('sawmill', 33, 17, true); // 1 log -> 2 planks
  g.stock.log = 0;
  g.setKeep('log', 2);
  const spot = g.workers[0];
  for (let i = 0; i < 3; i++) g.dropItem('log', spot.cx, spot.cy);

  for (let i = 0; i < 60 * 60; i++) g.tick(1 / 60); // 60s to settle
  check('loose logs bank to the floor rather than feeding the sawmill', g.stock.log === 2);
  check('only the surplus log was sawn',
    (saw.inputs.log ?? 0) + (saw.outputs.plank ?? 0) / 2 <= 1);
  check('no loose logs are left lying around', !g.groundItems.some((i) => i.item === 'log'));
}

// ---- Raising the floor cancels a haul already on its way to the store -------
// The floor is re-read at the moment of pickup, not trusted from dispatch time:
// a hauler dispatched a second before the player raised the floor must not be
// the hole the reserved unit escapes through.
{
  const g = new Game(LEVELS[0]);
  const saw = g.addBuilding('sawmill', 33, 17, true); // hungry sawmill, far from the store
  g.stock.log = 1;

  // Park every hauler at the sawmill so fetching the log is a LONG walk to the
  // stockpile — that keeps the task observable in its 'toSource' leg instead of
  // dispatching and picking up inside one tick.
  const key = [...g.buildingApproach(saw)][0];
  const sx = key % g.world.w;
  const sy = (key - sx) / g.world.w;
  for (const w of g.workers) {
    w.role = 'hauler';
    w.cx = sx; w.cy = sy; w.px = sx; w.py = sy;
    w.task = null; w.path = []; w.stepIdx = 0; w.carrying = null;
  }
  g.desiredRoles = { hauler: g.workers.length, builder: 0, woodcutter: 0, miner: 0, digger: 0 };

  let dispatched = false;
  for (let i = 0; i < 60 * 20 && !dispatched; i++) {
    g.tick(1 / 60);
    dispatched = g.workers.some(
      (w) => w.task?.kind === 'haul' && w.task.item === 'log' && w.task.source.t === 'stock' && w.task.phase === 'toSource'
    );
  }
  check('a hauler was dispatched to fetch the log from store (setup)', dispatched);

  g.setKeep('log', 1); // the player changes their mind mid-walk
  for (let i = 0; i < 60 * 30; i++) g.tick(1 / 60);
  check('the in-flight pickup is cancelled, the log stays in store', g.stock.log === 1);
  check('nothing is left promised against the store', g.stockReserved.log === 0);
}

// ---- The player's own spend is the release valve, not a leak ----------------
// Placement/upgrade costs are the player deliberately giving the goods up, so
// they still spend the whole store — that is the documented purpose of the
// floor (level 3's hint: keep stone back SO you can build the lift and forge).
{
  const g = new Game(LEVELS[0]);
  const [cell] = findLadderCells(g, 1);
  g.stock = { log: 1, plank: 0, stone: 0, iron: 0, spear: 0, shovel: 0 };
  g.setKeep('log', 5);
  check('a kept log still builds a ladder when the player asks', g.placeLadder(cell.x, cell.y) === true);
  check('the player spend went through', g.stock.log === 0);
}

// ---- Level 3 shape: stone is both the order and the build material ---------
{
  const g = new Game(LEVELS[2]); // objectives include stone 8; goal at west edge
  const stoneObj = () => g.objectives.find((o) => o.item === 'stone');

  // bank 6 stone (the TH Lv2 upgrade cost); only the surplus of a 10 stock ships
  g.stock.stone = 10;
  g.setKeep('stone', 6);
  for (let i = 0; i < 60 * 30; i++) g.tick(1 / 60); // 30s
  check('order stalls at the floor (ships 10-6=4)', stoneObj().delivered === 4);
  check('6 stone stay banked for building', g.stock.stone === 6);

  // release the floor → the order finishes (up to the 8 required)
  g.setKeep('stone', 0);
  for (let i = 0; i < 60 * 30; i++) g.tick(1 / 60); // 30s
  check('lowering the floor lets the order finish', stoneObj().delivered === 8);
  check('stock drops to the remainder (10-8=2)', g.stock.stone === 2);
}

// ---- Level 3 teaches the reserve exactly when stone is contested -----------
{
  const g = new Game(LEVELS[2]);
  const hint = (g.level.hints ?? []).find((h) => h.id === 'reserve');
  check('level 3 has the reserve hint', !!hint);
  g.stock.stone = 0; g.thLevel = 1;
  check('reserve hint hidden with no stone', hint.when(g) === false);
  g.stock.stone = 2;
  check('reserve hint fires once stone is on hand', hint.when(g) === true);
  g.thLevel = 2;
  check('reserve hint gone after the upgrade', hint.when(g) === false);
}

// ---- placementShortfall: what's missing to place a cost-bearing tool -------
// Drives the cursor cost badge. Returns the required resources (with have/need
// and a `short` flag) ONLY when at least one is short; an empty array means
// "you can afford it" → no badge.
{
  const g = new Game(LEVELS[0]);

  // A tool with no cost never has a shortfall.
  check('no-cost tool (select) returns no rows', g.placementShortfall('select').length === 0);

  // Forge needs plank 4 + stone 4. Plenty of planks, not enough stone.
  g.stock = { log: 0, plank: 5, stone: 1, iron: 0, spear: 0 };
  const forge = g.placementShortfall('forge');
  check('forge lists every required resource for context', forge.length === 2);
  const plankRow = forge.find((r) => r.item === 'plank');
  const stoneRow = forge.find((r) => r.item === 'stone');
  check('forge: satisfied plank row carries have/need, not short',
    !!plankRow && plankRow.have === 5 && plankRow.need === 4 && plankRow.short === false);
  check('forge: the missing stone row is flagged short',
    !!stoneRow && stoneRow.have === 1 && stoneRow.need === 4 && stoneRow.short === true);

  // Enough of everything → nothing missing → no badge.
  g.stock = { log: 0, plank: 4, stone: 4, iron: 0, spear: 0 };
  check('forge fully affordable returns no rows', g.placementShortfall('forge').length === 0);

  // Ladder spends 1 log OR 1 plank, so it's only short when you have neither.
  g.stock = { log: 0, plank: 0, stone: 0, iron: 0, spear: 0 };
  const ladder = g.placementShortfall('ladder');
  check('ladder with no wood shows one short log row',
    ladder.length === 1 && ladder[0].item === 'log' && ladder[0].have === 0 &&
    ladder[0].need === 1 && ladder[0].short === true);
  g.stock = { log: 0, plank: 2, stone: 0, iron: 0, spear: 0 };
  check('ladder affordable via the plank fallback shows nothing', g.placementShortfall('ladder').length === 0);
  g.stock = { log: 3, plank: 0, stone: 0, iron: 0, spear: 0 };
  check('ladder affordable via logs shows nothing', g.placementShortfall('ladder').length === 0);
}

// ============================ Campaign 2 mechanics ===========================

// ---- campaign structure -----------------------------------------------------
{
  check('seventeen campaign levels ship', LEVELS.length === 17);
  check('level ids stay sequential', LEVELS.every((l, i) => l.id === i + 1));
  check('campaign 1 keeps its four levels', LEVELS.filter((l) => (l.campaign ?? 1) === 1).length === 4);
  check('campaign 2 brings five levels', LEVELS.filter((l) => l.campaign === 2).length === 5);
  check('campaign 4 digs five levels deep', LEVELS.filter((l) => l.campaign === 4).length === 5);
}

// ---- water: impassable, unbuildable, bridgeable -----------------------------
{
  const g = new Game(LEVELS[4]); // The Ford
  check('the river holds water', g.world.get(25, 22) === T.WATER);
  check('water is not passable', g.world.isPassable(25, 22) === false);
  check('water is not standable', g.world.isStandable(25, 22) === false);
  check('no ladder builds in water', canPlaceLadder(g.world, 25, 22) === false);
  g.stock.plank = 20;
  check('a bridge spans the river bank to bank', g.placeBridgeRun(22, 19, 29, 19) === 8);
}

// ---- weather: deterministic schedule, wet work is slower ---------------------
{
  const g = new Game(LEVELS[5]); // Monsoon Hollow: clear 45s -> rain 30s, looping
  check('weather starts on the first phase', g.weather === 'clear');
  check('clear skies work at full speed', g.workFactor === 1);
  for (let i = 0; i < 46 * 30; i++) g.tick(1 / 30);
  check('rain arrives on the forecast', g.weather === 'rain');
  check('rain slows harvest work', g.workFactor < 1);
  for (let i = 0; i < 30 * 30; i++) g.tick(1 / 30);
  check('the sky clears again on schedule', g.weather === 'clear');
}

// ---- storm phase reads as storm (lift brake + slow work) ---------------------
{
  const g = new Game(LEVELS[8]); // Tempest Summit: clear/rain/clear/storm
  g.weatherIdx = 3;
  check('storm phase reads as storm', g.weather === 'storm');
  check('storm also slows harvest', g.workFactor < 1);
}

// ---- the rising tide: floods, sinks goods, rescues smallies, then stops ----
{
  const g = new Game(LEVELS[7]); // The Rising Tide; basin floor stands at row 25
  const w = g.workers[0];
  w.cx = 31;
  w.cy = 25;
  w.px = 31;
  w.py = 25;
  g.groundItems.push({ id: 9999, item: 'stone', x: 33, y: 25, reserved: false, bounce: 0 });
  check('the basin floor starts dry', g.world.get(31, 25) === T.AIR);
  g.riseWater();
  check('the first rise floods the basin floor', g.world.get(31, 25) === T.WATER);
  check('goods caught by the tide sink', !g.groundItems.some((i) => i.id === 9999));
  check('a smallie caught by the tide scrambles home', w.cy === 19 && g.world.get(w.cx, w.cy) !== T.WATER);
  g.riseWater();
  check('the second rise laps one row higher', g.world.get(31, 24) === T.WATER);
  g.riseWater();
  check('the tide never climbs past its ceiling', g.world.get(31, 23) === T.AIR);
  g.stock.plank = 20;
  check('a shelf-height bridge still crosses the lake', g.placeBridgeRun(26, 23, 37, 23) === 12);
}

// ---- night: work only in the light; lanterns push the frontier ---------------
{
  const g = new Game(LEVELS[6]); // Lantern Ridge
  check('the town keeps its own fires', g.isLit(10, 20) === true);
  check('the far ridge lies in darkness', g.isLit(44, 17) === false);
  const vein = g.nodes.find((n) => n.kind === 'vein');
  check('an unlit node cannot be marked', g.toggleMark(vein.x, vein.y) === false && vein.marked === false);
  g.stock = { log: 99, plank: 99, stone: 99, iron: 0, spear: 0 };
  check('no workshop rises in the dark', g.placeBuilding('sawmill', 40, 17) === false);
  check('a lantern may be raised anywhere in the dark', g.placeBuilding('lantern', 47, 17) === true);
  const lantern = g.buildings.find((b) => b.kind === 'lantern');
  check('an unbuilt lantern sheds no light yet', g.isLit(48, 17) === false);
  lantern.state = 'ready';
  check('a finished lantern lights its surroundings', g.isLit(48, 17) === true);
  check('the lit vein can now be marked', g.toggleMark(vein.x, vein.y) === true && vein.marked === true);
  check('day levels are always lit', new Game(LEVELS[0]).isLit(0, 0) === true);
}

// ---- #41 night build gate: only lanterns and ladders defy the dark -----------
// Once night falls, ramps, platforms, digs and the machine blueprints all need a
// lit site; only the light source (lantern) and vertical mobility (ladder) stay
// buildable, so the player must run the light out first. See docs/architecture.md.
{
  const g = new Game(LEVELS[6]); // Lantern Ridge — the far ridge (44,17) lies dark
  check('the far ridge lies in darkness', g.isLit(44, 17) === false);
  for (const tool of ['ramp', 'platform', 'lift', 'rope', 'hoist', 'dig']) {
    check(`darkBlocks refuses ${tool} on an unlit cell`, g.darkBlocks(tool, 44, 17) === true);
  }
  check('darkBlocks lets a ladder defy the dark', g.darkBlocks('ladder', 44, 17) === false);
  check('darkBlocks lets a lantern defy the dark', g.darkBlocks('lantern', 44, 17) === false);
  check('darkBlocks passes a build in the lit town', g.darkBlocks('ramp', 10, 20) === false);
  // a finished lantern lights the ridge, and building resumes there
  g.addBuilding('lantern', 43, 17, true);
  check('darkBlocks clears once the site is lit', g.darkBlocks('ramp', 44, 17) === false);
}

// ---- day↔night cycle: the living clock drives the light ----------------------
// nightAmountAt maps the hour to a 0..1 night intensity; a `dayNight` level
// advances timeOfDay so lighting, sky and veil all move together. Day and
// static-night maps stay pinned at the ends (0 / 1) — behaviour-preserving.
{
  // the pure curve
  check('curve: noon is full day', nightAmountAt(12) === 0);
  check('curve: 3am is deep night', nightAmountAt(3) === 1);
  check('curve: mid-dusk sits at the work threshold', nightAmountAt(19.5) >= NIGHT_WORK_DARK);
  check('curve: early dusk still counts as day-lit', nightAmountAt(18.2) < NIGHT_WORK_DARK);
  check('curve: hours wrap past midnight', nightAmountAt(27) === nightAmountAt(3));

  // fixed level types read the ends of the curve
  check('a day map reads full daylight', new Game(LEVELS[0]).nightAmount() === 0);
  check('a static night map reads full night', new Game(LEVELS[6]).nightAmount() === 1);

  // the showcase cycle level (#17, The Waning Light) opens at noon and turns over
  const g = new Game(LEVELS[16]);
  check('the cycle level opens in daylight', g.nightAmount() === 0);
  check('midday, the far ground is lit', g.isLit(35, 2) === true);
  check('the cycle clock starts at noon', Math.abs(g.timeOfDay - 12) < 0.001);

  // run the clock forward ~10 game-hours (rate 0.05 h/s → 200s) into deep night
  for (let i = 0; i < 800; i++) g.tick(0.25);
  check('the clock moved with the world', g.timeOfDay > 21 && g.timeOfDay < 23);
  check('night has fallen on the cycle', g.nightAmount() > 0.9);
  check('the far ground falls dark at night', g.isLit(35, 2) === false);
  check('the town fire still holds its own light', g.isLit(6, g.buildings.find((b) => b.kind === 'townhall').y + 1) === true);
}

// ---- no smallie prison under a ramp -----------------------------------------
// A ramp run laid against a wall roofs over the floor pocket beneath its
// diagonal. Workers standing there when it lands must still be able to step out
// onto the ramp — a ramp cell is passable, so it is headroom like any air cell
// (card #59; there is no longer a ramp-specific clause in the nav).
{
  const g = new Game(LEVELS[8]); // Tempest Summit (night): wall at x50, terrace floor row 20
  g.stock.plank = 10;
  // Tempest Summit is a night level, and ramps now refuse an unlit anchor (#41),
  // so the dark run is rejected and spends nothing until the site is lit.
  check('a ramp run is refused on an unlit anchor at night', g.placeRampRun(49, 16, 45, 20) === 0);
  check('the refused ramp spent no planks', g.stock.plank === 10);
  g.addBuilding('lantern', 47, 16, true); // a finished lantern lights the run's anchor
  check('ramp run against the wall places fully once lit', g.placeRampRun(49, 16, 45, 20) === 5);
  // a worker in the pocket under the diagonal (x46..49, row 20)
  const targets = new Set([g.world.key(50, 15)]); // the terrace above
  const path = findPath(g.world, g.transits, 48, 20, targets, false);
  check('a smallie under the ramp can still climb out', path !== null);

  // A worker whose very cell becomes a RAMP is not entombed and is not moved
  // either: a ramp cell is walkable, so they simply stand on the new slope.
  const park = (w, x, y) => {
    w.cx = x;
    w.cy = y;
    w.px = x;
    w.py = y;
    w.task = null;
    w.path = [];
    w.stepIdx = 0;
  };
  const w = g.workers[0];
  park(w, 45, 20); // (45,20) is one of the ramp tiles just laid
  check('the ramp really covers the test cell', g.world.get(45, 20) === T.RAMP);
  g.tick(1 / 60);
  check('a smallie built over by a ramp stays put on the slope',
    w.cx === 45 && w.cy === 20 && g.world.isStandable(45, 20));

  // A BRIDGE tile is still a solid deck, so it keeps the pop-up rescue: the
  // worker is lifted onto the first standable cell above instead of entombed.
  const w2 = g.workers[1];
  park(w2, 46, 20);
  g.world.set(46, 20, T.PLATFORM); // drop a deck straight onto them
  check('a bridge tile really covers the second test cell', g.world.isPassable(46, 20) === false);
  g.tick(1 / 60);
  check('a smallie built over by a bridge pops up on top',
    w2.cy < 20 && g.world.isStandable(w2.cx, w2.cy));
}

// ---- i18n: keys translate, params substitute, unknown text passes through -----
{
  check('default language is English', getLang() === 'en');
  check('a key resolves to English text', t('lvl5.name') === 'The Ford');
  check('params substitute', t('win.next', { name: 'X' }) === 'Next: X →');
  setLang('de');
  check('the same key resolves to German', t('lvl5.name') === 'Die Furt');
  check('tool labels translate', t('tool.lift.label') === 'Lastenaufzug');
  check('weather names translate', t('weather.storm') === 'Sturm');
  // custom level names are not keys — they must pass through unchanged
  check('non-key text passes through untouched', t("Anna's Mountain") === "Anna's Mountain");
  setLang('en');
  check('switching back restores English', t('lvl5.name') === 'The Ford');
  // every campaign level resolves in both languages (no missing dictionary rows)
  let missing = 0;
  for (const lvl of LEVELS) {
    for (const lang of ['en', 'de']) {
      setLang(lang);
      if (t(lvl.name) === lvl.name || t(lvl.desc) === lvl.desc) missing++;
      for (const h of lvl.hints ?? []) if (t(h.text) === h.text) missing++;
    }
  }
  setLang('en');
  check('every level name/desc/hint has EN and DE text', missing === 0);
}

// ---- save export/import: full round-trip, hostile input never crashes --------
{
  const level = blankLevelData();
  const save = {
    completed: [1, 2, 3],
    completedCustom: [level.id],
    records: { c1: { bestTime: 62.5, medal: 'gold', feats: ['no_demolish'] } },
    muted: true,
    lang: 'de',
    effects: 'reduced',
  };
  const text = exportAllData(save, [level]);
  const back = importAllData(text);
  check('export/import round-trips', back !== null);
  check('completed levels survive', back.save.completed.join() === '1,2,3');
  check('records survive', back.save.records.c1.bestTime === 62.5 && back.save.records.c1.medal === 'gold');
  check('settings survive', back.save.muted === true && back.save.lang === 'de' && back.save.effects === 'reduced');
  check('custom levels survive', back.customLevels.length === 1 && back.customLevels[0].id === level.id);

  // not a save file → null, never a throw
  check('plain text is rejected', importAllData('hello') === null);
  check('unrelated JSON is rejected', importAllData('{"foo":1}') === null);
  check('wrong version is rejected', importAllData(JSON.stringify({ format: 'smallhands-save', version: 99 })) === null);

  // a hostile payload behind a valid envelope is sanitized field by field
  const hostile = JSON.stringify({
    format: 'smallhands-save',
    version: 1,
    save: {
      completed: [1, 'x', null],
      records: { bad: { bestTime: -5, medal: 'gold', feats: [] } },
      muted: 'yes',
      lang: 'fr',
    },
    customLevels: [{ v: 1, id: 'broken' }],
  });
  const clean = importAllData(hostile);
  check('bogus completed entries are dropped', clean.save.completed.join() === '1');
  check('negative best times are dropped', !('bad' in clean.save.records));
  check('non-boolean muted coerces to false', clean.save.muted === false);
  check('unknown language is dropped', clean.save.lang === undefined);
  check('broken custom levels are dropped', clean.customLevels.length === 0);
}

// ---- score timer: Game.time, the hidden medal clock ------------------------
// Game.time is the run's score (medals + PBs read it after the win); it is NOT
// shown in the HUD anymore — the clock chip renders timeOfDay instead (below).
// Time is summed per tick, so it stretches with the speed multiplier (4× = four
// ticks a frame) and holds whenever the sim isn't ticking — pause and the win
// both freeze it. fmtTime still formats it for the win ceremony.
{
  check('fresh level starts at 0:00', fmtTime(new Game(LEVELS[0]).time) === '0:00');
  check('seconds pad to two digits', fmtTime(9) === '0:09');
  check('minutes roll over', fmtTime(75) === '1:15');
  check('hours only appear past an hour', fmtTime(3725) === '1:02:05');
  check('a partial second floors', fmtTime(59.9) === '0:59');
  check('negative time never renders', fmtTime(-5) === '0:00');

  const g = new Game(LEVELS[0]);
  const run = (secs, dt = 1 / 60) => {
    for (let i = 0; i < secs / dt; i++) g.tick(dt);
  };
  run(10);
  check('clock tracks ticked time', Math.abs(g.time - 10) < 0.05);
  check('clock renders the elapsed run', fmtTime(g.time) === '0:10');

  // pause is the sim's own guard; main.ts also stops calling tick at speed 0
  g.paused = true;
  run(5);
  check('paused clock holds', Math.abs(g.time - 10) < 0.05);
  g.paused = false;
  run(5);
  check('unpaused clock resumes', Math.abs(g.time - 15) < 0.05);

  // the win freezes the clock at the final time — medals and PBs read it after
  g.won = true;
  run(5);
  check('won clock freezes at the final time', Math.abs(g.time - 15) < 0.05);

  // restart is a fresh Game, so the clock resets with no reset code
  check('restart resets the clock', new Game(LEVELS[0]).time === 0);
}

// ---- time of day: the diegetic HUD clock, decoupled from the score ----------
// game.timeOfDay is the wall-clock hour the chip shows. It is static for now:
// noon on a day map, midnight on a night map, and it does NOT advance with
// ticks (a moving day→night cycle is a later phase — card #36).
{
  check('day map opens at noon', new Game(LEVELS[0]).timeOfDay === DAY_HOUR);

  const nightLevel = LEVELS.find((l) => l.night);
  check('a night map exists to test', !!nightLevel);
  if (nightLevel) check('night map opens at midnight', new Game(nightLevel).timeOfDay === NIGHT_HOUR);

  // startHour overrides the day/night default
  check('startHour overrides the default', new Game({ ...LEVELS[0], startHour: 7 }).timeOfDay === 7);

  // ticking the sim advances the score timer but NOT the time-of-day clock
  const g = new Game(LEVELS[0]);
  for (let i = 0; i < 600; i++) g.tick(1 / 60); // ~10s
  check('ticks advance the score timer', Math.abs(g.time - 10) < 0.05);
  check('ticks do NOT move the time-of-day clock', g.timeOfDay === DAY_HOUR);

  // fmtClock renders a zero-padded 24h wall time and wraps the day
  check('fmtClock pads the hour', fmtClock(9) === '09:00');
  check('fmtClock renders noon', fmtClock(12) === '12:00');
  check('fmtClock renders half hours', fmtClock(6.5) === '06:30');
  check('fmtClock renders midnight', fmtClock(0) === '00:00');
  check('fmtClock wraps past midnight', fmtClock(25) === '01:00');
}

// ---- Stranded-goods detector ------------------------------------------------
// A dropped item is "stranded" when a LOADED hauler could never carry it to any
// accepting sink. We build a fully isolated shelf (an air moat on both sides) so
// the geometry is deterministic and independent of Level 1's terrain.
function islandShelf(g) {
  const W = g.world;
  const gy = 20; // floor row of the shelf
  const L = g.townhall.x + 12;
  const R = L + 6;
  // air moat from the sky to just above the world floor across L-1..R+1
  for (let x = L - 1; x <= R + 1; x++) for (let y = 0; y < W.h - 1; y++) W.set(x, y, T.AIR);
  // a short solid floor for L..R only — nothing can walk or be carried on/off it
  for (let x = L; x <= R; x++) W.set(x, gy, T.DIRT);
  return { gy, L, R };
}

{
  const g = new Game(LEVELS[0]); // objective is plank; stone is nobody's sink
  const { gy, L } = islandShelf(g);
  g.dropItem('stone', L + 3, gy - 1);
  for (let i = 0; i < 60 * 4; i++) g.tick(1 / 60); // past the 3s grace
  check('stone marooned on an island is flagged stranded',
    g.strandedGroundItems().some((gi) => gi.item === 'stone'));
}

{
  const g = new Game(LEVELS[0]);
  const { gy, L } = islandShelf(g);
  // a log with no consumer on the shelf is stranded...
  g.dropItem('log', L + 4, gy - 1);
  for (let i = 0; i < 60 * 4; i++) g.tick(1 / 60);
  check('a log with no reachable sink is stranded',
    g.strandedGroundItems().some((gi) => gi.item === 'log'));
  // ...a ready sawmill on the SAME shelf eats logs, so a local sink is now
  // reachable without leaving the shelf → no longer stranded.
  g.addBuilding('sawmill', L + 1, gy - 2, true);
  for (let i = 0; i < 60 * 2; i++) g.tick(1 / 60);
  check('a consuming building on the same shelf clears the stranded flag',
    !g.strandedGroundItems().some((gi) => gi.item === 'log'));
}

{
  const g = new Game(LEVELS[0]);
  // a stone dropped by the town hall reaches the stockpile fine — never stranded
  g.dropItem('stone', g.townhall.x + 3, g.townhall.y);
  for (let i = 0; i < 60 * 4; i++) g.tick(1 / 60);
  check('a reachable drop is never flagged stranded',
    !g.strandedGroundItems().some((gi) => gi.item === 'stone'));
}

{
  // Level 10 has hoist unlocked (thLevel 2) with starting stock that already
  // covers its cost, so no manual stock/thLevel hacking is needed.
  const g = new Game(LEVELS[9]);
  const { gy, L } = islandShelf(g);
  // Anchor the hoist's upper post right on the shelf's edge. placeHoist runs the
  // real rope-drop validation (a standable cliff edge with a clear >=3-tile fall),
  // which the shelf's air moat satisfies on both sides — a genuine placement, not
  // a hand-rolled one.
  check('hoist placement succeeds on the shelf edge', g.placeHoist(L, gy - 1));
  const hoist = g.buildings.find((b) => b.kind === 'hoist');
  hoist.state = 'ready'; // skip the builder-construction step; only READY matters here
  // The item sits on the shelf at the hoist's UPPER station (b.x, b.y), so
  // routing the 'upper' car — which sets hoistSendDown, per tryAssignHaul's
  // ['upper', b.hoistSendDown, ...] mapping — is the shelf's real way out.
  // This is a genuine reachability flip via the real toggleHoistRoute API,
  // not a forced/hand-set internal flag.
  g.toggleHoistRoute(hoist.id, 'upper', 'log');
  g.dropItem('log', L + 3, gy - 1);
  for (let i = 0; i < 60 * 4; i++) g.tick(1 / 60); // past the 3s grace
  check('an item reachable via a ROUTED ready hoist station is not flagged stranded',
    !g.strandedGroundItems().some((gi) => gi.item === 'log'));
}

{
  // Identical shelf + ready hoist, but never routed: tryAssignHaul would never
  // load this car for 'log' (hoistSendDown['log'] stays false/undefined), so
  // the detector must agree the item is genuinely stuck — this is what proves
  // the routing gate actually gates (an unrouted hoist is not a real exit).
  const g = new Game(LEVELS[9]);
  const { gy, L } = islandShelf(g);
  check('hoist placement succeeds on the shelf edge (unrouted case)', g.placeHoist(L, gy - 1));
  const hoist = g.buildings.find((b) => b.kind === 'hoist');
  hoist.state = 'ready'; // skip the builder-construction step; only READY matters here — no route configured
  g.dropItem('log', L + 3, gy - 1);
  for (let i = 0; i < 60 * 4; i++) g.tick(1 / 60); // past the 3s grace
  check('an item at an UNROUTED ready hoist station is still flagged stranded',
    g.strandedGroundItems().some((gi) => gi.item === 'log'));
}

{
  // The `!` glyph is drawn ONE tile ABOVE the item (render.ts drawStrandedMarkers
  // draws at gi.y - 1), so the hover/tap hit-target must resolve on BOTH the
  // item's own tile and the glyph's tile above it — otherwise hovering the
  // visible warning shows no reason and the affordance is inert.
  const g = new Game(LEVELS[0]);
  const { gy, L } = islandShelf(g);
  g.dropItem('stone', L + 3, gy - 1);
  for (let i = 0; i < 60 * 4; i++) g.tick(1 / 60); // past the 3s grace
  const gi = g.strandedGroundItems().find((item) => item.item === 'stone');
  check('a stranded item exists before hit-target checks', !!gi);
  check('strandedItemAt matches the item\'s own tile', g.strandedItemAt(gi.x, gi.y) === gi);
  check('strandedItemAt matches the glyph tile one row above', g.strandedItemAt(gi.x, gi.y - 1) === gi);
  check('strandedItemAt misses an unrelated tile', g.strandedItemAt(gi.x + 5, gi.y) === undefined);
}

// ---- Locate-on-map resolver -------------------------------------------------
// A helper to build a ResourceNode literal (all fields required by the type).
function node(id, kind, x, y) {
  return { id, kind, x, y, yieldLeft: 4, marked: false, workerId: null, wobble: 0 };
}

{
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.nodes.length = 0; // deterministic: only the two veins we place
  g.nodes.push(node(9001, 'vein', th.x + 3, th.y));
  g.nodes.push(node(9002, 'vein', th.x + 12, th.y));
  const r = g.locateItem('iron');
  check('locateItem(iron) points at the nearest vein',
    !!r && r.kind === 'node' && r.x === th.x + 3 && r.y === th.y);
}

{
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.addBuilding('forge', th.x + 5, th.y, true); // ready forge produces spear
  const r = g.locateItem('spear');
  check('locateItem(spear) points at the forge that makes it',
    !!r && r.kind === 'building' && r.x === th.x + 5 && r.y === th.y);
}

{
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.buildings = g.buildings.filter((b) => b.kind !== 'sawmill'); // no plank producer
  g.nodes.length = 0;
  g.nodes.push(node(9101, 'tree', th.x + 4, th.y)); // logs come from here
  const r = g.locateItem('plank');
  check('locateItem(plank) with no sawmill points at a log source (input)',
    !!r && r.kind === 'input' && r.x === th.x + 4 && r.y === th.y);
}

{
  const g = new Game(LEVELS[0]);
  g.nodes.length = 0; // no veins; iron is not craftable
  const r = g.locateItem('iron');
  check('locateItem(iron) with no vein and no producer returns null', r === null);
}

{
  // The four tests above all place their vein at th.y — above the surface,
  // where nodeApproachCells is always empty — so every one of them resolves
  // through the straight-line FALLBACK branch of nearestNodeOfKind, never the
  // reachable/path-cost branch. This test builds a case only the reachable
  // branch can pass: the straight-line-nearest vein is unreachable (embedded
  // in solid rock, no approach cell at all) while a farther vein sits on real
  // open ground and is genuinely path-reachable. If locateItem instead used
  // (or fell back to) straight-line distance, it would return the nearer,
  // unreachable vein — so a correct answer here proves the path-cost search
  // ran and ranked correctly.
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.nodes.length = 0;

  // Unreachable vein: buried in solid rock straight down from the town hall.
  // Scan down from th.y (which is above the surface) to the first solid row,
  // then a few tiles deeper to land comfortably inside rock rather than the
  // thin dirt band — solid on every side, so nodeApproachCells is empty and
  // this vein can never be a path-cost candidate.
  let ry = th.y;
  while (ry < g.world.h - 1 && g.world.isPassable(th.x, ry)) ry++; // first solid (surface) row
  ry = Math.min(ry + 3, g.world.h - 2); // a few tiles deeper into solid rock
  const buried = node(9201, 'vein', th.x, ry);
  check('reachable-branch setup: the buried vein has no approach cells',
    nodeApproachCells(g.world, buried.x, buried.y).size === 0);

  // Reachable vein: real open ground, farther away in a straight line. Scan
  // down from th.y for the first standable row at this column.
  const col = th.x + 8;
  let gy = th.y;
  while (gy < g.world.h - 1 && !g.world.isStandable(col, gy)) gy++;
  const grounded = node(9202, 'vein', col, gy);

  const dBuried = (buried.x - th.x) ** 2 + (buried.y - th.y) ** 2;
  const dGrounded = (grounded.x - th.x) ** 2 + (grounded.y - th.y) ** 2;
  check('reachable-branch setup: the grounded vein is farther away in a straight line',
    dGrounded > dBuried);

  g.nodes.push(buried, grounded);
  const r = g.locateItem('iron');
  check('locateItem(iron) picks the farther REACHABLE vein over the nearer buried one',
    !!r && r.kind === 'node' && r.x === grounded.x && r.y === grounded.y);

  // Prove the setup genuinely distinguishes the branches: remove the
  // reachable vein and the straight-line fallback takes over, returning the
  // nearer buried vein instead — showing the assertion above could only have
  // passed because the reachable/path-cost branch ran and picked correctly.
  g.nodes = g.nodes.filter((n) => n.id !== grounded.id);
  const r2 = g.locateItem('iron');
  check('removing the reachable vein falls back to the nearer buried one',
    !!r2 && r2.kind === 'node' && r2.x === buried.x && r2.y === buried.y);
}

// ---- Locate finds harvested resources too (card #57) ------------------------
// A mined-out vein used to make locateItem return null, so the HUD said "No
// Iron source on this map." on a level that shipped exactly the iron the order
// needed. The resolver must instead follow the iron that already exists — on the
// ground, in a hauler's hands, in a buffer, in the store — and, failing all of
// that, point at the dead vein so the copy can say "used up", not "never here".

// A spent node literal: the map HAD this source, it is worked out.
function spentNode(id, kind, x, y) {
  const n = node(id, kind, x, y);
  n.yieldLeft = 0;
  return n;
}

{
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.nodes.length = 0;
  g.nodes.push(spentNode(9301, 'vein', th.x + 6, th.y));
  g.stock.iron = 0;
  const r = g.locateItem('iron');
  check('locateItem(iron) with the only vein mined out points at the spent vein',
    !!r && r.kind === 'spent' && r.x === th.x + 6 && r.y === th.y);
}

{
  // A live vein must still outrank iron lying around — the source is the answer
  // to "where do I get more", the dropped unit is only the fallback.
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.nodes.length = 0;
  g.nodes.push(node(9302, 'vein', th.x + 9, th.y));
  g.dropItem('iron', th.x + 1, th.y);
  const r = g.locateItem('iron');
  check('a live vein still wins over a dropped iron', !!r && r.kind === 'node' && r.x === th.x + 9);
}

{
  // The repro shape: vein worked out, the iron it yielded is lying on the map.
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.nodes.length = 0;
  g.nodes.push(spentNode(9303, 'vein', th.x + 6, th.y));
  g.stock.iron = 0;
  g.dropItem('iron', th.x + 3, th.y);
  const gi = g.groundItems.find((it) => it.item === 'iron');
  const r = g.locateItem('iron');
  check('the dropped iron exists as a ground item', !!gi);
  check('a spent vein plus dropped iron points at the iron on the ground',
    !!r && r.kind === 'item' && !!gi && r.x === gi.x && r.y === gi.y);
}

{
  // Iron parked in a forge's input buffer is still iron on the map.
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.nodes.length = 0;
  g.nodes.push(spentNode(9304, 'vein', th.x + 6, th.y));
  g.stock.iron = 0;
  const forge = g.addBuilding('forge', th.x + 4, th.y, true);
  forge.inputs.iron = 1;
  const r = g.locateItem('iron');
  check('iron in a producer input buffer is located at that producer',
    !!r && r.kind === 'item' && r.x === th.x + 4 && r.y === th.y);
}

{
  // A hauler mid-route counts too — the iron is in its hands, not nowhere.
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.nodes.length = 0;
  g.nodes.push(spentNode(9305, 'vein', th.x + 6, th.y));
  g.stock.iron = 0;
  const w = g.workers[0];
  w.carrying = 'iron';
  const r = g.locateItem('iron');
  check('iron in a smallie\'s hands is located at that smallie',
    !!r && r.kind === 'item' && r.x === w.cx && r.y === w.cy);
}

{
  // Nothing out in the world, but the store holds some: least useful answer, so
  // it comes last — after the spent node has had its chance… which means with a
  // spent node present the node wins, and with none the store answers. It gets
  // its OWN kind: a ring on your own town hall needs its own line of copy.
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.nodes.length = 0;
  g.stock.iron = 3;
  const r = g.locateItem('iron');
  check('iron only in the store is located at the town hall, kind store',
    !!r && r.kind === 'store' && r.x === th.x && r.y === th.y);
  g.stock.iron = 0;
  check('no vein, no iron anywhere → still null (locate.none is honest here)',
    g.locateItem('iron') === null);
}

{
  // PR #83 review, finding 1: a 'spent' verdict reached THROUGH the recipe must
  // survive the recursion, or a spear request whose iron is mined out pans onto
  // a rubble mark in silence. The result also has to name the spent item (iron),
  // not the requested one (spear), or the toast lies.
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.buildings = g.buildings.filter((b) => b.kind !== 'forge'); // no spear producer
  g.nodes.length = 0;
  g.nodes.push(spentNode(9401, 'vein', th.x + 7, th.y));
  g.stock.iron = 0;
  g.stock.plank = 5; // iron is the scarcest input → the recursion targets iron
  const r = g.locateItem('spear');
  check('a spent source reached through the recipe stays kind spent',
    !!r && r.kind === 'spent' && r.x === th.x + 7 && r.y === th.y);
  check('…and names the item that is actually used up', !!r && r.item === 'iron');
}

{
  // PR #83 review, finding 2: for a produced item with no producer, "here is the
  // input you still need" beats "here is one stray unit someone dropped".
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.buildings = g.buildings.filter((b) => b.kind !== 'sawmill'); // no plank producer
  g.nodes.length = 0;
  g.nodes.push(node(9402, 'tree', th.x + 4, th.y));
  g.dropItem('plank', th.x + 1, th.y); // a single stray plank, much nearer
  const r = g.locateItem('plank');
  check('a stray plank does not outrank the log source a plank is made from',
    !!r && r.kind === 'input' && r.x === th.x + 4 && r.y === th.y);
  check('the input answer names the input item', !!r && r.item === 'log');
}

{
  // Raw items keep the opposite precedence: nothing produces iron, so an iron
  // lying on the map IS the answer once the veins are worked out.
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.nodes.length = 0;
  g.nodes.push(spentNode(9403, 'vein', th.x + 7, th.y));
  g.stock.iron = 0;
  g.dropItem('iron', th.x + 2, th.y);
  const gi = g.groundItems.find((it) => it.item === 'iron');
  const r = g.locateItem('iron');
  check('dropped iron still outranks the spent vein for a raw item',
    !!r && r.kind === 'item' && !!gi && r.x === gi.x && r.y === gi.y);
}

{
  // Stranded iron outranks freely haulable iron even when it is farther away:
  // the stuck unit is the one the player has to act on (build a lift), so that
  // is where the camera should go.
  const g = new Game(LEVELS[9]);
  const th = g.townhall;
  const { gy, L } = islandShelf(g);
  g.nodes.length = 0;
  g.nodes.push(spentNode(9306, 'vein', th.x + 2, th.y));
  g.stock.iron = 0;
  g.dropItem('iron', L + 3, gy - 1); // on the cut-off shelf → stranded
  g.dropItem('iron', th.x + 1, th.y); // right by the town hall → haulable
  for (let i = 0; i < 60 * 4; i++) g.tick(1 / 60); // past the 3s stranded grace
  const stranded = g.strandedGroundItems().find((it) => it.item === 'iron');
  check('the shelf iron is genuinely flagged stranded', !!stranded);
  const r = g.locateItem('iron');
  check('stranded iron outranks nearer haulable iron',
    !!r && r.kind === 'item' && !!stranded && r.x === stranded.x && r.y === stranded.y);
}

{
  // The copy has to distinguish "used up" from "never here", in both languages.
  const prev = getLang();
  for (const lang of ['en', 'de']) {
    setLang(lang);
    const none = t('locate.none', { name: t('item.iron') });
    for (const key of ['locate.spent', 'locate.inStore']) {
      const line = t(key, { name: t('item.iron') });
      check(`${key} is translated in ${lang}`, line !== key && line.length > 0);
      check(`${key} names the item in ${lang}`, line.includes(t('item.iron')));
      check(`${key} differs from locate.none in ${lang}`, line !== none);
    }
    check(`locate.spent and locate.inStore differ in ${lang}`,
      t('locate.spent', { name: 'X' }) !== t('locate.inStore', { name: 'X' }));
  }
  setLang(prev);
}

// ---- Producer pause hint reflects state (card #44 follow-up) ----------------
// The hover hint must read as an action and match the producer's state — pause
// while running, resume while already paused — and use the click/tap verb the
// caller passes. The old copy always said "pause", even on a paused producer.
{
  const prev = getLang();
  setLang('en');
  const pauseEn = t('producer.hintPause', { verb: 'Click' });
  const resumeEn = t('producer.hintResume', { verb: 'Click' });
  check('EN pause hint: how to pause via Inspect',
    pauseEn.includes('Inspect') && /to pause/i.test(pauseEn) && !/to resume/i.test(pauseEn));
  check('EN resume hint: how to resume via Inspect',
    resumeEn.includes('Inspect') && /to resume/i.test(resumeEn));
  check('hint interpolates the click/tap verb',
    pauseEn.startsWith('Click') && resumeEn.startsWith('Click'));
  setLang('de');
  const pauseDe = t('producer.hintPause', { verb: 'anklicken' });
  const resumeDe = t('producer.hintResume', { verb: 'anklicken' });
  check('DE pause hint: pausieren + Prüfen + verb',
    /pausier/i.test(pauseDe) && pauseDe.includes('Prüfen') && pauseDe.includes('anklicken'));
  check('DE resume hint: fortsetzen', /fortsetzen/i.test(resumeDe));
  setLang(prev);
}

{
  // Pausing a producer mid-batch aborts the in-flight batch and refunds its
  // input, so pausing spends zero raw goods (card #44 follow-up: pause must
  // halt IMMEDIATELY, not finish the batch it was already running).
  const g = new Game(LEVELS[0]);
  g.workers.length = 0; // isolate: no haulers moving goods in/out of the buffers
  for (const k in g.stock) g.stock[k] = 0;
  const saw = g.addBuilding('sawmill', 40, 16, true); // ready sawmill
  saw.inputs = { log: 2 };

  // start a batch and catch it mid-conversion (recipe time = 3.5s)
  for (let i = 0; i < 60; i++) g.tick(1 / 60); // 1s
  check('sawmill runs a batch: one log spent, processing',
    saw.processing === true && (saw.inputs.log ?? 0) === 1);

  g.toggleProducerPause(saw.id);
  check('pause aborts the in-flight batch immediately', saw.processing === false);
  check('pause refunds the in-flight log — 0 raw goods spent', (saw.inputs.log ?? 0) === 2);

  for (let i = 0; i < 60 * 5; i++) g.tick(1 / 60); // 5s paused
  check('paused: no planks produced and both logs held',
    (saw.outputs.plank ?? 0) === 0 && (saw.inputs.log ?? 0) === 2);

  g.toggleProducerPause(saw.id); // resume
  for (let i = 0; i < 60 * 5; i++) g.tick(1 / 60); // 5s running
  check('resume: conversion restarts (log consumed, planks made)',
    (saw.inputs.log ?? 0) < 2 && (saw.outputs.plank ?? 0) >= 2);
}

// ---- Producer idle status names its own cause (card #51) -------------------
// The reported confusion: a sawmill showing a bare "Idle · ready" while no logs
// turn into planks. Game.producerStatus is the shared policy behind the inspect
// panel + hover tooltip; it must distinguish WHY a ready producer isn't running,
// and a full output buffer must actually stall the line (matching tickBuildings).
{
  const g = new Game(LEVELS[0]);
  g.workers.length = 0; // isolate: no haulers moving goods in/out of the buffers
  for (const k in g.stock) g.stock[k] = 0;
  const saw = g.addBuilding('sawmill', 40, 16, true); // ready sawmill
  saw.inputs = {};
  saw.inbound = {};
  saw.outputs = {};

  check('producerStatus: empty buffer → needs log (not delivering)', (() => {
    const s = g.producerStatus(saw);
    return s.kind === 'needs' && s.item === 'log' && s.delivering === false;
  })());

  saw.inbound = { log: 1 };
  check('producerStatus: a log inbound → needs log, delivering', (() => {
    const s = g.producerStatus(saw);
    return s.kind === 'needs' && s.item === 'log' && s.delivering === true;
  })());

  saw.inbound = {};
  saw.inputs = { log: 1 };
  check('producerStatus: input buffered, output empty → ready',
    g.producerStatus(saw).kind === 'ready');

  saw.outputs = { plank: 6 }; // at PRODUCER_OUTPUT_CAP
  check('producerStatus: output buffer full → output-full (takes precedence over ready)',
    g.producerStatus(saw).kind === 'output-full');

  saw.paused = true;
  check('producerStatus: paused wins over everything', g.producerStatus(saw).kind === 'paused');
  saw.paused = false;

  // and the cap actually gates the sim: a full output buffer stops new batches,
  // then clearing it lets conversion resume (this is why logs "stopped" becoming
  // planks — the line had backed up, not broken).
  saw.processing = false;
  saw.processT = 0;
  saw.inputs = { log: 2 };
  saw.outputs = { plank: 6 };
  for (let i = 0; i < 60; i++) g.tick(1 / 60); // 1s
  check('output full stalls the line: no batch starts, no log spent',
    saw.processing === false && (saw.inputs.log ?? 0) === 2);

  saw.outputs = { plank: 0 }; // haulers carried the planks off
  for (let i = 0; i < 60; i++) g.tick(1 / 60); // 1s
  check('clearing the output resumes conversion (log consumed)',
    (saw.inputs.log ?? 0) < 2 && (saw.processing === true || (saw.outputs.plank ?? 0) >= 2));
}

// ---- the sim is deterministic: same seed, same run (card #65) ---------------
// The sim's randomness lives in two seeded streams, both private: `rand`, drawn
// only by the idle wander, and `randFx` for cosmetics. That split is what makes a
// play-to-a-win suite (hoist, campaign1-4, digging) a proof rather than a sample:
// an unseeded draw inside the tick used to shift the wander, which shifts who is
// nearest when the next task opens, which shifts the timing of the whole run —
// hoist red-flagged about 1 run in 20 that way — and a shared stream would let the
// UI painting a particle do the same thing from outside the sim entirely.
{
  // Two comparators, because the two streams answer different questions.
  //   behaviour — what the sim DID. No cosmetic fields, so a claim made with this
  //     is a claim about `rand` alone. `facing` is excluded deliberately: it is an
  //     fx draw at spawn, and although movement overwrites it a moment later (so it
  //     tracks behaviour in practice), resting an assertion on that coincidence
  //     would let a cosmetic difference stand in for a behavioural one.
  //   fingerprint — behaviour plus the cosmetics, for the replay claims, which
  //     should hold for both streams at once.
  const behaviour = (g) =>
    JSON.stringify({
      time: Math.round(g.time * 1000),
      stock: g.stock,
      won: g.won,
      workers: g.workers.map((w) => [w.role, w.cx, w.cy, w.carrying, w.task?.kind ?? null]),
      ground: g.groundItems.map((gi) => [gi.item, gi.x, gi.y]),
      objectives: g.objectives.map((o) => [o.item, o.delivered, o.inbound]),
    });
  // The cosmetic half. `animT` carries it: an fx draw at spawn (`sim.ts` ~1013) that
  // only ever accumulates (`+= dt`), so the random offset survives the whole run.
  // `facing` alone would not — movement overwrites it within a step or two, leaving
  // every claim below resting on behaviour and saying nothing about `randFx`.
  const cosmetics = (g) => JSON.stringify(g.workers.map((w) => [w.facing, Math.round(w.animT * 1000)]));
  const fingerprint = (g) => JSON.stringify([behaviour(g), cosmetics(g)]);

  const play = (seed) => {
    const g = seed === undefined ? new Game(LEVELS[0]) : new Game(LEVELS[0], seed);
    for (let i = 0; i < 60 * 90; i++) g.tick(1 / 60); // 90 sim-seconds
    return g;
  };

  check('the same seed replays the same run exactly', fingerprint(play('proof')) === fingerprint(play('proof')));
  // Divergence is asserted per stream, and replay alone cannot stand in for it: a
  // stream wired to a constant is perfectly reproducible while ignoring the seed
  // entirely, so each stream needs its own "the seed actually drives this" claim.
  check('a different seed really is a different run', behaviour(play('proof')) !== behaviour(play('other')));
  // The fx stream has to be sampled at spawn, before the first tick. A cosmetic read
  // from the END of a run cannot isolate it: `animT` accumulates at behaviour-dependent
  // rates (`dt * 6` walking, `dt * 2` falling) and `facing` is overwritten by movement,
  // so two runs would differ in cosmetics purely because `rand` sent them different
  // ways — and a `randFx` wired to a constant would still look seed-driven. At tick 0
  // the two games are identical apart from their streams, so this is a claim about
  // `randFx` and nothing else.
  const spawnFx = (seed) => cosmetics(new Game(LEVELS[0], seed));
  check('…and it re-rolls the cosmetic stream too', spawnFx('proof') !== spawnFx('other'));
  // the default seed is the level id, so a suite that passes no seed is still reproducible
  check('no seed still means a reproducible run', fingerprint(play(undefined)) === fingerprint(play(LEVELS[0].id)));

  // And the hole stays shut. The sweep is written as an EXEMPTION list, not a list
  // of files to check: everything under src/game and src/engine is swept — recursively,
  // so splitting this 2400-line sim into `sim/*.ts` stays covered — unless it is named
  // here. A module added to the tick path later is therefore covered by default, and
  // exempting one is a deliberate, reviewable act rather than an omission nobody
  // notices. src/engine is in scope even though the tick path imports nothing from it
  // today: that is exactly the kind of fact that changes quietly.
  //
  // Two sources of nondeterminism, two narrow exemption sets — a file allowed to roll
  // dice is not thereby allowed to read the clock, and vice versa. Wall-clock reads are
  // swept alongside `Math.random` because they are the other documented way a tick stops
  // being reproducible; nothing on the tick path uses either today.
  //
  // Exemptions name a PATH, not a basename: a `src/engine/render.ts` added later must
  // not inherit `src/game/render.ts`'s licence to roll dice on day one.
  //
  // May draw entropy (none of them can move a smallie): render.ts and motion.ts are
  // look-physics, generator.ts mints level seeds (`randomSeed`) around its own seeded
  // Rng, leveldata.ts mints custom-level ids, audio.ts jitters playback.
  const ENTROPY_OK = new Set([
    'game/render.ts',
    'game/motion.ts',
    'game/generator.ts',
    'game/leveldata.ts',
    'engine/audio.ts',
  ]);
  // May read the wall clock: dailylog.ts walks calendar days, generator.ts derives the
  // daily seed from today's date, leveldata.ts stamps custom-level ids, report-ui.ts
  // stamps a report's generatedAt.
  const CLOCK_OK = new Set(['game/dailylog.ts', 'game/generator.ts', 'game/leveldata.ts', 'game/report-ui.ts']);
  const NONDETERMINISM = [
    { what: 'unseeded randomness', re: /Math\s*\.\s*random\s*\(/, allowed: ENTROPY_OK },
    { what: 'the wall clock', re: /Date\s*\.\s*now\s*\(|performance\s*\.\s*now\s*\(|new\s+Date\s*\(/, allowed: CLOCK_OK },
  ];

  // Reads the *code*, not the prose, so the doc line in sim.ts explaining why the
  // file no longer calls the global can't red this. The `[^:]` guard keeps a `//`
  // inside a URL from blanking the rest of its line (`https://…` used to hide any
  // later call on that same line). A `//` inside some other string literal would
  // still over-strip — accepted: it can only ever hide a call on that one line, and
  // the count check below is a second net.
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/gm, '$1 ');

  const srcRoot = new URL('../src/', import.meta.url);
  const tsUnder = (dir) =>
    readdirSync(new URL(`${dir}/`, srcRoot), { recursive: true })
      .map((f) => `${dir}/${f}`.replaceAll('\\', '/'))
      .filter((f) => f.endsWith('.ts'));
  // EVERY file is read; the exemptions apply per pattern, so an entropy-exempt file is
  // still swept for clock reads (and vice versa) instead of dropping out altogether.
  const swept = [...tsUnder('game'), ...tsUnder('engine')].sort();
  const code = new Map(swept.map((f) => [f, stripComments(readFileSync(new URL(f, srcRoot), 'utf8'))]));
  check(
    `the sweep reads every .ts under src/game + src/engine (${swept.length} files)`,
    ['game/sim.ts', 'game/nav.ts', 'game/world.ts', 'game/types.ts', 'engine/save.ts'].every((f) => swept.includes(f))
  );
  // An exemption must name a real file AND still be needed. Existence alone isn't
  // enough: one whose file stopped rolling dice (or reading the clock) would sit in
  // the set forever, quietly licensing a future re-introduction — an exemption that
  // shields nothing is indistinguishable from cover until the day it matters.
  const stale = [...ENTROPY_OK, ...CLOCK_OK].filter((e) => !swept.includes(e));
  check(`no stale exemptions${stale.length ? `: ${[...new Set(stale)].join(', ')}` : ''}`, stale.length === 0);
  const unneeded = NONDETERMINISM.flatMap(({ what, re, allowed }) =>
    [...allowed].filter((f) => code.has(f) && !re.test(code.get(f))).map((f) => `${f} (${what})`)
  );
  check(
    `every exemption is still earning it${unneeded.length ? ` — no longer needed: ${unneeded.join(', ')}` : ''}`,
    unneeded.length === 0
  );

  for (const { what, re, allowed } of NONDETERMINISM) {
    const strays = swept.filter((f) => !allowed.has(f) && re.test(code.get(f)));
    check(
      `nothing on the tick path draws ${what}${strays.length ? ` — found in ${strays.join(', ')}` : ` (${allowed.size} files exempt)`}`,
      strays.length === 0
    );
  }

  // …and the split holds: cosmetics draw from `randFx`, so painting particles can
  // never perturb behaviour. This is not academic — `spawnBurst` is public and the
  // UI calls it (win confetti, harvest-flag sparks in main.ts), so on one shared
  // stream a click that changes no sim state would shift the wander and reorder
  // assignments: render feeding back into the sim. Two guards, source and effect.
  // Counted across every swept file, so a `rand(` call added in a sibling module is
  // caught too. `randFx(` deliberately doesn't match.
  const behaviouralDraws = swept
    .map((f) => (code.get(f).match(/(?<![A-Za-z])rand\s*\(/g) ?? []).length)
    .reduce((a, b) => a + b, 0);
  check(`only the idle wander draws from the behavioural stream (${behaviouralDraws} draws)`, behaviouralDraws === 2);

  // The count alone is not enough, because it matches an identifier: hand `this.rand`
  // to a helper that names its parameter `roll` and the draw happens with the count
  // still reading 2. `rand` is `private readonly`, so the stream can only escape by
  // being passed or aliased — every legitimate mention is either a call (`this.rand(`)
  // or the constructor's own assignment (`this.rand =`), and anything else is an escape.
  const escapes = swept.flatMap((f) => {
    const hits = code.get(f).match(/this\s*\.\s*rand\b(?!\s*[(=])/g) ?? [];
    return hits.length ? [`${f} (${hits.length})`] : [];
  });
  check(
    `the behavioural stream is never handed out of the sim${escapes.length ? ` — passed or aliased in ${escapes.join(', ')}` : ''}`,
    escapes.length === 0
  );

  // Twin runs, one of them painting bursts from outside the tick exactly as a flag
  // click does, compared with the same behaviour-only comparator used above (the
  // painted run's `facing` legitimately differs — that is the fx stream doing its job).
  // `painted` counts particles the burst actually ADDED. Reading `particles.length > 0`
  // after a `spawnBurst(…, 10)` would be a tautology, not a witness — it cannot fail,
  // so it could never tell us the fx work really happened.
  let particlesPainted = 0;
  const twin = (paint) => {
    const g = new Game(LEVELS[0], 'twin');
    for (let i = 0; i < 60 * 90; i++) {
      g.tick(1 / 60);
      if (paint && i % 137 === 0) {
        const before = g.particles.length;
        g.spawnBurst(3, 3, '#ffd94d', 10); // a UI-side cosmetic, mid-run
        particlesPainted += g.particles.length - before;
      }
    }
    return g;
  };
  const quiet = behaviour(twin(false));
  const painted = behaviour(twin(true));
  check(`the cosmetic bursts really painted (${particlesPainted} particles added)`, particlesPainted === 40 * 10);
  check('a UI-side cosmetic burst cannot change behaviour', quiet === painted);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
