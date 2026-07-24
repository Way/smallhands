// Headless tests for the bug/feedback report (card #58).
//
// Two things have to hold. First, the markdown has to actually contain the run
// state an agent would need. Second — the part that is easy to break — the live
// snapshot code has to round-trip: encode a mid-play world, decode it, build a
// fresh Game from it, and land on the same map.
import { bundleExports } from './bundle.mjs';

const mod = await bundleExports(`
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
  export { collectReport, formatReport, snapshotLevelData, clockString } from './src/game/report.ts';
  export { encodeShareCode, decodeShareCode, levelDefFromData, sanitizeLevelData, encodeTiles } from './src/game/leveldata.ts';
  export { T, BUILD_TIME } from './src/game/types.ts';
  export { liftTopFor, ropeDropFor } from './src/game/world.ts';
  export { t, setLang, LANGS } from './src/engine/i18n.ts';
`);
const {
  Game,
  LEVELS,
  collectReport,
  formatReport,
  snapshotLevelData,
  clockString,
  encodeShareCode,
  decodeShareCode,
  levelDefFromData,
  sanitizeLevelData,
  encodeTiles,
  T,
  BUILD_TIME,
  liftTopFor,
  ropeDropFor,
  t,
  setLang,
  LANGS,
} = mod;

let failures = 0;
function check(name, cond) {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

const CONTEXT = {
  kind: 'bug',
  message: 'my digger will not move',
  levelLabel: 'campaign 1 · level 1',
  levelName: 'First Steps',
  speed: 2,
  build: 'test',
  userAgent: 'node',
  viewport: '1280x720',
  lang: 'en',
  generatedAt: '2026-07-24T00:00:00.000Z',
};

// A level mutated the way a player would: terrain carved and built on, a ready
// producer, an unfinished blueprint, a part-harvested node, spent stock.
function playedGame() {
  const g = new Game(LEVELS[0]);
  // carve a cell and lay a ladder, so world.tiles differs from the level's own
  const th = g.townhall;
  const lx = th.x + 8;
  const ly = th.y + 2;
  g.world.set(lx, ly, T.AIR);
  g.world.set(lx, ly + 1, T.LADDER);
  // a ready producer holding an input, and a half-built one
  const mill = g.addBuilding('sawmill', th.x + 12, th.y, true);
  mill.inputs = { log: 2 };
  mill.paused = true;
  const forge = g.addBuilding('forge', th.x + 16, th.y, false);
  forge.progress = 3.5;
  // part-harvested node + spent stock + a dig order
  if (g.nodes.length) g.nodes[0].yieldLeft = 1;
  g.stock.log = 5;
  g.stock.plank = 2;
  g.digOrders.add(ly * g.world.w + lx);
  g.time = 214;
  return { g, lx, ly, mill, forge };
}

// ---- markdown carries the state ------------------------------------------------
{
  const { g } = playedGame();
  const data = collectReport(g, CONTEXT);
  const md = formatReport(data);

  check('report titles by kind', md.startsWith('# Smallhands — Bug report'));
  check("player's own words survive verbatim", md.includes('my digger will not move'));
  check('elapsed time is reported', md.includes('| elapsed | 214s |'));
  // LevelDef.name is an i18n key, so the readable name has to come from the
  // caller; both belong in the report — one for a human, one to grep with.
  check(
    'the level line carries the readable name AND the i18n key',
    md.includes('"First Steps"') && md.includes('`lvl1.name`')
  );
  check('speed comes from the caller, not the sim', md.includes('| speed | 2×'));
  check('every worker gets a row', data.workers.length === g.workers.length);
  check('a paused producer is called out', md.includes('ready (PAUSED)'));
  check('a blueprint shows progress against its build time', md.includes(`blueprint 3.5/${BUILD_TIME.forge}s`));
  check('dig orders are listed', md.includes('## Dig orders (1)'));
  check('the live code is embedded', md.includes(data.code) && data.code.startsWith('SMH1.'));
  // The code restores the world, not the instant. Saying so beats letting a
  // reader assume worker positions came back and chase a phantom difference.
  check(
    'the code section states what it does NOT restore',
    md.includes('**Restored:**') && md.includes('**Not restored**') && md.includes('worker positions')
  );
  check('sections an agent needs are all present', [
    '## What happened',
    '## Run state',
    '## Objectives',
    '## Stock',
    '## Roles',
    '## Workers',
    '## Buildings',
    '## Resource nodes',
    '## Loose items',
    '## Dig orders',
    '## Live level code',
  ].every((s) => md.includes(s)));

  const idle = formatReport(collectReport(g, { ...CONTEXT, message: '   ' }));
  check('an empty message degrades gracefully', idle.includes('_(no description given)_'));
  check('clockString renders hour-of-day', clockString(3.5) === '03:30' && clockString(24) === '00:00');
}

// ---- the snapshot code round-trips ----------------------------------------------
{
  const { g, lx, ly, mill, forge } = playedGame();
  const snap = snapshotLevelData(g);
  const decoded = decodeShareCode(encodeShareCode(snap));
  check('a snapshot code decodes', decoded !== null);
  const named = snapshotLevelData(g, 'First Steps');
  check(
    'the snapshot is named readably, not by its i18n key',
    named.name === 'First Steps (snapshot)' && !named.desc.includes('lvl1.name')
  );

  const reloaded = new Game(levelDefFromData(decoded));

  check(
    'terrain survives, including the dug cell and the ladder',
    encodeTiles(reloaded.world.tiles) === encodeTiles(g.world.tiles) &&
      reloaded.world.get(lx, ly) === T.AIR &&
      reloaded.world.get(lx, ly + 1) === T.LADDER
  );

  const millBack = reloaded.buildings.find((b) => b.kind === 'sawmill');
  check('a ready building comes back ready, at the same cell', !!millBack && millBack.state === 'ready' && millBack.x === mill.x && millBack.y === mill.y);
  check('a paused producer stays paused', !!millBack && millBack.paused === true);

  const forgeBack = reloaded.buildings.find((b) => b.kind === 'forge');
  check('a blueprint comes back mid-construction', !!forgeBack && forgeBack.state === 'blueprint' && forgeBack.progress === forge.progress);

  check('the town hall is not duplicated', reloaded.buildings.filter((b) => b.kind === 'townhall').length === 1);
  check('the goal is not duplicated', reloaded.buildings.filter((b) => b.kind === 'goal').length === 1);

  check('node yields survive', reloaded.nodes.length === g.nodes.length && reloaded.nodes[0].yieldLeft === g.nodes[0].yieldLeft);
  check('stock survives', reloaded.stock.log === 5 && reloaded.stock.plank === 2);
  check('town-hall level survives', reloaded.thLevel === g.thLevel);
}

// ---- lift and rope geometry is recomputed, not stored -----------------------------
//
// The snapshot code deliberately omits liftTopY/ropeBottomY/ropeSide, because
// they are a function of terrain the code already carries. If that assumption
// ever stops holding, every reported lift comes back the wrong length.
{
  // Level 1 is deliberately flat and has no cliff face at all; level 4 does.
  const g = new Game(LEVELS[3]);
  const findSite = (ok) => {
    for (let x = 2; x < g.world.w - 2; x++) {
      for (let y = 2; y < g.world.h - 2; y++) if (ok(x, y)) return { x, y };
    }
    return null;
  };
  const liftAt = findSite((x, y) => liftTopFor(g.world, x, y) !== null);
  // a different anchor than the lift, so the two do not share a cell
  const ropeAt = findSite((x, y) => ropeDropFor(g.world, x, y) !== null && !(liftAt && x === liftAt.x && y === liftAt.y));
  check('level 4 offers a lift site and a rope site to test with', !!liftAt && !!ropeAt);

  const lift = g.addBuilding('lift', liftAt.x, liftAt.y, true);
  lift.liftTopY = liftTopFor(g.world, liftAt.x, liftAt.y);
  lift.liftCarY = liftAt.y;
  const drop = ropeDropFor(g.world, ropeAt.x, ropeAt.y);
  const rope = g.addBuilding('rope', ropeAt.x, ropeAt.y, true);
  rope.ropeSide = drop.side;
  rope.ropeBottomY = drop.bottomY;

  const reloaded = new Game(levelDefFromData(decodeShareCode(encodeShareCode(snapshotLevelData(g)))));
  const liftBack = reloaded.buildings.find((b) => b.kind === 'lift');
  const ropeBack = reloaded.buildings.find((b) => b.kind === 'rope');
  check(
    'lift span is recomputed from terrain, matching the original',
    !!liftBack && liftBack.x === lift.x && liftBack.y === lift.y && liftBack.liftTopY === lift.liftTopY
  );
  check(
    'rope drop and side are recomputed from terrain, matching the original',
    !!ropeBack && ropeBack.ropeBottomY === rope.ropeBottomY && ropeBack.ropeSide === rope.ropeSide
  );
}

// ---- old codes still load, hostile ones do not ------------------------------------
{
  const g = new Game(LEVELS[0]);
  const snap = snapshotLevelData(g);
  // a pre-#58 code: no buildings array, no yieldLeft on nodes
  const legacy = {
    ...snap,
    buildings: undefined,
    nodes: snap.nodes.map((n) => ({ kind: n.kind, x: n.x, y: n.y })),
  };
  const back = sanitizeLevelData(JSON.parse(JSON.stringify(legacy)));
  check('a v1 code with no buildings/yieldLeft still sanitizes', back !== null);
  check('absent yieldLeft stays absent', back.nodes.every((n) => n.yieldLeft === undefined));
  check('absent buildings stays absent', back.buildings === undefined);
  const fresh = new Game(levelDefFromData(back));
  check('and nodes load at full yield', fresh.nodes.every((n) => n.yieldLeft > 0));

  const hostile = sanitizeLevelData({
    ...JSON.parse(JSON.stringify(snap)),
    buildings: [
      { kind: 'townhall', x: 1, y: 1, ready: true }, // must be dropped: has its own field
      { kind: 'goal', x: 2, y: 2, ready: true }, // ditto
      { kind: 'nonsense', x: 3, y: 3, ready: true }, // not a building
      { kind: 'sawmill', x: -5, y: 9999, ready: true }, // out of bounds
      { kind: 'forge', x: 4, y: 4, ready: false, progress: 1e9 }, // absurd progress
    ],
  });
  check('townhall/goal/unknown/out-of-bounds buildings are rejected', hostile.buildings.length === 1);
  check('blueprint progress is clamped to the build time', hostile.buildings[0].progress === BUILD_TIME.forge);

  // `BUILD_TIME[kind] !== undefined` looks like an allowlist and is not: every
  // object inherits constructor/toString/__proto__, so those kinds would sail
  // through, get persisted to localStorage by the importer, and place a
  // building whose footprint lookup resolves to an inherited function.
  const polluted = sanitizeLevelData({
    ...JSON.parse(JSON.stringify(snap)),
    buildings: [
      { kind: 'constructor', x: 4, y: 4, ready: true },
      { kind: 'toString', x: 5, y: 4, ready: true },
      { kind: '__proto__', x: 6, y: 4, ready: true },
      { kind: 'valueOf', x: 7, y: 4, ready: true },
      { kind: 'hasOwnProperty', x: 8, y: 4, ready: true },
    ],
  });
  check('inherited Object keys are not building kinds', polluted.buildings === undefined);
}

// ---- a spent node stays spent ------------------------------------------------------
//
// Depleted nodes are NOT removed from game.nodes — they stay on as stumps
// (render.ts draws 'stump' when yieldLeft is 0). A snapshot therefore has to
// carry 0 through; clamping it up to 1 hands the player back a live tree and
// quietly changes the level's resource budget.
{
  const g = new Game(LEVELS[0]);
  const tree = g.nodes.find((n) => n.kind === 'tree');
  tree.yieldLeft = 0;
  const other = g.nodes.filter((n) => n !== tree)[0];
  other.yieldLeft = 2;

  const back = new Game(levelDefFromData(decodeShareCode(encodeShareCode(snapshotLevelData(g)))));
  const treeBack = back.nodes.find((n) => n.x === tree.x && n.y === tree.y);
  const otherBack = back.nodes.find((n) => n.x === other.x && n.y === other.y);
  check('a fully harvested node comes back spent, not resurrected', treeBack.yieldLeft === 0);
  check('a partly harvested node keeps its exact remainder', otherBack.yieldLeft === 2);
  check(
    'the reloaded level cannot be over-harvested',
    back.nodes.reduce((s, n) => s + n.yieldLeft, 0) === g.nodes.reduce((s, n) => s + n.yieldLeft, 0)
  );
}

// ---- the level's *type* survives ----------------------------------------------------
//
// night/dayNight/weather/flood live on LevelDef, not in the tile grid. Without
// them a snapshot of a flood level reloads as a calm day map and the reported
// bug cannot happen again.
{
  const flood = LEVELS.find((l) => l.flood);
  const night = LEVELS.find((l) => l.night);
  const weather = LEVELS.find((l) => l.weather?.length);
  check('the campaign has a flood, a night and a weather level to test with', !!flood && !!night && !!weather);

  const floodBack = new Game(levelDefFromData(decodeShareCode(encodeShareCode(snapshotLevelData(new Game(flood))))));
  check(
    'a flood level reloads as a flood level',
    floodBack.level.flood?.start === flood.flood.start && floodBack.level.flood?.min === flood.flood.min
  );

  const nightGame = new Game(night);
  const nightBack = new Game(levelDefFromData(decodeShareCode(encodeShareCode(snapshotLevelData(nightGame)))));
  check('a night level reloads as a night level', nightBack.level.night === true);
  check('and it reloads at the same hour', Math.abs(nightBack.timeOfDay - nightGame.timeOfDay) < 0.01);
  // the lantern is the light source; without it a night snapshot is unplayable
  check('a night snapshot keeps the lantern available', nightBack.level.allowedTools.includes('lantern'));

  const wxGame = new Game(weather);
  const wxBack = new Game(levelDefFromData(decodeShareCode(encodeShareCode(snapshotLevelData(wxGame)))));
  check(
    'a weather schedule reloads intact',
    JSON.stringify(wxBack.level.weather) === JSON.stringify(weather.weather)
  );

  // an authored (non-snapshot) custom level must stay a plain day map
  const plain = sanitizeLevelData(JSON.parse(JSON.stringify({ ...snapshotLevelData(new Game(LEVELS[0])), world: undefined })));
  const plainBack = new Game(levelDefFromData(plain));
  check(
    'a code with no world block is still a plain day level',
    plain.world === undefined && !plainBack.level.night && !plainBack.level.flood && !plainBack.level.weather
  );
}

// ---- loose run state survives --------------------------------------------------------
{
  const g = new Game(LEVELS[0]);
  g.keep.log = 3;
  g.digOrders.add(5 * g.world.w + 7);
  g.digOrders.add(5 * g.world.w + 8);
  g.groundItems.push({ id: 999, item: 'plank', x: 12, y: 17, reserved: false, bounce: 0, stranded: true, idleFor: 4 });
  const mill = g.addBuilding('sawmill', g.townhall.x + 12, g.townhall.y, true);
  mill.inputs = { log: 2 };
  mill.outputs = { plank: 1 };

  const back = new Game(levelDefFromData(decodeShareCode(encodeShareCode(snapshotLevelData(g)))));
  check('keep floors survive', back.keep.log === 3);
  check('dig orders survive', back.digOrders.size === 2 && back.digOrders.has(5 * g.world.w + 7));
  check(
    'loose ground items survive at their exact cell',
    back.groundItems.length === 1 && back.groundItems[0].item === 'plank' && back.groundItems[0].x === 12 && back.groundItems[0].y === 17
  );
  const millBack = back.buildings.find((b) => b.kind === 'sawmill');
  check(
    'producer buffers survive — the difference between reproducing a stall and not',
    millBack.inputs.log === 2 && millBack.outputs.plank === 1
  );
}

// ---- every UI string is translated in both languages ------------------------------
//
// t() falls back to returning the key itself when one is missing, so a forgotten
// German string renders as "report.copy" in the UI and no test notices. The
// browser i18n suite is a smoke test and would not catch it either — hence this
// explicit list.
{
  const KEYS = [
    'menu.report',
    'report.title.bug',
    'report.title.feedback',
    'report.title.idea',
    'report.intro',
    'report.kind',
    'report.kind.bug',
    'report.kind.feedback',
    'report.kind.idea',
    'report.hint.bug',
    'report.hint.feedback',
    'report.hint.idea',
    'report.placeholder',
    'report.preview',
    'report.copy',
    'report.download',
    'report.close',
    'report.copied',
    'report.copyFailed',
    'report.downloaded',
    'report.downloadedPartial',
    'report.downloadUnsupported',
  ];
  for (const lang of LANGS) {
    setLang(lang);
    const missing = KEYS.filter((k) => t(k) === k);
    check(`every report.* key is translated in ${lang}`, missing.length === 0);
    if (missing.length) console.log('      missing:', missing.join(', '));
  }
  setLang('en');
  check('report.downloaded interpolates its count', t('report.downloaded', { n: 3 }).includes('3'));
}

console.log(failures ? `\n${failures} failure(s)` : '\nall report tests passed');
process.exit(failures ? 1 : 0);
