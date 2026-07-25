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

export type ItemType = 'log' | 'plank' | 'stone' | 'iron' | 'spear' | 'shovel';
export const ITEM_TYPES: ItemType[] = ['log', 'plank', 'stone', 'iron', 'spear', 'shovel'];
// display names live in the i18n table: t(`item.${itemType}`)
// sprite-atlas keys for each item, shared by the HUD and the map popover
export const ITEM_ICON: Record<ItemType, string> = {
  log: 'item_log',
  plank: 'item_plank',
  stone: 'item_stone',
  iron: 'item_iron',
  spear: 'item_spear',
  shovel: 'item_shovel',
};

export type Role = 'hauler' | 'builder' | 'woodcutter' | 'miner' | 'digger';
export const ROLES: Role[] = ['hauler', 'builder', 'woodcutter', 'miner', 'digger'];
// display names live in the i18n table: t(`role.${role}`)

export const ROLE_COLORS: Record<Role, string> = {
  hauler: '#5aa2e8',
  builder: '#ffc94d',
  woodcutter: '#6fd66f',
  miner: '#f08a4b',
  digger: '#b07de0',
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

export type BuildingKind = 'townhall' | 'sawmill' | 'forge' | 'workshop' | 'lift' | 'rope' | 'hoist' | 'lantern' | 'goal';

// ---- counterweight hoist ------------------------------------------------------

// Item weights for the counterweight hoist. One rule: THE HEAVIER SIDE SINKS.
// Stone is the natural ballast — twice the weight of everything else — which
// gives the miner's most abundant output its late-level identity.
export const ITEM_WEIGHT: Record<ItemType, number> = {
  log: 1,
  plank: 1,
  stone: 2,
  iron: 1,
  spear: 1,
  shovel: 1,
};

export const HOIST_CYCLE = 2.5; // seconds the cars take to swap ends
export const HOIST_CAR_CAPACITY = 3; // items per car (count, not weight)

export type HoistCar = 'upper' | 'lower';

export function carWeight(contents: Partial<Record<ItemType, number>>): number {
  let w = 0;
  for (const [k, v] of Object.entries(contents)) w += ITEM_WEIGHT[k as ItemType] * (v ?? 0);
  return w;
}

export function carCount(contents: Partial<Record<ItemType, number>>): number {
  let n = 0;
  for (const v of Object.values(contents)) n += v ?? 0;
  return n;
}

export type BuildingState = 'blueprint' | 'ready';

export interface Recipe {
  inputs: Partial<Record<ItemType, number>>;
  outputs: Partial<Record<ItemType, number>>;
  time: number;
}

export const RECIPES: Partial<Record<BuildingKind, Recipe>> = {
  sawmill: { inputs: { log: 1 }, outputs: { plank: 2 }, time: 3.5 },
  forge: { inputs: { plank: 1, iron: 1 }, outputs: { spear: 1 }, time: 5 },
  workshop: { inputs: { plank: 1, iron: 1 }, outputs: { shovel: 1 }, time: 4 },
};

// A producer stops starting new batches once this many finished goods sit in its
// output buffer unhauled — the line backs up until a hauler carries them off, so
// it won't keep consuming raw inputs it can't turn into shippable stock.
export const PRODUCER_OUTPUT_CAP = 6;

export interface Footprint {
  w: number;
  h: number;
}

export const FOOTPRINTS: Record<BuildingKind, Footprint> = {
  townhall: { w: 4, h: 3 },
  sawmill: { w: 3, h: 2 },
  forge: { w: 3, h: 2 },
  workshop: { w: 3, h: 2 },
  lift: { w: 1, h: 1 }, // base cell; the mast extends upward separately
  rope: { w: 1, h: 1 }, // anchor cell; the rope hangs down beside it
  hoist: { w: 1, h: 1 }, // wheel post on the cliff edge; the cars hang beside it
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
  paused: boolean; // producer only (sawmill/forge/workshop): player holds conversion so raw inputs stockpile
  // lift only
  liftTopY: number; // tile y of the top landing (liftTopY < y)
  liftCarY: number; // current car position in tile coords (render/anim)
  liftBusy: boolean;
  liftRiderId: number | null;
  // rope anchor AND hoist: both hang over a cliff edge into a drop column
  ropeSide: number; // -1 or 1: which side of the anchor the rope hangs over
  ropeBottomY: number; // tile y of the bottom landing (ropeBottomY > y)
  // counterweight hoist only. "Upper"/"lower" always mean the car currently at
  // the top/bottom STATION — contents swap when a cycle completes.
  hoistUpper: Partial<Record<ItemType, number>>; // car at the top station
  hoistLower: Partial<Record<ItemType, number>>; // car at the bottom station
  hoistUpperIn: Partial<Record<ItemType, number>>; // reserved items on the way
  hoistLowerIn: Partial<Record<ItemType, number>>;
  hoistSendDown: Partial<Record<ItemType, boolean>>; // routing: load into the upper car
  hoistSendUp: Partial<Record<ItemType, boolean>>; // routing: load into the lower car
  hoistBusy: boolean; // cars are mid-swap
  hoistT: number; // cycle animation timer (0..HOIST_CYCLE)
}

export const BUILD_TIME: Partial<Record<BuildingKind, number>> = {
  sawmill: 6,
  forge: 8,
  workshop: 7,
  lift: 7,
  rope: 4,
  hoist: 6,
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
  | 'workshop'
  | 'dig'
  | 'lift'
  | 'rope'
  | 'hoist'
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
  { id: 'hoist', key: 'h', cost: { plank: 3, iron: 1 }, thLevel: 2 },
  { id: 'lantern', key: 'l', cost: { log: 1, stone: 1 } },
  { id: 'forge', key: '8', cost: { plank: 4, stone: 4 }, thLevel: 2 },
  { id: 'workshop', key: 'k', cost: { plank: 4, stone: 2 }, thLevel: 2 },
  { id: 'dig', key: 'g', thLevel: 2 },
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
// Vertical descent is a build problem, just like climbing up (card #48).
// Everyone — empty-handed or loaded — takes a single step down for free;
// anything deeper needs a Ladder (empty), a Ramp (either) or a Rope (cargo
// down). No more free multi-tile "hop" off a cliff in either state.
export const MAX_FALL = 1; // tiles a smallie may drop when not carrying
export const MAX_FALL_CARRY = 1; // tiles a smallie may drop while carrying

export const WORKER_SPAWN_INTERVAL = 2.5; // seconds between new smallies
export const BUILDER_SPEED = 1; // progress per second

// Seconds a Digger takes to remove one tile, by terrain kind. Rock is the slog;
// dirt and grass give way quickly. Balanced further in the polish pass.
export const DIG_TIME: Partial<Record<T, number>> = {
  [T.DIRT]: 1.6,
  [T.GRASS]: 1.6,
  [T.ROCK]: 2.8,
};
export const DIG_TIME_DEFAULT = 2;

export interface GroundItem {
  id: number;
  item: ItemType;
  x: number; // tile
  y: number;
  reserved: boolean;
  bounce: number; // spawn animation timer
  stranded: boolean; // cached: no loaded carry-route to any accepting sink
  idleFor: number; // seconds settled & unreserved (drives the grace period)
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

// Where the camera should go when the player asks "where do I get <item>?"
// kind: 'node' = a live raw source node, 'building' = a producer, 'input' = the
// source of a producer's missing input (the recipe had no built producer),
// 'item' = units of the item that already exist out on the map (dropped, in a
// hauler's hands, in a building's buffer), 'store' = the only ones left are
// already in the stockpile, 'spent' = a harvested-out source node — the map DID
// have one, it is used up, which is a different answer from "this map has none"
// (card #57).
//
// `item` is the item the answer is ABOUT, which is not always the item asked
// for: a spear request whose iron is mined out resolves through the recipe to a
// spent vein, and the HUD has to say "Iron", not "Spear".
export interface LocateResult {
  x: number; // tile
  y: number; // tile
  kind: 'node' | 'building' | 'input' | 'item' | 'store' | 'spent';
  item: ItemType;
}

// ---- medals & feats ---------------------------------------------------------

// Level times as M:SS (H:MM:SS past an hour). Shared by the live HUD clock, the
// win ceremony and the medal readouts so one run reads the same everywhere.
export function fmtTime(t: number): string {
  const total = Math.max(0, Math.floor(t));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = hrs > 0 ? String(mins).padStart(2, '0') : String(mins);
  return `${hrs > 0 ? `${hrs}:` : ''}${mm}:${String(secs).padStart(2, '0')}`;
}

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

// ---- time of day -------------------------------------------------------------
// The HUD clock reads a diegetic hour-of-day (0..24), NOT the run's score timer
// (that's `Game.time`, kept off-screen and surfaced only at the win ceremony).
// A day level holds at noon and a night level at the dead of night; nothing
// advances the hour yet (a dynamic day→night cycle is a later phase — card #36).
export const DAY_HOUR = 12; // noon — the default for daytime maps
export const NIGHT_HOUR = 0; // midnight — the default for `night` maps

// Format an hour-of-day (0..24, wrapping) as a 24h "HH:MM" chip. Distinct from
// fmtTime (which renders elapsed M:SS): here the hours are always zero-padded so
// the clock reads as wall time — "09:00", "12:00", "00:00" — not a stopwatch.
export function fmtClock(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60) % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// The island's two glyph vocabularies live side by side, and here rather than
// in the HUD, so anything that has to know what the pill can render (the tests
// do) can import them without pulling in the DOM. Together they are exactly the
// range of Hud.skyIcon(): a weather phase where one is running, else the hour.
export const WX_ICON: Record<WeatherKind, string> = {
  clear: '☀️',
  rain: '🌧️',
  storm: '🌩️',
};

// A sun/dusk/moon glyph for the hour, so the clock reads day vs night at a
// glance. Bands: night before dawn and after dusk, a dawn/dusk sliver either
// side of daytime. Forward-compatible with a moving clock (later phase).
export function dayNightIcon(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5 || h >= 20) return '🌙'; // deep night
  if (h < 7 || h >= 18) return '🌇'; // dawn / dusk
  return '☀️'; // daytime
}

// Night intensity (0 = full daylight, 1 = deep night) for an hour-of-day.
// Day 07–18 is fully lit; dusk 18–21 ramps up to dark; night 21–05 is fully
// dark; dawn 05–07 ramps back down — smoothstepped so the sky, the darkness
// veil and the lighting ease rather than slide. One curve keeps all three in
// lockstep on a day↔night cycle level (see Game.nightAmount / LevelDef.dayNight).
export function nightAmountAt(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const smooth = (a: number, b: number, x: number): number => {
    const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };
  if (h >= 7 && h < 18) return 0; // day
  if (h >= 18 && h < 21) return smooth(18, 21, h); // dusk → dark
  if (h >= 5 && h < 7) return 1 - smooth(5, 7, h); // dawn → light
  return 1; // 21..24 and 00..05 — night
}

// Above this night intensity the open ground goes dark: smallies only work
// within a light source (see Game.isLit). Below it the whole map is lit, so the
// early dusk stays fully workable — the player's window to string lanterns.
export const NIGHT_WORK_DARK = 0.5;

// ---- look events (cosmetic outbox) -------------------------------------------

// Write-only breadcrumbs the sim appends for the renderer's look-physics layer
// (flight arcs, tree falls, water ripples, landing squash — see motion.ts).
// Game logic never reads these back; the renderer drains the queue every frame
// and tick() caps it so headless runs without a renderer cannot grow it
// without bound. All coordinates are in tile units.
export type LookEvent =
  | {
      kind: 'item-flight';
      id: number; // GroundItem id the flight belongs to
      item: ItemType;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      delay: number; // seconds before the flight becomes visible
    }
  | { kind: 'tree-felled'; id: number; x: number; y: number; dir: number }
  | { kind: 'item-sink'; item: ItemType; x: number; y: number }
  | { kind: 'worker-land'; id: number; x: number; y: number; dist: number };

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
