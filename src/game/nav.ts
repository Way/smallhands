import { T, MAX_FALL, MAX_FALL_CARRY } from './types';
import type { Building, PathStep } from './types';
import type { World } from './world';

// Movement graph search. The graph differs depending on whether the
// smallhand is carrying goods:
//   - carrying workers cannot climb ladders
//   - carrying workers only dare small drops
//   - cargo lifts move workers (and their cargo) upward only
//   - rope anchors slide workers (and their cargo) downward only
//
// Falls make the graph directional: walking off a ledge is easy,
// getting back up needs a ladder (empty-handed) or a lift.

interface SearchResult {
  steps: PathStep[]; // excludes the start cell
  cost: number;
}

export function findPath(
  world: World,
  transits: Building[], // ready-or-not lifts and rope anchors
  sx: number,
  sy: number,
  targets: Set<number>, // cell keys that count as arrival
  carrying: boolean
): SearchResult | null {
  if (!world.isStandable(sx, sy)) {
    // A worker mid-fall or on a demolished tile: let them settle first.
    const settled = settle(world, sx, sy);
    if (!settled) return null;
    sx = settled.x;
    sy = settled.y;
  }
  const startKey = world.key(sx, sy);
  if (targets.has(startKey)) return { steps: [], cost: 0 };

  const maxFall = carrying ? MAX_FALL_CARRY : MAX_FALL;

  // Uniform-cost search (Dijkstra) over the movement graph with a small
  // binary heap. Entries carry their cost at push time; outdated entries
  // (cost worse than the best known) are skipped on pop.
  const dist = new Map<number, number>();
  const prev = new Map<number, { key: number; step: PathStep }>();
  dist.set(startKey, 0);
  const heap: { key: number; cost: number }[] = [{ key: startKey, cost: 0 }];

  const push = (key: number, cost: number) => {
    heap.push({ key, cost });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].cost <= heap[i].cost) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };

  const pop = (): { key: number; cost: number } => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].cost < heap[m].cost) m = l;
        if (r < heap.length && heap[r].cost < heap[m].cost) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  let found: number | null = null;
  while (heap.length > 0) {
    const entry = pop();
    const key = entry.key;
    const d = dist.get(key)!;
    if (entry.cost > d) continue; // outdated entry
    if (targets.has(key)) {
      found = key;
      break;
    }
    const x = key % world.w;
    const y = Math.floor(key / world.w);

    const consider = (nx: number, ny: number, kind: PathStep['kind'], cost: number) => {
      const nk = world.key(nx, ny);
      const nd = d + cost;
      const old = dist.get(nk);
      if (old !== undefined && old <= nd) return;
      dist.set(nk, nd);
      prev.set(nk, { key, step: { x: nx, y: ny, kind } });
      push(nk, nd);
    };

    // Walk left/right on the same level.
    for (const dx of [-1, 1]) {
      const nx = x + dx;
      if (world.isStandable(nx, y)) {
        consider(nx, y, 'walk', 1);
      } else if (world.isPassable(nx, y) && world.isPassable(nx, y - 1) === true) {
        // nothing — handled by fall below
      }
      // Step up one tile (a little hop onto a ledge) — needs headroom. A ramp
      // tile overhead counts as headroom: its underside is a diagonal, so a
      // smallhand in the pocket beneath a ramp run can duck out onto the ramp
      // instead of being walled in by its own staircase.
      const head = world.get(x, y - 1);
      if (
        world.isStandable(nx, y - 1) &&
        (world.isPassable(x, y - 1) || head === T.RAMP) &&
        world.get(nx, y - 1) !== T.LADDER
      ) {
        consider(nx, y - 1, 'walk', 1.4);
      }
      // Walk off the edge and fall.
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
        if (ok) consider(nx, fy, 'fall', 1 + (fy - y) * 0.3);
      }
    }

    // Ladders (never while carrying).
    if (!carrying) {
      if (world.get(x, y) === T.LADDER && world.isPassable(x, y - 1)) {
        if (world.get(x, y - 1) === T.LADDER || world.isStandable(x, y - 1)) {
          consider(x, y - 1, 'climb', 1.5);
        }
      }
      if (world.get(x, y + 1) === T.LADDER) {
        consider(x, y + 1, 'climb', 1.5);
      }
    }

    // Cargo lifts: base cell → top landing cell, upward only.
    // Rope anchors: anchor cell → bottom landing, downward only, cargo ok.
    for (const t of transits) {
      if (t.state !== 'ready') continue;
      if (t.kind === 'lift' && t.x === x && t.y === y) {
        consider(t.x, t.liftTopY, 'lift', 2 + (t.y - t.liftTopY) * 0.4);
      } else if (t.kind === 'rope' && t.x === x && t.y === y) {
        consider(t.x + t.ropeSide, t.ropeBottomY, 'slide', 1.2 + (t.ropeBottomY - t.y) * 0.15);
      }
    }
  }

  if (found === null) return null;
  const steps: PathStep[] = [];
  let cur = found;
  while (cur !== startKey) {
    const p = prev.get(cur)!;
    steps.push(p.step);
    cur = p.key;
  }
  steps.reverse();
  return { steps, cost: dist.get(found)! };
}

// Where does a body at (x, y) come to rest if dropped straight down?
export function settle(world: World, x: number, y: number): { x: number; y: number } | null {
  if (!world.inBounds(x, y)) return null;
  let fy = y;
  while (fy < world.h && !world.isStandable(x, fy)) {
    if (!world.isPassable(x, fy)) return null;
    fy++;
  }
  return fy < world.h ? { x, y: fy } : null;
}

// Cells from which a worker can interact with a building footprint:
// standing anywhere inside it, or directly beside it at ground level.
export function buildingApproachCells(
  world: World,
  x: number,
  y: number,
  w: number,
  h: number
): Set<number> {
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

// Cells from which a worker can work on a resource node (beside or on it).
export function nodeApproachCells(world: World, nx: number, ny: number): Set<number> {
  const cells = new Set<number>();
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, 0],
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ]) {
    if (world.isStandable(nx + dx, ny + dy)) cells.add(world.key(nx + dx, ny + dy));
  }
  return cells;
}
