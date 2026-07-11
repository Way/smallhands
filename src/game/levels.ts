import { T } from './types';
import type { MedalTimes, ObjectiveReq, Role, Tool } from './types';
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
    name: 'First Steps',
    desc: 'Meet your smallhands. Chop wood, saw planks, and load the trade caravan.',
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
        text: 'Welcome, overseer! You never control the <b>smallhands</b> directly — you shape the world, they do the work. Select the <b>Harvest</b> tool and mark a few trees.',
        when: () => true,
      },
      {
        id: 'sawmill',
        text: 'Logs are piling up! Place a <b>Sawmill</b> (costs 6 logs) on flat ground. A builder will construct it, then haulers will feed it logs — 1 log becomes 2 planks.',
        when: (g) => g.stock.log >= 6,
      },
      {
        id: 'deliver',
        text: 'Planks are flowing! Haulers automatically carry them to the <b>caravan</b> on the right. Fill the order to finish the level.',
        when: (g) => g.stock.plank >= 2,
      },
    ],
    camera: { x: 12, y: 14 },
  },
  {
    id: 2,
    name: 'The Cliff Shrine',
    desc: 'The shrine sits on a high ledge — and loaded smallhands refuse ladders. Send goods up anyway.',
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
        text: 'The shrine is <b>7 tiles up</b> that cliff. Ladders get empty-handed smallhands up and down — but a hauler carrying stone <b>will not touch a ladder</b>.',
        when: () => true,
      },
      {
        id: 'lift',
        text: 'To move goods up, build a <b>Cargo Lift</b> on the ground right beside the cliff face. It hoists a loaded hauler to the top. Add a <b>ladder</b> nearby so they can climb back down for the next load!',
        when: (g) => g.time > 20,
      },
    ],
    camera: { x: 10, y: 16 },
  },
  {
    id: 3,
    name: 'Iron in the Deep',
    desc: 'Iron waits at the bottom of an old pit. Upgrade the town hall, forge spears for the garrison.',
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
        text: 'Iron veins glitter in <b>the pit</b>. Empty-handed smallhands can hop down safely (up to 5 tiles) — but hauling iron out again is the real puzzle. Plan your lift money!',
        when: () => true,
      },
      {
        id: 'th2',
        text: 'The <b>Forge</b> and <b>Cargo Lift</b> need Town Hall level 2. Stockpile planks and stone, then press <b>Upgrade</b> in the crew panel.',
        when: (g) => g.stock.plank >= 6,
      },
      {
        id: 'forge',
        text: 'Town Hall upgraded! Build a <b>Forge</b> — it turns 1 plank + 1 iron into a spear for the garrison.',
        when: (g) => g.thLevel >= 2,
      },
    ],
    camera: { x: 10, y: 18 },
  },
  {
    id: 4,
    name: 'The Summit Beacon',
    desc: 'A beacon must be raised on the mountain. Three terraces, one grand supply line.',
    width: 84,
    height: 36,
    objectives: [
      { item: 'plank', amount: 10 },
      { item: 'stone', amount: 10 },
      { item: 'spear', amount: 4 },
    ],
    medals: { gold: 480, silver: 660, bronze: 960 },
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'sawmill', 'forge', 'lift', 'demolish'],
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
        text: 'The <b>beacon site</b> is three terraces up. Every plank, stone and spear must climb the whole mountain — chain lifts and ladders into one supply line.',
        when: () => true,
      },
      {
        id: 'chain',
        text: 'Tip: lifts only need Town Hall 2 — but each terrace needs its own lift. Consider moving production <b>up the mountain</b> instead of hauling everything from below.',
        when: (g) => g.thLevel >= 2,
      },
    ],
    camera: { x: 12, y: 22 },
  },
];
