// Campaign 3 solvability proof: plays every Weight & Wheel level (10–12)
// headlessly with a scripted player — mark orders, place the hoist, route
// cars, raise ladders up the back paths — and fails unless the simulation
// reaches the win state. Same bar as campaigns 1 and 2.
import { bundleExports } from './bundle.mjs';

const { Game, LEVELS, t } = await bundleExports(`
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
  export { t } from './src/engine/i18n.ts';
`);

let failures = 0;

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
  const h = g.hoists[0];
  console.log(
    `       t=${Math.round(g.time)}s · order: ${obj} · stock`,
    JSON.stringify(g.stock),
    `· crew ${g.workers.length} · weather ${g.weather}`,
    h ? `· hoist ${h.state} up=${JSON.stringify(h.hoistUpper)} lo=${JSON.stringify(h.hoistLower)}` : ''
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

const hoistReady = (g) => g.hoists.some((b) => b.state === 'ready');
const route = (car, ...items) => (g) => {
  const b = g.hoists[0];
  for (const item of items) g.toggleHoistRoute(b.id, car, item);
};

// ---- Level 10: The Turning Wheel — send the order down ------------------------
{
  const def = LEVELS[9];
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      { name: 'hoist at the shelf edge', when: () => true, do: (g) => g.placeHoist(27, 16) },
      { name: 'sawmill', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 22, 15) },
      { name: 'route planks + stone down', when: hoistReady, do: route('upper', 'plank', 'stone') },
    ],
    700
  );
  report(def, g);
}

// ---- Level 11: Ballast Ridge — stone pays the planks' way up -------------------
{
  const def = LEVELS[10];
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      { name: 'hoist at the ridge edge', when: () => true, do: (g) => g.placeHoist(22, 14) },
      { name: 'sawmill', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 0, 20) },
      { name: 'route planks up', when: hoistReady, do: route('lower', 'plank') },
    ],
    900
  );
  report(def, g);
}

// ---- Level 12: The High Forge — spears in the sky, storms on the wheel ---------
{
  const def = LEVELS[11];
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      { name: 'hoist at the plateau edge', when: () => true, do: (g) => g.placeHoist(26, 14) },
      { name: 'sawmill', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 0, 21) },
      {
        name: 'the high forge',
        when: (g) => g.stock.plank >= 4 && g.stock.stone >= 4,
        do: (g) => g.placeBuilding('forge', 29, 13),
      },
      // only now let the planks ride: the forge's build cost is already paid,
      // so the lower car can't drain the stock out from under it
      {
        name: 'route planks up',
        when: (g) => hoistReady(g) && g.buildings.some((b) => b.kind === 'forge'),
        do: route('lower', 'plank'),
      },
    ],
    1500
  );
  report(def, g);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
