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
}

export type ItemType = 'log' | 'plank' | 'stone' | 'iron' | 'spear';
export const ITEM_TYPES: ItemType[] = ['log', 'plank', 'stone', 'iron', 'spear'];

export const ITEM_NAMES: Record<ItemType, string> = {
  log: 'Log',
  plank: 'Plank',
  stone: 'Stone',
  iron: 'Iron',
  spear: 'Spear',
};

export type Role = 'hauler' | 'builder' | 'woodcutter' | 'miner';
export const ROLES: Role[] = ['hauler', 'builder', 'woodcutter', 'miner'];

export const ROLE_NAMES: Record<Role, string> = {
  hauler: 'Haulers',
  builder: 'Builders',
  woodcutter: 'Woodcutters',
  miner: 'Miners',
};

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

export type BuildingKind = 'townhall' | 'sawmill' | 'forge' | 'lift' | 'rope' | 'goal';

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
  | 'demolish';

export interface ToolDef {
  id: Tool;
  label: string;
  key: string;
  desc: string;
  cost?: Partial<Record<ItemType, number>>;
  thLevel?: number; // required town hall level (for buildings)
}

export const TOOL_DEFS: ToolDef[] = [
  { id: 'select', label: 'Inspect', key: '1', desc: 'Inspect things. Drag or use WASD to pan, scroll to zoom.' },
  { id: 'harvest', label: 'Harvest', key: '2', desc: 'Mark trees, boulders and iron veins for your crew to harvest. Click again to unmark.' },
  { id: 'ladder', label: 'Ladder', key: '3', desc: 'Build a ladder tile from 1 log — or a plank if you have no logs. Smallhands climb ladders, but never while carrying goods!', cost: { log: 1 } },
  { id: 'platform', label: 'Bridge', key: '4', desc: 'Build a wooden bridge to span a gap or hole — drag to lay a run.', cost: { plank: 1 } },
  { id: 'ramp', label: 'Ramp', key: '0', desc: 'Build a diagonal ramp to climb a layer — drag up or down from solid ground. Loaded smallhands can walk it (unlike ladders).', cost: { plank: 1 } },
  { id: 'sawmill', label: 'Sawmill', key: '5', desc: 'Saws logs into planks. Needs a builder to construct it.', cost: { log: 6 }, thLevel: 1 },
  { id: 'lift', label: 'Cargo Lift', key: '6', desc: 'Carries a worker and their cargo UP a cliff face. Place at the base of a cliff. Up only!', cost: { plank: 4, stone: 2 }, thLevel: 2 },
  { id: 'rope', label: 'Rope Anchor', key: '7', desc: 'Anchors a rope at a cliff edge. Smallhands slide DOWN it — cargo and all. Down only!', cost: { log: 2, plank: 1 } },
  { id: 'forge', label: 'Forge', key: '8', desc: 'Forges spears from planks and iron. Needs a builder to construct it.', cost: { plank: 4, stone: 4 }, thLevel: 2 },
  { id: 'demolish', label: 'Demolish', key: '9', desc: 'Remove a ladder, platform or building. Refunds half the cost.' },
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
