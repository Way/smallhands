// Campaign 2 solvability proof: plays every new level (5–9) headlessly with a
// scripted player — mark orders, workshop/lantern placements, ramps, bridges —
// and fails unless the simulation reaches the win state. This is the same
// "verified completable end-to-end" bar the campaign-1 levels were held to.
//
// Bundles the TypeScript sources with rolldown (see bundle.mjs) and imports
// the result from an in-memory data URL, so it runs with plain `node`.
import { bundleExports } from './bundle.mjs';

const { Game, LEVELS, t } = await bundleExports(`
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
  export { t } from './src/engine/i18n.ts';
`);

let failures = 0;

// Run a level with an ORDERED list of scripted steps. Each step fires once its
// `when` predicate holds (steps only fire in order, like a player's build
// queue). A step's `do` may return false to signal a refused placement — that
// fails the run immediately, because it means the level geometry moved under us.
function runLevel(def, steps, maxTime) {
  const g = new Game(def);
  const pending = [...steps];
  const dt = 1 / 30;
  while (g.time < maxTime && !g.won) {
    g.tick(dt);
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
  return g;
}

function dump(g) {
  const obj = g.objectives.map((o) => `${o.item} ${o.delivered}/${o.amount}`).join(', ');
  console.log(
    `       t=${Math.round(g.time)}s · order: ${obj} · stock`,
    JSON.stringify(g.stock),
    `· crew ${g.workers.length} · TH${g.thLevel} · weather ${g.weather}`
  );
}

function report(def, g) {
  if (g && g.won) {
    console.log(`  ok   L${def.id} "${t(def.name)}" completed in ${Math.round(g.time)}s of sim time`);
  } else if (g) {
    console.log(`  FAIL L${def.id} "${t(def.name)}" NOT completed`);
    dump(g);
    failures++;
  }
}

const mark = (pred = () => true) => (g) => {
  for (const n of g.nodes) if (pred(n)) n.marked = true;
};

// ---- Level 5: The Ford — bridge the river, deliver across -------------------
{
  const def = LEVELS[4];
  const g = runLevel(
    def,
    [
      { name: 'mark west bank', when: () => true, do: mark((n) => n.x < 22) },
      { name: 'sawmill', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 2, 17) },
      {
        name: 'bridge the river',
        when: (g) => g.stock.plank >= 8,
        do: (g) => g.placeBridgeRun(22, 19, 29, 19) === 8,
      },
    ],
    700
  );
  report(def, g);
}

// ---- Level 6: Monsoon Hollow — work around the rain --------------------------
{
  const def = LEVELS[5];
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      { name: 'sawmill', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 0, 19) },
      {
        name: 'bridge the pond',
        when: (g) => g.stock.plank >= 3,
        do: (g) => g.placeBridgeRun(27, 23, 29, 23) === 3,
      },
    ],
    800
  );
  report(def, g);
}

// ---- Level 7: Lantern Ridge — chain light out to the iron --------------------
{
  const def = LEVELS[6];
  const lanternReady = (x) => (g) =>
    g.buildings.some((b) => b.kind === 'lantern' && b.x === x && b.state === 'ready');
  const afford = (g) => g.stock.log >= 1 && g.stock.stone >= 1;
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      // bank planks for the forge before the caravan swallows them (the
      // in-game "keep in store" reserve — released once the forge is placed)
      { name: 'bank planks', when: () => true, do: (g) => g.setKeep('plank', 10) },
      { name: 'lantern 1', when: afford, do: (g) => g.placeBuilding('lantern', 14, 20) },
      { name: 'lantern 2', when: afford, do: (g) => g.placeBuilding('lantern', 20, 19) },
      { name: 'sawmill', when: (g) => g.stock.log >= 7, do: (g) => g.placeBuilding('sawmill', 0, 19) },
      { name: 'lantern 3', when: afford, do: (g) => g.placeBuilding('lantern', 27, 19) },
      { name: 'lantern 4', when: afford, do: (g) => g.placeBuilding('lantern', 33, 18) },
      { name: 'lantern 5 (the veins)', when: afford, do: (g) => g.placeBuilding('lantern', 47, 17) },
      {
        name: 'forge by the veins',
        when: (g) => lanternReady(47)(g) && g.stock.plank >= 4 && g.stock.stone >= 4,
        do: (g) => g.placeBuilding('forge', 49, 16),
      },
      { name: 'release the order', when: () => true, do: (g) => g.setKeep('plank', 0) },
    ],
    1200
  );
  report(def, g);
}

// ---- Level 8: The Rising Tide — loot the shelves, bridge the new lake --------
{
  const def = LEVELS[7];
  const g = runLevel(
    def,
    [
      // leave the basin to the tide; the shelves and hills carry the order
      { name: 'mark the dry ground', when: () => true, do: mark((n) => n.x < 26 || n.x >= 38) },
      { name: 'ramp down the west hill', when: () => true, do: (g) => g.placeRampRun(14, 20, 16, 22) === 3 },
      { name: 'sawmill', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 0, 18) },
      {
        name: 'bridge the lake at shelf height',
        when: (g) => g.stock.plank >= 17,
        do: (g) => g.placeBridgeRun(26, 23, 37, 23) === 12,
      },
      { name: 'ramp up the caravan hill', when: (g) => g.stock.plank >= 4, do: (g) => g.placeRampRun(49, 19, 46, 22) === 4 },
    ],
    1200
  );
  report(def, g);
}

// ---- Level 9: Tempest Summit — the full ascent through night and weather -----
{
  const def = LEVELS[8];
  const lanternAfford = (g) => g.stock.log >= 1 && g.stock.stone >= 1;
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      // bank stone and planks for the town hall, ramps, lanterns and forge —
      // otherwise the caravan drains the stock the moment the ramps connect
      {
        name: 'bank materials',
        when: () => true,
        do: (g) => {
          g.setKeep('stone', 12);
          g.setKeep('plank', 14);
        },
      },
      { name: 'lantern: base boulders', when: lanternAfford, do: (g) => g.placeBuilding('lantern', 18, 25) },
      { name: 'ramp to terrace 1', when: (g) => g.stock.plank >= 5, do: (g) => g.placeRampRun(27, 21, 23, 25) === 5 },
      { name: 'sawmill', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 0, 24) },
      { name: 'lantern: terrace 1 west', when: lanternAfford, do: (g) => g.placeBuilding('lantern', 34, 20) },
      { name: 'lantern: terrace 1 east', when: lanternAfford, do: (g) => g.placeBuilding('lantern', 43, 20) },
      { name: 'ramp to terrace 2', when: (g) => g.stock.plank >= 5, do: (g) => g.placeRampRun(49, 16, 45, 20) === 5 },
      {
        name: 'town hall 2',
        when: (g) => g.stock.plank >= 8 && g.stock.stone >= 6,
        do: (g) => g.startThUpgrade(),
      },
      { name: 'lantern: the iron, west', when: lanternAfford, do: (g) => g.placeBuilding('lantern', 56, 15) },
      { name: 'lantern: the iron, east', when: lanternAfford, do: (g) => g.placeBuilding('lantern', 62, 15) },
      { name: 'ramp to the summit', when: (g) => g.stock.plank >= 5, do: (g) => g.placeRampRun(71, 11, 67, 15) === 5 },
      {
        name: 'forge at base camp',
        when: (g) => g.thLevel >= 2 && g.stock.plank >= 4 && g.stock.stone >= 4,
        do: (g) => g.placeBuilding('forge', 20, 24),
      },
      {
        name: 'release the order',
        when: () => true,
        do: (g) => {
          g.setKeep('stone', 0);
          g.setKeep('plank', 0);
        },
      },
    ],
    2400
  );
  report(def, g);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
