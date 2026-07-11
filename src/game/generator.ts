// Procedural level generator: seeded, difficulty-graded, and verified against
// the static solvability checks in leveldata.ts. Levels are built from
// known-good terrain grammar (flats, cliffs, pits, terraces) so the classic
// Smallhands puzzle — getting goods UP — always has a construction answer.

import { T } from './types';
import type { ItemType, NodeKind, ObjectiveReq, Role } from './types';
import { World } from './world';
import { encodeTiles, makeLevelId, verifyLevel, MAX_W, MAX_H } from './leveldata';
import type { CustomLevelData } from './leveldata';

export interface GenOptions {
  seed: string;
  difficulty: number; // 1 (gentle) .. 5 (brutal)
}

// ---- seeded RNG -------------------------------------------------------------

function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private next: () => number;
  constructor(seed: string) {
    this.next = mulberry32(xmur3(seed)());
  }
  float(): number {
    return this.next();
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

// ---- terrain grammar -----------------------------------------------------------

interface Flat {
  x0: number;
  x1: number; // inclusive
  h: number; // ground thickness at this flat
  pit: boolean;
}

interface Plan {
  heights: number[];
  flats: Flat[];
  upCliffs: number;
  pits: number;
}

function planTerrain(rng: Rng, d: number): Plan {
  const heights: number[] = [];
  const flats: Flat[] = [];
  let upCliffs = 0;
  let pits = 0;

  let h = rng.int(7, 9);
  const pushFlat = (len: number, pit = false) => {
    const x0 = heights.length;
    for (let i = 0; i < len; i++) heights.push(h);
    flats.push({ x0, x1: heights.length - 1, h, pit });
  };

  pushFlat(rng.int(13, 17)); // home flat, roomy enough for the Town Hall
  const features = 1 + d + (rng.float() < 0.4 ? 1 : 0);
  for (let i = 0; i < features; i++) {
    const roll = rng.float();
    const kind = roll < (d >= 3 ? 0.45 : 0.4) ? 'up' : roll < 0.75 ? 'pit' : 'down';
    if (kind === 'up' && h < 22) {
      h += rng.int(3, Math.min(6, 3 + d));
      upCliffs++;
      pushFlat(rng.int(8, 13));
    } else if (kind === 'down' && h > 9) {
      h -= rng.int(3, 4);
      pushFlat(rng.int(8, 13));
    } else {
      // a pit: down 3..5 and back up — empty hands hop in, cargo needs a lift
      const depth = rng.int(3, Math.min(5, 2 + d));
      h -= depth;
      pits++;
      pushFlat(rng.int(6, 9), true);
      h += depth;
      pushFlat(rng.int(7, 11));
    }
  }
  // goal flat: on higher difficulties bias the finale upward
  if (d >= 2 && rng.float() < 0.6 && h < 22) {
    h += rng.int(3, Math.min(6, 3 + d));
    upCliffs++;
  }
  pushFlat(rng.int(10, 14));

  while (heights.length > MAX_W) heights.pop();
  return { heights, flats: flats.filter((f) => f.x1 < heights.length), upCliffs, pits };
}

// ---- naming -----------------------------------------------------------------------

const NAME_A = ['Windy', 'Sunken', 'Broken', 'Mossy', 'Silent', 'Amber', 'Foggy', 'Wild', 'Old', 'Copper', 'Hollow', 'Thorny'];
const NAME_B = ['Terraces', 'Hollow', 'Reach', 'Steps', 'Quarry', 'Bluffs', 'Crossing', 'Shelf', 'Climb', 'Gorge', 'Cradle', 'Heights'];

// ---- the generator ------------------------------------------------------------------

export function generateLevel(opts: GenOptions): CustomLevelData {
  const d = Math.max(1, Math.min(5, Math.round(opts.difficulty)));
  const rng = new Rng(`${opts.seed}|d${d}`);
  const plan = planTerrain(rng, d);

  const width = plan.heights.length;
  const height = Math.min(MAX_H, Math.max(...plan.heights) + 10);
  const world = new World(width, height);
  for (let x = 0; x < width; x++) {
    const surfaceY = height - plan.heights[x];
    for (let y = surfaceY; y < height; y++) {
      const t = y === height - 1 ? T.BEDROCK : y === surfaceY ? T.GRASS : y - surfaceY <= 2 ? T.DIRT : T.ROCK;
      world.set(x, y, t);
    }
  }
  const standY = (x: number) => height - plan.heights[x] - 1;

  // Town Hall on the home flat, goal on the last (non-pit) flat.
  const home = plan.flats[0];
  const thX = home.x0 + 2;
  const goalFlat = [...plan.flats].reverse().find((f) => !f.pit && f.x1 - f.x0 >= 6)!;
  const goalX = Math.min(goalFlat.x1 - 4, goalFlat.x0 + Math.floor((goalFlat.x1 - goalFlat.x0) / 2));

  // ---- objectives by difficulty ----
  const objectives: ObjectiveReq[] = [{ item: 'plank', amount: 6 + 2 * d + rng.int(0, 2) }];
  if (d >= 2) objectives.push({ item: 'stone', amount: 4 + 2 * d + rng.int(0, 2) });
  if (d >= 3) objectives.push({ item: 'spear', amount: d - 1 });
  const spears = objectives.find((o) => o.item === 'spear')?.amount ?? 0;
  const needStone = objectives.find((o) => o.item === 'stone')?.amount ?? 0;
  const needPlank = objectives[0].amount;

  // ---- start conditions ----
  const startThLevel = d <= 2 && plan.upCliffs > 0 ? 2 : 1;
  const startStock: Partial<Record<ItemType, number>> = {
    log: 4,
    plank: Math.max(0, 7 - d),
    stone: Math.max(0, 5 - d),
  };
  const startRoles: Partial<Record<Role, number>> = {
    hauler: 2,
    builder: 1,
    woodcutter: 1,
    ...(d >= 2 || needStone > 0 ? { miner: 1 } : {}),
  };
  const startWorkers = 4 + (d >= 3 ? 1 : 0) + (d >= 5 ? 1 : 0);

  // ---- resource budget (generous at low difficulty, tight at high) ----
  const margin = 1.7 - d * 0.09;
  const planksTotal = needPlank + spears + (startThLevel < 2 ? 8 : 0) + (d >= 4 ? 10 : 0);
  const logsTotal = Math.ceil(Math.max(0, planksTotal - (startStock.plank ?? 0)) / 2) + 6 + 5; // sawmill + ladder budget
  const stoneTotal = needStone + (plan.upCliffs + plan.pits) * 2 + (startThLevel < 2 ? 6 : 0) + (spears > 0 ? 4 : 0) + (d >= 4 ? 10 : 0);
  const ironTotal = spears + (d >= 4 ? 2 : 0);
  const trees = Math.max(2, Math.ceil((logsTotal * margin) / 4));
  const boulders = Math.max(needStone > 0 ? 2 : 1, Math.ceil((stoneTotal * margin) / 4));
  const veins = spears > 0 ? Math.max(1, Math.ceil((ironTotal * margin) / 4)) : 0;

  // ---- scatter nodes ----
  const nodes: CustomLevelData['nodes'] = [];
  const used = new Set<number>();
  // keep building zones clear
  for (let x = thX - 2; x < thX + 7; x++) used.add(x);
  for (let x = goalX - 2; x < goalX + 6; x++) used.add(x);

  const columnsOf = (flatFilter: (f: Flat) => boolean): number[] => {
    const cols: number[] = [];
    for (const f of plan.flats.filter(flatFilter)) {
      for (let x = f.x0 + 1; x < f.x1; x++) if (!used.has(x)) cols.push(x);
    }
    return rng.shuffle(cols);
  };

  const place = (kind: NodeKind, count: number, cols: number[]) => {
    let placed = 0;
    for (const x of cols) {
      if (placed >= count) break;
      if (used.has(x) || used.has(x - 1)) continue; // breathing room
      used.add(x);
      nodes.push({ kind, x, y: standY(x) });
      placed++;
    }
    return placed;
  };

  // trees favour the early half, boulders spread everywhere,
  // veins hide in pits (or the far flats when there is no pit)
  const mid = Math.floor(width / 2);
  const early = columnsOf((f) => !f.pit && f.x0 < mid);
  const anywhere = columnsOf((f) => !f.pit);
  const pitCols = columnsOf((f) => f.pit);
  const farCols = columnsOf((f) => !f.pit && f.x0 >= mid);

  let treesLeft = trees - place('tree', trees, early);
  if (treesLeft > 0) place('tree', treesLeft, anywhere);
  let bLeft = boulders - place('boulder', boulders, anywhere);
  if (bLeft > 0) bLeft -= place('boulder', bLeft, pitCols);
  if (veins > 0) {
    let vLeft = veins - place('vein', veins, pitCols.length ? pitCols : farCols);
    if (vLeft > 0) vLeft -= place('vein', vLeft, anywhere);
  }

  const name = `${rng.pick(NAME_A)} ${rng.pick(NAME_B)}`;
  const featureBits: string[] = [];
  if (plan.upCliffs) featureBits.push(`${plan.upCliffs} cliff${plan.upCliffs > 1 ? 's' : ''} to hoist goods up`);
  if (plan.pits) featureBits.push(`${plan.pits} pit${plan.pits > 1 ? 's' : ''} to haul goods out of`);
  const desc = `Generated (seed "${opts.seed}", difficulty ${d})${featureBits.length ? ' — ' + featureBits.join(', ') : ''}.`;

  return {
    v: 1,
    id: makeLevelId(),
    name,
    desc,
    width,
    height,
    tiles: encodeTiles(world.tiles),
    nodes,
    townhall: { x: thX, y: standY(thX) - 2 },
    goal: { x: goalX, y: standY(goalX) - 2 },
    objectives,
    startStock,
    startRoles,
    startWorkers,
    startThLevel,
    seed: opts.seed,
  };
}

// Generate and re-roll (with seed variants) until the static verifier is
// satisfied. The grammar rarely produces broken levels, but "rarely" is not
// good enough for a level the player is about to trust with 20 minutes.
export function generateVerifiedLevel(opts: GenOptions): CustomLevelData {
  let best: CustomLevelData | null = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    const seed = attempt === 0 ? opts.seed : `${opts.seed}#${attempt}`;
    const data = generateLevel({ seed, difficulty: opts.difficulty });
    data.seed = opts.seed; // keep the seed the player typed
    const report = verifyLevel(data);
    if (report.ok && report.warnings.length === 0) return data;
    if (report.ok && !best) best = data;
  }
  // fall back to the best "ok with warnings" attempt, or the raw roll
  return best ?? generateLevel(opts);
}

export function randomSeed(): string {
  const words = ['oak', 'fern', 'gale', 'moss', 'flint', 'ember', 'brook', 'ridge', 'dew', 'pine', 'clay', 'wren'];
  const a = words[Math.floor(Math.random() * words.length)];
  const b = words[Math.floor(Math.random() * words.length)];
  return `${a}-${b}-${Math.floor(Math.random() * 900 + 100)}`;
}

// The daily challenge: one shared seed per calendar day, difficulty rising
// through the week (Mon 2 … Sun 4) so the ritual stays fresh.
export function dailySeed(date = new Date()): { seed: string; difficulty: number; label: string } {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dow = date.getDay(); // 0 = Sunday
  const difficulty = dow === 0 ? 4 : dow <= 3 ? 2 : 3;
  return { seed: `daily-${y}-${m}-${day}`, difficulty, label: `${y}-${m}-${day}` };
}
