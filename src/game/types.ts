// Shared types and tuning constants for the Smallhands simulation.

export const TILE = 16; // world pixels per tile (before camera zoom)

// Terrain tile kinds stored in the world grid.
export const enum T {
  AIR = 0,
  DIRT = 1,
  GRASS = 2, // dirt with a grassy top surface
  ROCK = 3,
  BEDROCK = 4,
  PLATFORM = 5, // player-built wooden floor
  LADDER = 6, // player-built ladder
  RAMP = 7, // player-built diagonal climb tile (support, like PLATFORM)
  WATER = 8, // deep water: impassable, unbuildable — goods dropped in are lost
}

export type ItemType = 'log' | 'plank' | 'stone' | 'iron' | 'spear';
export const ITEM_TYPES: ItemType[] = ['log', 'plank', 'stone', 'iron', 'spear'];
// display names live in the i18n table: t(`item.${itemType}`)

export type Role = 'hauler' | 'builder' | 'woodcutter' | 'miner';
export const ROLES: Role[] = ['hauler', 'builder', 'woodcutter', 'miner'];
// display names live in the i18n table: t(`role.${role}`)

export const ROLE_COLORS: Record<Role, string> = {
  hauler: '#5aa2e8',
  builder: '#ffc94d',
  woodcutter: '#6fd66f',
  miner: '#f08a4b',
};

export type NodeKind = 'tree' | 'boulder' | 'vein';

export interface ResourceNode {
  id: number;
  kind: NodeKind;
  x: number; // base tile (the tile the node sits on, i.e. its ground-level cell)
  y: number;
  yieldLeft: number;
  marked: boolean;
  workerId: number | null; // harvester currently assigned
  wobble: number; // animation state while being worked
}

export const NODE_YIELD: Record<NodeKind, { item: ItemType; amount: number; workTime: number }> = {
  tree: { item: 'log', amount: 4, workTime: 2.2 },
  boulder: { item: 'stone', amount: 4, workTime: 2.6 },
  vein: { item: 'iron', amount: 4, workTime: 3 },
};

export const NODE_ROLE: Record<NodeKind, Role> = {
  tree: 'woodcutter',
  boulder: 'miner',
  vein: 'miner',
};

export type BuildingKind = 'townhall' | 'sawmill' | 'forge' | 'lift' | 'rope' | 'lantern' | 'goal';

export type BuildingState = 'blueprint' | 'ready';

export interface Recipe {
  inputs: Partial<Record<ItemType, number>>;
  outputs: Partial<Record<ItemType, number>>;
  time: number;
}

export const RECIPES: Partial<Record<BuildingKind, Recipe>> = {
  sawmill: { inputs: { log: 1 }, outputs: { plank: 2 }, time: 3.5 },
  forge: { inputs: { plank: 1, iron: 1 }, outputs: { spear: 1 }, time: 5 },
};

export interface Footprint {
  w: number;
  h: number;
}

export const FOOTPRINTS: Record<BuildingKind, Footprint> = {
  townhall: { w: 4, h: 3 },
  sawmill: { w: 3, h: 2 },
  forge: { w: 3, h: 2 },
  lift: { w: 1, h: 1 }, // base cell; the mast extends upward separately
  rope: { w: 1, h: 1 }, // anchor cell; the rope hangs down beside it
  lantern: { w: 1, h: 1 },
  goal: { w: 4, h: 3 },
};

export interface Building {
  id: number;
  kind: BuildingKind;
  x: number; // top-left tile of footprint (for lift: base cell)
  y: number;
  state: BuildingState;
  progress: number; // construction progress 0..buildTime
  // production
  inputs: Partial<Record<ItemType, number>>;
  inbound: Partial<Record<ItemType, number>>; // reserved items on the way
  outputs: Partial<Record<ItemType, number>>;
  processT: number;
  processing: boolean;
  // lift only
  liftTopY: number; // tile y of the top landing (liftTopY < y)
  liftCarY: number; // current car position in tile coords (render/anim)
  liftBusy: boolean;
  liftRiderId: number | null;
  // rope anchor only
  ropeSide: number; // -1 or 1: which side of the anchor the rope hangs over
  ropeBottomY: number; // tile y of the bottom landing (ropeBottomY > y)
}

export const BUILD_TIME: Partial<Record<BuildingKind, number>> = {
  sawmill: 6,
  forge: 8,
  lift: 7,
  rope: 4,
  lantern: 3,
};

export type Tool =
  | 'select'
  | 'harvest'
  | 'ladder'
  | 'platform'
  | 'ramp'
  | 'sawmill'
  | 'forge'
  | 'lift'
  | 'rope'
  | 'lantern'
  | 'demolish';

// Labels and descriptions live in the i18n table: t(`tool.${id}.label`) / .desc
export interface ToolDef {
  id: Tool;
  key: string;
  cost?: Partial<Record<ItemType, number>>;
  thLevel?: number; // required town hall level (for buildings)
}

export const TOOL_DEFS: ToolDef[] = [
  { id: 'select', key: '1' },
  { id: 'harvest', key: '2' },
  { id: 'ladder', key: '3', cost: { log: 1 } },
  { id: 'platform', key: '4', cost: { plank: 1 } },
  { id: 'ramp', key: '0', cost: { plank: 1 } },
  { id: 'sawmill', key: '5', cost: { log: 6 }, thLevel: 1 },
  { id: 'lift', key: '6', cost: { plank: 4, stone: 2 }, thLevel: 2 },
  { id: 'rope', key: '7', cost: { log: 2, plank: 1 } },
  { id: 'lantern', key: 'l', cost: { log: 1, stone: 1 } },
  { id: 'forge', key: '8', cost: { plank: 4, stone: 4 }, thLevel: 2 },
  { id: 'demolish', key: '9' },
];

// Town hall levels. Index 0 = level 1.
export interface THLevel {
  maxWorkers: number;
  upgradeCost: Partial<Record<ItemType, number>> | null; // cost to reach the NEXT level
  upgradeTime: number;
}

export const TH_LEVELS: THLevel[] = [
  { maxWorkers: 6, upgradeCost: { plank: 8, stone: 6 }, upgradeTime: 8 },
  { maxWorkers: 9, upgradeCost: { plank: 10, stone: 10, iron: 2 }, upgradeTime: 10 },
  { maxWorkers: 12, upgradeCost: null, upgradeTime: 0 },
];

// Movement tuning (tiles per second)
export const WALK_SPEED = 2.6;
export const CLIMB_SPEED = 1.7;
export const FALL_SPEED = 7.5;
export const LIFT_SPEED = 2.2;
export const SLIDE_SPEED = 5.5; // rope descent — gravity does the work
export const MAX_FALL = 5; // tiles a smallhand may drop when not carrying
export const MAX_FALL_CARRY = 2; // tiles a smallhand may drop while carrying

export const WORKER_SPAWN_INTERVAL = 2.5; // seconds between new smallhands
export const BUILDER_SPEED = 1; // progress per second

export interface GroundItem {
  id: number;
  item: ItemType;
  x: number; // tile
  y: number;
  reserved: boolean;
  bounce: number; // spawn animation timer
}

export type WorkerState = 'idle' | 'walking' | 'working';

export type StepKind = 'walk' | 'climb' | 'fall' | 'lift' | 'slide';

export interface PathStep {
  x: number;
  y: number;
  kind: StepKind;
}

export interface ObjectiveReq {
  item: ItemType;
  amount: number;
}

// ---- medals & feats ---------------------------------------------------------

export type MedalTier = 'gold' | 'silver' | 'bronze';
export const MEDAL_TIERS: MedalTier[] = ['gold', 'silver', 'bronze'];

// completion-time thresholds in seconds; at or under a threshold earns the tier
export interface MedalTimes {
  gold: number;
  silver: number;
  bronze: number;
}

export function medalFor(times: MedalTimes, seconds: number): MedalTier | null {
  if (seconds <= times.gold) return 'gold';
  if (seconds <= times.silver) return 'silver';
  if (seconds <= times.bronze) return 'bronze';
  return null;
}

// the higher (better) of two tiers
export function bestTier(a: MedalTier | null, b: MedalTier | null): MedalTier | null {
  const rank = (t: MedalTier | null) => (t === null ? 3 : MEDAL_TIERS.indexOf(t));
  return rank(a) <= rank(b) ? a : b;
}

// Feats: named side-goals, always the same two so every level (campaign,
// generated, custom) can award them and players learn to hunt them.
// Names/descriptions live in the i18n table: t(`feat.${id}.name`) / .desc
export interface FeatDef {
  id: string;
}

export const FEATS: FeatDef[] = [{ id: 'no-demolish' }, { id: 'light-touch' }];

// ---- weather, water & light -------------------------------------------------

// Weather runs on a per-level looping schedule of phases. It is fully
// deterministic — the HUD shows the forecast so the player can PLAN around it,
// which keeps it a puzzle element rather than a dice roll.
export type WeatherKind = 'clear' | 'rain' | 'storm';

export interface WeatherPhase {
  kind: WeatherKind;
  duration: number; // seconds
}

// display names live in the i18n table: t(`weather.${kind}`)

// Harvest progress multiplier while it rains or storms (wet axes bite slower).
export const WET_WORK_FACTOR = 0.55;

// Seconds to crossfade the weather visuals when a phase flips. Visual-only —
// gameplay (workFactor, storm blow-off, flood rise) still flips at the boundary.
// Assumes every schedule phase lasts >= this; a shorter phase would flip again
// mid-fade and restart the crossfade from a partially-blended look (a small pop).
export const WEATHER_FADE = 3;

// Light radii (in tiles) for night levels. The town hall and the caravan keep
// their own fires burning; everything else needs lanterns.
export const LANTERN_RADIUS = 6.5;
export const TOWNHALL_LIGHT_RADIUS = 9;
export const GOAL_LIGHT_RADIUS = 6.5;

// One required resource for a placement, annotated with what you have vs need.
// `short` marks the resource that's blocking the build (have < need).
export interface ShortfallRow {
  item: ItemType;
  have: number;
  need: number;
  short: boolean;
}

// A drag-run's cells, how many the current stock can pay for (`affordable`), the
// resource total for that affordable prefix (`cost`, what a drop spends), and
// display rows for the cursor readout (`rows`, sized to the FULL run so the badge
// can warn). Single source of truth for the ghost, placement and readout.
export interface RunPlan {
  cells: { x: number; y: number }[];
  affordable: number;
  cost: Partial<Record<ItemType, number>>;
  rows: ShortfallRow[];
}
