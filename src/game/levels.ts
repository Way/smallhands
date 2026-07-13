import { T } from './types';
import type { MedalTimes, ObjectiveReq, Role, Tool, WeatherPhase } from './types';
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
  campaign?: number; // 1 (default) or 2 — grouping + unlock gate on the level select
  weather?: WeatherPhase[]; // looping phase schedule; omit for an always-clear sky
  night?: boolean; // night level: work only happens in the light (see lanterns)
  flood?: { start: number; min: number }; // rising tide: first flood row & highest row it reaches
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
    objectives: [{ item: 'plank', amount: 8 }],
    medals: { gold: 210, silver: 330, bronze: 540 },
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
    objectives: [
      { item: 'stone', amount: 10 },
      { item: 'plank', amount: 6 },
    ],
    medals: { gold: 270, silver: 390, bronze: 600 },
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
    objectives: [
      { item: 'spear', amount: 4 },
      { item: 'plank', amount: 8 },
      { item: 'stone', amount: 8 },
    ],
    medals: { gold: 360, silver: 510, bronze: 720 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'sawmill', 'forge', 'lift', 'demolish'],
    startStock: { log: 6, plank: 4, stone: 2 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 5,
    startThLevel: 1,
    build: (g) => {
      terrain(
        g,
        runs([
          [9, 26],
          [5, 12], // the deep pit (5 tiles down — a safe hop for empty hands)
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
    objectives: [
      { item: 'plank', amount: 10 },
      { item: 'stone', amount: 10 },
      { item: 'spear', amount: 4 },
    ],
    medals: { gold: 480, silver: 660, bronze: 960 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'ramp', 'sawmill', 'forge', 'lift', 'demolish'],
    startStock: { log: 6, plank: 2, stone: 4 },
    startRoles: { hauler: 3, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 6,
    startThLevel: 1,
    build: (g) => {
      terrain(
        g,
        runs([
          [8, 18], // base camp
          [9, 4],
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
        text: 'lvl4.hint.chain',
        when: (g) => g.thLevel >= 2,
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
    objectives: [
      { item: 'plank', amount: 10 },
      { item: 'stone', amount: 8 },
    ],
    medals: { gold: 330, silver: 480, bronze: 720 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'ramp', 'sawmill', 'demolish'],
    startStock: { log: 2, plank: 2 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1, miner: 1 },
    startWorkers: 5,
    weather: [
      { kind: 'clear', duration: 45 },
      { kind: 'rain', duration: 30 },
    ],
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
    weather: [
      { kind: 'clear', duration: 90 },
      { kind: 'rain', duration: 25 },
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
    night: true,
    weather: [
      { kind: 'clear', duration: 45 },
      { kind: 'rain', duration: 25 },
      { kind: 'clear', duration: 30 },
      { kind: 'storm', duration: 20 },
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
        text: 'lvl9.hint.upgrade2',
        when: (g) => g.time > 30 && g.thLevel < 2,
      },
      {
        id: 'stormplan',
        text: 'lvl9.hint.stormplan',
        when: (g) => g.weather === 'storm',
      },
    ],
    camera: { x: 10, y: 22 },
  },
];
