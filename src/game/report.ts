// Bug/feedback reports: everything an agent needs to reproduce, verify and fix
// what the player just hit.
//
// Two halves, both pure and DOM-free so the headless suites can exercise them
// against a real Game:
//
//   collectReport()  Game -> ReportData    a flat, serializable picture of the run
//   formatReport()   ReportData -> string  the markdown the player copies
//
// The third artifact, `ReportData.code`, is a *snapshot* share code: the world
// as it stands right now, not as the level began. Pasting it back into the game
// reconstructs the exact map — see snapshotLevelData below.
//
// The report body is deliberately English-only. It is read by agents, not by
// players; only the surrounding UI (report-ui.ts) is localized. The player's own
// words are copied through verbatim in whatever language they typed.

import { BUILD_TIME, ITEM_TYPES, NODE_YIELD, ROLES } from './types';
import type { Building, BuildingKind, ItemType, Role } from './types';
import type { Game, Worker } from './sim';
import { encodeShareCode, encodeTiles, makeLevelId } from './leveldata';
import type { CustomLevelData, SnapshotBuilding } from './leveldata';

export type ReportKind = 'bug' | 'feedback' | 'idea';

// Everything about the report that the sim cannot know: who is running it, on
// what, and what they wanted to say. Supplied by the caller (report-ui.ts).
export interface ReportContext {
  kind: ReportKind;
  message: string; // the player's free text, verbatim
  levelLabel: string; // "campaign 2 · level 7" or "custom level"
  originCode?: string; // pristine starting code, for custom levels
  speed: number; // main-loop speed multiplier — a sim-external concern
  build: string;
  userAgent: string;
  viewport: string;
  lang: string;
  generatedAt: string; // ISO 8601
}

export interface ReportData {
  context: ReportContext;
  level: {
    id: number;
    name: string;
    desc: string;
    width: number;
    height: number;
    campaign: number;
    biome: string;
    night: boolean;
    dayNightRate: number | null;
    flood: { start: number; min: number } | null;
  };
  run: {
    time: number;
    clock: string;
    timeOfDay: number;
    nightAmount: number;
    weather: string;
    weatherNext: string | null;
    weatherIn: number | null;
    waterRow: number | null;
    paused: boolean;
    won: boolean;
    demolishCount: number;
    thLevel: number;
    thUpgrade: { progress: number; time: number; builderId: number | null } | null;
    workerCount: number;
    maxWorkers: number;
  };
  objectives: { item: ItemType; amount: number; delivered: number; inbound: number }[];
  stock: { item: ItemType; count: number; reserved: number; keep: number }[];
  roles: { role: Role; desired: number; actual: number }[];
  workers: {
    id: number;
    role: Role;
    task: string;
    carrying: ItemType | null;
    cx: number;
    cy: number;
    working: boolean;
    waiting: boolean;
    hasShovel: boolean;
  }[];
  buildings: {
    id: number;
    kind: BuildingKind;
    x: number;
    y: number;
    state: string;
    progress: number | null; // blueprints: seconds done
    buildTime: number | null;
    paused: boolean;
    processing: boolean;
    inputs: string;
    outputs: string;
    detail: string; // kind-specific extras (lift span, hoist cars, …)
  }[];
  nodes: { kind: string; x: number; y: number; yieldLeft: number; max: number; workerId: number | null }[];
  groundItems: { item: ItemType; x: number; y: number; reserved: boolean; stranded: boolean }[];
  digOrders: { x: number; y: number }[];
  code: string; // live snapshot share code
}

// ---- snapshot code ----------------------------------------------------------

// The world as it stands right now, in the shareable level format. Terrain comes
// straight off `world.tiles`, so every dug cell, ladder, ramp and platform the
// player made is baked in; the start-state fields are filled from live values so
// loading the code drops you into the same economy, not the level's opening one.
export function snapshotLevelData(game: Game, name?: string): CustomLevelData {
  const { level, world } = game;
  const townhall = game.townhall;
  const goal = game.goal;
  const startStock: Partial<Record<ItemType, number>> = {};
  for (const item of ITEM_TYPES) {
    if (game.stock[item] > 0) startStock[item] = game.stock[item];
  }
  const startRoles: Partial<Record<Role, number>> = {};
  for (const role of ROLES) {
    if (game.desiredRoles[role] > 0) startRoles[role] = game.desiredRoles[role];
  }
  // BUILD_TIME's keys are exactly the constructible buildings, which is also
  // exactly what a snapshot may carry: townhall and goal are excluded because
  // they travel in their own fields and would otherwise be placed twice.
  const buildings: SnapshotBuilding[] = game.buildings
    .filter((b) => BUILD_TIME[b.kind] !== undefined)
    .map((b) => ({
      kind: b.kind,
      x: b.x,
      y: b.y,
      ready: b.state === 'ready',
      ...(b.state === 'ready' ? {} : { progress: round2(b.progress) }),
      ...(b.paused ? { paused: true as const } : {}),
    }));

  return {
    v: 1,
    id: makeLevelId(),
    name: (name ?? `${level.name} (snapshot)`).slice(0, 40),
    desc: `Reported state of ${level.name}`.slice(0, 140),
    width: level.width,
    height: level.height,
    tiles: encodeTiles(world.tiles),
    nodes: game.nodes.map((n) => ({ kind: n.kind, x: n.x, y: n.y, yieldLeft: n.yieldLeft })),
    townhall: { x: townhall.x, y: townhall.y },
    // A level always has a goal in practice; fall back to the townhall cell
    // rather than throwing, so a report never fails on a half-built world.
    goal: goal ? { x: goal.x, y: goal.y } : { x: townhall.x, y: townhall.y },
    objectives: game.objectives.map((o) => ({ item: o.item, amount: o.amount })),
    startStock,
    startRoles,
    startWorkers: Math.max(1, game.workers.length),
    startThLevel: game.thLevel,
    biome: level.biome,
    ...(buildings.length ? { buildings } : {}),
  };
}

// ---- collection --------------------------------------------------------------

export function collectReport(game: Game, context: ReportContext): ReportData {
  const { level } = game;
  const sched = game.weatherSchedule;
  const nextPhase = sched ? sched[(game.weatherIdx + 1) % sched.length] : null;

  return {
    context,
    level: {
      id: level.id,
      name: level.name,
      desc: level.desc,
      width: level.width,
      height: level.height,
      campaign: level.campaign ?? 1,
      biome: level.biome ?? 'meadow',
      night: level.night === true,
      dayNightRate: level.dayNight?.rate ?? null,
      flood: level.flood ?? null,
    },
    run: {
      time: round2(game.time),
      clock: clockString(game.timeOfDay),
      timeOfDay: round2(game.timeOfDay),
      nightAmount: round2(game.nightAmount()),
      weather: game.weather,
      weatherNext: nextPhase ? nextPhase.kind : null,
      weatherIn: Number.isFinite(game.weatherRemaining) ? round2(game.weatherRemaining) : null,
      waterRow: game.waterRow,
      paused: game.paused,
      won: game.won,
      demolishCount: game.demolishCount,
      thLevel: game.thLevel,
      thUpgrade: game.thUpgrade
        ? { progress: round2(game.thUpgrade.progress), time: game.thUpgrade.time, builderId: game.thUpgrade.builderId }
        : null,
      workerCount: game.workers.length,
      maxWorkers: game.maxWorkers,
    },
    objectives: game.objectives.map((o) => ({
      item: o.item,
      amount: o.amount,
      delivered: o.delivered,
      inbound: o.inbound,
    })),
    stock: ITEM_TYPES.map((item) => ({
      item,
      count: game.stock[item],
      reserved: game.stockReserved[item],
      keep: game.keep[item],
    })),
    roles: ROLES.map((role) => ({
      role,
      desired: game.desiredRoles[role],
      actual: game.workers.filter((w) => w.role === role).length,
    })),
    workers: game.workers.map((w) => ({
      id: w.id,
      role: w.role,
      task: describeTask(w),
      carrying: w.carrying,
      cx: w.cx,
      cy: w.cy,
      working: w.working,
      waiting: w.waiting,
      hasShovel: w.hasShovel,
    })),
    buildings: game.buildings.map((b) => ({
      id: b.id,
      kind: b.kind,
      x: b.x,
      y: b.y,
      state: b.state,
      progress: b.state === 'ready' ? null : round2(b.progress),
      buildTime: BUILD_TIME[b.kind] ?? null,
      paused: b.paused,
      processing: b.processing,
      inputs: bag(b.inputs, b.inbound),
      outputs: bag(b.outputs),
      detail: describeBuilding(b),
    })),
    nodes: game.nodes.map((n) => ({
      kind: n.kind,
      x: n.x,
      y: n.y,
      yieldLeft: n.yieldLeft,
      max: NODE_YIELD[n.kind].amount,
      workerId: n.workerId,
    })),
    groundItems: game.groundItems.map((g) => ({
      item: g.item,
      x: g.x,
      y: g.y,
      reserved: g.reserved,
      stranded: g.stranded,
    })),
    digOrders: [...game.digOrders].map((idx) => ({ x: idx % level.width, y: Math.floor(idx / level.width) })),
    code: encodeShareCode(snapshotLevelData(game)),
  };
}

// ---- markdown -----------------------------------------------------------------

const KIND_TITLE: Record<ReportKind, string> = {
  bug: 'Bug report',
  feedback: 'Feedback',
  idea: 'Idea',
};

export function formatReport(d: ReportData): string {
  const { context: c, run, level } = d;
  const out: string[] = [];
  const push = (s = ''): number => out.push(s);

  push(`# Smallhands — ${KIND_TITLE[c.kind]}`);
  push();
  push(`- **Level:** ${c.levelLabel} — "${level.name}" (id ${level.id}, ${level.width}×${level.height}, ${level.biome})`);
  push(`- **When:** ${c.generatedAt}`);
  push(`- **Build:** ${c.build}`);
  push(`- **Client:** ${c.viewport} · lang ${c.lang}`);
  push(`- **UA:** ${c.userAgent}`);
  push();

  push(`## What happened`);
  push();
  push(c.message.trim() || '_(no description given)_');
  push();

  push(`## Run state`);
  push();
  push(`| | |`);
  push(`|---|---|`);
  push(`| elapsed | ${run.time}s |`);
  push(`| clock | ${run.clock} (hour ${run.timeOfDay}, night ${run.nightAmount}) |`);
  push(`| speed | ${c.speed}× ${run.paused ? '(paused)' : ''} |`);
  push(
    `| weather | ${run.weather}${
      run.weatherNext && run.weatherIn !== null ? ` → ${run.weatherNext} in ${run.weatherIn}s` : ' (static)'
    } |`
  );
  push(`| water row | ${run.waterRow ?? '—'}${level.flood ? ` (flood ${level.flood.start}→${level.flood.min})` : ''} |`);
  push(`| town hall | level ${run.thLevel}${run.thUpgrade ? ` (upgrading ${run.thUpgrade.progress}/${run.thUpgrade.time}s)` : ''} |`);
  push(`| workers | ${run.workerCount}/${run.maxWorkers} |`);
  push(`| demolished | ${run.demolishCount} |`);
  push(`| won | ${run.won} |`);
  push();

  push(`## Objectives`);
  push();
  for (const o of d.objectives) {
    const done = o.delivered >= o.amount ? ' ✓' : '';
    push(`- ${o.item} ${o.delivered}/${o.amount}${o.inbound ? ` (+${o.inbound} inbound)` : ''}${done}`);
  }
  push();

  push(`## Stock`);
  push();
  const held = d.stock.filter((s) => s.count || s.reserved || s.keep);
  push(
    held.length
      ? held
          .map((s) => `${s.item} ${s.count}${s.reserved ? ` (${s.reserved} reserved)` : ''}${s.keep ? ` [keep ${s.keep}]` : ''}`)
          .join(' · ')
      : '_(empty)_'
  );
  push();

  push(`## Roles`);
  push();
  push(d.roles.map((r) => `${r.role} ${r.actual}/${r.desired}`).join(' · '));
  push();

  push(`## Workers (${d.workers.length})`);
  push();
  push('| id | role | task | carrying | cell | flags |');
  push('|---|---|---|---|---|---|');
  for (const w of d.workers) {
    const flags = [w.working && 'working', w.waiting && 'waiting-lift', w.hasShovel && 'shovel']
      .filter(Boolean)
      .join(', ');
    push(`| ${w.id} | ${w.role} | ${w.task} | ${w.carrying ?? '—'} | ${w.cx},${w.cy} | ${flags || '—'} |`);
  }
  push();

  push(`## Buildings (${d.buildings.length})`);
  push();
  push('| kind | cell | state | in | out | detail |');
  push('|---|---|---|---|---|---|');
  for (const b of d.buildings) {
    const state =
      b.state === 'ready'
        ? b.paused
          ? 'ready (PAUSED)'
          : b.processing
            ? 'ready (processing)'
            : 'ready'
        : `blueprint ${b.progress}/${b.buildTime}s`;
    push(`| ${b.kind} | ${b.x},${b.y} | ${state} | ${b.inputs} | ${b.outputs} | ${b.detail} |`);
  }
  push();

  push(`## Resource nodes (${d.nodes.length})`);
  push();
  push(
    d.nodes.length
      ? d.nodes
          .map((n) => `${n.kind} ${n.x},${n.y} ${n.yieldLeft}/${n.max}${n.workerId !== null ? ` (worker ${n.workerId})` : ''}`)
          .join(' · ')
      : '_(none left)_'
  );
  push();

  push(`## Loose items (${d.groundItems.length})`);
  push();
  push(
    d.groundItems.length
      ? d.groundItems
          .map(
            (g) =>
              `${g.item} ${g.x},${g.y}${g.stranded ? ' STRANDED' : ''}${g.reserved ? ' (reserved)' : ''}`
          )
          .join(' · ')
      : '_(none)_'
  );
  push();

  push(`## Dig orders (${d.digOrders.length})`);
  push();
  push(d.digOrders.length ? d.digOrders.map((o) => `(${o.x},${o.y})`).join(' ') : '_(none)_');
  push();

  push(`## Live level code`);
  push();
  push('Paste into the game to load the map exactly as it was when this was reported.');
  push();
  push('```');
  push(d.code);
  push('```');
  push();

  if (c.originCode) {
    push(`## Original level code`);
    push();
    push('The level as it started, before the player changed anything.');
    push();
    push('```');
    push(c.originCode);
    push('```');
    push();
  }

  return out.join('\n');
}

// ---- helpers -------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// 0..24 hour-of-day to a wall clock the reader can match against the HUD.
export function clockString(hour: number): string {
  const total = Math.round(((hour % 24) + 24) % 24 * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "log 2, plank 1(+1 inbound)" — item buffers, with reservations folded in.
function bag(items: Partial<Record<ItemType, number>>, inbound?: Partial<Record<ItemType, number>>): string {
  const parts: string[] = [];
  for (const item of ITEM_TYPES) {
    const have = items[item] ?? 0;
    const coming = inbound?.[item] ?? 0;
    if (!have && !coming) continue;
    parts.push(`${item} ${have}${coming ? `(+${coming})` : ''}`);
  }
  return parts.join(', ') || '—';
}

function describeTask(w: Worker): string {
  const t = w.task;
  if (!t) return 'idle';
  switch (t.kind) {
    case 'harvest':
      return `harvest node ${t.nodeId}`;
    case 'haul':
      return `haul ${t.item} ${endpoint(t.source)}→${endpoint(t.sink)} (${t.phase})`;
    case 'construct':
      return `construct building ${t.buildingId}`;
    case 'upgrade':
      return 'upgrade town hall';
    case 'dig':
      return `dig ${t.tx},${t.ty}`;
    case 'wander':
      return 'wander';
  }
}

function endpoint(e: { t: string; id?: number; car?: string }): string {
  return e.id === undefined ? e.t : `${e.t}#${e.id}${e.car ? `/${e.car}` : ''}`;
}

function describeBuilding(b: Building): string {
  switch (b.kind) {
    case 'lift':
      return `car y${round2(b.liftCarY)}, span ${b.liftTopY}→${b.y}${b.liftBusy ? ', busy' : ''}${
        b.liftRiderId !== null ? `, rider ${b.liftRiderId}` : ''
      }`;
    case 'rope':
      return `drops ${b.y}→${b.ropeBottomY}, side ${b.ropeSide}`;
    case 'hoist':
      return `drops ${b.y}→${b.ropeBottomY}, upper {${bag(b.hoistUpper, b.hoistUpperIn)}}, lower {${bag(
        b.hoistLower,
        b.hoistLowerIn
      )}}${b.hoistBusy ? ', cycling' : ''}`;
    default:
      return '—';
  }
}
