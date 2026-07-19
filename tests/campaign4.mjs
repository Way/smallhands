// Campaign 4 solvability proof: plays the new Shaft & Seam levels (14–16)
// headlessly with a scripted player — sink shafts, carve tunnels, hang lifts
// and hoists off the player's own excavations — and fails unless the
// simulation reaches the win state. Level 13 is covered by digging.mjs, and
// Level 17 (the living-clock vale) rides along at the end of this file.
import { bundleExports } from './bundle.mjs';

const { Game, LEVELS, T, t } = await bundleExports(`
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
  export { T } from './src/game/types.ts';
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
  console.log(
    `       t=${Math.round(g.time)}s · order: ${obj} · stock`,
    JSON.stringify(g.stock),
    `· crew ${g.workers.length} · weather ${g.weather} · digOrders ${g.digOrders.size}`
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

const byId = (id) => LEVELS.find((l) => l.id === id);
const mark = () => (g) => {
  for (const n of g.nodes) n.marked = true;
};
const air = (x, y) => (g) => g.world.get(x, y) === T.AIR;
const dig = (ax, ay, tx, ty) => (g) => g.paintDigRun(ax, ay, tx, ty) > 0;
const shovelReady = (g) => g.stock.shovel >= 1 || g.equippedDiggers() >= 1;
const lanternReady = (x, y) => (g) =>
  g.buildings.some((b) => b.kind === 'lantern' && b.x === x && b.y === y && b.state === 'ready');

// ---- Level 14: The Iron Well — dig down, lift the iron back up ----------------
{
  const def = byId(14);
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      // bank the lift's stone so the caravan doesn't drink it first
      { name: 'keep stone back', when: () => true, do: (g) => g.setKeep('stone', 2) },
      { name: 'sink the shaft', when: () => true, do: dig(27, 19, 27, 22) },
      { name: 'tunnel the seam', when: air(27, 22), do: dig(28, 22, 37, 22) },
      {
        name: 'lift on the shaft floor',
        when: (g) => air(27, 22)(g) && g.stock.plank >= 4 && g.stock.stone >= 2,
        do: (g) => g.placeLift(27, 22),
      },
      {
        name: 'release the stone',
        when: (g) => g.lifts.length > 0,
        do: (g) => g.setKeep('stone', 0),
      },
      // the finished head-frame decks over the well — the ladder beside the
      // mast is the climb back down for empty hands
      {
        name: 'ladder beside the mast',
        when: (g) => g.lifts.length > 0 && g.stock.log + g.stock.plank >= 4,
        do: (g) => g.placeLadderRun(27, 19, 27, 22) > 0,
      },
    ],
    700
  );
  report(def, g);
}

// ---- Level 15: The Dark Gallery — rope cargo down to the buried caravan --------
{
  const def = byId(15);
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      { name: 'workshop in the town light', when: () => true, do: (g) => g.placeBuilding('workshop', 8, 18) },
      { name: 'lantern by the far trees', when: () => true, do: (g) => g.placeBuilding('lantern', 16, 19) },
      { name: 'lantern by the boulders', when: () => true, do: (g) => g.placeBuilding('lantern', 23, 19) },
      // #41: digging now needs a lit face — light the well mouth (and, from the
      // surface, the shaft floor + tunnel mouth + rope anchor) before sinking it
      { name: 'lantern at the well mouth', when: () => true, do: (g) => g.placeBuilding('lantern', 32, 19) },
      { name: 'sawmill', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 12, 18) },
      { name: 'sink the well', when: (g) => shovelReady(g) && lanternReady(32, 19)(g), do: dig(30, 20, 30, 24) },
      // the workshop keeps crafting shovels as long as it is fed — reclaim it
      // (and anything parked in its inputs) once the digger holds a shovel
      { name: 'reclaim the workshop', when: (g) => g.equippedDiggers() >= 1, do: (g) => g.demolish(8, 18) },
      { name: 'tunnel east', when: air(30, 24), do: dig(31, 24, 43, 24) },
      // rope FIRST: a laddered well reads as ground and refuses the anchor
      {
        name: 'rope at the well mouth',
        when: (g) => air(30, 24)(g) && g.stock.plank >= 1 && g.stock.log >= 2,
        do: (g) => g.placeRope(29, 19),
      },
      // ...then ladder the same well: empty hands climb home, and the rungs
      // deck the mouth so surface traffic keeps flowing over it
      {
        name: 'ladder the well',
        when: (g) => g.ropes.length > 0 && g.stock.log + g.stock.plank >= 5,
        do: (g) => g.placeLadderRun(30, 24, 30, 20) > 0,
      },
      // planks are covered — reclaim the sawmill so it stops vacuuming the
      // logs the gallery lantern still needs
      { name: 'reclaim the sawmill', when: (g) => g.stock.plank >= 8, do: (g) => g.demolish(12, 18) },
      {
        name: 'lantern in the gallery',
        when: (g) => air(37, 24)(g) && g.stock.log >= 1 && g.stock.stone >= 1,
        do: (g) => g.placeBuilding('lantern', 37, 24),
      },
    ],
    1100
  );
  report(def, g);
}

// ---- Level 16: The Ember Vault — the full chain, storms on every brake ---------
{
  const def = byId(16);
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      { name: 'second miner for the plateau', when: (g) => g.workers.length >= 8, do: (g) => g.setDesired('miner', 2) },
      { name: 'workshop', when: () => true, do: (g) => g.placeBuilding('workshop', 21, 20) },
      { name: 'sawmill', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 17, 20) },
      { name: 'sink the shaft', when: shovelReady, do: dig(30, 22, 30, 26) },
      // stop the workshop from quietly eating the forge's iron: reclaim it
      // once the digger holds its shovel
      { name: 'reclaim the workshop', when: (g) => g.equippedDiggers() >= 1, do: (g) => g.demolish(21, 20) },
      { name: 'tunnel the seam', when: air(30, 26), do: dig(31, 26, 43, 26) },
      {
        name: 'lift on the shaft floor',
        when: (g) => air(30, 26)(g) && g.stock.plank >= 4 && g.stock.stone >= 2,
        do: (g) => g.placeLift(30, 26),
      },
      {
        name: 'ladder beside the mast',
        when: (g) => g.lifts.length > 0 && g.stock.log + g.stock.plank >= 5,
        do: (g) => g.placeLadderRun(30, 22, 30, 26) > 0,
      },
      {
        name: 'forge in the meadow',
        when: (g) => g.stock.plank >= 4 && g.stock.stone >= 4 && g.lifts.length > 0,
        do: (g) => g.placeBuilding('forge', 33, 20),
      },
      {
        name: 'hoist on the plateau edge',
        when: (g) => g.stock.plank >= 3 && g.stock.iron >= 1 && g.buildings.some((b) => b.kind === 'forge'),
        do: (g) => g.placeHoist(46, 14),
      },
      {
        name: 'route spears up',
        when: (g) => g.hoists.some((b) => b.state === 'ready'),
        do: (g) => g.toggleHoistRoute(g.hoists[0].id, 'lower', 'spear'),
      },
    ],
    1700
  );
  report(def, g);
}

// ---- Level 17: The Waning Light — harvest the near vale before dark ------------
{
  const def = byId(17);
  const g = runLevel(
    def,
    [
      // work the near + mid ground (west of the far shelf) — enough timber and
      // stone to fill plank 6 / stone 4 without racing all the way east into dark
      { name: 'mark the near vale', when: () => true, do: (g) => { for (const n of g.nodes) if (n.x < 48) n.marked = true; } },
      { name: 'sawmill in the vale', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 16, 19) },
    ],
    900
  );
  report(def, g);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
