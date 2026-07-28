// Campaign 5 solvability proof: plays the Deep & Drowning levels (18–22)
// headlessly with a scripted player — sink shafts before the rain, get the ore out
// of a drift the water table is about to take, and keep the wheels above the
// waterline — and fails unless the simulation reaches the win state.
//
// It also prints the two numbers the campaign is tuned on: each level's completion
// time (the repo's only difficulty telemetry — see docs/architecture.md) and the
// wall-clock of the FIRST rise, because `flood.min` and the rain cadence are
// coupled: a schedule that rains faster than a crew can carve a shaft turns the
// campaign's opening beat from tense into pointless.
//
// Two authoring invariants are asserted from the level DATA rather than played,
// because each is a silent softlock:
//   1. the town hall, the caravan and the rows they stand on are above flood.min
//      (riseWater does not spare building cells — a drowned dock cannot load)
//   2. every objective item is obtainable from above the final waterline
import { bundleExports } from './bundle.mjs';

const { Game, LEVELS, T, t, FOOTPRINTS, NODE_YIELD, RECIPES } = await bundleExports(`
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
  export { T, FOOTPRINTS, NODE_YIELD, RECIPES } from './src/game/types.ts';
  export { t } from './src/engine/i18n.ts';
`);

let failures = 0;
const check = (name, cond, note = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${note && !cond ? ` — ${note}` : ''}`);
  if (!cond) failures++;
};

const CAMPAIGN = LEVELS.filter((l) => l.campaign === 5);

function runLevel(def, steps, maxTime) {
  const g = new Game(def);
  const pending = [...steps];
  const dt = 1 / 30;
  let firstRise = null;
  while (g.time < maxTime && !g.won) {
    g.tick(dt);
    if (firstRise === null && g.waterRow !== null) firstRise = g.time;
    while (pending.length && pending[0].when(g)) {
      const s = pending.shift();
      if (s.do(g) === false) {
        console.log(`  FAIL L${def.id} step "${s.name}" was refused at t=${g.time.toFixed(1)}s`);
        dump(g);
        failures++;
        return null;
      }
    }
  }
  if (pending.length) {
    console.log(`  note L${def.id}: ${pending.length} step(s) never fired (first: "${pending[0].name}")`);
  }
  g.firstRise = firstRise;
  return g;
}

function dump(g) {
  const obj = g.objectives.map((o) => `${o.item} ${o.delivered}/${o.amount}`).join(', ');
  console.log(
    `       t=${Math.round(g.time)}s · order: ${obj} · stock`,
    JSON.stringify(g.stock),
    `· crew ${g.workers.length} · weather ${g.weather} · water ${g.waterRow} · digOrders ${g.digOrders.size}`
  );
}

function report(def, g) {
  if (g && g.won) {
    const rise = g.firstRise === null ? 'no rise' : `first rise ${Math.round(g.firstRise)}s`;
    console.log(`  ok   L${def.id} "${t(def.name)}" completed in ${Math.round(g.time)}s of sim time (${rise})`);
  } else if (g) {
    console.log(`  FAIL L${def.id} "${t(def.name)}" NOT completed`);
    dump(g);
    failures++;
  }
}

const byId = (id) => LEVELS.find((l) => l.id === id);
const mark = () => (g) => {
  for (const n of g.nodes) n.marked = true;
};
const air = (x, y) => (g) => g.world.get(x, y) === T.AIR;
const dig = (ax, ay, tx, ty) => (g) => g.paintDigRun(ax, ay, tx, ty) > 0;
const shovelReady = (g) => g.stock.shovel >= 1 || g.equippedDiggers() >= 1;

// ---- the authoring invariants ------------------------------------------------
// Read off the data, so a level authored into a softlock reds here rather than
// mysteriously failing to finish somewhere in the play loop below.
{
  for (const def of CAMPAIGN) {
    const g = new Game(def);
    const floor = def.flood?.min;
    check(`L${def.id} is a flood level`, floor !== undefined, 'campaign 5 levels all carry a water table');
    if (floor === undefined) continue;

    // 1. the dock and the yard stay dry — footprint AND the row they stand on
    for (const kind of ['townhall', 'goal']) {
      const b = g.buildings.find((o) => o.kind === kind);
      const lowest = b.y + FOOTPRINTS[kind].h; // the support row beneath it
      check(
        `L${def.id}: the ${kind === 'goal' ? 'caravan' : 'town hall'} stands above the final waterline`,
        lowest < floor,
        `rests on row ${lowest}, the water reaches row ${floor}`
      );
    }

    // 2. the sheet is fillable from above the final waterline. Count only nodes the
    // tide can never reach, and resolve a recipe item to the raw inputs it needs.
    const dryYield = {};
    for (const n of g.nodes) {
      if (n.y >= floor) continue; // this one drowns
      const { item, amount } = NODE_YIELD[n.kind];
      dryYield[item] = (dryYield[item] ?? 0) + amount;
    }
    for (const o of def.objectives) {
      const recipe = RECIPES[Object.keys(RECIPES).find((k) => RECIPES[k].outputs[o.item])];
      const need = recipe
        ? Object.entries(recipe.inputs).map(([k, v]) => [k, v * o.amount])
        : [[o.item, o.amount]];
      for (const [item, amount] of need) {
        const have = (dryYield[item] ?? 0) + (def.startStock?.[item] ?? 0);
        check(
          `L${def.id}: ${o.amount} ${o.item} needs ${amount} ${item} — dry ground offers ${have}`,
          have >= amount
        );
      }
    }
  }
}

// ---- Level 18: The Seeping Floor — the drift below the water table -------------
{
  const def = byId(18);
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      // bank the lift's materials: the caravan wants stone too, and the mill would
      // eat the logs the shaft's ladder needs
      { name: 'keep the wheel back', when: () => true, do: (g) => { g.setKeep('plank', 4); g.setKeep('stone', 2); } },
      // the deep drift FIRST — it is the one on a 100s clock. The scrape keeps.
      { name: 'sink the shaft', when: shovelReady, do: dig(38, 18, 38, 23) },
      // the drift anchors on the shaft FLOOR, the only standable cell in a hollow
      // column — which is also why the mid drift has to wait for the ladder
      { name: 'tunnel the deep drift', when: air(38, 23), do: dig(39, 23, 48, 23) },
      // the wheel goes on the shaft floor (level 14's move) and shares the drift's
      // clock — a lift cannot dodge the water one row higher, because the cell above
      // a dug floor is not standable and liftTopFor refuses it. Before the ladder:
      // a laddered shaft is not AIR, and the mast needs a clear column.
      {
        name: 'lift on the shaft floor',
        when: (g) => air(38, 23)(g) && g.stock.plank >= 4 && g.stock.stone >= 2,
        do: (g) => g.placeLift(38, 23),
      },
      { name: 'release the order', when: (g) => g.lifts.length > 0, do: (g) => { g.setKeep('plank', 0); g.setKeep('stone', 0); } },
      {
        name: 'ladder down the shaft',
        when: (g) => g.lifts.length > 0 && g.stock.log + g.stock.plank >= 6,
        do: (g) => g.placeLadderRun(38, 18, 38, 23) > 0,
      },
      // rungs are standable, so now the mid drift has an approach
      {
        name: 'tunnel the mid drift',
        when: (g) => g.world.get(38, 21) === T.LADDER,
        do: dig(39, 21, 45, 21),
      },
      // the shallow scrape: one dig each, the ore steps up to the ground on its own
      { name: 'open the scrape', when: (g) => g.waterRow !== null, do: dig(26, 18, 26, 18) },
      { name: 'open the scrape 2', when: (g) => g.waterRow !== null, do: dig(28, 18, 28, 18) },
      { name: 'open the scrape 3', when: (g) => g.waterRow !== null, do: dig(30, 18, 30, 18) },
      { name: 'open the scrape 4', when: (g) => g.waterRow !== null, do: dig(32, 18, 32, 18) },
      { name: 'open the scrape 5', when: (g) => g.waterRow !== null, do: dig(34, 18, 34, 18) },
    ],
    900
  );
  report(def, g);
  if (g) {
    check('L18: the tide took the drift it was dug into', g.waterRow !== null && g.world.get(44, 23) === T.WATER);
    check('L18: and the shallow scrape stayed dry', g.world.get(26, 18) !== T.WATER && g.world.get(34, 18) !== T.WATER);
  }
}

// ---- Level 19: Two Galleries — two depths, two clocks, one wheel ---------------
{
  const def = byId(19);
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      { name: 'keep the wheel back', when: () => true, do: (g) => { g.setKeep('plank', 4); g.setKeep('stone', 2); } },
      // the deep gallery first: its stone is what the water is coming for
      { name: 'sink the east shaft', when: shovelReady, do: dig(42, 19, 42, 25) },
      { name: 'quarry the lower gallery', when: air(42, 25), do: dig(43, 25, 52, 25) },
      {
        name: 'wheel in the deep shaft',
        when: (g) => air(42, 25)(g) && g.stock.plank >= 4 && g.stock.stone >= 2,
        do: (g) => g.placeLift(42, 25),
      },
      { name: 'release the order', when: (g) => g.lifts.length > 0, do: (g) => { g.setKeep('plank', 0); g.setKeep('stone', 0); } },
      {
        name: 'ladder the east shaft',
        when: (g) => g.lifts.length > 0 && g.stock.log + g.stock.plank >= 7,
        do: (g) => g.placeLadderRun(42, 19, 42, 25) > 0,
      },
      // the shallow gallery, dug while the deep one is still being hauled out
      { name: 'sink the west shaft', when: (g) => g.lifts.length > 0, do: dig(26, 19, 26, 22) },
      { name: 'drive the upper gallery', when: air(26, 22), do: dig(27, 22, 36, 22) },
      // …and when the tide takes the lower floor, the wheel moves upstairs. The
      // budget only allows one, so this is a demolish first — half the materials
      // back, and the slot with them.
      {
        name: 'tear the drowned wheel out',
        when: (g) => g.waterRow !== null && g.waterRow <= 25 && g.lifts.length > 0,
        do: (g) => g.demolish(42, 25),
      },
      {
        name: 'wheel in the shallow shaft',
        when: (g) => air(26, 22)(g) && g.toolRemaining('lift') > 0 && g.stock.plank >= 4 && g.stock.stone >= 2,
        do: (g) => g.placeLift(26, 22),
      },
      {
        name: 'ladder the west shaft',
        when: (g) => g.lifts.some((l) => l.x === 26) && g.stock.log + g.stock.plank >= 4,
        do: (g) => g.placeLadderRun(26, 19, 26, 22) > 0,
      },
    ],
    1200
  );
  report(def, g);
  if (g) {
    check('L19: the lower gallery drowned', g.world.get(48, 25) === T.WATER);
    check('L19: the upper gallery stayed dry', g.world.get(32, 22) !== T.WATER);
    check('L19: exactly one wheel ever stands', g.lifts.length <= 1);
  }
}

// ---- Level 20: Ballast & Bilge — a wheel with a shelf life ---------------------
{
  const def = byId(20);
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      // the wheel first: plateau stone is both its ballast and half the order, so
      // bank what it costs before the caravan ships it out
      // bank the wheel's build cost AND its ballast: the caravan would otherwise
      // ship every last stone and leave the cars too light to swap
      { name: 'keep the wheel back', when: () => true, do: (g) => { g.setKeep('plank', 3); g.setKeep('iron', 1); g.setKeep('stone', 6); } },
      {
        name: 'hoist on the cliff edge',
        when: (g) => g.stock.plank >= 3 && g.stock.iron >= 1,
        do: (g) => g.placeHoist(40, 13),
      },
      { name: 'release the order', when: (g) => g.hoists.length > 0, do: (g) => { g.setKeep('plank', 0); g.setKeep('iron', 0); } },
      // ore rides up, stone rides down as the counterweight
      {
        name: 'route the ore up',
        when: (g) => g.hoists.some((b) => b.state === 'ready'),
        do: (g) => g.toggleHoistRoute(g.hoists[0].id, 'lower', 'iron'),
      },
      {
        name: 'route ballast down',
        when: (g) => g.hoists.some((b) => b.state === 'ready'),
        do: (g) => g.toggleHoistRoute(g.hoists[0].id, 'upper', 'stone'),
      },
      // a ladder down the cliff face for empty hands — its lowest rungs are the
      // first thing the tide sweeps
      {
        // from row 14 down: at row 13 the cliff has no wall to hang from (the
        // plateau's rock starts at 14), so the run anchors one row lower
        name: 'ladder down the cliff',
        when: (g) => g.hoists.length > 0 && g.stock.log + g.stock.plank >= 8,
        do: (g) => g.placeLadderRun(39, 14, 39, 20) > 0,
      },
      // and the dry scrape at the far end, which needs no machine at all — one dig
      // per vein, and a long carry back to the cliff
      { name: 'open the scrape', when: shovelReady, do: dig(49, 14, 49, 14) },
      { name: 'open the scrape 2', when: shovelReady, do: dig(52, 14, 52, 14) },
      { name: 'open the scrape 3', when: shovelReady, do: dig(55, 14, 55, 14) },
      { name: 'open the scrape 4', when: shovelReady, do: dig(58, 14, 58, 14) },
      { name: 'open the scrape 5', when: shovelReady, do: dig(60, 14, 60, 14) },
      { name: 'open the scrape 6', when: shovelReady, do: dig(62, 14, 62, 14) },
      // The stone half of the sheet is filled, so the floor comes off and the rest of
      // the plateau's stone becomes ballast. The keep floor gates EVERY autonomous
      // consumer, cars included — bank stone too long and the wheel never turns.
      {
        name: 'release the ballast',
        when: (g) => g.objectives.find((o) => o.item === 'stone').delivered >= 8,
        do: (g) => g.setKeep('stone', 0),
      },
    ],
    1500
  );
  report(def, g);
  if (g) {
    check('L20: the basin floor drowned', g.world.get(21, 23) === T.WATER);
    check('L20: the plateau stayed dry', g.world.get(60, 14) !== T.WATER);
  }
}

// ---- Level 21: The Rope Shift — gravity keeps working when wheels don't ---------
{
  const def = byId(21);
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      { name: 'bank the rope', when: () => true, do: (g) => { g.setKeep('log', 2); g.setKeep('plank', 1); } },
      { name: 'sawmill on the surface', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 16, 18) },
      // the well down to the buried gallery, then east into the vault
      { name: 'sink the well', when: shovelReady, do: dig(44, 20, 44, 22) },
      { name: 'tunnel to the vault', when: air(44, 22), do: dig(45, 22, 47, 22) },
      // rope FIRST: a laddered well reads as ground and refuses the anchor (lvl 15)
      {
        name: 'rope over the well',
        when: (g) => air(44, 22)(g) && g.stock.log >= 2 && g.stock.plank >= 1,
        do: (g) => g.placeRope(43, 19),
      },
      { name: 'release the order', when: (g) => g.ropes.length > 0, do: (g) => { g.setKeep('log', 0); g.setKeep('plank', 0); } },
      // …then ladder the same well so empty hands climb home
      {
        name: 'ladder the well',
        when: (g) => g.ropes.length > 0 && g.stock.log + g.stock.plank >= 4,
        do: (g) => g.placeLadderRun(44, 20, 44, 22) > 0,
      },
      // the surface scrapes: safe iron, one dig each
      { name: 'open the scrape', when: shovelReady, do: dig(32, 20, 32, 20) },
      { name: 'open the scrape 2', when: shovelReady, do: dig(35, 20, 35, 20) },
      // The deep quarry below the gallery is deliberately NOT scripted. It is the
      // level's fast route, not its only one, and the invariant block above is what
      // proves the sheet can be filled without it — so this run takes the safe way
      // and the quarry stays a player's gamble rather than a step the proof depends on.
    ],
    1800
  );
  report(def, g);
  if (g) {
    check('L21: the caravan floor never floods', g.world.get(50, 22) !== T.WATER);
    check('L21: the row the vault rests on stays dry', g.world.get(50, 23) !== T.WATER);
    check('L21: the deep quarry drowns', g.waterRow !== null && g.waterRow <= 25);
  }
}

// ---- Level 22: Low Water — rain, storm and dock, read together -----------------
{
  const def = byId(22);
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      { name: 'second miner for the plateau', when: (g) => g.workers.length >= 8, do: (g) => g.setDesired('miner', 2) },
      // bank the mill, the forge and the wheels before the caravan ships the lot
      { name: 'bank the works', when: () => true, do: (g) => { g.setKeep('plank', 8); g.setKeep('stone', 6); g.setKeep('iron', 2); } },
      { name: 'sawmill in the meadow', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 17, 20) },
      // the deep drift first — the second rain takes it
      { name: 'sink the shaft', when: shovelReady, do: dig(30, 22, 30, 26) },
      { name: 'tunnel the drift', when: air(30, 26), do: dig(31, 26, 40, 26) },
      {
        name: 'lift on the shaft floor',
        when: (g) => air(30, 26)(g) && g.stock.plank >= 4 && g.stock.stone >= 2,
        do: (g) => g.placeLift(30, 26),
      },
      {
        name: 'ladder the shaft',
        when: (g) => g.lifts.length > 0 && g.stock.log + g.stock.plank >= 5,
        do: (g) => g.placeLadderRun(30, 22, 30, 26) > 0,
      },
      // the safe scrape, so the sheet never depends on the drift
      { name: 'open the scrape', when: shovelReady, do: dig(20, 22, 20, 22) },
      { name: 'open the scrape 2', when: shovelReady, do: dig(23, 22, 23, 22) },
      {
        name: 'forge in the meadow',
        when: (g) => g.stock.plank >= 4 && g.stock.stone >= 4 && g.lifts.length > 0,
        do: (g) => g.placeBuilding('forge', 34, 20),
      },
      {
        name: 'hoist on the plateau edge',
        when: (g) => g.stock.plank >= 3 && g.stock.iron >= 1 && g.buildings.some((b) => b.kind === 'forge'),
        do: (g) => g.placeHoist(46, 13),
      },
      { name: 'release the works', when: (g) => g.hoists.length > 0, do: (g) => { g.setKeep('plank', 0); g.setKeep('stone', 0); g.setKeep('iron', 0); } },
      {
        name: 'route spears up',
        when: (g) => g.hoists.some((b) => b.state === 'ready'),
        do: (g) => g.toggleHoistRoute(g.hoists[0].id, 'lower', 'spear'),
      },
    ],
    2400
  );
  report(def, g);
  if (g) {
    check('L22: the drift drowned', g.world.get(36, 26) === T.WATER);
    check('L22: the plateau never floods', g.world.get(62, 13) !== T.WATER);
    check('L22: one lift and one wheel, no more', g.lifts.length <= 1 && g.hoists.length <= 1);
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
