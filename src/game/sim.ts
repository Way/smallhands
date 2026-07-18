import {
  BUILD_TIME,
  BUILDER_SPEED,
  DAY_HOUR,
  DIG_TIME,
  DIG_TIME_DEFAULT,
  CLIMB_SPEED,
  carCount,
  carWeight,
  FALL_SPEED,
  FOOTPRINTS,
  GOAL_LIGHT_RADIUS,
  HOIST_CAR_CAPACITY,
  HOIST_CYCLE,
  ITEM_TYPES,
  LANTERN_RADIUS,
  LIFT_SPEED,
  NIGHT_HOUR,
  NIGHT_WORK_DARK,
  nightAmountAt,
  NODE_ROLE,
  NODE_YIELD,
  RECIPES,
  ROLES,
  SLIDE_SPEED,
  T,
  TH_LEVELS,
  TOOL_DEFS,
  TOWNHALL_LIGHT_RADIUS,
  WALK_SPEED,
  WEATHER_FADE,
  WET_WORK_FACTOR,
  WORKER_SPAWN_INTERVAL,
} from './types';
import type {
  Building,
  BuildingKind,
  GroundItem,
  HoistCar,
  ItemType,
  LookEvent,
  ObjectiveReq,
  PathStep,
  ResourceNode,
  Role,
  RunPlan,
  ShortfallRow,
  Tool,
  WeatherKind,
  WeatherPhase,
} from './types';
import { World, canPlaceBuilding, canPlaceLadder, rampRunCells, bridgeRunCells, ladderRunCells, canDig, digRunCells, footprintH, footprintW, liftTopFor, ropeDropFor } from './world';
import { buildingApproachCells, digApproachCells, findPath, nodeApproachCells, settle } from './nav';
import type { LevelDef } from './levels';

// ---- tasks ----------------------------------------------------------------

type Source = { t: 'ground'; id: number } | { t: 'stock' } | { t: 'output'; id: number };
type Sink =
  | { t: 'stock' }
  | { t: 'input'; id: number }
  | { t: 'goal'; id: number }
  | { t: 'hoist'; id: number; car: HoistCar };

type Task =
  | { kind: 'harvest'; nodeId: number }
  | { kind: 'haul'; phase: 'toSource' | 'toSink'; item: ItemType; source: Source; sink: Sink }
  | { kind: 'construct'; buildingId: number }
  | { kind: 'upgrade' }
  | { kind: 'dig'; tx: number; ty: number }
  | { kind: 'wander' };

export interface Worker {
  id: number;
  role: Role;
  // logical cell (last settled cell / current step target once arrived)
  cx: number;
  cy: number;
  // render position in float tile coords
  px: number;
  py: number;
  path: PathStep[];
  stepIdx: number;
  task: Task | null;
  carrying: ItemType | null;
  hasShovel: boolean; // a Digger holds one shovel as permanent equipment
  workT: number;
  facing: number; // 1 or -1
  animT: number;
  working: boolean;
  waiting: boolean; // queued for a busy lift
  spawnT: number; // pop-in animation
}

export interface Objective extends ObjectiveReq {
  delivered: number;
  inbound: number;
}

export type GameEvent =
  | { type: 'place' }
  | { type: 'invalid' }
  | { type: 'chop'; x: number; y: number; node: ResourceNode }
  | { type: 'itemSpawn'; item: ItemType }
  | { type: 'deposit'; item: ItemType; sink: 'stock' | 'goal' | 'input' }
  | { type: 'built'; building: Building }
  | { type: 'upgraded'; level: number }
  | { type: 'demolish' }
  | { type: 'dug'; x: number; y: number }
  | { type: 'spawn' }
  | { type: 'produce'; building: Building; item: ItemType }
  | { type: 'hoistCycle' }
  | { type: 'weather'; kind: WeatherKind }
  | { type: 'flood'; row: number; rescued: number }
  | { type: 'splash'; item: ItemType }
  | { type: 'win' }
  | { type: 'hint'; text: string };

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  grav?: number; // per-particle downward accel (defaults to 9); low = floaty dust
}

// Placements refused on an unlit cell once night takes hold. Lanterns (the light
// source) and ladders (vertical mobility — see docs/architecture.md) are
// deliberately absent: both stay buildable in the dark so the player can always
// push the light frontier and never deadlock a descent. Everything else needs a
// lit site, so night forces you to run the light out before you can build.
const NEEDS_LIGHT: ReadonlySet<Tool> = new Set<Tool>([
  'ramp',
  'platform',
  'sawmill',
  'forge',
  'workshop',
  'lift',
  'rope',
  'hoist',
  'dig',
]);

// ---- the game -------------------------------------------------------------

export class Game {
  level: LevelDef;
  world: World;
  buildings: Building[] = [];
  nodes: ResourceNode[] = [];
  groundItems: GroundItem[] = [];
  workers: Worker[] = [];
  particles: Particle[] = [];
  // cosmetic outbox for the renderer's look-physics layer (see motion.ts):
  // append-only breadcrumbs, drained by the renderer, never read by game logic
  lookEvents: LookEvent[] = [];

  stock: Record<ItemType, number> = { log: 0, plank: 0, stone: 0, iron: 0, spear: 0, shovel: 0 };
  stockReserved: Record<ItemType, number> = { log: 0, plank: 0, stone: 0, iron: 0, spear: 0, shovel: 0 };

  // Player-set floor per item: haulers deliver only stock ABOVE this to the
  // caravan, so resources can be banked for construction. 0 = ship everything.
  keep: Record<ItemType, number> = { log: 0, plank: 0, stone: 0, iron: 0, spear: 0, shovel: 0 };

  desiredRoles: Record<Role, number> = { hauler: 0, builder: 0, woodcutter: 0, miner: 0, digger: 0 };

  // Cells the player has marked to dig, stored as world tile indices. An
  // assigned Digger removes them over time (see the dig task); until then they
  // render as a pending overlay. Kept as indices for O(1) add/has/delete.
  digOrders: Set<number> = new Set();

  thLevel = 1;
  thUpgrade: { progress: number; time: number; builderId: number | null } | null = null;

  objectives: Objective[] = [];
  won = false;
  time = 0; // elapsed run seconds — the medal/best-time score. NOT shown in-game.
  // Diegetic hour-of-day (0..24) the HUD clock renders, decoupled from `time`.
  // Static for now (noon on day maps, midnight on night maps); a dynamic
  // day→night cycle that advances it is a later phase (card #36).
  timeOfDay = DAY_HOUR;
  // The sim knows *whether* it runs, not how fast: speed is a main-loop concern
  // (it scales the tick accumulator, so a tick is always exactly dt). Don't add
  // a speed field here — nothing in the sim could read it.
  paused = false;
  demolishCount = 0; // for the "No Demolish" feat

  // weather: index + elapsed time within the level's looping schedule
  weatherIdx = 0;
  private weatherT = 0;
  // visual crossfade: the kind we're leaving + seconds since the last flip.
  // Initialised settled (fade already complete) so there's no fade-in on spawn.
  private weatherPrev: WeatherKind = 'clear';
  private weatherFadeT = WEATHER_FADE;
  // rising-water table: every AIR cell at y >= waterRow is flooded.
  // null = no water table (static water tiles may still exist).
  waterRow: number | null = null;

  private nextId = 1;
  private spawnTimer = 1;
  private schedTimer = 0;
  private hintsShown = new Set<string>();
  private hintTimer = 0;

  onEvent: (e: GameEvent) => void = () => {};

  constructor(level: LevelDef) {
    this.level = level;
    this.world = new World(level.width, level.height);
    // Night maps open in the dark, day maps at noon. `startHour` overrides both
    // when a level wants a specific time; a moving cycle comes in a later phase.
    this.timeOfDay = level.startHour ?? (level.night ? NIGHT_HOUR : DAY_HOUR);
    level.build(this);
    this.thLevel = level.startThLevel ?? 1;
    for (const [k, v] of Object.entries(level.startStock ?? {})) {
      this.stock[k as ItemType] = v as number;
    }
    this.desiredRoles = { hauler: 0, builder: 0, woodcutter: 0, miner: 0, digger: 0, ...level.startRoles };
    this.objectives = level.objectives.map((o) => ({ ...o, delivered: 0, inbound: 0 }));
    const startWorkers = level.startWorkers ?? 4;
    for (let i = 0; i < startWorkers; i++) this.spawnWorker(true);
  }

  // ---- level construction helpers (used by LevelDef.build) ----------------

  id(): number {
    return this.nextId++;
  }

  addNode(kind: ResourceNode['kind'], x: number, y: number, marked = false): void {
    const def = NODE_YIELD[kind];
    this.nodes.push({ id: this.id(), kind, x, y, yieldLeft: def.amount, marked, workerId: null, wobble: 0 });
  }

  addBuilding(kind: BuildingKind, x: number, y: number, ready = true): Building {
    const b: Building = {
      id: this.id(),
      kind,
      x,
      y,
      state: ready ? 'ready' : 'blueprint',
      progress: 0,
      inputs: {},
      inbound: {},
      outputs: {},
      processT: 0,
      processing: false,
      liftTopY: y,
      liftCarY: y,
      liftBusy: false,
      liftRiderId: null,
      ropeSide: 1,
      ropeBottomY: y,
      hoistUpper: {},
      hoistLower: {},
      hoistUpperIn: {},
      hoistLowerIn: {},
      hoistSendDown: {},
      hoistSendUp: {},
      hoistBusy: false,
      hoistT: 0,
    };
    this.buildings.push(b);
    return b;
  }

  get townhall(): Building {
    return this.buildings.find((b) => b.kind === 'townhall')!;
  }

  get goal(): Building | undefined {
    return this.buildings.find((b) => b.kind === 'goal');
  }

  // ---- derived state -------------------------------------------------------

  get maxWorkers(): number {
    return TH_LEVELS[this.thLevel - 1].maxWorkers;
  }

  get lifts(): Building[] {
    return this.buildings.filter((b) => b.kind === 'lift');
  }

  get ropes(): Building[] {
    return this.buildings.filter((b) => b.kind === 'rope');
  }

  get hoists(): Building[] {
    return this.buildings.filter((b) => b.kind === 'hoist');
  }

  // Buildings that add edges to the movement graph (lifts and rope anchors).
  get transits(): Building[] {
    return this.buildings.filter((b) => b.kind === 'lift' || b.kind === 'rope');
  }

  // ---- weather ---------------------------------------------------------------

  get weatherSchedule(): WeatherPhase[] | null {
    const sched = this.level.weather;
    return sched && sched.length > 0 ? sched : null;
  }

  get weather(): WeatherKind {
    const sched = this.weatherSchedule;
    return sched ? sched[this.weatherIdx % sched.length].kind : 'clear';
  }

  // Seconds until the current phase ends (Infinity when weather is static).
  get weatherRemaining(): number {
    const sched = this.weatherSchedule;
    if (!sched) return Infinity;
    return Math.max(0, sched[this.weatherIdx % sched.length].duration - this.weatherT);
  }

  // Continuous crossfade between the previous and current weather. `t` ramps
  // 0→1 across WEATHER_FADE after a flip, then holds at 1. Renderer-only.
  get weatherBlend(): { from: WeatherKind; to: WeatherKind; t: number } {
    // No schedule needs no special case: `weather` is 'clear', `weatherPrev`
    // stays 'clear', and `weatherFadeT` stays at WEATHER_FADE, so t === 1.
    const t = Math.min(1, this.weatherFadeT / WEATHER_FADE);
    return { from: this.weatherPrev, to: this.weather, t };
  }

  // Wet weather (rain or storm) slows outdoor harvest work.
  get workFactor(): number {
    return this.weather === 'clear' ? 1 : WET_WORK_FACTOR;
  }

  // ---- light (night levels) ----------------------------------------------------

  // Night intensity right now, 0 (full daylight) .. 1 (deep night). Flat on the
  // fixed level types — 0 on a day map, 1 on a static `night` map — but a live
  // curve of the clock on a day↔night cycle level (`dayNight`), so lighting, the
  // sky and the veil all move together as dusk falls. See nightAmountAt.
  nightAmount(): number {
    if (this.level.dayNight) return nightAmountAt(this.timeOfDay);
    return this.level.night ? 1 : 0;
  }

  // Light sources: the town hall and caravan keep their own fires, plus every
  // finished lantern. Radii are in tiles, measured from the source's centre.
  lightSources(): { x: number; y: number; r: number }[] {
    const out: { x: number; y: number; r: number }[] = [];
    for (const b of this.buildings) {
      if (b.kind === 'townhall') out.push({ x: b.x + 2, y: b.y + 1.5, r: TOWNHALL_LIGHT_RADIUS });
      else if (b.kind === 'goal') out.push({ x: b.x + 2, y: b.y + 1.5, r: GOAL_LIGHT_RADIUS });
      else if (b.kind === 'lantern' && b.state === 'ready') out.push({ x: b.x + 0.5, y: b.y + 0.5, r: LANTERN_RADIUS });
    }
    return out;
  }

  // Is the tile lit? True whenever it isn't dark enough to matter (all day, and
  // through the early dusk up to NIGHT_WORK_DARK). Once night takes hold,
  // smallhands only harvest and raise buildings within a light source — lanterns
  // themselves are the exception, so the player can push the frontier of light.
  isLit(x: number, y: number): boolean {
    if (this.nightAmount() < NIGHT_WORK_DARK) return true;
    const cx = x + 0.5;
    const cy = y + 0.5;
    for (const s of this.lightSources()) {
      const dx = cx - s.x;
      const dy = cy - s.y;
      if (dx * dx + dy * dy <= s.r * s.r) return true;
    }
    return false;
  }

  // Would placing `tool` aimed at (x, y) be refused right now for being too dark?
  // Exempt tools (lantern, ladder) never are — see NEEDS_LIGHT. For the rest the
  // deciding cell is a workshop's footprint bottom-centre, or the aimed/anchor
  // cell for terrain runs and masts, so callers pass the raw aim and need not
  // know footprints. Shared by placement, the ghost, and the cursor hints.
  darkBlocks(tool: Tool, x: number, y: number): boolean {
    if (!NEEDS_LIGHT.has(tool)) return false;
    if (tool === 'sawmill' || tool === 'forge' || tool === 'workshop') {
      const fp = FOOTPRINTS[tool];
      return !this.isLit(x + Math.floor(fp.w / 2), y + fp.h - 1);
    }
    return !this.isLit(x, y);
  }

  roleCount(role: Role): number {
    let n = 0;
    for (const w of this.workers) if (w.role === role) n++;
    return n;
  }

  // Workers of a role with nothing to do right now (no task, or just strolling).
  roleIdle(role: Role): number {
    let n = 0;
    for (const w of this.workers) if (w.role === role && (!w.task || w.task.kind === 'wander')) n++;
    return n;
  }

  // Diggers currently holding a shovel — used by the crew panel's shovel warning.
  equippedDiggers(): number {
    let n = 0;
    for (const w of this.workers) if (w.role === 'digger' && w.hasShovel) n++;
    return n;
  }

  available(item: ItemType): number {
    return this.stock[item] - this.stockReserved[item];
  }

  setKeep(item: ItemType, n: number): void {
    this.keep[item] = Math.max(0, Math.min(99, Math.floor(n)));
  }

  toolUnlocked(tool: Tool): boolean {
    const def = TOOL_DEFS.find((t) => t.id === tool)!;
    if (def.thLevel && this.thLevel < def.thLevel) return false;
    return (this.level.allowedTools ?? TOOL_DEFS.map((t) => t.id)).includes(tool);
  }

  canAfford(cost: Partial<Record<ItemType, number>>): boolean {
    for (const [k, v] of Object.entries(cost)) {
      if (this.stock[k as ItemType] < (v as number)) return false;
    }
    return true;
  }

  // What's missing to place a cost-bearing tool right now, for the cursor cost
  // badge. Returns every required resource (with have/need + a `short` flag) ONLY
  // when at least one is short — an empty array means "affordable", so no badge.
  // Compares against raw `stock`, exactly like canAfford/payCost.
  placementShortfall(tool: Tool): ShortfallRow[] {
    // Ladder spends 1 log, or 1 plank when no logs remain (see ladderWood), so
    // it's short only when you have neither. Show a single log row in that case
    // rather than TOOL_DEFS' nominal { log: 1 }, which would misread a plank.
    if (tool === 'ladder') {
      if (this.ladderWood() !== null) return [];
      return [{ item: 'log', have: 0, need: 1, short: true }];
    }
    const cost = TOOL_DEFS.find((t) => t.id === tool)?.cost;
    if (!cost) return [];
    const rows: ShortfallRow[] = [];
    let anyShort = false;
    for (const [k, need] of Object.entries(cost)) {
      const item = k as ItemType;
      const have = this.stock[item];
      const short = have < (need as number);
      if (short) anyShort = true;
      rows.push({ item, have, need: need as number, short });
    }
    return anyShort ? rows : [];
  }

  private payCost(cost: Partial<Record<ItemType, number>>): void {
    for (const [k, v] of Object.entries(cost)) this.stock[k as ItemType] -= v as number;
  }

  private refund(cost: Partial<Record<ItemType, number>>, factor: number): void {
    for (const [k, v] of Object.entries(cost)) {
      this.stock[k as ItemType] += Math.ceil((v as number) * factor);
    }
  }

  // ---- player actions ------------------------------------------------------

  // A ladder is 1 unit of wood: spend a log if we have one, otherwise a plank.
  // Prefer logs so refined planks stay free for the goal and platforms, but
  // never dead-end the player when every log has been sawn into planks.
  ladderWood(): ItemType | null {
    if (this.stock.log >= 1) return 'log';
    if (this.stock.plank >= 1) return 'plank';
    return null;
  }

  placeLadder(x: number, y: number): boolean {
    const wood = this.ladderWood();
    if (!canPlaceLadder(this.world, x, y) || wood === null) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    this.stock[wood] -= 1;
    this.world.set(x, y, T.LADDER);
    this.onEvent({ type: 'place' });
    return true;
  }

  // The cells a drag would fill, from the per-tool generator.
  private runCells(tool: Tool, ax: number, ay: number, tx: number, ty: number): { x: number; y: number }[] {
    if (tool === 'ladder') return ladderRunCells(this.world, ax, ay, tx, ty);
    if (tool === 'ramp') return rampRunCells(this.world, ax, ay, tx, ty);
    if (tool === 'dig') return digRunCells(this.world, this.buildings, ax, ay, tx, ty);
    return bridgeRunCells(this.world, ax, ay, tx, ty); // platform (Bridge)
  }

  // Single source of truth for a drag-run — read by the ghost, placement and the
  // cursor cost readout. `affordable` = how many leading cells the stock covers;
  // `cost` = the resource total for that prefix (what a drop spends); `rows` =
  // full-run need vs have for the readout badge.
  runPlan(tool: Tool, ax: number, ay: number, tx: number, ty: number): RunPlan {
    const cells = this.runCells(tool, ax, ay, tx, ty);
    const n = cells.length;
    if (tool === 'dig') {
      // Digging spends no resources — every marked cell is "affordable". The
      // readout shows a plain tile count via a zero-need row.
      return { cells, affordable: n, cost: {}, rows: [] };
    }
    if (tool === 'ladder') {
      // 1 wood per rung: spend logs first, then planks (mirrors ladderWood).
      const logsUsed = Math.min(n, this.stock.log);
      const planksUsed = Math.min(n - logsUsed, this.stock.plank);
      const cost: Partial<Record<ItemType, number>> = {};
      if (logsUsed > 0) cost.log = logsUsed;
      if (planksUsed > 0) cost.plank = planksUsed;
      const wood = this.stock.log + this.stock.plank;
      const rows: ShortfallRow[] =
        n > 0 ? [{ item: 'log', have: wood, need: n, short: n > wood }] : [];
      return { cells, affordable: logsUsed + planksUsed, cost, rows };
    }
    // ramp / platform: 1 plank per tile.
    const planks = this.stock.plank;
    const affordable = Math.min(n, planks);
    const cost: Partial<Record<ItemType, number>> = affordable > 0 ? { plank: affordable } : {};
    const rows: ShortfallRow[] =
      n > 0 ? [{ item: 'plank', have: planks, need: n, short: n > planks }] : [];
    return { cells, affordable, cost, rows };
  }

  // Lay a run's affordable prefix, paying its total cost once. The plan already
  // encodes both terrain validity and affordability, so we just place.
  private placeRun(plan: RunPlan, tile: T): number {
    this.payCost(plan.cost);
    for (let i = 0; i < plan.affordable; i++) {
      this.world.set(plan.cells[i].x, plan.cells[i].y, tile);
    }
    this.onEvent({ type: plan.affordable > 0 ? 'place' : 'invalid' });
    return plan.affordable;
  }

  // Ramps and platforms are horizontal spans — dark-gated at the drag anchor, so
  // a run can only start from a lit cell at night (ladders stay exempt below).
  placeRampRun(ax: number, ay: number, tx: number, ty: number): number {
    if (this.darkBlocks('ramp', ax, ay)) {
      this.onEvent({ type: 'invalid' });
      return 0;
    }
    return this.placeRun(this.runPlan('ramp', ax, ay, tx, ty), T.RAMP);
  }

  placeBridgeRun(ax: number, ay: number, tx: number, ty: number): number {
    if (this.darkBlocks('platform', ax, ay)) {
      this.onEvent({ type: 'invalid' });
      return 0;
    }
    return this.placeRun(this.runPlan('platform', ax, ay, tx, ty), T.PLATFORM);
  }

  // Ladders are exempt from the dark gate (vertical mobility — docs/architecture.md).
  placeLadderRun(ax: number, ay: number, tx: number, ty: number): number {
    return this.placeRun(this.runPlan('ladder', ax, ay, tx, ty), T.LADDER);
  }

  // Can this single cell be marked to dig? Thin wrapper over the world test so
  // the renderer's ghost and callers don't need the buildings list.
  canDig(x: number, y: number): boolean {
    return canDig(this.world, this.buildings, x, y);
  }

  // Paint (or, on a single tap over an existing order, erase) a dig plan. A drag
  // always adds its whole valid run; a lone tap on a cell that already carries an
  // order clears it — the demolish-style cancel. Returns cells changed.
  paintDigRun(ax: number, ay: number, tx: number, ty: number): number {
    const anchorIdx = this.world.idx(ax, ay);
    if (ax === tx && ay === ty && this.digOrders.has(anchorIdx)) {
      this.digOrders.delete(anchorIdx);
      this.onEvent({ type: 'demolish' });
      return 1;
    }
    // No fresh dig orders in the dark — light the face first (erasing above is fine).
    if (this.darkBlocks('dig', ax, ay)) {
      this.onEvent({ type: 'invalid' });
      return 0;
    }
    const cells = digRunCells(this.world, this.buildings, ax, ay, tx, ty);
    let added = 0;
    for (const c of cells) {
      const i = this.world.idx(c.x, c.y);
      if (!this.digOrders.has(i)) {
        this.digOrders.add(i);
        added++;
      }
    }
    this.onEvent({ type: added > 0 ? 'place' : 'invalid' });
    return added;
  }

  // Remove a pending dig order at this cell, if any (used by the demolish tool).
  clearDigOrder(x: number, y: number): boolean {
    return this.digOrders.delete(this.world.idx(x, y));
  }

  placeBuilding(kind: 'sawmill' | 'forge' | 'workshop' | 'lantern', x: number, y: number): boolean {
    const def = TOOL_DEFS.find((t) => t.id === kind)!;
    const fp = FOOTPRINTS[kind];
    if (!this.toolUnlocked(kind) || !this.canAfford(def.cost!) || !canPlaceBuilding(this.world, this.buildings, this.nodes, x, y, fp.w, fp.h)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    // At night, workshops rise only in the light. Lanterns are the exception —
    // that is how the player pushes the frontier of light outward.
    if (this.darkBlocks(kind, x, y)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    this.payCost(def.cost!);
    this.addBuilding(kind, x, y, false);
    this.onEvent({ type: 'place' });
    return true;
  }

  placeLift(x: number, y: number): boolean {
    const def = TOOL_DEFS.find((t) => t.id === 'lift')!;
    const topY = liftTopFor(this.world, x, y);
    if (!this.toolUnlocked('lift') || topY === null || !this.canAfford(def.cost!)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    // no two lifts sharing a base
    if (this.lifts.some((l) => l.x === x && l.y === y)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    if (this.darkBlocks('lift', x, y)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    this.payCost(def.cost!);
    const b = this.addBuilding('lift', x, y, false);
    b.liftTopY = topY;
    b.liftCarY = y;
    this.onEvent({ type: 'place' });
    return true;
  }

  placeRope(x: number, y: number): boolean {
    const def = TOOL_DEFS.find((t) => t.id === 'rope')!;
    const drop = ropeDropFor(this.world, x, y);
    if (!this.toolUnlocked('rope') || drop === null || !this.canAfford(def.cost!)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    // no rope/hoist sharing an anchor cell
    if (this.buildings.some((b) => (b.kind === 'rope' || b.kind === 'hoist') && b.x === x && b.y === y)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    if (this.darkBlocks('rope', x, y)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    this.payCost(def.cost!);
    const b = this.addBuilding('rope', x, y, false);
    b.ropeSide = drop.side;
    b.ropeBottomY = drop.bottomY;
    this.onEvent({ type: 'place' });
    return true;
  }

  // The counterweight hoist shares the rope anchor's placement grammar: a
  // standable cliff-edge cell with a clear >= 3-tile drop to a landing.
  placeHoist(x: number, y: number): boolean {
    const def = TOOL_DEFS.find((t) => t.id === 'hoist')!;
    const drop = ropeDropFor(this.world, x, y);
    if (!this.toolUnlocked('hoist') || drop === null || !this.canAfford(def.cost!)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    if (this.buildings.some((b) => (b.kind === 'rope' || b.kind === 'hoist') && b.x === x && b.y === y)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    if (this.darkBlocks('hoist', x, y)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    this.payCost(def.cost!);
    const b = this.addBuilding('hoist', x, y, false);
    b.ropeSide = drop.side;
    b.ropeBottomY = drop.bottomY;
    this.onEvent({ type: 'place' });
    return true;
  }

  // Flip an item's routing on a hoist: 'upper' = load it into the top car
  // (send it DOWN), 'lower' = load it into the bottom car (send it UP).
  // Directions are exclusive per item — both at once would be a perpetual
  // motion machine (the cycle's output re-boards immediately, forever).
  toggleHoistRoute(id: number, car: HoistCar, item: ItemType): void {
    const b = this.buildings.find((bd) => bd.id === id && bd.kind === 'hoist');
    if (!b) return;
    const routes = car === 'upper' ? b.hoistSendDown : b.hoistSendUp;
    const opposite = car === 'upper' ? b.hoistSendUp : b.hoistSendDown;
    routes[item] = !routes[item];
    if (routes[item]) opposite[item] = false;
  }

  demolish(x: number, y: number): boolean {
    // Cancelling a pending dig order is the cheapest thing demolish can do here.
    if (this.clearDigOrder(x, y)) {
      this.onEvent({ type: 'demolish' });
      return true;
    }
    const t = this.world.get(x, y);
    if (t === T.LADDER || t === T.PLATFORM || t === T.RAMP) {
      this.world.set(x, y, T.AIR);
      // Refund in planks even for ladders (which may have been paid in logs):
      // refunding a log would let plank→ladder→demolish→log→sawmill mint free
      // planks. Planks never convert back to logs, so a plank refund can't loop.
      this.refund({ plank: 1 }, 0.5);
      this.demolishCount++;
      this.onEvent({ type: 'demolish' });
      return true;
    }
    const b = this.buildingAt(x, y);
    if (b && b.kind !== 'townhall' && b.kind !== 'goal') {
      const def = TOOL_DEFS.find((td) => td.id === (b.kind as Tool));
      if (def?.cost) this.refund(def.cost, b.state === 'blueprint' ? 1 : 0.5);
      // return any stored inputs/outputs to the ground
      for (const store of [b.inputs, b.outputs]) {
        for (const [k, v] of Object.entries(store)) {
          for (let i = 0; i < (v as number); i++) this.dropItem(k as ItemType, b.x, b.y);
        }
      }
      if (b.kind === 'hoist') {
        // both cars unload where they hang: upper at the post, lower at the landing
        for (const [store, sx, sy] of [
          [b.hoistUpper, b.x, b.y],
          [b.hoistLower, b.x + b.ropeSide, b.ropeBottomY],
        ] as const) {
          for (const [k, v] of Object.entries(store)) {
            for (let i = 0; i < (v as number); i++) this.dropItem(k as ItemType, sx, sy);
          }
        }
      }
      if (b.kind === 'lift') {
        this.world.extraSupport.delete(this.world.idx(b.x, b.liftTopY + 1));
      }
      // Cancelling an unbuilt blueprint refunds in full and tears down nothing
      // real, so it shouldn't cost the player the "No Demolish" feat.
      if (b.state !== 'blueprint') this.demolishCount++;
      this.buildings = this.buildings.filter((o) => o.id !== b.id);
      // abort tasks that reference it
      for (const w of this.workers) {
        const task = w.task;
        if (!task) continue;
        if (
          (task.kind === 'construct' && task.buildingId === b.id) ||
          (task.kind === 'haul' &&
            ((task.source.t === 'output' && task.source.id === b.id) ||
              (task.sink.t === 'input' && task.sink.id === b.id) ||
              (task.sink.t === 'goal' && task.sink.id === b.id) ||
              (task.sink.t === 'hoist' && task.sink.id === b.id)))
        ) {
          this.abortTask(w);
        }
      }
      this.onEvent({ type: 'demolish' });
      return true;
    }
    this.onEvent({ type: 'invalid' });
    return false;
  }

  toggleMark(x: number, y: number): boolean {
    const n = this.nodeAt(x, y);
    if (!n || n.yieldLeft <= 0) return false;
    // in the dark nobody would find the flag — light it first
    if (!n.marked && !this.isLit(n.x, n.y)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    n.marked = !n.marked;
    if (!n.marked && n.workerId !== null) {
      const w = this.workers.find((wk) => wk.id === n.workerId);
      if (w) this.abortTask(w);
    }
    this.onEvent({ type: 'place' });
    return true;
  }

  startThUpgrade(): boolean {
    const cost = TH_LEVELS[this.thLevel - 1].upgradeCost;
    if (!cost || this.thUpgrade || !this.canAfford(cost)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    this.payCost(cost);
    this.thUpgrade = { progress: 0, time: TH_LEVELS[this.thLevel - 1].upgradeTime, builderId: null };
    this.onEvent({ type: 'place' });
    return true;
  }

  setDesired(role: Role, n: number): void {
    const others = ROLES.filter((r) => r !== role).reduce((s, r) => s + this.desiredRoles[r], 0);
    this.desiredRoles[role] = Math.max(0, Math.min(n, this.workers.length - others));
  }

  // ---- lookups ---------------------------------------------------------------

  buildingAt(x: number, y: number): Building | undefined {
    return this.buildings.find((b) => {
      if (b.kind === 'lift') return b.x === x && y <= b.y && y >= b.liftTopY;
      if (b.kind === 'rope' || b.kind === 'hoist') {
        // the anchor/post cell, or anywhere along the hanging rope/cars
        if (b.x === x && b.y === y) return true;
        return x === b.x + b.ropeSide && y >= b.y && y <= b.ropeBottomY;
      }
      const w = footprintW(b);
      const h = footprintH(b);
      return x >= b.x && x < b.x + w && y >= b.y && y < b.y + h;
    });
  }

  nodeAt(x: number, y: number): ResourceNode | undefined {
    // trees are tall: accept clicks up to 2 tiles above the base
    return this.nodes.find((n) => {
      if (n.yieldLeft <= 0) return false;
      if (n.kind === 'tree') return x === n.x && y <= n.y && y >= n.y - 2;
      return x === n.x && y === n.y;
    });
  }

  // ---- items -----------------------------------------------------------------

  // `src` is a cosmetic hint only: where the item visually comes from (a tree's
  // crown, a worker's hands), so the renderer can fly it to its rest tile.
  private dropItem(item: ItemType, x: number, y: number, src?: { x: number; y: number; delay?: number }): void {
    // find a nearby resting spot workers can actually reach
    let spot: { x: number; y: number } | null = null;
    for (const dx of [0, -1, 1, -2, 2]) {
      spot = settle(this.world, x + dx, y);
      if (spot) break;
    }
    if (!spot) {
      // no resting spot — if the drop column ends in water, the goods are lost
      let fy = y;
      while (this.world.inBounds(x, fy) && this.world.get(x, fy) === T.AIR) fy++;
      if (this.world.get(x, fy) === T.WATER) {
        this.sinkItem(item, x, fy);
        return;
      }
      spot = { x, y };
    }
    const gi: GroundItem = { id: this.id(), item, x: spot.x, y: spot.y, reserved: false, bounce: 0.4 };
    this.groundItems.push(gi);
    this.lookEvents.push({
      kind: 'item-flight',
      id: gi.id,
      item,
      fromX: src?.x ?? x,
      fromY: src?.y ?? y,
      toX: spot.x,
      toY: spot.y,
      delay: src?.delay ?? 0,
    });
    this.onEvent({ type: 'itemSpawn', item });
  }

  private sinkItem(item: ItemType, x: number, y: number): void {
    this.spawnBurst(x + 0.5, y + 0.2, '#9fd0f0', 7);
    this.lookEvents.push({ kind: 'item-sink', item, x, y });
    this.onEvent({ type: 'splash', item });
  }

  // ---- worker lifecycle --------------------------------------------------------

  private spawnWorker(initial = false): void {
    const th = this.townhall;
    const door = settle(this.world, th.x + 1 + (this.workers.length % 2), th.y + FOOTPRINTS.townhall.h - 1);
    if (!door) return;
    // fill the biggest role deficit, default hauler
    let role: Role = 'hauler';
    let bestDef = 0;
    for (const r of ROLES) {
      const deficit = this.desiredRoles[r] - this.roleCount(r);
      if (deficit > bestDef) {
        bestDef = deficit;
        role = r;
      }
    }
    this.workers.push({
      id: this.id(),
      role,
      cx: door.x,
      cy: door.y,
      px: door.x,
      py: door.y,
      path: [],
      stepIdx: 0,
      task: null,
      carrying: null,
      hasShovel: false,
      workT: 0,
      facing: Math.random() < 0.5 ? -1 : 1,
      animT: Math.random() * 10,
      working: false,
      waiting: false,
      spawnT: initial ? 0 : 0.6,
    });
    if (!initial) this.onEvent({ type: 'spawn' });
  }

  private abortTask(w: Worker): void {
    const task = w.task;
    if (task?.kind === 'harvest') {
      const n = this.nodes.find((nd) => nd.id === task.nodeId);
      if (n && n.workerId === w.id) n.workerId = null;
    }
    if (task?.kind === 'haul') {
      // undo reservations for the leg not yet completed
      if (task.phase === 'toSource') {
        this.unreserveSource(task.source, task.item);
      }
      this.unreserveSink(task.sink, task.item);
    }
    if (task?.kind === 'construct' || task?.kind === 'upgrade') {
      if (this.thUpgrade?.builderId === w.id) this.thUpgrade.builderId = null;
    }
    // release a lift the worker was riding or had claimed
    for (const lift of this.lifts) {
      if (lift.liftRiderId === w.id) {
        lift.liftBusy = false;
        lift.liftRiderId = null;
      }
    }
    if (w.carrying) {
      this.dropItem(w.carrying, Math.round(w.px), Math.round(w.py));
      w.carrying = null;
    }
    w.task = null;
    w.path = [];
    w.stepIdx = 0;
    w.working = false;
    w.waiting = false;
    w.workT = 0;
  }

  private unreserveSource(s: Source, item: ItemType): void {
    if (s.t === 'ground') {
      const gi = this.groundItems.find((g) => g.id === s.id);
      if (gi) gi.reserved = false;
    } else if (s.t === 'stock') {
      this.stockReserved[item] = Math.max(0, this.stockReserved[item] - 1);
    } else {
      const b = this.buildings.find((bd) => bd.id === s.id);
      if (b) b.outputs[item] = (b.outputs[item] ?? 0) + 0; // reservation tracked via outReserve map below
      const r = this.outReserve.get(s.id);
      if (r) r[item] = Math.max(0, (r[item] ?? 0) - 1);
    }
  }

  private unreserveSink(s: Sink, item: ItemType): void {
    if (s.t === 'input') {
      const b = this.buildings.find((bd) => bd.id === s.id);
      if (b) b.inbound[item] = Math.max(0, (b.inbound[item] ?? 0) - 1);
    } else if (s.t === 'goal') {
      const o = this.objectives.find((ob) => ob.item === item);
      if (o) o.inbound = Math.max(0, o.inbound - 1);
    } else if (s.t === 'hoist') {
      const b = this.buildings.find((bd) => bd.id === s.id);
      if (b) {
        const inb = s.car === 'upper' ? b.hoistUpperIn : b.hoistLowerIn;
        inb[item] = Math.max(0, (inb[item] ?? 0) - 1);
      }
    }
  }

  private outReserve = new Map<number, Partial<Record<ItemType, number>>>();

  private outAvailable(b: Building, item: ItemType): number {
    const r = this.outReserve.get(b.id)?.[item] ?? 0;
    return (b.outputs[item] ?? 0) - r;
  }

  private reserveOut(b: Building, item: ItemType): void {
    let r = this.outReserve.get(b.id);
    if (!r) {
      r = {};
      this.outReserve.set(b.id, r);
    }
    r[item] = (r[item] ?? 0) + 1;
  }

  // ---- scheduling ----------------------------------------------------------------

  private thApproach(): Set<number> {
    const th = this.townhall;
    return buildingApproachCells(this.world, th.x, th.y, FOOTPRINTS.townhall.w, FOOTPRINTS.townhall.h);
  }

  private buildingApproach(b: Building): Set<number> {
    if (b.kind === 'lift') {
      const cells = new Set<number>();
      for (const c of [
        { x: b.x, y: b.y },
        { x: b.x - 1, y: b.y },
        { x: b.x + 1, y: b.y },
      ]) {
        if (this.world.isStandable(c.x, c.y)) cells.add(this.world.key(c.x, c.y));
      }
      return cells;
    }
    return buildingApproachCells(this.world, b.x, b.y, footprintW(b), footprintH(b));
  }

  private sourceCells(s: Source): Set<number> | null {
    if (s.t === 'ground') {
      const gi = this.groundItems.find((g) => g.id === s.id);
      if (!gi) return null;
      const cells = new Set<number>();
      if (this.world.isStandable(gi.x, gi.y)) cells.add(this.world.key(gi.x, gi.y));
      for (const dx of [-1, 1]) {
        if (this.world.isStandable(gi.x + dx, gi.y)) cells.add(this.world.key(gi.x + dx, gi.y));
      }
      return cells.size ? cells : null;
    }
    if (s.t === 'stock') return this.thApproach();
    const b = this.buildings.find((bd) => bd.id === s.id);
    return b ? this.buildingApproach(b) : null;
  }

  private sinkCells(s: Sink): Set<number> | null {
    if (s.t === 'stock') return this.thApproach();
    const b = this.buildings.find((bd) => bd.id === s.id);
    if (!b) return null;
    if (s.t === 'hoist') return this.hoistStationCells(b, s.car);
    return this.buildingApproach(b);
  }

  // Where a worker can load a hoist car: the upper car is served from the
  // post cell (and its neighbours), the lower car from the bottom landing.
  private hoistStationCells(b: Building, car: HoistCar): Set<number> {
    const cells = new Set<number>();
    const [cx, cy] = car === 'upper' ? [b.x, b.y] : [b.x + b.ropeSide, b.ropeBottomY];
    for (const dx of [0, -1, 1]) {
      if (this.world.isStandable(cx + dx, cy)) cells.add(this.world.key(cx + dx, cy));
    }
    return cells;
  }

  // Candidates whose path legs recently failed are paused for a few seconds
  // so they don't starve the per-pass attempt budget (e.g. items stranded in
  // a pit before a lift exists would otherwise crowd out reachable work).
  // Keyed PER WORKER: reachability depends on where a worker stands — on
  // split terrain (a hoist shelf, a one-way drop) a stranded hauler's failed
  // attempt must not poison the same candidate for a hauler who can do it.
  private haulCooldown = new Map<string, number>();

  private candKey(w: Worker, source: Source, sink: Sink, item: ItemType): string {
    const s = source.t === 'stock' ? 'stock' : `${source.t}:${source.id}`;
    const k =
      sink.t === 'stock' ? 'stock' : sink.t === 'hoist' ? `hoist:${sink.id}:${sink.car}` : `${sink.t}:${sink.id}`;
    return `${w.id}:${s}>${k}:${item}`;
  }

  private tryAssignHaul(w: Worker): boolean {
    interface Candidate {
      source: Source;
      sink: Sink;
      item: ItemType;
      priority: number;
    }
    const cands: Candidate[] = [];

    // 1. goal deliveries — from stock, straight from loose items, and straight
    // from workshop outputs. The direct routes matter wherever the town hall
    // is not on the caravan's level (e.g. goods a hoist raised to a plateau):
    // funnelling through the stockpile would need a cargo route back up.
    const goal = this.goal;
    if (goal) {
      for (const o of this.objectives) {
        if (o.delivered + o.inbound >= o.amount) continue;
        // The keep floor banks `keep` units in the stockpile before any surplus
        // ships to the caravan. It must gate EVERY route to the goal, not only
        // the stock route: loose items and workshop outputs can reach the goal
        // WITHOUT passing through the stockpile, so unless they honour the floor
        // too, freshly produced/dropped goods sail straight past it and keep is
        // silently ignored ("all planks keep get delivered to target").
        const surplus = this.available(o.item) - this.keep[o.item];
        if (surplus > 0) {
          cands.push({ source: { t: 'stock' }, sink: { t: 'goal', id: goal.id }, item: o.item, priority: 0 });
        }
        // Direct-to-goal routes fire only once the store already holds the
        // floor; below it these units belong in the stockpile, building the
        // reserve up (routes 3 & 4 sink loose items and outputs into stock).
        // keep 0 (the default) keeps surplus >= 0 always true — behaviour there
        // is unchanged.
        if (surplus >= 0) {
          for (const gi of this.groundItems) {
            if (gi.reserved || gi.item !== o.item) continue;
            cands.push({ source: { t: 'ground', id: gi.id }, sink: { t: 'goal', id: goal.id }, item: o.item, priority: 0 });
          }
          for (const b of this.buildings) {
            if (b.state !== 'ready') continue;
            if (this.outAvailable(b, o.item) > 0) {
              cands.push({ source: { t: 'output', id: b.id }, sink: { t: 'goal', id: goal.id }, item: o.item, priority: 0 });
            }
          }
        }
      }
    }
    // 2. feed production buildings — from stock or straight from loose items
    // (a forge on a plateau eats the iron mined beside it and the planks the
    // hoist just landed, without a round trip through the town hall)
    for (const b of this.buildings) {
      if (b.state !== 'ready') continue;
      const recipe = RECIPES[b.kind];
      if (!recipe) continue;
      for (const [k, need] of Object.entries(recipe.inputs)) {
        const item = k as ItemType;
        const have = (b.inputs[item] ?? 0) + (b.inbound[item] ?? 0);
        if (have >= (need as number) * 2) continue; // keep a small buffer
        if (this.available(item) > 0) {
          cands.push({ source: { t: 'stock' }, sink: { t: 'input', id: b.id }, item, priority: 1 });
        }
        for (const gi of this.groundItems) {
          if (gi.reserved || gi.item !== item) continue;
          cands.push({ source: { t: 'ground', id: gi.id }, sink: { t: 'input', id: b.id }, item, priority: 1 });
        }
      }
    }
    // 2b. load counterweight hoist cars: routed items from stock or loose
    // items, plus automatic stone ballast into the upper car whenever cargo
    // below is waiting on weight ("the heavier side sinks").
    for (const b of this.buildings) {
      if (b.kind !== 'hoist' || b.state !== 'ready' || b.hoistBusy) continue;
      if (this.weather === 'storm') continue; // brake locked — don't stage loads
      const carFree = (contents: Partial<Record<ItemType, number>>, inb: Partial<Record<ItemType, number>>) =>
        HOIST_CAR_CAPACITY - carCount(contents) - carCount(inb);
      const wants: { car: HoistCar; item: ItemType }[] = [];
      for (const [car, routes, contents, inb] of [
        ['upper', b.hoistSendDown, b.hoistUpper, b.hoistUpperIn],
        ['lower', b.hoistSendUp, b.hoistLower, b.hoistLowerIn],
      ] as const) {
        if (carFree(contents, inb) <= 0) continue;
        for (const item of ITEM_TYPES) if (routes[item]) wants.push({ car, item });
      }
      // auto-ballast: the lower car's cargo is waiting and the upper side is
      // too light — request stone (weight 2, the natural counterweight)
      const upW = carWeight(b.hoistUpper) + carWeight(b.hoistUpperIn);
      const loW = carWeight(b.hoistLower) + carWeight(b.hoistLowerIn);
      if (
        carCount(b.hoistLower) + carCount(b.hoistLowerIn) > 0 &&
        upW <= loW &&
        carFree(b.hoistUpper, b.hoistUpperIn) > 0 &&
        !wants.some((w2) => w2.car === 'upper' && w2.item === 'stone')
      ) {
        wants.push({ car: 'upper', item: 'stone' });
      }
      for (const want of wants) {
        const sink: Sink = { t: 'hoist', id: b.id, car: want.car };
        if (this.available(want.item) > 0) {
          cands.push({ source: { t: 'stock' }, sink, item: want.item, priority: 1 });
        }
        // loose items load directly — that's how plateau stone becomes ballast
        // without a detour through the town hall. Items resting at this hoist's
        // OTHER station are excluded, or a cycle's output would ride straight
        // back where it came from.
        const [ox, oy] = want.car === 'upper' ? [b.x + b.ropeSide, b.ropeBottomY] : [b.x, b.y];
        for (const gi of this.groundItems) {
          if (gi.reserved || gi.item !== want.item) continue;
          if (Math.abs(gi.x - ox) <= 1 && gi.y === oy) continue;
          cands.push({ source: { t: 'ground', id: gi.id }, sink, item: want.item, priority: 1 });
        }
      }
    }
    // 3. collect loose items
    for (const gi of this.groundItems) {
      if (gi.reserved) continue;
      cands.push({ source: { t: 'ground', id: gi.id }, sink: { t: 'stock' }, item: gi.item, priority: 2 });
    }
    // 4. empty production outputs
    for (const b of this.buildings) {
      if (b.state !== 'ready') continue;
      for (const k of Object.keys(b.outputs)) {
        const item = k as ItemType;
        if (this.outAvailable(b, item) <= 0) continue;
        cands.push({ source: { t: 'output', id: b.id }, sink: { t: 'stock' }, item, priority: 2 });
      }
    }

    cands.sort((a, b) => a.priority - b.priority);
    let attempts = 0;
    for (const c of cands) {
      if (attempts >= 10) break;
      const key = this.candKey(w, c.source, c.sink, c.item);
      const coolUntil = this.haulCooldown.get(key);
      if (coolUntil !== undefined && this.time < coolUntil) continue;
      attempts++;
      const srcCells = this.sourceCells(c.source);
      const snkCells = this.sinkCells(c.sink);
      if (!srcCells || !snkCells || srcCells.size === 0 || snkCells.size === 0) {
        this.haulCooldown.set(key, this.time + 4);
        continue;
      }
      const leg1 = findPath(this.world, this.transits, w.cx, w.cy, srcCells, w.carrying !== null);
      if (!leg1) {
        this.haulCooldown.set(key, this.time + 4);
        continue;
      }
      // verify the carrying leg is possible from the pickup point
      const pickCell = leg1.steps.length ? leg1.steps[leg1.steps.length - 1] : { x: w.cx, y: w.cy };
      const leg2 = findPath(this.world, this.transits, pickCell.x, pickCell.y, snkCells, true);
      if (!leg2) {
        this.haulCooldown.set(key, this.time + 4);
        continue;
      }
      // reserve
      if (c.source.t === 'ground') {
        const gi = this.groundItems.find((g) => g.id === (c.source as { t: 'ground'; id: number }).id)!;
        gi.reserved = true;
      } else if (c.source.t === 'stock') {
        this.stockReserved[c.item]++;
      } else {
        this.reserveOut(this.buildings.find((b) => b.id === (c.source as { t: 'output'; id: number }).id)!, c.item);
      }
      if (c.sink.t === 'input') {
        const b = this.buildings.find((bd) => bd.id === (c.sink as { t: 'input'; id: number }).id)!;
        b.inbound[c.item] = (b.inbound[c.item] ?? 0) + 1;
      } else if (c.sink.t === 'goal') {
        const o = this.objectives.find((ob) => ob.item === c.item)!;
        o.inbound++;
      } else if (c.sink.t === 'hoist') {
        const sink = c.sink as { t: 'hoist'; id: number; car: HoistCar };
        const b = this.buildings.find((bd) => bd.id === sink.id)!;
        const inb = sink.car === 'upper' ? b.hoistUpperIn : b.hoistLowerIn;
        inb[c.item] = (inb[c.item] ?? 0) + 1;
      }
      w.task = { kind: 'haul', phase: 'toSource', item: c.item, source: c.source, sink: c.sink };
      w.path = leg1.steps;
      w.stepIdx = 0;
      return true;
    }
    return false;
  }

  private tryAssignHarvest(w: Worker): boolean {
    let best: { node: ResourceNode; steps: PathStep[]; cost: number } | null = null;
    for (const n of this.nodes) {
      if (!n.marked || n.yieldLeft <= 0 || n.workerId !== null) continue;
      if (NODE_ROLE[n.kind] !== w.role) continue;
      if (!this.isLit(n.x, n.y)) continue; // no harvest in the dark
      if (this.world.get(n.x, n.y) === T.WATER) continue; // submerged by the flood
      const cells = nodeApproachCells(this.world, n.x, n.y);
      if (cells.size === 0) continue;
      const path = findPath(this.world, this.transits, w.cx, w.cy, cells, false);
      if (!path) continue;
      if (!best || path.cost < best.cost) best = { node: n, steps: path.steps, cost: path.cost };
    }
    if (!best) return false;
    best.node.workerId = w.id;
    w.task = { kind: 'harvest', nodeId: best.node.id };
    w.path = best.steps;
    w.stepIdx = 0;
    return true;
  }

  // Assign an idle Digger the nearest reachable dig order. Reach = stand beside
  // it (tunnel) or above it (shaft). A shovel is claimed from stock only once a
  // reachable order exists, so a Digger never hoards a shovel with nothing to dig.
  private tryAssignDig(w: Worker): boolean {
    if (this.digOrders.size === 0) return false;
    const wgrid = this.world.w;
    let best: { tx: number; ty: number; steps: PathStep[]; cost: number } | null = null;
    for (const idx of this.digOrders) {
      const x = idx % wgrid;
      const y = (idx / wgrid) | 0;
      if (!this.world.isSolid(x, y)) {
        this.digOrders.delete(idx); // already open, or flooded/replaced — prune it
        continue;
      }
      // don't double-book a cell another Digger is already headed to
      if (this.workers.some((o) => o !== w && o.task?.kind === 'dig' && o.task.tx === x && o.task.ty === y)) continue;
      const cells = digApproachCells(this.world, x, y);
      if (cells.size === 0) continue;
      const path = findPath(this.world, this.transits, w.cx, w.cy, cells, false);
      if (!path) continue;
      if (!best || path.cost < best.cost) best = { tx: x, ty: y, steps: path.steps, cost: path.cost };
    }
    if (!best) return false;
    if (!w.hasShovel) {
      if (this.available('shovel') <= 0) return false; // no shovel to dig with
      this.stock.shovel--; // claim one as permanent equipment
      w.hasShovel = true;
    }
    w.task = { kind: 'dig', tx: best.tx, ty: best.ty };
    w.path = best.steps;
    w.stepIdx = 0;
    return true;
  }

  private tryAssignConstruct(w: Worker): boolean {
    // town hall upgrade takes priority
    if (this.thUpgrade && this.thUpgrade.builderId === null) {
      const path = findPath(this.world, this.transits, w.cx, w.cy, this.thApproach(), false);
      if (path) {
        this.thUpgrade.builderId = w.id;
        w.task = { kind: 'upgrade' };
        w.path = path.steps;
        w.stepIdx = 0;
        return true;
      }
    }
    for (const b of this.buildings) {
      if (b.state !== 'blueprint') continue;
      if (this.workers.some((o) => o.task?.kind === 'construct' && o.task.buildingId === b.id)) continue;
      const cells = this.buildingApproach(b);
      if (cells.size === 0) continue;
      const path = findPath(this.world, this.transits, w.cx, w.cy, cells, false);
      if (!path) continue;
      w.task = { kind: 'construct', buildingId: b.id };
      w.path = path.steps;
      w.stepIdx = 0;
      return true;
    }
    return false;
  }

  private tryAssignWander(w: Worker): void {
    if (Math.random() < 0.985) return; // mostly stand around
    const dx = Math.floor(Math.random() * 7) - 3;
    if (dx === 0) return;
    const targets = new Set<number>();
    if (this.world.isStandable(w.cx + dx, w.cy)) targets.add(this.world.key(w.cx + dx, w.cy));
    if (targets.size === 0) return;
    const path = findPath(this.world, this.transits, w.cx, w.cy, targets, w.carrying !== null);
    if (path && path.steps.length <= 5) {
      w.task = { kind: 'wander' };
      w.path = path.steps;
      w.stepIdx = 0;
    }
  }

  private rebalanceRoles(): void {
    for (const role of ROLES) {
      let deficit = this.desiredRoles[role] - this.roleCount(role);
      if (deficit <= 0) continue;
      // convert idle workers from over-staffed roles
      for (const w of this.workers) {
        if (deficit <= 0) break;
        if (w.role === role) continue;
        if (w.task && w.task.kind !== 'wander') continue;
        if (this.roleCount(w.role) <= this.desiredRoles[w.role]) continue;
        if (w.task) this.abortTask(w);
        // a Digger leaving the role hands its shovel back to the stockpile
        if (w.hasShovel && role !== 'digger') {
          this.stock.shovel++;
          w.hasShovel = false;
        }
        w.role = role;
        deficit--;
      }
    }
  }

  private schedule(): void {
    // expired cooldown entries accumulate (per-worker keys over churning item
    // ids) — sweep them occasionally so the map stays small on long sessions
    if (this.haulCooldown.size > 2000) {
      for (const [k, until] of this.haulCooldown) {
        if (this.time >= until) this.haulCooldown.delete(k);
      }
    }
    this.rebalanceRoles();
    for (const w of this.workers) {
      if (w.task && w.task.kind !== 'wander') continue;
      if (w.task?.kind === 'wander') continue; // let them finish the stroll
      let assigned = false;
      if (w.role === 'hauler') assigned = this.tryAssignHaul(w);
      else if (w.role === 'builder') assigned = this.tryAssignConstruct(w);
      else if (w.role === 'digger') assigned = this.tryAssignDig(w);
      else assigned = this.tryAssignHarvest(w);
      if (!assigned) this.tryAssignWander(w);
    }
  }

  // ---- task execution -------------------------------------------------------------

  private arriveAtTaskTarget(w: Worker): void {
    const task = w.task;
    if (!task) return;
    switch (task.kind) {
      case 'wander':
        w.task = null;
        break;
      case 'harvest': {
        w.working = true;
        w.workT = 0;
        break;
      }
      case 'dig': {
        w.working = true;
        w.workT = 0;
        break;
      }
      case 'construct':
      case 'upgrade':
        w.working = true;
        break;
      case 'haul': {
        if (task.phase === 'toSource') {
          // pick up
          let ok = false;
          if (task.source.t === 'ground') {
            const gi = this.groundItems.find((g) => g.id === (task.source as { t: 'ground'; id: number }).id);
            if (gi) {
              this.groundItems = this.groundItems.filter((g) => g.id !== gi.id);
              ok = true;
            }
          } else if (task.source.t === 'stock') {
            if (this.stock[task.item] > 0) {
              this.stock[task.item]--;
              this.stockReserved[task.item] = Math.max(0, this.stockReserved[task.item] - 1);
              ok = true;
            }
          } else {
            const b = this.buildings.find((bd) => bd.id === (task.source as { t: 'output'; id: number }).id);
            if (b && (b.outputs[task.item] ?? 0) > 0) {
              b.outputs[task.item]!--;
              const r = this.outReserve.get(b.id);
              if (r) r[task.item] = Math.max(0, (r[task.item] ?? 0) - 1);
              ok = true;
            }
          }
          if (!ok) {
            this.abortTask(w);
            return;
          }
          w.carrying = task.item;
          // second leg
          const cells = this.sinkCells(task.sink);
          const path = cells ? findPath(this.world, this.transits, w.cx, w.cy, cells, true) : null;
          if (!path) {
            this.abortTask(w); // drops the item where they stand
            return;
          }
          task.phase = 'toSink';
          w.path = path.steps;
          w.stepIdx = 0;
        } else {
          // deposit
          w.carrying = null;
          if (task.sink.t === 'stock') {
            this.stock[task.item]++;
            this.onEvent({ type: 'deposit', item: task.item, sink: 'stock' });
          } else if (task.sink.t === 'input') {
            const b = this.buildings.find((bd) => bd.id === (task.sink as { t: 'input'; id: number }).id);
            if (b) {
              b.inputs[task.item] = (b.inputs[task.item] ?? 0) + 1;
              b.inbound[task.item] = Math.max(0, (b.inbound[task.item] ?? 0) - 1);
              this.onEvent({ type: 'deposit', item: task.item, sink: 'input' });
            }
          } else if (task.sink.t === 'hoist') {
            const sink = task.sink as { t: 'hoist'; id: number; car: HoistCar };
            const b = this.buildings.find((bd) => bd.id === sink.id);
            if (b) {
              const contents = sink.car === 'upper' ? b.hoistUpper : b.hoistLower;
              const inb = sink.car === 'upper' ? b.hoistUpperIn : b.hoistLowerIn;
              contents[task.item] = (contents[task.item] ?? 0) + 1;
              inb[task.item] = Math.max(0, (inb[task.item] ?? 0) - 1);
              this.onEvent({ type: 'deposit', item: task.item, sink: 'input' });
            } else {
              // the hoist vanished mid-haul: the cargo lands where they stand
              this.dropItem(task.item, w.cx, w.cy);
            }
          } else {
            const o = this.objectives.find((ob) => ob.item === task.item);
            if (o) {
              o.delivered++;
              o.inbound = Math.max(0, o.inbound - 1);
              this.onEvent({ type: 'deposit', item: task.item, sink: 'goal' });
            }
          }
          w.task = null;
          this.checkWin();
        }
        break;
      }
    }
  }

  private tickWorking(w: Worker, dt: number): void {
    const task = w.task!;
    w.animT += dt;
    if (task.kind === 'harvest') {
      const n = this.nodes.find((nd) => nd.id === task.nodeId);
      if (!n || !n.marked || n.yieldLeft <= 0) {
        this.abortTask(w);
        return;
      }
      n.wobble = 0.2;
      w.workT += dt * this.workFactor; // wet weather slows the swing
      const def = NODE_YIELD[n.kind];
      if (w.workT >= def.workTime) {
        w.workT = 0;
        n.yieldLeft--;
        // the last chop fells a tree: it topples away from the woodcutter
        const felledDir = n.kind === 'tree' && n.yieldLeft <= 0 ? (w.px < n.x + 0.5 ? 1 : -1) : 0;
        // drop at the harvester's feet — a spot that is provably reachable.
        // The breadcrumb source is the node (a tree's crown); the felling log
        // flies out of the fallen crown once the trunk lands (0.8s = FELL_DUR).
        this.dropItem(
          def.item,
          w.cx,
          w.cy,
          felledDir !== 0
            ? { x: n.x + felledDir * 1.5, y: n.y + 0.3, delay: 0.8 }
            : { x: n.x, y: n.kind === 'tree' ? n.y - 1.3 : n.y }
        );
        this.onEvent({ type: 'chop', x: n.x, y: n.y, node: n });
        this.spawnBurst(n.x + 0.5, n.y - (n.kind === 'tree' ? 1 : 0), n.kind === 'tree' ? '#8a5a2b' : '#9aa3ad');
        if (n.yieldLeft <= 0) {
          if (felledDir !== 0) {
            this.lookEvents.push({ kind: 'tree-felled', id: n.id, x: n.x, y: n.y, dir: felledDir });
          }
          n.workerId = null;
          w.task = null;
          w.working = false;
        }
      }
    } else if (task.kind === 'dig') {
      const idx = this.world.idx(task.tx, task.ty);
      // abandon if the order was cancelled, the tile is already open, or the
      // digger got bumped off its reach cell (e.g. it fell) — reschedule instead
      const adjacent =
        (w.cx === task.tx && w.cy === task.ty - 1) || (w.cy === task.ty && Math.abs(w.cx - task.tx) === 1);
      if (!this.digOrders.has(idx) || !this.world.isSolid(task.tx, task.ty) || !adjacent) {
        if (this.world.get(task.tx, task.ty) === T.AIR) this.digOrders.delete(idx);
        this.abortTask(w);
        return;
      }
      const tile = this.world.get(task.tx, task.ty);
      if (task.tx !== w.cx) w.facing = task.tx > w.cx ? 1 : -1; // face the tile being dug
      w.workT += dt;
      if (Math.random() < dt * 3) this.spawnBurst(task.tx + 0.5, task.ty + 0.5, '#8a6a45', 2);
      if (w.workT >= (DIG_TIME[tile] ?? DIG_TIME_DEFAULT)) {
        w.workT = 0;
        this.world.set(task.tx, task.ty, T.AIR);
        this.digOrders.delete(idx);
        this.spawnBurst(task.tx + 0.5, task.ty + 0.5, '#8a6a45', 8);
        this.onEvent({ type: 'dug', x: task.tx, y: task.ty });
        w.task = null;
        w.working = false;
        // opened terrain frees new routes; the next schedule (0.3s) repaths, and
        // tickGravity settles anyone standing where the ground just vanished.
      }
    } else if (task.kind === 'construct') {
      const b = this.buildings.find((bd) => bd.id === task.buildingId);
      if (!b || b.state === 'ready') {
        this.abortTask(w);
        return;
      }
      b.progress += dt * BUILDER_SPEED;
      // dust kicked up off the base, plus the odd sawdust chip from the work
      if (Math.random() < dt * 6) {
        const bx = b.x + Math.random() * footprintW(b);
        const by = b.y + footprintH(b) - 0.1;
        this.spawnDust(bx, by, 2);
        if (Math.random() < 0.45) this.spawnBurst(bx, by - 0.2, '#d8c27a', 1);
      }
      const need = BUILD_TIME[b.kind] ?? 5;
      if (b.progress >= need) {
        b.state = 'ready';
        if (b.kind === 'lift') {
          this.world.extraSupport.add(this.world.idx(b.x, b.liftTopY + 1));
        }
        this.onEvent({ type: 'built', building: b });
        w.task = null;
        w.working = false;
      }
    } else if (task.kind === 'upgrade') {
      const up = this.thUpgrade;
      if (!up) {
        this.abortTask(w);
        return;
      }
      up.progress += dt * BUILDER_SPEED;
      const th = this.townhall;
      if (Math.random() < dt * 6) {
        const bx = th.x + Math.random() * footprintW(th);
        const by = th.y + footprintH(th) - 0.1;
        this.spawnDust(bx, by, 2);
        if (Math.random() < 0.45) this.spawnBurst(bx, by - 0.2, '#d8c27a', 1);
      }
      if (up.progress >= up.time) {
        this.thUpgrade = null;
        this.thLevel++;
        this.onEvent({ type: 'upgraded', level: this.thLevel });
        w.task = null;
        w.working = false;
      }
    }
  }

  // ---- movement ---------------------------------------------------------------------

  private tickMove(w: Worker, dt: number): void {
    if (w.stepIdx >= w.path.length) {
      // arrived
      w.px = w.cx;
      w.py = w.cy;
      if (w.task && !w.working) this.arriveAtTaskTarget(w);
      return;
    }
    const step = w.path[w.stepIdx];

    // validate the step is still traversable (world may have changed)
    if (step.kind === 'walk' || step.kind === 'climb') {
      if (!this.world.isPassable(step.x, step.y)) {
        this.repath(w);
        return;
      }
    }

    if (step.kind === 'lift') {
      const lift = this.lifts.find((l) => l.state === 'ready' && l.x === w.cx && l.y === w.cy && l.liftTopY === step.y);
      if (!lift) {
        this.repath(w);
        return;
      }
      if (this.weather === 'storm' && lift.liftRiderId !== w.id) {
        w.waiting = true; // storm brake: nobody boards until the gust passes
        return;
      }
      if (lift.liftBusy && lift.liftRiderId !== w.id) {
        w.waiting = true; // queue at the base until the car is free
        return;
      }
      w.waiting = false;
      lift.liftBusy = true;
      lift.liftRiderId = w.id;
      // ride: move straight up with the car
      const speed = LIFT_SPEED * dt;
      w.py -= speed;
      lift.liftCarY = w.py;
      if (w.py <= step.y) {
        w.py = step.y;
        w.cx = step.x;
        w.cy = step.y;
        lift.liftBusy = false;
        lift.liftRiderId = null;
        w.stepIdx++;
        if (w.stepIdx >= w.path.length) this.tickMove(w, 0);
      }
      return;
    }

    if (step.kind === 'slide') {
      // the rope must still exist (and be built) to slide down it
      const rope = this.ropes.find(
        (r) => r.state === 'ready' && r.x === w.cx && r.y === w.cy && r.x + r.ropeSide === step.x && r.ropeBottomY === step.y
      );
      if (!rope) {
        this.repath(w);
        return;
      }
    }

    const speed =
      (step.kind === 'climb'
        ? CLIMB_SPEED
        : step.kind === 'fall'
          ? FALL_SPEED
          : step.kind === 'slide'
            ? SLIDE_SPEED
            : WALK_SPEED) * dt;
    const tx = step.x;
    const ty = step.y;
    // move horizontally first for falls and rope slides, then vertically
    let dx = tx - w.px;
    let dy = ty - w.py;
    if ((step.kind === 'fall' || step.kind === 'slide') && Math.abs(dx) > 0.01) dy = 0;
    const len = Math.hypot(dx, dy);
    if (Math.abs(dx) > 0.01) w.facing = dx > 0 ? 1 : -1;
    if (len <= speed) {
      // a real drop (not a one-tile hop-down) lands with a thump
      if (step.kind === 'fall' && ty - w.cy >= 2) {
        this.lookEvents.push({ kind: 'worker-land', id: w.id, x: tx, y: ty, dist: ty - w.cy });
      }
      w.px = tx;
      w.py = ty;
      w.cx = tx;
      w.cy = ty;
      w.stepIdx++;
      w.animT += dt * 6;
      if (w.stepIdx >= w.path.length) {
        if (w.task && !w.working) this.arriveAtTaskTarget(w);
      }
    } else {
      w.px += (dx / len) * speed;
      w.py += (dy / len) * speed;
      w.animT += dt * (step.kind === 'fall' ? 2 : 6);
    }
  }

  private repath(w: Worker): void {
    if (!w.task || w.path.length === 0) {
      this.abortTask(w);
      return;
    }
    const last = w.path[w.path.length - 1];
    const targets = new Set<number>([this.world.key(last.x, last.y)]);
    const path = findPath(this.world, this.transits, w.cx, w.cy, targets, w.carrying !== null);
    if (path) {
      w.path = path.steps;
      w.stepIdx = 0;
    } else {
      this.abortTask(w);
    }
  }

  // ---- production, gravity, win ---------------------------------------------------------

  // The counterweight hoist's whole rule: THE HEAVIER SIDE SINKS. When the
  // upper car outweighs the lower one the cars swap ends (a timed animation),
  // then both unload as ordinary ground items at their new stations. Storms
  // lock the brake, exactly like the cargo lift's.
  private tickHoist(b: Building, dt: number): void {
    if (b.hoistBusy) {
      b.hoistT += dt;
      if (b.hoistT >= HOIST_CYCLE) {
        // the (former) upper car arrives below, the lower car arrives on top
        for (const [k, v] of Object.entries(b.hoistUpper)) {
          for (let i = 0; i < (v as number); i++) {
            this.dropItem(k as ItemType, b.x + b.ropeSide, b.ropeBottomY, {
              x: b.x + b.ropeSide,
              y: b.ropeBottomY - 0.6,
            });
          }
        }
        for (const [k, v] of Object.entries(b.hoistLower)) {
          for (let i = 0; i < (v as number); i++) {
            this.dropItem(k as ItemType, b.x, b.y, { x: b.x + b.ropeSide, y: b.y + 0.2 });
          }
        }
        b.hoistUpper = {};
        b.hoistLower = {};
        b.hoistBusy = false;
        b.hoistT = 0;
      }
      return;
    }
    if (this.weather === 'storm') return; // brake locked until the gust passes
    // hold the wheel while loaders are still on their way — otherwise ballast
    // deposited a moment before its cargo would ride down alone and be wasted
    if (carCount(b.hoistUpperIn) + carCount(b.hoistLowerIn) > 0) return;
    if (carWeight(b.hoistUpper) > carWeight(b.hoistLower)) {
      b.hoistBusy = true;
      b.hoistT = 0;
      this.onEvent({ type: 'hoistCycle' });
    }
  }

  private tickBuildings(dt: number): void {
    for (const b of this.buildings) {
      if (b.state !== 'ready') continue;
      if (b.kind === 'hoist') {
        this.tickHoist(b, dt);
        continue;
      }
      const recipe = RECIPES[b.kind];
      if (!recipe) continue;
      if (!b.processing) {
        const canStart = Object.entries(recipe.inputs).every(
          ([k, v]) => (b.inputs[k as ItemType] ?? 0) >= (v as number)
        );
        const outTotal = Object.values(b.outputs).reduce((s, v) => s + (v ?? 0), 0);
        if (canStart && outTotal < 6) {
          for (const [k, v] of Object.entries(recipe.inputs)) {
            b.inputs[k as ItemType]! -= v as number;
          }
          b.processing = true;
          b.processT = 0;
        }
      } else {
        b.processT += dt;
        if (b.processT >= recipe.time) {
          b.processing = false;
          for (const [k, v] of Object.entries(recipe.outputs)) {
            const item = k as ItemType;
            b.outputs[item] = (b.outputs[item] ?? 0) + (v as number);
            this.onEvent({ type: 'produce', building: b, item });
          }
        }
      }
      // idle lift car sinks back to its base
      if (b.kind === 'lift' && !b.liftBusy && b.liftCarY < b.y) {
        b.liftCarY = Math.min(b.y, b.liftCarY + dt * 3);
      }
    }
  }

  // ---- weather & flood -------------------------------------------------------

  private tickWeather(dt: number): void {
    const sched = this.weatherSchedule;
    if (!sched) return;
    this.weatherT += dt;
    this.weatherFadeT += dt;
    const phase = sched[this.weatherIdx % sched.length];
    if (this.weatherT >= phase.duration) {
      this.weatherT -= phase.duration;
      this.weatherPrev = phase.kind; // the kind we're leaving
      this.weatherIdx = (this.weatherIdx + 1) % sched.length;
      this.weatherFadeT = this.weatherT; // start the fade from the boundary (carry overflow)
      const kind = sched[this.weatherIdx].kind;
      this.onEvent({ type: 'weather', kind });
      // in flood levels, every downpour raises the water table one row
      if (kind === 'rain' && this.level.flood) this.riseWater();
    }
  }

  // Raise the water table one row: AIR at or below the new row floods, goods
  // in the water are lost, and smallhands caught wading scramble home.
  riseWater(): void {
    const f = this.level.flood;
    if (!f) return;
    const next = this.waterRow === null ? f.start : this.waterRow - 1;
    if (next < f.min) return;
    this.waterRow = next;
    const { world } = this;
    for (let x = 0; x < world.w; x++) {
      for (let y = next; y < world.h; y++) {
        if (world.get(x, y) === T.AIR) world.set(x, y, T.WATER);
      }
    }
    this.groundItems = this.groundItems.filter((gi) => {
      if (world.get(gi.x, gi.y) !== T.WATER) return true;
      this.sinkItem(gi.item, gi.x, gi.y);
      return false;
    });
    let rescued = 0;
    for (const w of this.workers) {
      if (world.get(w.cx, w.cy) === T.WATER || world.get(Math.round(w.px), Math.round(w.py)) === T.WATER) {
        this.rescueWorker(w);
        rescued++;
      }
    }
    this.onEvent({ type: 'flood', row: next, rescued });
  }

  // A smallhand caught by the water scrambles back to the town hall, dropping
  // whatever they carried into the drink.
  private rescueWorker(w: Worker): void {
    if (w.task) this.abortTask(w); // drops cargo — over water it sinks
    const th = this.townhall;
    const door = settle(this.world, th.x + 1 + (w.id % 2), th.y + FOOTPRINTS.townhall.h - 1);
    if (door) {
      w.cx = door.x;
      w.cy = door.y;
      w.px = door.x;
      w.py = door.y;
    }
    w.path = [];
    w.stepIdx = 0;
    w.spawnT = 0.6; // pop back in, soggy but safe
  }

  private tickGravity(): void {
    for (const w of this.workers) {
      if (this.world.get(w.cx, w.cy) === T.WATER) {
        // washed out mid-path (e.g. the tide rose under a route) — scramble home
        this.rescueWorker(w);
        continue;
      }
      // A support tile (ramp or bridge) was built into the worker's cell —
      // pop them up on top of the new tile instead of entombing them.
      if (!this.world.isPassable(w.cx, w.cy)) {
        let freed = false;
        for (let ny = w.cy - 1; ny >= w.cy - 3; ny--) {
          if (this.world.isStandable(w.cx, ny)) {
            if (w.task) this.abortTask(w);
            w.cy = ny;
            w.px = w.cx;
            w.py = ny;
            w.path = [];
            w.stepIdx = 0;
            freed = true;
            break;
          }
          if (!this.world.isPassable(w.cx, ny)) break;
        }
        if (freed) continue;
      }
      if (w.stepIdx < w.path.length) continue; // mid-path, handled there
      if (!this.world.isStandable(w.cx, w.cy)) {
        const spot = settle(this.world, w.cx, w.cy);
        if (w.task) this.abortTask(w);
        if (spot) {
          w.cx = spot.x;
          w.cy = spot.y;
          w.path = [{ x: spot.x, y: spot.y, kind: 'fall' }];
          w.stepIdx = 0;
        }
      }
    }
    for (const gi of this.groundItems) {
      if (!this.world.isSupport(gi.x, gi.y + 1) && this.world.isPassable(gi.x, gi.y)) {
        const spot = settle(this.world, gi.x, gi.y);
        if (spot) {
          gi.x = spot.x;
          gi.y = spot.y;
        }
      }
    }
  }

  // Which feats did this run earn? Evaluated at win time.
  earnedFeats(): string[] {
    const out: string[] = [];
    if (this.demolishCount === 0) out.push('no-demolish');
    if (this.nodes.length > 0) {
      const touched = this.nodes.filter((n) => n.yieldLeft < NODE_YIELD[n.kind].amount).length;
      // "leave half untouched" ⇒ untouched ≥ n/2 ⇒ touched ≤ floor(n/2). Using
      // floor (not ceil) keeps the miss honest: it can't be earned by touching a
      // majority on odd counts, and a single-node level can't cheat it.
      if (touched <= Math.floor(this.nodes.length / 2)) out.push('light-touch');
    }
    return out;
  }

  private checkWin(): void {
    if (this.won) return;
    if (this.objectives.every((o) => o.delivered >= o.amount)) {
      this.won = true;
      this.onEvent({ type: 'win' });
    }
  }

  private tickHints(): void {
    for (const h of this.level.hints ?? []) {
      if (this.hintsShown.has(h.id)) continue;
      if (h.when(this)) {
        this.hintsShown.add(h.id);
        this.onEvent({ type: 'hint', text: h.text });
        break; // one hint at a time
      }
    }
  }

  spawnBurst(x: number, y: number, color: string, n = 5): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI - Math.PI;
      const sp = 1 + Math.random() * 2.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1,
        life: 0.5 + Math.random() * 0.3,
        maxLife: 0.8,
        color,
        size: 1.5 + Math.random() * 1.5,
      });
    }
  }

  // Pale dust kicked into the air by construction work: a soft upward fan that
  // drifts sideways and settles back down (tickParticles' gravity pulls it in).
  // Airier and longer-lived than spawnBurst's debris chips.
  spawnDust(x: number, y: number, n = 3): void {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.3; // fan upward
      const sp = 1.2 + Math.random() * 1.8;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 0.6,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.6,
        life: 0.8 + Math.random() * 0.6,
        maxLife: 1.4,
        color: Math.random() < 0.5 ? '#e6dcc6' : '#d0bd98',
        size: 1.5 + Math.random() * 2,
        grav: 1.5, // floaty: hangs in the air a moment before settling
      });
    }
  }

  // ---- main tick ------------------------------------------------------------------------

  tick(dt: number): void {
    // headless runs (unit tests, verifier soaks) have no renderer draining the
    // cosmetic outbox — drop the oldest breadcrumbs instead of growing forever
    if (this.lookEvents.length > 200) this.lookEvents.splice(0, this.lookEvents.length - 200);
    if (this.paused || this.won) {
      // still animate particles so the win moment sparkles
      this.tickParticles(dt);
      return;
    }
    this.time += dt;

    // day↔night cycle levels advance the diegetic clock (game-hours per second);
    // day/static-night maps leave timeOfDay fixed. Driven by sim dt, not the
    // render clock, so it keeps honest under reduced motion and at every speed.
    if (this.level.dayNight) {
      this.timeOfDay = (this.timeOfDay + this.level.dayNight.rate * dt) % 24;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.workers.length < this.maxWorkers) {
      this.spawnWorker();
      this.spawnTimer = WORKER_SPAWN_INTERVAL;
    }

    this.schedTimer -= dt;
    if (this.schedTimer <= 0) {
      this.schedule();
      this.schedTimer = 0.3;
    }

    for (const w of this.workers) {
      if (w.spawnT > 0) {
        w.spawnT -= dt;
        continue;
      }
      if (w.working) this.tickWorking(w, dt);
      else if (w.task) this.tickMove(w, dt);
      else w.animT += dt;
    }

    this.tickWeather(dt);
    this.tickBuildings(dt);
    this.tickGravity();
    this.tickParticles(dt);

    this.hintTimer -= dt;
    if (this.hintTimer <= 0) {
      this.tickHints();
      this.hintTimer = 0.5;
    }

    for (const gi of this.groundItems) {
      if (gi.bounce > 0) gi.bounce -= dt;
    }
    for (const n of this.nodes) {
      if (n.wobble > 0) n.wobble -= dt;
    }
  }

  private tickParticles(dt: number): void {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.grav ?? 9) * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
}
