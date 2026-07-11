// Serializable custom-level format: created by the in-game editor or the
// procedural generator, stored in localStorage and shareable as a text code.

import { FOOTPRINTS, ITEM_TYPES, ROLES, T } from './types';
import type { ItemType, MedalTimes, NodeKind, ObjectiveReq, Role } from './types';
import { World, liftTopFor, ropeDropFor } from './world';
import { settle } from './nav';
import type { LevelDef } from './levels';

export interface CustomLevelData {
  v: 1;
  id: string; // stable identity for saves / completion tracking
  name: string;
  desc: string;
  width: number;
  height: number;
  tiles: string; // run-length encoded terrain, see encodeTiles()
  nodes: { kind: NodeKind; x: number; y: number }[];
  townhall: { x: number; y: number };
  goal: { x: number; y: number };
  objectives: ObjectiveReq[];
  startStock: Partial<Record<ItemType, number>>;
  startRoles: Partial<Record<Role, number>>;
  startWorkers: number;
  startThLevel: number;
  seed?: string; // set when produced by the generator
}

export const MIN_W = 32;
export const MAX_W = 160;
export const MIN_H = 20;
export const MAX_H = 60;

export function makeLevelId(): string {
  return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// ---- tile run-length encoding ----------------------------------------------

export function encodeTiles(tiles: Uint8Array): string {
  const parts: string[] = [];
  let i = 0;
  while (i < tiles.length) {
    const t = tiles[i];
    let n = 1;
    while (i + n < tiles.length && tiles[i + n] === t) n++;
    parts.push(n === 1 ? String(t) : `${t}x${n}`);
    i += n;
  }
  return parts.join(',');
}

export function decodeTiles(s: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let i = 0;
  for (const part of s.split(',')) {
    const [t, n] = part.includes('x') ? part.split('x').map(Number) : [Number(part), 1];
    for (let k = 0; k < n && i < length; k++) out[i++] = t;
  }
  return out;
}

export function worldFromData(data: CustomLevelData): World {
  const world = new World(data.width, data.height);
  world.tiles = decodeTiles(data.tiles, data.width * data.height);
  return world;
}

// ---- blank level -------------------------------------------------------------

export function blankLevelData(width = 64, height = 28): CustomLevelData {
  const world = new World(width, height);
  const groundH = 8;
  for (let x = 0; x < width; x++) {
    for (let y = height - groundH; y < height; y++) {
      const t =
        y === height - 1 ? T.BEDROCK : y === height - groundH ? T.GRASS : y - (height - groundH) <= 2 ? T.DIRT : T.ROCK;
      world.set(x, y, t);
    }
  }
  const standY = height - groundH - 1;
  return {
    v: 1,
    id: makeLevelId(),
    name: 'My Level',
    desc: 'A custom level.',
    width,
    height,
    tiles: encodeTiles(world.tiles),
    nodes: [
      { kind: 'tree', x: 20, y: standY },
      { kind: 'tree', x: 24, y: standY },
      { kind: 'boulder', x: 28, y: standY },
    ],
    townhall: { x: 4, y: standY - 2 },
    goal: { x: width - 10, y: standY - 2 },
    objectives: [{ item: 'plank', amount: 6 }],
    startStock: { log: 2 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1 },
    startWorkers: 4,
    startThLevel: 1,
  };
}

// ---- LevelDef bridge -----------------------------------------------------------

// Medal thresholds for generated/custom levels, derived from the order size
// and the walking distances the map implies. Deliberately a touch generous —
// hand-tuned thresholds are for the campaign; these keep dailies fair.
export function medalTimesFor(data: CustomLevelData): MedalTimes {
  const items = data.objectives.reduce((s, o) => s + o.amount, 0);
  const par = 100 + items * 15 + Math.round(data.width * 0.8);
  const r = (v: number) => Math.round(v / 10) * 10;
  return { gold: r(par), silver: r(par * 1.5), bronze: r(par * 2.3) };
}

let customDefSeq = 1000;

export function levelDefFromData(data: CustomLevelData): LevelDef {
  return {
    id: customDefSeq++,
    name: data.name,
    desc: data.desc,
    width: data.width,
    height: data.height,
    objectives: data.objectives.filter((o) => o.amount > 0),
    startStock: { ...data.startStock },
    startRoles: { ...data.startRoles },
    startWorkers: data.startWorkers,
    startThLevel: data.startThLevel,
    medals: medalTimesFor(data),
    camera: { x: Math.max(0, data.townhall.x - 6), y: Math.max(0, data.townhall.y - 6) },
    build: (g) => {
      g.world.tiles = decodeTiles(data.tiles, data.width * data.height);
      g.addBuilding('townhall', data.townhall.x, data.townhall.y);
      g.addBuilding('goal', data.goal.x, data.goal.y);
      for (const n of data.nodes) g.addNode(n.kind, n.x, n.y);
    },
  };
}

// ---- share codes ------------------------------------------------------------------

const CODE_PREFIX = 'SMH1.';

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeShareCode(data: CustomLevelData): string {
  const json = JSON.stringify(data);
  return CODE_PREFIX + b64encode(new TextEncoder().encode(json));
}

export function decodeShareCode(code: string): CustomLevelData | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith(CODE_PREFIX)) return null;
  try {
    const json = new TextDecoder().decode(b64decode(trimmed.slice(CODE_PREFIX.length)));
    return sanitizeLevelData(JSON.parse(json));
  } catch {
    return null;
  }
}

// Best-effort validation of untrusted level data (import codes, old saves).
export function sanitizeLevelData(raw: unknown): CustomLevelData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const width = clampInt(r.width, MIN_W, MAX_W);
  const height = clampInt(r.height, MIN_H, MAX_H);
  if (width === null || height === null || typeof r.tiles !== 'string') return null;
  const inBounds = (p: unknown): p is { x: number; y: number } => {
    if (typeof p !== 'object' || p === null) return false;
    const q = p as Record<string, unknown>;
    return (
      typeof q.x === 'number' && typeof q.y === 'number' && q.x >= 0 && q.x < width && q.y >= 0 && q.y < height
    );
  };
  if (!inBounds(r.townhall) || !inBounds(r.goal)) return null;
  const nodeKinds: NodeKind[] = ['tree', 'boulder', 'vein'];
  const nodes = Array.isArray(r.nodes)
    ? (r.nodes as unknown[])
        .filter((n): n is { kind: NodeKind; x: number; y: number } => {
          if (typeof n !== 'object' || n === null) return false;
          const q = n as Record<string, unknown>;
          return nodeKinds.includes(q.kind as NodeKind) && inBounds(q);
        })
        .slice(0, 200)
        .map((n) => ({ kind: n.kind, x: Math.floor(n.x), y: Math.floor(n.y) }))
    : [];
  const objectives = Array.isArray(r.objectives)
    ? (r.objectives as unknown[])
        .filter((o): o is ObjectiveReq => {
          if (typeof o !== 'object' || o === null) return false;
          const q = o as Record<string, unknown>;
          return ITEM_TYPES.includes(q.item as ItemType) && typeof q.amount === 'number' && q.amount > 0;
        })
        .slice(0, ITEM_TYPES.length)
        .map((o) => ({ item: o.item, amount: Math.min(99, Math.floor(o.amount)) }))
    : [];
  const numRecord = <K extends string>(v: unknown, keys: readonly K[], max: number): Partial<Record<K, number>> => {
    const out: Partial<Record<K, number>> = {};
    if (typeof v === 'object' && v !== null) {
      for (const k of keys) {
        const n = (v as Record<string, unknown>)[k];
        if (typeof n === 'number' && n > 0) out[k] = Math.min(max, Math.floor(n));
      }
    }
    return out;
  };
  return {
    v: 1,
    id: typeof r.id === 'string' && r.id.length <= 40 ? r.id : makeLevelId(),
    name: typeof r.name === 'string' ? r.name.slice(0, 40) : 'Imported level',
    desc: typeof r.desc === 'string' ? r.desc.slice(0, 140) : '',
    width,
    height,
    tiles: r.tiles,
    nodes,
    townhall: { x: Math.floor((r.townhall as { x: number }).x), y: Math.floor((r.townhall as { y: number }).y) },
    goal: { x: Math.floor((r.goal as { x: number }).x), y: Math.floor((r.goal as { y: number }).y) },
    objectives,
    startStock: numRecord(r.startStock, ITEM_TYPES, 99),
    startRoles: numRecord(r.startRoles, ROLES, 12),
    startWorkers: clampInt(r.startWorkers, 1, 12) ?? 4,
    startThLevel: clampInt(r.startThLevel, 1, 3) ?? 1,
    seed: typeof r.seed === 'string' ? r.seed.slice(0, 60) : undefined,
  };
}

function clampInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

// ---- verification ---------------------------------------------------------------
//
// Static solvability analysis. It cannot fully prove a level is beatable, but
// it catches the classic authoring mistakes:
//   - buildings floating or buried
//   - resource nodes without ground
//   - goods that can never reach the stockpile or the caravan
//     (checked on a "player-augmented" movement graph that assumes the player
//      may build platforms across gaps and lifts on any valid cliff face)
//   - a raw-resource budget that cannot cover the delivery order

export interface VerifyReport {
  ok: boolean;
  problems: string[]; // definitely broken
  warnings: string[]; // suspicious but possibly fine
}

export function verifyLevel(data: CustomLevelData): VerifyReport {
  const problems: string[] = [];
  const warnings: string[] = [];
  const world = worldFromData(data);

  const footprintOk = (x: number, y: number, w: number, h: number): boolean => {
    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        if (world.get(x + dx, y + dy) !== T.AIR) return false;
      }
      if (!world.isSolid(x + dx, y + h)) return false;
    }
    return true;
  };
  const th = data.townhall;
  const goal = data.goal;
  const fpTh = FOOTPRINTS.townhall;
  const fpGoal = FOOTPRINTS.goal;
  if (!footprintOk(th.x, th.y, fpTh.w, fpTh.h)) problems.push('Town Hall is buried or floating — it needs clear air on solid, level ground.');
  if (!footprintOk(goal.x, goal.y, fpGoal.w, fpGoal.h)) problems.push('The caravan (goal) is buried or floating — it needs clear air on solid, level ground.');

  for (const n of data.nodes) {
    if (!world.isPassable(n.x, n.y) || !world.isSolid(n.x, n.y + 1)) {
      problems.push(`A ${n.kind} at (${n.x}, ${n.y}) is not standing on solid ground.`);
    }
  }

  const objectives = data.objectives.filter((o) => o.amount > 0);
  if (objectives.length === 0) problems.push('No delivery objectives — the level cannot be won.');

  // resource budget: raw yield + starting stock vs. what the order needs
  const yieldOf = (kind: NodeKind) => data.nodes.filter((n) => n.kind === kind).length * 4;
  const have = {
    log: (data.startStock.log ?? 0) + yieldOf('tree'),
    stone: (data.startStock.stone ?? 0) + yieldOf('boulder'),
    iron: (data.startStock.iron ?? 0) + yieldOf('vein'),
    plank: data.startStock.plank ?? 0,
    spear: data.startStock.spear ?? 0,
  };
  const need = { plank: 0, stone: 0, iron: 0, spear: 0, log: 0 };
  for (const o of objectives) need[o.item] += o.amount;
  const spearsToMake = Math.max(0, need.spear - have.spear);
  const planksNeeded = need.plank + spearsToMake; // forge uses 1 plank per spear
  const planksToSaw = Math.max(0, planksNeeded - have.plank);
  // sawmill yields 2 planks per log; the mill itself costs 6 logs
  const logsNeeded = need.log + (planksToSaw > 0 ? Math.ceil(planksToSaw / 2) + 6 : 0);
  if (have.log < logsNeeded) warnings.push(`Wood may run short: the order needs ~${logsNeeded} logs (incl. a sawmill) but only ${have.log} are obtainable.`);
  if (have.stone < need.stone) problems.push(`Not enough stone in the level: order needs ${need.stone}, only ${have.stone} obtainable.`);
  if (have.iron < spearsToMake) problems.push(`Not enough iron in the level: spears need ${spearsToMake}, only ${have.iron} obtainable.`);
  if (spearsToMake > 0 && data.startThLevel < 2) {
    const thStone = 6; // TH1→2 upgrade stone cost
    if (have.stone < need.stone + thStone + 4) warnings.push('Spears need a forge (Town Hall 2) — stone for the upgrade and forge may run short.');
  }

  // reachability on the player-augmented graph
  const thDoor = settle(world, th.x + 1, th.y + fpTh.h - 1);
  if (!thDoor) {
    problems.push('No standable spot at the Town Hall door.');
  } else {
    const airReach = floodPassable(world, thDoor.x, thDoor.y);
    for (const n of data.nodes) {
      if (!airReach.has(world.key(n.x, n.y))) {
        warnings.push(`The ${n.kind} at (${n.x}, ${n.y}) is sealed off from the Town Hall — no air path connects them.`);
      }
    }
    const cargoFromTh = cargoReach(world, thDoor.x, thDoor.y);
    const goalCells = approachKeys(world, goal.x, goal.y, fpGoal.w, fpGoal.h);
    if (![...goalCells].some((k) => cargoFromTh.has(k))) {
      problems.push('Loaded smallhands can never reach the caravan from the Town Hall — even with platforms and lifts. Goods cannot be delivered.');
    }
    const thCells = approachKeys(world, th.x, th.y, fpTh.w, fpTh.h);
    for (const n of data.nodes) {
      const spot = settle(world, n.x, n.y);
      if (!spot) continue;
      const reach = cargoReach(world, spot.x, spot.y);
      if (![...thCells].some((k) => reach.has(k))) {
        warnings.push(`Goods harvested at the ${n.kind} (${n.x}, ${n.y}) may never reach the stockpile — check for a lift-able cliff face or a platform route.`);
      }
    }
  }

  return { ok: problems.length === 0, problems, warnings };
}

function approachKeys(world: World, x: number, y: number, w: number, h: number): Set<number> {
  const cells = new Set<number>();
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      if (world.isStandable(x + dx, y + dy)) cells.add(world.key(x + dx, y + dy));
    }
  }
  for (const bx of [x - 1, x + w]) {
    for (let dy = -1; dy <= h; dy++) {
      if (world.isStandable(bx, y + dy)) cells.add(world.key(bx, y + dy));
    }
  }
  return cells;
}

// All passable cells connected to (sx, sy) through air/ladders (4-neighbour).
// Empty-handed workers can in principle reach any of these with enough
// ladders and platforms, so a node OUTSIDE this set is definitely sealed off.
function floodPassable(world: World, sx: number, sy: number): Set<number> {
  const seen = new Set<number>();
  const queue: number[] = [world.key(sx, sy)];
  seen.add(queue[0]);
  while (queue.length) {
    const key = queue.pop()!;
    const x = key % world.w;
    const y = Math.floor(key / world.w);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!world.isPassable(nx, ny)) continue;
      const nk = world.key(nx, ny);
      if (!seen.has(nk)) {
        seen.add(nk);
        queue.push(nk);
      }
    }
  }
  return seen;
}

// Where can a CARRYING smallhand get to from (sx, sy), assuming the player
// builds whatever helps: platforms bridging any air corridor that starts at
// a standable cell, cargo lifts on every valid cliff face, and rope anchors
// on every valid cliff edge (cargo may slide DOWN ropes).
// Carrying rules still apply: no ladders, falls of at most 2 tiles.
function cargoReach(world: World, sx: number, sy: number): Set<number> {
  const start = settle(world, sx, sy);
  const seen = new Set<number>();
  if (!start) return seen;
  const queue: number[] = [world.key(start.x, start.y)];
  seen.add(queue[0]);
  const visit = (x: number, y: number) => {
    const k = world.key(x, y);
    if (!seen.has(k)) {
      seen.add(k);
      queue.push(k);
    }
  };
  const maxFall = 2; // MAX_FALL_CARRY
  while (queue.length) {
    const key = queue.pop()!;
    const x = key % world.w;
    const y = Math.floor(key / world.w);
    for (const dx of [-1, 1]) {
      const nx = x + dx;
      // walk / step up one
      if (world.isStandable(nx, y)) visit(nx, y);
      if (world.isStandable(nx, y - 1) && world.isPassable(x, y - 1) && world.get(nx, y - 1) !== T.LADDER) {
        visit(nx, y - 1);
      }
      // walk off and fall (short falls only)
      if (world.isPassable(nx, y) && !world.isStandable(nx, y)) {
        let fy = y;
        let ok = true;
        while (!world.isStandable(nx, fy)) {
          fy++;
          if (fy - y > maxFall || !world.isPassable(nx, fy)) {
            ok = false;
            break;
          }
        }
        if (ok) visit(nx, fy);
      }
      // platform bridge: a chain of platforms can extend from here across any
      // air corridor at this height, letting the worker walk at row y
      let bx = x + dx;
      while (
        world.inBounds(bx, y) &&
        world.get(bx, y) === T.AIR &&
        (world.get(bx, y + 1) === T.AIR || world.isSupport(bx, y + 1))
      ) {
        visit(bx, y); // platform below makes this standable
        bx += dx;
      }
    }
    // a lift could be built here
    const topY = liftTopFor(world, x, y);
    if (topY !== null) visit(x, topY);
    // a rope anchor could be built here
    const drop = ropeDropFor(world, x, y);
    if (drop !== null) visit(x + drop.side, drop.bottomY);
  }
  return seen;
}
