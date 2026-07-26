// Campaign 1 solvability proof: plays every Home Meadows level (1–4) headlessly
// with a scripted player and fails unless the simulation reaches the win state.
// These four were the only campaign levels without an end-to-end playthrough
// (they had mechanic-specific unit checks only), so a change to core movement
// (e.g. the empty-hand fall cap) could break them silently. This closes that gap.
//
// Same harness as campaign2/3/4: bundle the TS sources with rolldown and import
// from an in-memory data URL, so it runs with plain `node`.
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
  console.log(
    `       t=${Math.round(g.time)}s · order: ${obj} · stock`,
    JSON.stringify(g.stock),
    `· crew ${g.workers.length} · TH${g.thLevel}`
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

// "this line of the order sheet is full" — read against the level's own amount,
// never a hardcoded count, so retuning an order (card #70) can't quietly turn a
// scripted step into a step that never fires.
const filled = (item) => (g) => {
  const o = g.objectives.find((ob) => ob.item === item);
  return !!o && o.delivered >= o.amount;
};

// ---- Level 1: First Steps — harvest, saw, deliver ----------------------------
{
  const def = LEVELS[0];
  const g = runLevel(
    def,
    [
      { name: 'mark the timber', when: () => true, do: mark() },
      { name: 'sawmill on the meadow', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 33, 17) },
    ],
    600
  );
  report(def, g);
}

// ---- Level 2: The Cliff Shrine — lift the order up, ladder the empties down ---
{
  const def = LEVELS[1];
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      // bank planks/stone for the lift + a plank cushion for the goal
      { name: 'bank materials', when: () => true, do: (g) => { g.setKeep('plank', 6); g.setKeep('stone', 4); } },
      { name: 'sawmill on the base', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 0, 20) },
      // cargo lift up the west face of the shrine ledge (h9 base -> h16 ledge)
      { name: 'lift up the shrine face', when: (g) => g.stock.plank >= 4 && g.stock.stone >= 2, do: (g) => g.placeLift(23, 20) },
      // ladder the same face so empty hands climb back down for the next load
      { name: 'ladder for the empties', when: (g) => g.lifts.length > 0 && g.stock.log + g.stock.plank >= 6, do: (g) => g.placeLadderRun(23, 19, 23, 14) > 0 },
      { name: 'release the order', when: (g) => g.lifts.length > 0, do: (g) => { g.setKeep('plank', 0); g.setKeep('stone', 0); } },
    ],
    1200
  );
  report(def, g);
}

// ---- Level 3: Iron in the Deep — mine the pit, forge spears, lift iron out ----
{
  const def = LEVELS[2];
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      // bank plank + stone so the caravan can't drain the town-hall/forge/ramp bill
      { name: 'bank materials', when: () => true, do: (g) => { g.setKeep('plank', 12); g.setKeep('stone', 14); } },
      // ramp down into the pit — empty miners walk in, and the iron rides back
      // UP the same ramp (no more free hop down; #48)
      { name: 'ramp into the pit', when: (g) => g.stock.plank >= 3, do: (g) => g.placeRampRun(26, 24, 28, 26) === 3 },
      { name: 'sawmill on the rim', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 11, 21) },
      { name: 'upgrade the town hall', when: (g) => g.stock.plank >= 8 && g.stock.stone >= 6, do: (g) => g.startThUpgrade() },
      { name: 'forge on the rim', when: (g) => g.thLevel >= 2 && g.stock.plank >= 4 && g.stock.stone >= 4, do: (g) => g.placeBuilding('forge', 15, 21) },
      // keep a small plank reserve to feed the forge, then release once spears flow
      { name: 'trim the reserve', when: (g) => g.buildings.some((b) => b.kind === 'forge'), do: (g) => { g.setKeep('plank', 4); g.setKeep('stone', 0); } },
      { name: 'release the order', when: filled('spear'), do: (g) => g.setKeep('plank', 0) },
    ],
    1500
  );
  report(def, g);
}

// ---- Level 4: The Summit Beacon — chain ramps up three terraces ---------------
{
  const def = LEVELS[3];
  const g = runLevel(
    def,
    [
      { name: 'mark everything', when: () => true, do: mark() },
      { name: 'bank materials', when: () => true, do: (g) => { g.setKeep('plank', 20); g.setKeep('stone', 12); } },
      { name: 'sawmill by the stock', when: (g) => g.stock.log >= 6, do: (g) => g.placeBuilding('sawmill', 18, 26) },
      { name: 'ramp: base -> terrace 1', when: (g) => g.stock.plank >= 6, do: (g) => g.placeRampRun(21, 22, 16, 27) === 6 },
      { name: 'ramp: terrace 1 -> terrace 2', when: (g) => g.stock.plank >= 6, do: (g) => g.placeRampRun(41, 16, 36, 21) === 6 },
      { name: 'ramp: terrace 2 -> summit', when: (g) => g.stock.plank >= 6, do: (g) => g.placeRampRun(59, 10, 54, 15) === 6 },
      // no town-hall upgrade here any more: the level starts at TH2 (card #70), so
      // the forge is available from the first second and the crew can reach nine
      { name: 'forge on terrace 2', when: (g) => g.stock.plank >= 4 && g.stock.stone >= 4, do: (g) => g.placeBuilding('forge', 42, 14) },
      { name: 'trim the reserve', when: (g) => g.buildings.some((b) => b.kind === 'forge'), do: (g) => { g.setKeep('plank', 4); g.setKeep('stone', 0); } },
      { name: 'release the order', when: filled('spear'), do: (g) => g.setKeep('plank', 0) },
    ],
    2500
  );
  report(def, g);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
