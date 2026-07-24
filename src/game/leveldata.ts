// Serializable custom-level format: created by the in-game editor or the
// procedural generator, stored in localStorage and shareable as a text code.

import { BUILD_TIME, FOOTPRINTS, ITEM_TYPES, MAX_FALL_CARRY, NODE_YIELD, ROLES, T, TOOL_DEFS } from './types';
import type {
  BuildingKind,
  ItemType,
  MedalTimes,
  NodeKind,
  ObjectiveReq,
  Role,
  WeatherKind,
  WeatherPhase,
} from './types';
import { BIOMES } from '../engine/biomes';
import type { Biome } from '../engine/biomes';
import { World, liftTopFor, ropeDropFor } from './world';
import { settle } from './nav';
import { t } from '../engine/i18n';
import type { LevelDef } from './levels';

// A building carried by a *snapshot* code (see game/report.ts): a level as it
// stands mid-play, not as it starts. The editor never emits these — it has no
// building tool — so the field is optional and an editor round-trip drops them.
//
// Lift/rope/hoist geometry (liftTopY, ropeBottomY, ropeSide) is deliberately
// absent: it is a pure function of the terrain, which the same code already
// carries, so levelDefFromData recomputes it. Storing it would be a second
// source of truth free to disagree with the tiles.
export interface SnapshotBuilding {
  kind: BuildingKind; // never 'townhall' or 'goal' — those have their own fields
  x: number;
  y: number;
  ready: boolean;
  progress?: number; // blueprints only: seconds of construction done so far
  paused?: boolean; // producers only: player is holding conversion
  // Producer buffers. A stalled producer is one of the commonest things a
  // report is filed about, and "sawmill holding 2 logs" versus "sawmill empty"
  // is the whole difference between reproducing it and not.
  inputs?: Partial<Record<ItemType, number>>;
  outputs?: Partial<Record<ItemType, number>>;
}

// The parts of a level's *type* that live on LevelDef rather than in the world
// grid. Without these a snapshot of a flood level reloads as a calm day map and
// the reported bug simply cannot happen again. Every field is optional and
// omitted for a plain day level, so authored levels and old codes are unchanged.
export interface SnapshotWorld {
  night?: boolean;
  startHour?: number; // 0..24 clock the level opens on
  dayNightRate?: number; // LevelDef.dayNight.rate — live day→night cycle
  flood?: { start: number; min: number };
  weather?: WeatherPhase[]; // looping schedule
  weatherIdx?: number; // which phase the run had reached
  waterRow?: number; // the risen water table at snapshot time
  keep?: Partial<Record<ItemType, number>>; // per-item hauling floors
  digOrders?: number[]; // world tile indices the player marked to dig
  groundItems?: { item: ItemType; x: number; y: number }[];
}

export interface CustomLevelData {
  v: 1;
  id: string; // stable identity for saves / completion tracking
  name: string;
  desc: string;
  width: number;
  height: number;
  tiles: string; // run-length encoded terrain, see encodeTiles()
  // `yieldLeft` is only set by snapshot codes; a freshly authored node omits it
  // and starts at the full NODE_YIELD amount.
  nodes: { kind: NodeKind; x: number; y: number; yieldLeft?: number }[];
  townhall: { x: number; y: number };
  goal: { x: number; y: number };
  objectives: ObjectiveReq[];
  startStock: Partial<Record<ItemType, number>>;
  startRoles: Partial<Record<Role, number>>;
  startWorkers: number;
  startThLevel: number;
  seed?: string; // set when produced by the generator
  biome?: Biome; // terrain palette family; omit for the classic meadow look
  buildings?: SnapshotBuilding[]; // snapshot codes only, see SnapshotBuilding
  world?: SnapshotWorld; // snapshot codes only, see SnapshotWorld
}

// The building kinds a snapshot may carry, as a real allowlist. A bare
// `BUILD_TIME[kind] !== undefined` test is NOT one: every object inherits
// `constructor`, `toString` and friends, so "kind": "constructor" would pass,
// get written to localStorage by the level importer, and place a building whose
// footprint lookup resolves to an inherited function. Own keys only.
export const CONSTRUCTIBLE: ReadonlySet<BuildingKind> = new Set(Object.keys(BUILD_TIME) as BuildingKind[]);

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
    name: t('ed.defaultName'),
    desc: t('custom.defaultDesc'),
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

// A stable per-content id. The renderer keys its scenic decoration off
// `level.id` — set pieces and waterfalls roll on `levelHash(id)`, rock strata on
// `id % 4` — so the id must be a pure function of the terrain, or the SAME level
// decorates itself differently each time it is booted. A monotonic counter here
// did exactly that: restarting a level into a live page (retry, editor playtest,
// level→level) grew ghost scenery from the previous roll, following render order
// rather than content (card #31). Biome is deliberately excluded: the same
// terrain under two biomes must place identical decoration, differing only in
// palette. Custom levels track saves/completion by `CustomLevelData.id`
// (see recordKey / completedCustom), never by this numeric id, so a content
// collision here is cosmetic-only.
function contentId(data: CustomLevelData): number {
  const s = `${data.width}x${data.height}:${data.tiles}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function levelDefFromData(data: CustomLevelData): LevelDef {
  return {
    id: contentId(data),
    name: data.name,
    desc: data.desc,
    width: data.width,
    height: data.height,
    objectives: data.objectives.filter((o) => o.amount > 0),
    // Authored custom levels are daytime levels, so the lantern (a night tool)
    // is left out — but a snapshot of a night level needs it, or the map it
    // reproduces is unplayable in the dark it was reported in.
    allowedTools: data.world?.night
      ? TOOL_DEFS.map((t) => t.id)
      : TOOL_DEFS.map((t) => t.id).filter((id) => id !== 'lantern'),
    startStock: { ...data.startStock },
    startRoles: { ...data.startRoles },
    startWorkers: data.startWorkers,
    startThLevel: data.startThLevel,
    biome: data.biome,
    medals: medalTimesFor(data),
    camera: { x: Math.max(0, data.townhall.x - 6), y: Math.max(0, data.townhall.y - 6) },
    // Level *type*, restored only from a snapshot (see SnapshotWorld). An
    // authored custom level has no `world` block and stays a plain day map.
    night: data.world?.night,
    startHour: data.world?.startHour,
    dayNight: data.world?.dayNightRate !== undefined ? { rate: data.world.dayNightRate } : undefined,
    flood: data.world?.flood,
    weather: data.world?.weather,
    build: (g) => {
      g.world.tiles = decodeTiles(data.tiles, data.width * data.height);
      g.addBuilding('townhall', data.townhall.x, data.townhall.y);
      g.addBuilding('goal', data.goal.x, data.goal.y);
      for (const n of data.nodes) {
        g.addNode(n.kind, n.x, n.y);
        // Patch the partial yield afterwards rather than widening addNode's
        // signature, which every hand-authored campaign level calls.
        if (n.yieldLeft !== undefined) g.nodes[g.nodes.length - 1].yieldLeft = n.yieldLeft;
      }
      // Snapshot buildings. Terrain is already in place above, so the lift and
      // rope geometry recomputes to exactly what it was when the snapshot was
      // taken — see SnapshotBuilding on why it is not serialized.
      for (const b of data.buildings ?? []) {
        const built = g.addBuilding(b.kind, b.x, b.y, b.ready);
        if (!b.ready) built.progress = b.progress ?? 0;
        if (b.paused) built.paused = true;
        if (b.inputs) built.inputs = { ...b.inputs };
        if (b.outputs) built.outputs = { ...b.outputs };
        if (b.kind === 'lift') {
          built.liftTopY = liftTopFor(g.world, b.x, b.y) ?? b.y;
          built.liftCarY = b.y;
        } else if (b.kind === 'rope' || b.kind === 'hoist') {
          const drop = ropeDropFor(g.world, b.x, b.y);
          if (drop) {
            built.ropeSide = drop.side;
            built.ropeBottomY = drop.bottomY;
          }
        }
      }
      // Remaining snapshot state. These are plain Game fields the constructor
      // does not touch after build(), so setting them here sticks.
      const w = data.world;
      if (!w) return;
      if (w.waterRow !== undefined) g.waterRow = w.waterRow;
      if (w.weatherIdx !== undefined) g.weatherIdx = w.weatherIdx;
      if (w.keep) g.keep = { ...g.keep, ...w.keep };
      for (const idx of w.digOrders ?? []) g.digOrders.add(idx);
      // Placed at their reported cell rather than through dropItem, which
      // re-settles the position and would quietly move the very item the
      // report is about.
      for (const gi of w.groundItems ?? []) {
        g.groundItems.push({
          id: g.id(),
          item: gi.item,
          x: gi.x,
          y: gi.y,
          reserved: false,
          bounce: 0,
          stranded: false,
          idleFor: 0,
        });
      }
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
  // An item bag that stays absent when empty, so authored levels and old codes
  // keep serializing byte-identically.
  const bagField = <K extends string>(key: K, v: unknown): Partial<Record<K, Partial<Record<ItemType, number>>>> => {
    const bag = numRecord(v, ITEM_TYPES, 99);
    return Object.keys(bag).length ? ({ [key]: bag } as Partial<Record<K, Partial<Record<ItemType, number>>>>) : {};
  };
  const nodeKinds: NodeKind[] = ['tree', 'boulder', 'vein'];
  const nodes = Array.isArray(r.nodes)
    ? (r.nodes as unknown[])
        .filter((n): n is { kind: NodeKind; x: number; y: number; yieldLeft?: unknown } => {
          if (typeof n !== 'object' || n === null) return false;
          const q = n as Record<string, unknown>;
          return nodeKinds.includes(q.kind as NodeKind) && inBounds(q);
        })
        .slice(0, 200)
        .map((n) => {
          // A snapshot node carries its remaining yield; an authored one omits
          // it and the sim fills the full amount. 0 is meaningful and must
          // survive: a spent node is never removed from game.nodes, it stays on
          // as a stump, and clamping it up to 1 would hand back a live tree.
          const left = clampInt(n.yieldLeft, 0, NODE_YIELD[n.kind].amount);
          return {
            kind: n.kind,
            x: Math.floor(n.x),
            y: Math.floor(n.y),
            ...(left === null ? {} : { yieldLeft: left }),
          };
        })
    : [];
  // Snapshot buildings (see SnapshotBuilding). townhall/goal are absent from
  // BUILD_TIME and so are filtered out here — they have their own fields and
  // would otherwise be placed twice.
  const buildings = Array.isArray(r.buildings)
    ? (r.buildings as unknown[])
        .filter((b): b is Record<string, unknown> => {
          if (typeof b !== 'object' || b === null) return false;
          const q = b as Record<string, unknown>;
          return CONSTRUCTIBLE.has(q.kind as BuildingKind) && inBounds(q);
        })
        .slice(0, 200)
        .map((b) => {
          const kind = b.kind as BuildingKind;
          const ready = b.ready !== false;
          // Construction progress is seconds, not a whole number — clampInt
          // would quietly floor a half-built blueprint back down.
          const progress = ready ? null : clampFloat(b.progress, 0, BUILD_TIME[kind]!);
          return {
            kind,
            x: Math.floor(b.x as number),
            y: Math.floor(b.y as number),
            ready,
            ...(progress === null ? {} : { progress }),
            ...(b.paused === true ? { paused: true } : {}),
            ...bagField('inputs', b.inputs),
            ...bagField('outputs', b.outputs),
          };
        })
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
  const world = sanitizeSnapshotWorld(r.world, width, height, numRecord);
  return {
    v: 1,
    id: typeof r.id === 'string' && r.id.length <= 40 ? r.id : makeLevelId(),
    name: typeof r.name === 'string' ? r.name.slice(0, 40) : t('ed.defaultName'),
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
    biome: BIOMES.includes(r.biome as Biome) ? (r.biome as Biome) : undefined,
    ...(buildings.length ? { buildings } : {}),
    ...(world ? { world } : {}),
  };
}

// The snapshot-only `world` block (see SnapshotWorld). Returns null when there
// is nothing worth carrying, so an authored level never grows an empty object.
function sanitizeSnapshotWorld(
  raw: unknown,
  width: number,
  height: number,
  numRecord: <K extends string>(v: unknown, keys: readonly K[], max: number) => Partial<Record<K, number>>
): SnapshotWorld | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const out: SnapshotWorld = {};

  if (r.night === true) out.night = true;
  const hour = clampFloat(r.startHour, 0, 24);
  if (hour !== null) out.startHour = hour;
  const rate = clampFloat(r.dayNightRate, 0, 24);
  if (rate !== null && rate > 0) out.dayNightRate = rate;

  if (typeof r.flood === 'object' && r.flood !== null) {
    const f = r.flood as Record<string, unknown>;
    const start = clampInt(f.start, 0, height - 1);
    const min = clampInt(f.min, 0, height - 1);
    if (start !== null && min !== null) out.flood = { start, min };
  }

  if (Array.isArray(r.weather)) {
    const kinds: WeatherKind[] = ['clear', 'rain', 'storm'];
    const phases = (r.weather as unknown[])
      .filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      .map((p) => ({ kind: p.kind as WeatherKind, duration: clampFloat(p.duration, 1, 3600) }))
      .filter((p): p is WeatherPhase => kinds.includes(p.kind) && p.duration !== null)
      .slice(0, 24);
    if (phases.length) {
      out.weather = phases;
      // Only meaningful against a schedule, and modulo'd by the sim anyway.
      const idx = clampInt(r.weatherIdx, 0, phases.length - 1);
      if (idx !== null) out.weatherIdx = idx;
    }
  }

  const row = clampInt(r.waterRow, 0, height - 1);
  if (row !== null) out.waterRow = row;

  const keep = numRecord(r.keep, ITEM_TYPES, 99);
  if (Object.keys(keep).length) out.keep = keep;

  if (Array.isArray(r.digOrders)) {
    const cells = width * height;
    const orders = (r.digOrders as unknown[])
      .map((v) => clampInt(v, 0, cells - 1))
      .filter((v): v is number => v !== null)
      .slice(0, 400);
    if (orders.length) out.digOrders = orders;
  }

  if (Array.isArray(r.groundItems)) {
    const items = (r.groundItems as unknown[])
      .filter((g): g is Record<string, unknown> => typeof g === 'object' && g !== null)
      .filter(
        (g) =>
          ITEM_TYPES.includes(g.item as ItemType) &&
          typeof g.x === 'number' &&
          typeof g.y === 'number' &&
          g.x >= 0 &&
          g.x < width &&
          g.y >= 0 &&
          g.y < height
      )
      .slice(0, 200)
      .map((g) => ({ item: g.item as ItemType, x: Math.floor(g.x as number), y: Math.floor(g.y as number) }));
    if (items.length) out.groundItems = items;
  }

  return Object.keys(out).length ? out : null;
}

function clampInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

// Same, for the values that are genuinely fractional (construction seconds).
function clampFloat(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(min, Math.min(max, v));
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
  if (!footprintOk(th.x, th.y, fpTh.w, fpTh.h)) problems.push(t('verify.thBuried'));
  if (!footprintOk(goal.x, goal.y, fpGoal.w, fpGoal.h)) problems.push(t('verify.goalBuried'));

  for (const n of data.nodes) {
    if (!world.isPassable(n.x, n.y) || !world.isSolid(n.x, n.y + 1)) {
      problems.push(t('verify.nodeGround', { kind: t(`node.${n.kind}`), x: n.x, y: n.y }));
    }
  }

  // floating water: every water cell needs support below and banks (or more
  // water) beside, or pools hover mid-air. The campaign water helper and the
  // flood table are consistent by construction — this catches imported codes.
  let floatFirst: { x: number; y: number } | null = null;
  let floatCount = 0;
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      if (world.get(x, y) !== T.WATER) continue;
      const open = (nx: number, ny: number) => world.inBounds(nx, ny) && world.get(nx, ny) === T.AIR;
      if (open(x, y + 1) || open(x - 1, y) || open(x + 1, y)) {
        floatCount++;
        if (!floatFirst) floatFirst = { x, y };
      }
    }
  }
  if (floatFirst) warnings.push(t('verify.waterFloat', { n: floatCount, x: floatFirst.x, y: floatFirst.y }));

  const objectives = data.objectives.filter((o) => o.amount > 0);
  if (objectives.length === 0) problems.push(t('verify.noObjectives'));

  // Resource budget: raw yield + starting stock vs. what the order needs.
  // A snapshot's nodes are part-harvested, so count what is actually left —
  // budgeting a spent stump as a full tree would pass a level that can no
  // longer be finished. Authored nodes have no yieldLeft and count in full.
  const yieldOf = (kind: NodeKind) =>
    data.nodes
      .filter((n) => n.kind === kind)
      .reduce((sum, n) => sum + (n.yieldLeft ?? NODE_YIELD[kind].amount), 0);
  const have = {
    log: (data.startStock.log ?? 0) + yieldOf('tree'),
    stone: (data.startStock.stone ?? 0) + yieldOf('boulder'),
    iron: (data.startStock.iron ?? 0) + yieldOf('vein'),
    plank: data.startStock.plank ?? 0,
    spear: data.startStock.spear ?? 0,
    shovel: data.startStock.shovel ?? 0,
  };
  const need = { plank: 0, stone: 0, iron: 0, spear: 0, log: 0, shovel: 0 };
  for (const o of objectives) need[o.item] += o.amount;
  // forge (spear) and workshop (shovel) each craft one tool from 1 plank + 1 iron
  const toolsToMake = Math.max(0, need.spear - have.spear) + Math.max(0, need.shovel - have.shovel);
  const planksNeeded = need.plank + toolsToMake;
  const planksToSaw = Math.max(0, planksNeeded - have.plank);
  // sawmill yields 2 planks per log; the mill itself costs 6 logs
  const logsNeeded = need.log + (planksToSaw > 0 ? Math.ceil(planksToSaw / 2) + 6 : 0);
  if (have.log < logsNeeded) warnings.push(t('verify.wood', { need: logsNeeded, have: have.log }));
  if (have.stone < need.stone) problems.push(t('verify.stone', { need: need.stone, have: have.stone }));
  if (have.iron < toolsToMake) problems.push(t('verify.iron', { need: toolsToMake, have: have.iron }));
  if (toolsToMake > 0 && data.startThLevel < 2) {
    const thStone = 6; // TH1→2 upgrade stone cost
    if (have.stone < need.stone + thStone + 4) warnings.push(t('verify.spearStone'));
  }

  // reachability on the player-augmented graph
  const thDoor = settle(world, th.x + 1, th.y + fpTh.h - 1);
  if (!thDoor) {
    problems.push(t('verify.thDoor'));
  } else {
    const airReach = floodPassable(world, thDoor.x, thDoor.y);
    for (const n of data.nodes) {
      if (!airReach.has(world.key(n.x, n.y))) {
        warnings.push(t('verify.sealed', { kind: t(`node.${n.kind}`), x: n.x, y: n.y }));
      }
    }
    const cargoFromTh = cargoReach(world, thDoor.x, thDoor.y);
    const goalCells = approachKeys(world, goal.x, goal.y, fpGoal.w, fpGoal.h);
    if (![...goalCells].some((k) => cargoFromTh.has(k))) {
      problems.push(t('verify.goalUnreachable'));
    }
    const thCells = approachKeys(world, th.x, th.y, fpTh.w, fpTh.h);
    for (const n of data.nodes) {
      const spot = settle(world, n.x, n.y);
      if (!spot) continue;
      const reach = cargoReach(world, spot.x, spot.y);
      if (![...thCells].some((k) => reach.has(k))) {
        warnings.push(t('verify.stranded', { kind: t(`node.${n.kind}`), x: n.x, y: n.y }));
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
// Empty-handed workers can in principle reach any of these with enough ladders
// and platforms — that holds even now that free descent is capped at one tile
// (card #48), because a descending ladder is instant terrain the player drags
// down from the rim. So this stays a POSSIBILITY test: a node OUTSIDE the set is
// definitely sealed off; one inside is reachable only once the player builds the
// vertical infrastructure to get there.
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
// Carrying rules still apply: no ladders, and (card #48) at most a single-tile
// drop — every deeper carried descent must ride a ramp, a rope or a platform.
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
  const maxFall = MAX_FALL_CARRY;
  while (queue.length) {
    const key = queue.pop()!;
    const x = key % world.w;
    const y = Math.floor(key / world.w);
    for (const dx of [-1, 1]) {
      const nx = x + dx;
      // walk / step up one (a ramp tile overhead counts as headroom — see nav.ts)
      if (world.isStandable(nx, y)) visit(nx, y);
      if (
        world.isStandable(nx, y - 1) &&
        (world.isPassable(x, y - 1) || world.get(x, y - 1) === T.RAMP) &&
        world.get(nx, y - 1) !== T.LADDER
      ) {
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
