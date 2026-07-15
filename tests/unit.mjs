// Fast headless unit checks for pure sim logic — no browser needed.
// Bundles the TypeScript sources with rolldown (see bundle.mjs) and imports
// the result from an in-memory data URL, so it runs with plain `node`.
import { bundleExports } from './bundle.mjs';

const mod = await bundleExports(`
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
  export { canPlaceLadder } from './src/game/world.ts';
  export { findPath } from './src/game/nav.ts';
  export { T } from './src/game/types.ts';
  export { t, setLang, getLang } from './src/engine/i18n.ts';
`);
const { Game, LEVELS, canPlaceLadder, findPath, T, t, setLang, getLang } = mod;

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
  check('twelve campaign levels ship', LEVELS.length === 12);
  check('level ids stay sequential', LEVELS.every((l, i) => l.id === i + 1));
  check('campaign 1 keeps its four levels', LEVELS.filter((l) => (l.campaign ?? 1) === 1).length === 4);
  check('campaign 2 brings five levels', LEVELS.filter((l) => l.campaign === 2).length === 5);
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

// ---- the rising tide: floods, sinks goods, rescues smallhands, then stops ----
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
  check('a smallhand caught by the tide scrambles home', w.cy === 19 && g.world.get(w.cx, w.cy) !== T.WATER);
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

// ---- no smallhand prison under a ramp -----------------------------------------
// A ramp run laid against a wall roofs over the floor pocket beneath its
// diagonal. Workers standing there when it lands must still be able to step
// out onto the ramp (a ramp tile overhead counts as headroom in the nav).
{
  const g = new Game(LEVELS[8]); // Tempest Summit: wall at x50, terrace floor row 20
  g.stock.plank = 10;
  check('ramp run against the wall places fully', g.placeRampRun(49, 16, 45, 20) === 5);
  // a worker in the pocket under the diagonal (x46..49, row 20)
  const targets = new Set([g.world.key(50, 15)]); // the terrace above
  const path = findPath(g.world, g.transits, 48, 20, targets, false);
  check('a smallhand under the ramp can still climb out', path !== null);

  // a worker whose very cell was built over pops up on top of the new tile
  const w = g.workers[0];
  w.cx = 45;
  w.cy = 20; // this cell is now a ramp tile
  w.px = 45;
  w.py = 20;
  w.task = null;
  w.path = [];
  w.stepIdx = 0;
  g.tick(1 / 60);
  check('a smallhand built over by a ramp pops up on top', g.world.isStandable(w.cx, w.cy));
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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
