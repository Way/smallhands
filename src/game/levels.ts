import { T } from './types';
import type { MedalTimes, ObjectiveReq, Role, Tool, WeatherPhase } from './types';
import type { Biome } from '../engine/biomes';
import type { Game } from './sim';

export interface LevelHint {
  id: string;
  text: string;
  when: (g: Game) => boolean;
}

export interface LevelDef {
  id: number;
  name: string;
  desc: string;
  width: number;
  height: number;
  build: (g: Game) => void;
  objectives: ObjectiveReq[];
  allowedTools?: Tool[];
  startStock?: Partial<Record<string, number>>;
  startRoles?: Partial<Record<Role, number>>;
  startWorkers?: number;
  startThLevel?: number;
  hints?: LevelHint[];
  camera?: { x: number; y: number };
  medals?: MedalTimes; // completion-time thresholds in seconds
  campaign?: number; // 1 (default), 2 or 3 — grouping + unlock gate on the level select
  weather?: WeatherPhase[]; // looping phase schedule; omit for an always-clear sky
  night?: boolean; // night level: work only happens in the light (see lanterns)
  startHour?: number; // HUD clock's hour-of-day (0..24); defaults to noon, or midnight when night
  dayNight?: { rate: number }; // live day→night cycle: advance the clock `rate` game-hours per second (omit for a fixed sky)
  flood?: { start: number; min: number }; // rising tide: first flood row & highest row it reaches
  biome?: Biome; // terrain palette family; omit for the classic meadow look
  // The caravan's dock window (card #70): it loads for `open` seconds, rolls out
  // for `closed`, and returns — forever, from t=0, derived from the run clock so
  // a restart docks on the same seconds. Deliveries are only DISPATCHED while it
  // stands there, so the level becomes "stockpile through the gap, empty the
  // store into the window" — the game's timing verb. See Game.convoyOpen.
  convoy?: { open: number; closed: number };
  // Lemmings-style tool budget (card #70): how many of a tool may STAND at once.
  // One per tile for the drag-run tools (ladder/platform/ramp), one per instance
  // for buildings and machines; demolishing gives the slot back, so a budget is a
  // puzzle constraint and never a softlock. `dig` is deliberately unbudgetable —
  // its orders are painted and erased freely. See Game.toolRemaining.
  toolLimit?: Partial<Record<Tool, number>>;
}

// ---- terrain authoring helpers ---------------------------------------------

// Fill terrain from a surface heightmap: heights[x] = number of solid tiles
// from the bottom of the map. Grass on top, dirt beneath, rock deeper down.
function terrain(g: Game, heights: number[]): void {
  const { world } = g;
  for (let x = 0; x < world.w; x++) {
    const h = heights[Math.min(x, heights.length - 1)];
    const surfaceY = world.h - h;
    for (let y = 0; y < world.h; y++) {
      if (y < surfaceY) continue;
      if (y === world.h - 1) world.set(x, y, T.BEDROCK);
      else if (y === surfaceY) world.set(x, y, T.GRASS);
      else if (y - surfaceY <= 2) world.set(x, y, T.DIRT);
      else world.set(x, y, T.ROCK);
    }
  }
}

// Expand a run-length spec like [[height, count], ...] into a heights array.
function runs(spec: [number, number][]): number[] {
  const out: number[] = [];
  for (const [h, n] of spec) for (let i = 0; i < n; i++) out.push(h);
  return out;
}

// Fill a water body: every AIR cell in x0..x1 from row `top` down to the first
// solid tile becomes water. Call after terrain() so banks are already in place.
function water(g: Game, x0: number, x1: number, top: number): void {
  const { world } = g;
  for (let x = x0; x <= x1; x++) {
    for (let y = top; y < world.h && !world.isSolid(x, y); y++) {
      if (world.get(x, y) === T.AIR) world.set(x, y, T.WATER);
    }
  }
}

function surfaceY(g: Game, x: number): number {
  const { world } = g;
  for (let y = 0; y < world.h; y++) {
    if (world.isSolid(x, y)) return y - 1;
  }
  return world.h - 1;
}

function tree(g: Game, x: number, marked = false): void {
  g.addNode('tree', x, surfaceY(g, x), marked);
}

function boulder(g: Game, x: number, marked = false): void {
  g.addNode('boulder', x, surfaceY(g, x), marked);
}

function vein(g: Game, x: number, marked = false): void {
  g.addNode('vein', x, surfaceY(g, x), marked);
}

function townhall(g: Game, x: number): void {
  g.addBuilding('townhall', x, surfaceY(g, x) - 2);
}

function goal(g: Game, x: number): void {
  g.addBuilding('goal', x, surfaceY(g, x) - 2);
}

// ---- levels ------------------------------------------------------------------

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: 'lvl1.name',
    desc: 'lvl1.desc',
    width: 56,
    height: 26,
    // The very first order in the game: small enough that the loop (mark → saw →
    // deliver) closes once before the player can get bored of it. Card #70 cut it
    // from 8 to 6 — the lesson is "the chain works", not "the chain is long".
    objectives: [{ item: 'plank', amount: 6 }],
    medals: { gold: 180, silver: 270, bronze: 450 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'sawmill', 'demolish'],
    startStock: { log: 2 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1 },
    startWorkers: 4,
    build: (g) => {
      terrain(
        g,
        runs([
          [7, 8],
          [8, 4],
          [8, 18],
          [7, 10],
          [8, 6],
          [9, 10],
        ])
      );
      townhall(g, 10);
      goal(g, 46);
      tree(g, 18);
      tree(g, 21);
      tree(g, 24);
      tree(g, 27);
      tree(g, 31);
      boulder(g, 36);
    },
    hints: [
      {
        id: 'welcome',
        text: 'lvl1.hint.welcome',
        when: () => true,
      },
      {
        id: 'sawmill',
        text: 'lvl1.hint.sawmill',
        when: (g) => g.stock.log >= 6,
      },
      {
        id: 'deliver',
        text: 'lvl1.hint.deliver',
        when: (g) => g.stock.plank >= 2,
      },
    ],
    camera: { x: 12, y: 14 },
  },
  {
    id: 2,
    name: 'lvl2.name',
    desc: 'lvl2.desc',
    width: 64,
    height: 30,
    // The lift is the new verb here, so the haul is deliberately NOT also the
    // biggest one yet (stone 10 → 8, card #70): one new idea per level.
    objectives: [
      { item: 'stone', amount: 8 },
      { item: 'plank', amount: 6 },
    ],
    medals: { gold: 240, silver: 360, bronze: 540 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'sawmill', 'lift', 'demolish'],
    startStock: { log: 4, plank: 6, stone: 4 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 5,
    startThLevel: 2,
    build: (g) => {
      terrain(
        g,
        runs([
          [8, 22],
          [9, 2],
          [16, 14], // the shrine ledge
          [9, 2],
          [8, 12],
          [7, 12],
        ])
      );
      townhall(g, 4);
      goal(g, 28); // up on the ledge
      boulder(g, 9);
      tree(g, 11);
      tree(g, 14);
      tree(g, 17);
      boulder(g, 19);
      boulder(g, 21);
    },
    hints: [
      {
        id: 'ledge',
        text: 'lvl2.hint.ledge',
        when: () => true,
      },
      {
        id: 'lift',
        text: 'lvl2.hint.lift',
        when: (g) => g.time > 20,
      },
    ],
    camera: { x: 10, y: 16 },
  },
  {
    id: 3,
    name: 'lvl3.name',
    desc: 'lvl3.desc',
    width: 72,
    height: 32,
    // Three lines on the order sheet is a lot for level 3 — the counts came down
    // (card #70) but stone stays at 8, because *stone is the lesson here*: it is
    // both the delivery and the town-hall upgrade, which is what teaches the
    // keep-in-store reserve. Shrinking it would remove the pinch that teaches it.
    objectives: [
      { item: 'spear', amount: 3 },
      { item: 'plank', amount: 6 },
      { item: 'stone', amount: 8 },
    ],
    medals: { gold: 330, silver: 480, bronze: 690 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'ramp', 'sawmill', 'forge', 'lift', 'demolish'],
    startStock: { log: 6, plank: 6, stone: 2 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 5,
    startThLevel: 1,
    build: (g) => {
      terrain(
        g,
        runs([
          [9, 26],
          [5, 12], // the deep pit (5 tiles down — ramp a way in, then carry the iron back up)
          [10, 8],
          [9, 14],
          [8, 12],
        ])
      );
      goal(g, 0); // the garrison caravan waits at the west edge
      townhall(g, 5);
      // x 10..17 stays clear — room for the player's workshops
      tree(g, 18);
      boulder(g, 19);
      tree(g, 20);
      boulder(g, 21);
      tree(g, 22);
      boulder(g, 23);
      tree(g, 24);
      boulder(g, 25);
      // down in the pit
      boulder(g, 27);
      vein(g, 29);
      vein(g, 32);
      vein(g, 35);
      boulder(g, 37);
    },
    hints: [
      {
        id: 'pit',
        text: 'lvl3.hint.pit',
        when: () => true,
      },
      {
        id: 'reserve',
        text: 'lvl3.hint.reserve',
        when: (g) => g.stock.stone >= 2 && g.thLevel < 2,
      },
      {
        id: 'th2',
        text: 'lvl3.hint.th2',
        when: (g) => g.stock.plank >= 6,
      },
      {
        id: 'forge',
        text: 'lvl3.hint.forge',
        when: (g) => g.thLevel >= 2,
      },
    ],
    camera: { x: 10, y: 18 },
  },
  {
    id: 4,
    name: 'lvl4.name',
    desc: 'lvl4.desc',
    width: 84,
    height: 36,
    // Campaign 1's finale: still the longest climb of the four, but it used to be
    // the longest level in the WHOLE game at level 4 of 17 — a spike right where a
    // new player is most likely to walk away (card #70). The three terraces do the
    // teaching; the order sheet no longer piles on.
    objectives: [
      { item: 'plank', amount: 8 },
      { item: 'stone', amount: 8 },
      { item: 'spear', amount: 3 },
    ],
    medals: { gold: 420, silver: 600, bronze: 870 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'ramp', 'sawmill', 'forge', 'lift', 'demolish'],
    // The first ramp used to wait on the sawmill's first six planks, which is why
    // this level ran nearly three times as long as level 3 (card #70). Hand the
    // crew one ramp's worth up front: the climb starts immediately and the level
    // is about *chaining* the terraces, not about the wait before the first one.
    startStock: { log: 8, plank: 8, stone: 4 },
    startRoles: { hauler: 3, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 6,
    // Level 3 taught the town-hall upgrade (and the reserve that pays for it), so
    // this level starts where that lesson ended: Town Hall 2, a crew that can grow
    // to nine, and the forge already unlocked. Re-teaching it here is what turned
    // the campaign-1 finale into the longest level in the game (card #70) — three
    // terraces of hauling on six pairs of hands. The climb is the lesson.
    startThLevel: 2,
    build: (g) => {
      terrain(
        g,
        runs([
          [8, 22], // base camp — flat to the terrace wall so the mill sits by the stock
          [14, 16], // first terrace
          [15, 4],
          [20, 14], // second terrace
          [21, 4],
          [26, 14], // summit
          [25, 10],
        ])
      );
      townhall(g, 2);
      goal(g, 66);
      // base camp
      tree(g, 8);
      tree(g, 11);
      tree(g, 15);
      boulder(g, 13);
      boulder(g, 17);
      // first terrace
      tree(g, 25);
      tree(g, 28);
      tree(g, 33);
      boulder(g, 30);
      boulder(g, 35);
      // second terrace
      boulder(g, 45);
      boulder(g, 49);
      tree(g, 47);
      vein(g, 52);
      vein(g, 55);
    },
    hints: [
      {
        id: 'summit',
        text: 'lvl4.hint.summit',
        when: () => true,
      },
      {
        id: 'chain',
        // the crew starts at Town Hall 2 now, so key this on the first spear line
        // actually being reachable rather than on an upgrade that already happened
        text: 'lvl4.hint.chain',
        when: (g) => g.stock.iron >= 1 || g.stock.spear >= 1,
      },
      {
        id: 'ramp',
        text: 'lvl4.hint.ramp',
        when: (g) => g.time > 15,
      },
    ],
    camera: { x: 12, y: 22 },
  },

  // ============================ CAMPAIGN 2 — STORM & TIDE ============================
  // Water, dynamic weather and night. Unlocked once every Campaign 1 level is done.

  {
    id: 5,
    campaign: 2,
    name: 'lvl5.name',
    desc: 'lvl5.desc',
    width: 64,
    height: 28,
    objectives: [
      { item: 'plank', amount: 8 },
      { item: 'stone', amount: 6 },
    ],
    medals: { gold: 300, silver: 420, bronze: 660 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'ramp', 'sawmill', 'demolish'],
    startStock: { log: 2, plank: 4 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 5,
    build: (g) => {
      terrain(
        g,
        runs([
          [9, 22], // west bank: town, trees, boulders
          [4, 8], // the river channel
          [9, 20], // east bank
          [8, 14], // caravan meadow, a step down
        ])
      );
      water(g, 22, 29, 21); // the river: three tiles deep, flush under the banks
      townhall(g, 6);
      goal(g, 52);
      tree(g, 10);
      tree(g, 12);
      tree(g, 14);
      tree(g, 16);
      boulder(g, 18);
      boulder(g, 20);
      // the far shore has its own riches — worth the second trip
      tree(g, 34);
      tree(g, 37);
      boulder(g, 40);
      boulder(g, 43);
    },
    hints: [
      {
        id: 'river',
        text: 'lvl5.hint.river',
        when: () => true,
      },
      {
        id: 'bridge',
        text: 'lvl5.hint.bridge',
        when: (g) => g.stock.plank >= 4,
      },
    ],
    camera: { x: 10, y: 14 },
  },
  {
    id: 6,
    campaign: 2,
    name: 'lvl6.name',
    desc: 'lvl6.desc',
    width: 68,
    height: 30,
    // trimmed (card #70): with the rain penalty on top, an 18-item sheet made the
    // second level of campaign 2 run longer than the flood level that follows it
    objectives: [
      { item: 'plank', amount: 8 },
      { item: 'stone', amount: 8 },
    ],
    medals: { gold: 300, silver: 450, bronze: 690 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'ramp', 'sawmill', 'demolish'],
    startStock: { log: 2, plank: 2 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 5,
    // A long calm and a short sting, not a 45/30 mush (card #70): a rhythm the
    // player can read off the forecast and *use* — fell in the sun, saw in the
    // rain. The forecast now spells the −30 % out, so the pattern is learnable.
    weather: [
      { kind: 'clear', duration: 55 },
      { kind: 'rain', duration: 25 },
    ],
    // The budget's playful introduction (card #70). The pond is three tiles wide
    // and the crew gets six planks' worth of bridge: enough that a first bridge
    // can be mis-laid and re-laid, few enough that the number on the chip is read.
    toolLimit: { platform: 6 },
    build: (g) => {
      terrain(
        g,
        runs([
          [9, 12],
          [8, 10],
          [7, 5], // the hollow
          [5, 3], // a sunken dip in the hollow floor…
          [7, 4],
          [8, 10],
          [9, 12],
          [10, 12], // caravan rise
        ])
      );
      water(g, 27, 29, 24); // …holds a pond one step below the banks
      townhall(g, 4);
      goal(g, 58);
      // west side of the pond
      tree(g, 14);
      tree(g, 17);
      tree(g, 20);
      tree(g, 24);
      boulder(g, 9);
      boulder(g, 11);
      // east side
      tree(g, 33);
      tree(g, 46);
      tree(g, 48);
      boulder(g, 36);
      boulder(g, 39);
      boulder(g, 50);
    },
    hints: [
      {
        id: 'forecast',
        text: 'lvl6.hint.forecast',
        when: () => true,
      },
      {
        id: 'pond',
        text: 'lvl6.hint.pond',
        when: (g) => g.time > 25,
      },
      {
        // the budget's first appearance — say it before a drag comes up short.
        // Reads "they have started spending" rather than comparing against the
        // cap: the cap is a tuning knob and lives one field up, not in a predicate.
        id: 'budget',
        text: 'lvl6.hint.budget',
        when: (g) => g.toolSpent('platform') > 0,
      },
    ],
    camera: { x: 8, y: 16 },
  },
  {
    id: 7,
    campaign: 2,
    name: 'lvl7.name',
    desc: 'lvl7.desc',
    width: 72,
    height: 30,
    objectives: [
      { item: 'spear', amount: 3 },
      { item: 'plank', amount: 6 },
    ],
    medals: { gold: 420, silver: 600, bronze: 900 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'ramp', 'sawmill', 'forge', 'lantern', 'demolish'],
    startStock: { log: 3, plank: 2, stone: 2 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 5,
    startThLevel: 2,
    night: true,
    build: (g) => {
      terrain(
        g,
        runs([
          [9, 16], // the town fires
          [10, 14],
          [11, 14],
          [12, 14],
          [13, 14], // the iron ridge, far in the dark
        ])
      );
      townhall(g, 4);
      goal(g, 62);
      tree(g, 10); // in the town light
      tree(g, 13);
      tree(g, 18); // from here on: darkness
      tree(g, 21);
      boulder(g, 25);
      boulder(g, 28);
      boulder(g, 31);
      tree(g, 35);
      boulder(g, 38);
      vein(g, 44);
      vein(g, 48);
      vein(g, 52);
    },
    hints: [
      {
        id: 'dark',
        text: 'lvl7.hint.dark',
        when: () => true,
      },
      {
        id: 'forge2',
        text: 'lvl7.hint.forge2',
        when: (g) => g.stock.iron >= 1,
      },
    ],
    camera: { x: 8, y: 16 },
  },
  {
    id: 8,
    campaign: 2,
    name: 'lvl8.name',
    desc: 'lvl8.desc',
    width: 72,
    height: 32,
    objectives: [
      { item: 'stone', amount: 10 },
      { item: 'plank', amount: 8 },
    ],
    medals: { gold: 420, silver: 600, bronze: 900 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'ramp', 'sawmill', 'lift', 'rope', 'demolish'],
    startStock: { log: 2, plank: 6, stone: 2 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 2, miner: 1 },
    startWorkers: 6,
    startThLevel: 2,
    // The tide's clock. Shortened from 90s of calm to 70 (card #70) so the first
    // rise lands while the player is still building rather than after they have
    // already won the race — the level is *about* the water arriving.
    weather: [
      { kind: 'clear', duration: 70 },
      { kind: 'rain', duration: 20 },
    ],
    // two rises: the basin floor drowns, then the water laps one row higher.
    // The shelves stay dry forever, so a shelf-height bridge can always cross
    // the new lake — the tide punishes slowness but never softlocks the level.
    flood: { start: 25, min: 24 },
    build: (g) => {
      terrain(
        g,
        runs([
          [12, 14], // town hill — safe
          [9, 12], // west shelf — stays dry
          [6, 12], // the deep basin — drowns
          [9, 12], // east shelf — stays dry
          [13, 22], // caravan hill — safe
        ])
      );
      townhall(g, 4);
      goal(g, 60);
      // town hill: wood to get the mill going
      tree(g, 9);
      tree(g, 11);
      tree(g, 13);
      // west shelf
      boulder(g, 18);
      tree(g, 20);
      tree(g, 22);
      boulder(g, 24);
      // the basin — richest ground, drowns first
      boulder(g, 28);
      tree(g, 31);
      boulder(g, 35);
      // east shelf
      tree(g, 42);
      boulder(g, 45);
      // caravan hill
      tree(g, 52);
      boulder(g, 54);
      tree(g, 66);
      boulder(g, 68);
      boulder(g, 70);
    },
    hints: [
      {
        id: 'tide',
        text: 'lvl8.hint.tide',
        when: () => true,
      },
      {
        id: 'rampout',
        text: 'lvl8.hint.rampout',
        when: (g) => g.time > 20,
      },
      {
        id: 'bridge2',
        text: 'lvl8.hint.bridge2',
        when: (g) => g.waterRow !== null,
      },
    ],
    camera: { x: 8, y: 18 },
  },
  {
    id: 9,
    campaign: 2,
    name: 'lvl9.name',
    desc: 'lvl9.desc',
    width: 96,
    height: 36,
    objectives: [
      { item: 'plank', amount: 10 },
      { item: 'stone', amount: 10 },
      { item: 'spear', amount: 5 },
    ],
    medals: { gold: 600, silver: 840, bronze: 1200 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'ramp', 'sawmill', 'forge', 'lift', 'rope', 'lantern', 'demolish'],
    startStock: { log: 4, plank: 6, stone: 4 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 2, miner: 1 },
    startWorkers: 6,
    // Campaign 2's finale starts at Town Hall 2 for the same reason level 4 does
    // (card #70): re-earning a level-3 lesson on a 96-tile night mountain with six
    // pairs of hands made this the longest level in the game by a wide margin.
    // Town Hall 3 is still on the table if the player wants twelve hands.
    startThLevel: 2,
    night: true,
    // Campaign 2's finale, and the first sky that really bites: the storm now
    // brakes the wheels AND gutters the lanterns (WEATHER_RULES), so a 25s gust on
    // a night ascent is the level's boss. The two clear windows are the plan.
    weather: [
      { kind: 'clear', duration: 50 },
      { kind: 'rain', duration: 20 },
      { kind: 'clear', duration: 30 },
      { kind: 'storm', duration: 25 },
    ],
    build: (g) => {
      terrain(
        g,
        runs([
          [10, 28], // base camp
          [15, 22], // first terrace
          [20, 22], // second terrace — the iron
          [25, 24], // the summit
        ])
      );
      townhall(g, 4);
      goal(g, 80);
      // base camp — the trees stand in the town light, the boulders just beyond
      tree(g, 9);
      tree(g, 11);
      tree(g, 13);
      boulder(g, 15);
      boulder(g, 17);
      // first terrace
      tree(g, 30);
      tree(g, 33);
      tree(g, 36);
      tree(g, 39);
      boulder(g, 41);
      boulder(g, 44);
      // second terrace — the iron, deepest in the dark
      boulder(g, 52);
      boulder(g, 54);
      vein(g, 57);
      vein(g, 60);
      vein(g, 63);
    },
    hints: [
      {
        id: 'finale',
        text: 'lvl9.hint.finale',
        when: () => true,
      },
      {
        id: 'upgrade2',
        // the crew is at its cap and there is still mountain left — point at TH3
        text: 'lvl9.hint.upgrade2',
        when: (g) => g.workers.length >= g.maxWorkers && g.thLevel < 3 && g.time > 60,
      },
      {
        id: 'stormplan',
        text: 'lvl9.hint.stormplan',
        when: (g) => g.weather === 'storm',
      },
    ],
    camera: { x: 10, y: 22 },
  },

  // ============================ CAMPAIGN 3 — WEIGHT & WHEEL ============================
  // The Counterweight Hoist: two cars on a pulley, and one law — the heavier
  // side sinks. Teaching arc: introduce (send down) → invert (ballast lifts
  // cargo up) → combine (a plateau forge fed by the wheel, under storm brakes).
  //
  // Card #70 gave the campaign a SECOND axis, because a wheel is already a thing
  // that runs on a rhythm: the caravan's dock window (LevelDef.convoy). It arrives,
  // loads, and rolls out again, so goods have to be *ready when it is* — buffer
  // through the gap, empty the store into the window. Its own teaching arc runs
  // alongside the hoist's: 50/15 (barely noticeable) → 40/20 (plan for it) →
  // 30/25 (the window is the level), the last one under storm brakes as well.

  {
    id: 10,
    campaign: 3,
    name: 'lvl10.name',
    desc: 'lvl10.desc',
    width: 60,
    height: 30,
    objectives: [
      { item: 'plank', amount: 6 },
      { item: 'stone', amount: 4 },
    ],
    medals: { gold: 330, silver: 480, bronze: 720 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'sawmill', 'hoist', 'demolish'],
    // the dock window, at its gentlest: away barely longer than a hoist cycle
    convoy: { open: 50, closed: 15 },
    startStock: { log: 2, plank: 3, iron: 1 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 5,
    startThLevel: 2,
    build: (g) => {
      terrain(
        g,
        runs([
          [13, 28], // the mining shelf: town, trees, boulders
          [8, 32], // the valley below, where the caravan waits
        ])
      );
      townhall(g, 3);
      goal(g, 44);
      tree(g, 9);
      tree(g, 11);
      tree(g, 13);
      tree(g, 15);
      boulder(g, 18);
      boulder(g, 20);
    },
    hints: [
      {
        id: 'wheel',
        text: 'lvl10.hint.wheel',
        when: () => true,
      },
      {
        id: 'route',
        text: 'lvl10.hint.route',
        when: (g) => g.hoists.some((b) => b.state === 'ready'),
      },
      {
        id: 'hop',
        text: 'lvl10.hint.hop',
        when: (g) => g.time > 25,
      },
      {
        // the convoy's first departure — explain the empty dock the moment it happens
        id: 'convoy',
        text: 'lvl10.hint.convoy',
        when: (g) => !g.convoyOpen,
      },
    ],
    camera: { x: 6, y: 14 },
  },
  {
    id: 11,
    campaign: 3,
    name: 'lvl11.name',
    desc: 'lvl11.desc',
    width: 64,
    height: 30,
    objectives: [
      { item: 'plank', amount: 8 },
      { item: 'stone', amount: 6 },
    ],
    medals: { gold: 420, silver: 600, bronze: 900 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'sawmill', 'hoist', 'demolish'],
    // tighter: the gap is now long enough that a full car's worth can pile up
    convoy: { open: 40, closed: 20 },
    startStock: { log: 4, plank: 3, iron: 1 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 5,
    startThLevel: 2,
    build: (g) => {
      terrain(
        g,
        runs([
          [8, 22], // the valley: town and timber
          [15, 42], // the ridge: the caravan and its stone
        ])
      );
      // the old adit: a floor-level tunnel into the ridge with a ladder shaft
      // left by the miners of the Ember Road. Empty hands climb it freely —
      // cargo will not touch a ladder, so goods only ride the wheel.
      const { world } = g;
      for (let x = 22; x < 30; x++) world.set(x, 21, T.AIR);
      for (let y = 15; y <= 21; y++) world.set(30, y, T.LADDER);
      townhall(g, 4);
      goal(g, 36); // up on the ridge
      tree(g, 10);
      tree(g, 12);
      tree(g, 14);
      tree(g, 16);
      boulder(g, 26);
      boulder(g, 28);
      boulder(g, 32);
      boulder(g, 34);
    },
    hints: [
      {
        id: 'up',
        text: 'lvl11.hint.up',
        when: () => true,
      },
      {
        id: 'ballast',
        text: 'lvl11.hint.ballast',
        when: (g) => g.hoists.some((b) => b.state === 'ready'),
      },
      {
        id: 'backpath',
        text: 'lvl11.hint.backpath',
        when: (g) => g.time > 20,
      },
    ],
    camera: { x: 8, y: 14 },
  },
  {
    id: 12,
    campaign: 3,
    name: 'lvl12.name',
    desc: 'lvl12.desc',
    width: 76,
    height: 32,
    objectives: [
      { item: 'spear', amount: 3 },
      { item: 'plank', amount: 6 },
    ],
    medals: { gold: 600, silver: 840, bronze: 1200 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'sawmill', 'forge', 'hoist', 'rope', 'demolish'],
    // the campaign's mastery test: the window is short, the storm takes the wheel
    // for a quarter of every cycle, and there is exactly ONE wheel to place. The
    // rope stays legal and storm-proof — that is the alternative worth finding.
    convoy: { open: 30, closed: 25 },
    toolLimit: { hoist: 1 },
    startStock: { log: 4, plank: 3, iron: 1, stone: 2 },
    startRoles: { hauler: 3, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 6,
    startThLevel: 2,
    weather: [
      { kind: 'clear', duration: 60 },
      { kind: 'storm', duration: 20 },
    ],
    build: (g) => {
      terrain(
        g,
        runs([
          [9, 26], // the valley: town and timber
          [17, 50], // the high plateau: iron, stone — and room for a forge
        ])
      );
      // the old adit again — deeper this time (see Level 11)
      const { world } = g;
      for (let x = 26; x < 36; x++) world.set(x, 22, T.AIR);
      for (let y = 15; y <= 22; y++) world.set(36, y, T.LADDER);
      townhall(g, 4);
      goal(g, 58); // the garrison caravan, high on the plateau
      tree(g, 10);
      tree(g, 12);
      tree(g, 14);
      tree(g, 16);
      tree(g, 18);
      boulder(g, 21);
      // the plateau: stone for ballast and the forge, iron for the order
      boulder(g, 32);
      boulder(g, 34);
      vein(g, 40);
      vein(g, 43);
      vein(g, 46);
      boulder(g, 50);
      boulder(g, 53);
    },
    hints: [
      {
        id: 'highforge',
        text: 'lvl12.hint.highforge',
        when: () => true,
      },
      {
        id: 'stormbrake',
        text: 'lvl12.hint.stormbrake',
        when: (g) => g.weather === 'storm',
      },
      {
        // the two clocks meet: the wheel is braked AND the caravan is standing there
        id: 'window',
        text: 'lvl12.hint.window',
        when: (g) => g.weather === 'storm' && g.convoyOpen,
      },
    ],
    camera: { x: 8, y: 16 },
  },
  {
    id: 13,
    campaign: 4,
    name: 'lvl13.name',
    desc: 'lvl13.desc',
    width: 50,
    height: 22,
    objectives: [{ item: 'iron', amount: 4 }],
    medals: { gold: 480, silver: 660, bronze: 960 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'sawmill', 'workshop', 'dig', 'demolish'],
    startStock: { log: 6, plank: 12, stone: 6, iron: 3 },
    startRoles: { hauler: 2, builder: 1, miner: 1, digger: 1 },
    startWorkers: 5,
    startThLevel: 2,
    build: (g) => {
      const { world } = g;
      // One flat meadow — but the iron and the caravan are buried in a sealed
      // gallery below it. The player crafts a shovel, sinks a VERTICAL SHAFT, then
      // tunnels HORIZONTALLY across the gallery to the seam and the caravan.
      // Everything the crew hauls stays flat or drops downhill, so no lift needed.
      terrain(g, runs([[6, 50]])); // surface row 16; rock down to bedrock at 21
      townhall(g, 4);
      tree(g, 9);
      tree(g, 11);
      tree(g, 13);
      boulder(g, 16);
      boulder(g, 18);
      // --- the sealed gallery (row 19), carved only where the buildings/seam
      // sit; the shaft down and the tunnel across are the player's to dig ---
      // the caravan, walled into a room at the east end of the gallery
      for (let x = 38; x <= 41; x++) for (let y = 17; y <= 19; y++) world.set(x, y, T.AIR);
      g.addBuilding('goal', 38, 17);
      // the buried iron seam: a vein embedded in the rock mid-gallery, revealed
      // (and made mineable) only once a tunnel is dug through its cell
      g.addNode('vein', 34, 19);
    },
    hints: [
      {
        id: 'seam',
        text: 'lvl13.hint.seam',
        when: () => true,
      },
      {
        id: 'shaft',
        text: 'lvl13.hint.shaft',
        when: (g) => g.stock.shovel > 0 || g.equippedDiggers() > 0,
      },
      {
        id: 'tunnel',
        text: 'lvl13.hint.tunnel',
        when: (g) => g.workers.some((w) => w.cy >= 18),
      },
    ],
    camera: { x: 4, y: 8 },
  },
  {
    id: 14,
    campaign: 4,
    name: 'lvl14.name',
    desc: 'lvl14.desc',
    width: 56,
    height: 26,
    objectives: [
      { item: 'iron', amount: 6 },
      { item: 'stone', amount: 6 },
    ],
    medals: { gold: 240, silver: 360, bronze: 600 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'sawmill', 'workshop', 'lift', 'dig', 'demolish'],
    startStock: { log: 2, plank: 6, stone: 2, shovel: 1 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1, digger: 1 },
    startWorkers: 6,
    startThLevel: 2,
    build: (g) => {
      // Level 13 taught digging where every haul ran flat or downhill. This one
      // inverts it: the seam is buried, the caravan loads on the SURFACE — so
      // the iron must ride UP. The trick: a Cargo Lift built on the shaft floor
      // uses the player's own shaft as its mast — and a ladder run down the
      // shaft, beside the mast, carries empty hands to the seam and back (no free
      // fall down the well any more, #48); the lift rides the iron up.
      terrain(g, runs([[7, 56]])); // surface row 19; rock 22-24, bedrock 25
      townhall(g, 3);
      goal(g, 48);
      tree(g, 9);
      tree(g, 11);
      tree(g, 13);
      tree(g, 15);
      boulder(g, 18);
      boulder(g, 20);
      boulder(g, 22);
      // the buried seam: veins embedded in the rock at row 22, revealed as the
      // player's tunnel passes through them (dig a shaft ~x27, then head east)
      g.addNode('vein', 30, 22);
      g.addNode('vein', 33, 22);
      g.addNode('vein', 36, 22);
    },
    hints: [
      {
        id: 'well',
        text: 'lvl14.hint.well',
        when: () => true,
      },
      {
        id: 'liftup',
        text: 'lvl14.hint.liftup',
        when: (g) => g.nodes.some((n) => n.kind === 'vein' && n.yieldLeft < 4),
      },
      {
        id: 'mast',
        text: 'lvl14.hint.mast',
        when: (g) => g.lifts.some((l) => l.state === 'ready'),
      },
    ],
    camera: { x: 10, y: 12 },
  },
  {
    id: 15,
    campaign: 4,
    name: 'lvl15.name',
    desc: 'lvl15.desc',
    width: 56,
    height: 28,
    objectives: [
      { item: 'iron', amount: 6 },
      { item: 'plank', amount: 6 },
    ],
    medals: { gold: 330, silver: 480, bronze: 780 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'sawmill', 'workshop', 'rope', 'lantern', 'dig', 'demolish'],
    // iron 2 = two shovels' worth: the workshop crafts a spare, so a digger
    // trapped below (the classic first-run mistake) never softlocks the level
    startStock: { log: 6, plank: 6, stone: 5, iron: 2 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1, digger: 1 },
    startWorkers: 6,
    startThLevel: 2,
    night: true,
    build: (g) => {
      // Night above, iron below — and this time the CARAVAN itself is walled
      // into the deep (the mirror of 14: deliveries flow DOWN). Diggers feel
      // their way in the dark, but miners need light, so lanterns must ride
      // into the gallery. One well serves both directions: cargo slides down
      // it on a rope, and a ladder run into the same shaft (slung AFTER the
      // rope — a laddered well reads as ground and refuses the anchor) is the
      // climb home. The ladder also decks the mouth, so surface traffic keeps
      // flowing over the well instead of being severed by it.
      terrain(g, runs([[8, 56]])); // surface row 20; rock 23-26, bedrock 27
      const { world } = g;
      // the caravan vault, sealed at the east end of the gallery (like lvl 13)
      for (let x = 44; x <= 47; x++) for (let y = 22; y <= 24; y++) world.set(x, y, T.AIR);
      g.addBuilding('goal', 44, 22);
      townhall(g, 3);
      // one tree in the town light; x 8..14 stays clear for the lit workshops
      tree(g, 7);
      // beyond the light — a lantern chain wakes them one pool at a time
      tree(g, 19);
      tree(g, 21);
      tree(g, 28);
      boulder(g, 24);
      boulder(g, 26);
      // the buried veins at gallery depth (row 24): two in the dark mid-tunnel,
      // one in the buried caravan's own fire-glow — the freebie that teaches
      // "light makes veins minable" before the player hauls a lantern down
      g.addNode('vein', 35, 24);
      g.addNode('vein', 39, 24);
      g.addNode('vein', 42, 24);
    },
    hints: [
      {
        id: 'dark',
        text: 'lvl15.hint.dark',
        when: () => true,
      },
      {
        id: 'ropeway',
        text: 'lvl15.hint.ropeway',
        when: (g) => g.workers.some((w) => w.cy >= 24),
      },
      {
        id: 'glow',
        text: 'lvl15.hint.glow',
        when: (g) => g.nodes.some((n) => n.kind === 'vein' && n.yieldLeft < 4),
      },
    ],
    camera: { x: 8, y: 12 },
  },
  {
    id: 16,
    campaign: 4,
    name: 'lvl16.name',
    desc: 'lvl16.desc',
    width: 84,
    height: 32,
    objectives: [
      { item: 'spear', amount: 5 },
      { item: 'stone', amount: 4 },
    ],
    medals: { gold: 720, silver: 990, bronze: 1440 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'ramp', 'sawmill', 'forge', 'workshop', 'lift', 'hoist', 'dig', 'demolish'],
    // The finale states its machines out loud: one well-lift, one cliff-wheel
    // (card #70). The whole level is designed around exactly that pair, so the
    // budget is not a restriction so much as the level naming its own shape —
    // and demolishing either one gives the slot back if it lands in the wrong cell.
    toolLimit: { lift: 1, hoist: 1 },
    startStock: { log: 4, plank: 6, stone: 4, iron: 2 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1, digger: 1 },
    startWorkers: 6,
    startThLevel: 2,
    weather: [
      { kind: 'clear', duration: 50 },
      { kind: 'rain', duration: 25 },
      { kind: 'clear', duration: 35 },
      { kind: 'storm', duration: 18 },
    ],
    build: (g) => {
      // The campaign finale: iron in the deep, the caravan on the heights, and
      // storms that seize every wheel between them. Dig the seam out below,
      // lift it up the shaft, forge spears in the meadow — then hoist them up
      // the cliff on plateau-stone ballast (which lands below, ready for
      // reuse). The old miners left an adit with a ladder in the cliff foot,
      // so the crew can reach the plateau — empty hands only, as ever.
      terrain(
        g,
        runs([
          [10, 46], // the meadow: town, timber, the buried seam
          [17, 38], // the plateau: the caravan, its stone — and a 7-tile cliff
        ])
      );
      const { world } = g;
      // the old adit: a floor-level tunnel into the cliff with a ladder
      // chimney to the plateau top (see levels 11/12 — same Ember Road crew)
      for (let x = 46; x < 52; x++) world.set(x, 21, T.AIR);
      for (let y = 15; y <= 21; y++) world.set(52, y, T.LADDER);
      townhall(g, 3);
      goal(g, 70); // high on the plateau
      // the meadow: timber and stone for the whole production line
      tree(g, 9);
      tree(g, 11);
      tree(g, 13);
      tree(g, 15);
      boulder(g, 24);
      boulder(g, 26);
      boulder(g, 28);
      // the buried seam (row 26): shaft down ~x30, tunnel east through it
      g.addNode('vein', 34, 26);
      g.addNode('vein', 38, 26);
      g.addNode('vein', 42, 26);
      // plateau stone: the delivery order AND the hoist's ballast supply
      boulder(g, 56);
      boulder(g, 59);
      boulder(g, 62);
      boulder(g, 65);
      boulder(g, 68);
    },
    hints: [
      {
        id: 'vault',
        text: 'lvl16.hint.vault',
        when: () => true,
      },
      {
        id: 'wheel',
        text: 'lvl16.hint.wheel',
        when: (g) => g.stock.spear >= 1 || g.buildings.some((b) => b.kind === 'forge' && (b.outputs.spear ?? 0) > 0),
      },
      {
        id: 'storm',
        text: 'lvl16.hint.storm',
        when: (g) => g.weather === 'storm',
      },
      {
        id: 'crew',
        text: 'lvl16.hint.crew',
        when: (g) => g.time > 150 && g.thLevel < 3,
      },
    ],
    camera: { x: 10, y: 16 },
  },
  {
    id: 17,
    campaign: 4,
    name: 'lvl17.name',
    desc: 'lvl17.desc',
    width: 72,
    height: 30,
    // The last level used to be the shortest run in the game — the dusk arrived
    // and the order was already filled, which is the one thing this level must not
    // do (card #70). A bigger sheet pushes the tail of the work past nightfall,
    // where the lantern race actually happens.
    objectives: [
      { item: 'plank', amount: 10 },
      { item: 'stone', amount: 8 },
    ],
    medals: { gold: 360, silver: 540, bronze: 840 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'ramp', 'sawmill', 'lantern', 'demolish'],
    startStock: { log: 3, plank: 2, stone: 2 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 5,
    startThLevel: 2,
    // The showcase for the living clock: opens at high noon and turns the whole
    // day over during play. Harvest is free while the sun holds; once dusk deepens
    // past NIGHT_WORK_DARK the far ground goes dark and only lantern-lit paths
    // still work — so the player must run the light out along the route BEFORE
    // nightfall. Not a `night` level: the darkness arrives on the clock.
    //
    // The rate went from 0.05 to 0.09 (card #70) because at 0.05 dusk began at
    // t=120s and the level was over in 110 — the last level in the game never once
    // showed the thing it exists to show. At 0.09 a full day turns in ~4½ minutes:
    // the work gate closes around t≈85s, right when the order is half filled.
    startHour: 12,
    dayNight: { rate: 0.09 },
    build: (g) => {
      terrain(
        g,
        runs([
          [9, 24], // the vale floor: town and the near timber
          [10, 24], // a gentle rise east
          [11, 24], // the far shelf — first to lose the light
        ])
      );
      townhall(g, 4);
      goal(g, 64); // far east, out past where the dark will fall
      // near timber & stone — cut these in the free daylight
      tree(g, 9);
      tree(g, 12);
      tree(g, 15);
      boulder(g, 19);
      boulder(g, 22);
      // the mid vale
      tree(g, 30);
      tree(g, 33);
      boulder(g, 44);
      boulder(g, 47);
      // the far shelf — reached only by a lantern-lit route once night falls
      tree(g, 56);
      tree(g, 59);
      boulder(g, 62);
    },
    hints: [
      {
        id: 'dusk',
        text: 'lvl17.hint.dusk',
        when: () => true,
      },
      {
        id: 'nightfall',
        text: 'lvl17.hint.dark',
        when: (g) => g.nightAmount() > 0.2,
      },
    ],
    camera: { x: 8, y: 16 },
  },
];
