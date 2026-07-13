import {
  BUILD_TIME,
  BUILDER_SPEED,
  CLIMB_SPEED,
  FALL_SPEED,
  FOOTPRINTS,
  GOAL_LIGHT_RADIUS,
  LANTERN_RADIUS,
  LIFT_SPEED,
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
  WET_WORK_FACTOR,
  WORKER_SPAWN_INTERVAL,
} from './types';
import type {
  Building,
  BuildingKind,
  GroundItem,
  ItemType,
  ObjectiveReq,
  PathStep,
  ResourceNode,
  Role,
  ShortfallRow,
  Tool,
  WeatherKind,
  WeatherPhase,
} from './types';
import { World, canPlaceBuilding, canPlaceLadder, rampRunCells, bridgeRunCells, footprintH, footprintW, liftTopFor, ropeDropFor } from './world';
import { buildingApproachCells, findPath, nodeApproachCells, settle } from './nav';
import type { LevelDef } from './levels';

// ---- tasks ----------------------------------------------------------------

type Source = { t: 'ground'; id: number } | { t: 'stock' } | { t: 'output'; id: number };
type Sink = { t: 'stock' } | { t: 'input'; id: number } | { t: 'goal'; id: number };

type Task =
  | { kind: 'harvest'; nodeId: number }
  | { kind: 'haul'; phase: 'toSource' | 'toSink'; item: ItemType; source: Source; sink: Sink }
  | { kind: 'construct'; buildingId: number }
  | { kind: 'upgrade' }
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
  | { type: 'spawn' }
  | { type: 'produce'; building: Building; item: ItemType }
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
}

// ---- the game -------------------------------------------------------------

export class Game {
  level: LevelDef;
  world: World;
  buildings: Building[] = [];
  nodes: ResourceNode[] = [];
  groundItems: GroundItem[] = [];
  workers: Worker[] = [];
  particles: Particle[] = [];

  stock: Record<ItemType, number> = { log: 0, plank: 0, stone: 0, iron: 0, spear: 0 };
  stockReserved: Record<ItemType, number> = { log: 0, plank: 0, stone: 0, iron: 0, spear: 0 };

  // Player-set floor per item: haulers deliver only stock ABOVE this to the
  // caravan, so resources can be banked for construction. 0 = ship everything.
  keep: Record<ItemType, number> = { log: 0, plank: 0, stone: 0, iron: 0, spear: 0 };

  desiredRoles: Record<Role, number> = { hauler: 0, builder: 0, woodcutter: 0, miner: 0 };

  thLevel = 1;
  thUpgrade: { progress: number; time: number; builderId: number | null } | null = null;

  objectives: Objective[] = [];
  won = false;
  time = 0;
  speed = 1;
  paused = false;
  demolishCount = 0; // for the "No Demolish" feat

  // weather: index + elapsed time within the level's looping schedule
  weatherIdx = 0;
  private weatherT = 0;
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
    level.build(this);
    this.thLevel = level.startThLevel ?? 1;
    for (const [k, v] of Object.entries(level.startStock ?? {})) {
      this.stock[k as ItemType] = v as number;
    }
    this.desiredRoles = { hauler: 0, builder: 0, woodcutter: 0, miner: 0, ...level.startRoles };
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

  // Wet weather (rain or storm) slows outdoor harvest work.
  get workFactor(): number {
    return this.weather === 'clear' ? 1 : WET_WORK_FACTOR;
  }

  // ---- light (night levels) ----------------------------------------------------

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

  // Is the tile lit? Always true outside night levels. Smallhands only harvest
  // and raise buildings in the light (lanterns themselves are the exception).
  isLit(x: number, y: number): boolean {
    if (!this.level.night) return true;
    const cx = x + 0.5;
    const cy = y + 0.5;
    for (const s of this.lightSources()) {
      const dx = cx - s.x;
      const dy = cy - s.y;
      if (dx * dx + dy * dy <= s.r * s.r) return true;
    }
    return false;
  }

  roleCount(role: Role): number {
    let n = 0;
    for (const w of this.workers) if (w.role === role) n++;
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

  // Lay a drag-run of tiles, charging the tool's cost per tile and stopping when
  // the player can no longer afford the next one. Shared by Ramp and Bridge.
  private placeRun(toolId: Tool, cells: { x: number; y: number }[], tile: T): number {
    const cost = TOOL_DEFS.find((t) => t.id === toolId)!.cost!;
    let placed = 0;
    for (const c of cells) {
      if (!this.canAfford(cost)) break;
      this.payCost(cost);
      this.world.set(c.x, c.y, tile);
      placed++;
    }
    this.onEvent({ type: placed > 0 ? 'place' : 'invalid' });
    return placed;
  }

  placeRampRun(ax: number, ay: number, tx: number, ty: number): number {
    return this.placeRun('ramp', rampRunCells(this.world, ax, ay, tx, ty), T.RAMP);
  }

  placeBridgeRun(ax: number, ay: number, tx: number, ty: number): number {
    return this.placeRun('platform', bridgeRunCells(this.world, ax, ay, tx, ty), T.PLATFORM);
  }

  placeBuilding(kind: 'sawmill' | 'forge' | 'lantern', x: number, y: number): boolean {
    const def = TOOL_DEFS.find((t) => t.id === kind)!;
    const fp = FOOTPRINTS[kind];
    if (!this.toolUnlocked(kind) || !this.canAfford(def.cost!) || !canPlaceBuilding(this.world, this.buildings, this.nodes, x, y, fp.w, fp.h)) {
      this.onEvent({ type: 'invalid' });
      return false;
    }
    // At night, workshops rise only in the light. Lanterns are the exception —
    // that is how the player pushes the frontier of light outward.
    if (kind !== 'lantern' && !this.isLit(x + Math.floor(fp.w / 2), y + fp.h - 1)) {
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
    // no two ropes sharing an anchor cell
    if (this.ropes.some((r) => r.x === x && r.y === y)) {
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

  demolish(x: number, y: number): boolean {
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
              (task.sink.t === 'goal' && task.sink.id === b.id)))
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
      if (b.kind === 'rope') {
        // the anchor cell, or anywhere along the hanging rope
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

  private dropItem(item: ItemType, x: number, y: number): void {
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
    this.groundItems.push({ id: this.id(), item, x: spot.x, y: spot.y, reserved: false, bounce: 0.4 });
    this.onEvent({ type: 'itemSpawn', item });
  }

  private sinkItem(item: ItemType, x: number, y: number): void {
    this.spawnBurst(x + 0.5, y + 0.2, '#9fd0f0', 7);
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
    const b = this.buildings.find((bd) => bd.id === (s.t === 'input' ? s.id : s.id));
    return b ? this.buildingApproach(b) : null;
  }

  // Candidates whose path legs recently failed are paused for a few seconds
  // so they don't starve the per-pass attempt budget (e.g. items stranded in
  // a pit before a lift exists would otherwise crowd out reachable work).
  private haulCooldown = new Map<string, number>();

  private candKey(source: Source, sink: Sink, item: ItemType): string {
    const s = source.t === 'stock' ? 'stock' : `${source.t}:${source.id}`;
    const k = sink.t === 'stock' ? 'stock' : `${sink.t}:${sink.id}`;
    return `${s}>${k}:${item}`;
  }

  private tryAssignHaul(w: Worker): boolean {
    interface Candidate {
      source: Source;
      sink: Sink;
      item: ItemType;
      priority: number;
    }
    const cands: Candidate[] = [];

    // 1. goal deliveries from stock
    const goal = this.goal;
    if (goal) {
      for (const o of this.objectives) {
        if (o.delivered + o.inbound >= o.amount) continue;
        if (this.available(o.item) - this.keep[o.item] <= 0) continue;
        cands.push({ source: { t: 'stock' }, sink: { t: 'goal', id: goal.id }, item: o.item, priority: 0 });
      }
    }
    // 2. feed production buildings
    for (const b of this.buildings) {
      if (b.state !== 'ready') continue;
      const recipe = RECIPES[b.kind];
      if (!recipe) continue;
      for (const [k, need] of Object.entries(recipe.inputs)) {
        const item = k as ItemType;
        const have = (b.inputs[item] ?? 0) + (b.inbound[item] ?? 0);
        if (have >= (need as number) * 2) continue; // keep a small buffer
        if (this.available(item) <= 0) continue;
        cands.push({ source: { t: 'stock' }, sink: { t: 'input', id: b.id }, item, priority: 1 });
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
      const key = this.candKey(c.source, c.sink, c.item);
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
        w.role = role;
        deficit--;
      }
    }
  }

  private schedule(): void {
    this.rebalanceRoles();
    for (const w of this.workers) {
      if (w.task && w.task.kind !== 'wander') continue;
      if (w.task?.kind === 'wander') continue; // let them finish the stroll
      let assigned = false;
      if (w.role === 'hauler') assigned = this.tryAssignHaul(w);
      else if (w.role === 'builder') assigned = this.tryAssignConstruct(w);
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
        // drop at the harvester's feet — a spot that is provably reachable
        this.dropItem(def.item, w.cx, w.cy);
        this.onEvent({ type: 'chop', x: n.x, y: n.y, node: n });
        this.spawnBurst(n.x + 0.5, n.y - (n.kind === 'tree' ? 1 : 0), n.kind === 'tree' ? '#8a5a2b' : '#9aa3ad');
        if (n.yieldLeft <= 0) {
          n.workerId = null;
          w.task = null;
          w.working = false;
        }
      }
    } else if (task.kind === 'construct') {
      const b = this.buildings.find((bd) => bd.id === task.buildingId);
      if (!b || b.state === 'ready') {
        this.abortTask(w);
        return;
      }
      b.progress += dt * BUILDER_SPEED;
      if (Math.random() < dt * 4) this.spawnBurst(b.x + Math.random() * footprintW(b), b.y + 1, '#d8c27a', 2);
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
      if (Math.random() < dt * 4) this.spawnBurst(th.x + Math.random() * 4, th.y + 1, '#d8c27a', 2);
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

  private tickBuildings(dt: number): void {
    for (const b of this.buildings) {
      if (b.state !== 'ready') continue;
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
    const phase = sched[this.weatherIdx % sched.length];
    if (this.weatherT >= phase.duration) {
      this.weatherT -= phase.duration;
      this.weatherIdx = (this.weatherIdx + 1) % sched.length;
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

  // ---- main tick ------------------------------------------------------------------------

  tick(dt: number): void {
    if (this.paused || this.won) {
      // still animate particles so the win moment sparkles
      this.tickParticles(dt);
      return;
    }
    this.time += dt;

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
      p.vy += 9 * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }
}
