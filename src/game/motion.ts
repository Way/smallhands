// Look-physics: render-only motion for the world — verlet ropes, item flight
// arcs, tree falls, landing squash, water ripples and dust puffs.
//
// Strict one-way firewall: this layer observes sim state and drains the sim's
// `lookEvents` outbox, but nothing here is ever read back by game logic. It
// runs on the render clock (frame hitches, pauses and Math.random are all
// harmless here), and under reduced effects / prefers-reduced-motion the
// layer stays empty so the game keeps its static look.

import { TILE } from './types';
import type { LookEvent } from './types';
import type { Game } from './sim';

// clamp a frame delta so a backgrounded tab can't integrate one giant step
const MAX_DT = 0.05;

// ---- verlet rope --------------------------------------------------------------

// N points chained by distance constraints, pinned at point 0 (the anchor's
// pulley). Integrated in fixed substeps so the sway is independent of the
// display refresh rate. Coordinates are world pixels.
const ROPE_STEP = 1 / 60;
const ROPE_GRAVITY = 300; // px/s² — keeps the hanging run taut
const ROPE_DAMP = 0.94;

export class VerletRope {
  readonly n: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly segLen: number;
  private acc = 0;
  private grabIdx = -1; // a sliding hand pins this point for the frame

  constructor(x0: number, y0: number, x1: number, y1: number, n: number) {
    this.n = n;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      this.x[i] = this.px[i] = x0 + (x1 - x0) * f;
      this.y[i] = this.py[i] = y0 + (y1 - y0) * f;
    }
    this.segLen = Math.hypot(x1 - x0, y1 - y0) / (n - 1);
  }

  // A hand on the rope: pin the nearest interior point to the hand. Cleared
  // each frame (release) so letting go leaves the rope swinging back.
  grab(gx: number, gy: number): void {
    let best = 1;
    let bestD = Infinity;
    for (let i = 1; i < this.n; i++) {
      const d = Math.abs(this.y[i] - gy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.x[best] = this.px[best] = gx;
    this.y[best] = this.py[best] = gy;
    this.grabIdx = best;
  }

  release(): void {
    this.grabIdx = -1;
  }

  tick(dt: number, windAt: (i: number) => number): void {
    this.acc = Math.min(this.acc + dt, ROPE_STEP * 4);
    while (this.acc >= ROPE_STEP) {
      this.acc -= ROPE_STEP;
      this.substep(windAt);
    }
  }

  private substep(windAt: (i: number) => number): void {
    const { x, y, px, py, n } = this;
    const s2 = ROPE_STEP * ROPE_STEP;
    for (let i = 1; i < n; i++) {
      if (i === this.grabIdx) continue;
      const vx = (x[i] - px[i]) * ROPE_DAMP;
      const vy = (y[i] - py[i]) * ROPE_DAMP;
      px[i] = x[i];
      py[i] = y[i];
      x[i] += vx + windAt(i) * s2;
      y[i] += vy + ROPE_GRAVITY * s2;
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 1; i < n; i++) {
        const dx = x[i] - x[i - 1];
        const dy = y[i] - y[i - 1];
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = (d - this.segLen) / d;
        const upPinned = i - 1 === 0 || i - 1 === this.grabIdx;
        if (i === this.grabIdx) {
          if (!upPinned) {
            x[i - 1] += dx * diff;
            y[i - 1] += dy * diff;
          }
        } else if (upPinned) {
          x[i] -= dx * diff;
          y[i] -= dy * diff;
        } else {
          x[i] -= dx * diff * 0.5;
          y[i] -= dy * diff * 0.5;
          x[i - 1] += dx * diff * 0.5;
          y[i - 1] += dy * diff * 0.5;
        }
      }
    }
  }
}

// ---- transient elements ---------------------------------------------------------

// A parabolic hop from A to B (tile coords) with a light tumble.
interface Flight {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  start: number; // render-clock second the flight becomes visible
  dur: number;
  spin: number; // tumble, rad/s
}

// seconds a felled trunk takes to topple; keep in sync with the item-flight
// delay the sim uses for the felling log (sim.ts tickWorking)
export const FELL_DUR = 0.8;

interface Felling {
  x: number;
  y: number;
  dir: number;
  start: number;
}

interface Ripple {
  x: number;
  y: number;
  start: number;
}

export interface Puff {
  x: number;
  y: number;
  start: number;
  color: string;
}

// landing squash: an underdamped spring so the thump gets a visible rebound
interface SquashSpring {
  v: number;
  vel: number;
}
const SQUASH_K = 170;
const SQUASH_C = 13;

export const RIPPLE_DUR = 0.9;
export const PUFF_DUR = 0.5;

// ---- the layer ------------------------------------------------------------------

export class MotionLayer {
  private lastGame: Game | null = null;
  private lastT = 0;
  private t = 0;
  private flights = new Map<number, Flight>();
  private fellings = new Map<number, Felling>();
  private squashes = new Map<number, SquashSpring>();
  private ropes = new Map<number, VerletRope>();
  ripples: Ripple[] = [];
  puffs: Puff[] = [];

  clear(): void {
    this.flights.clear();
    this.fellings.clear();
    this.squashes.clear();
    this.ropes.clear();
    this.ripples.length = 0;
    this.puffs.length = 0;
  }

  // Advance one render frame; drains game.lookEvents. With `reduced` set the
  // layer stays empty (events are still discarded) so toggling the option
  // never replays stale motion.
  update(game: Game, t: number, wind: { amp: number; hz: number }, reduced: boolean): void {
    if (this.lastGame !== game) {
      // new level / editor round-trip: drop stale motion AND any breadcrumbs
      // queued before this renderer attached (e.g. during the level build)
      this.clear();
      this.lastGame = game;
      this.lastT = t;
      game.lookEvents.length = 0;
    }
    const dt = Math.min(MAX_DT, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.t = t;
    if (reduced) {
      this.clear();
      game.lookEvents.length = 0;
      return;
    }
    for (const e of game.lookEvents) this.ingest(e, t);
    game.lookEvents.length = 0;
    this.tickRopes(game, dt, wind, t);
    this.tickSquashes(dt);
    this.settle(game, t);
  }

  private ingest(e: LookEvent, t: number): void {
    switch (e.kind) {
      case 'item-flight': {
        const dist = Math.hypot(e.toX - e.fromX, e.toY - e.fromY);
        if (dist < 0.05) return; // dropped in place — the spawn bounce covers it
        this.flights.set(e.id, {
          fx: e.fromX,
          fy: e.fromY,
          tx: e.toX,
          ty: e.toY,
          start: t + e.delay,
          dur: Math.min(0.6, 0.3 + dist * 0.05),
          spin: (3 + Math.random() * 4) * (Math.random() < 0.5 ? -1 : 1),
        });
        break;
      }
      case 'tree-felled':
        this.fellings.set(e.id, { x: e.x, y: e.y, dir: e.dir, start: t });
        break;
      case 'item-sink':
        if (this.ripples.length < 24) this.ripples.push({ x: e.x + 0.5, y: e.y + 0.15, start: t });
        break;
      case 'worker-land':
        this.squashes.set(e.id, { v: Math.min(0.4, 0.1 + e.dist * 0.06), vel: 0 });
        this.puff(e.x + 0.5, e.y + 0.95, '#c9b998');
        break;
    }
  }

  puff(x: number, y: number, color: string): void {
    if (this.puffs.length < 32) this.puffs.push({ x, y, start: this.t, color });
  }

  // In-flight item position (tile coords + tumble angle), 'hidden' while the
  // flight is delay-gated (the log is still inside the falling tree), or null
  // once the item is at rest and the static draw takes over.
  flightFor(id: number): { x: number; y: number; rot: number } | 'hidden' | null {
    const f = this.flights.get(id);
    if (!f) return null;
    const e = (this.t - f.start) / f.dur;
    if (e < 0) return 'hidden';
    if (e >= 1) return null; // settle() lands it (puff + delete)
    const arc = 0.5 + Math.abs(f.tx - f.fx) * 0.15 + Math.max(0, f.ty - f.fy) * 0.1;
    return {
      x: f.fx + (f.tx - f.fx) * e,
      y: f.fy + (f.ty - f.fy) * e - arc * 4 * e * (1 - e),
      rot: f.spin * (this.t - f.start),
    };
  }

  // Fall angle of a just-felled tree (radians about the trunk foot), or null
  // once it has crashed and the stump alone remains.
  fellingFor(id: number): number | null {
    const f = this.fellings.get(id);
    if (!f) return null;
    const p = (this.t - f.start) / FELL_DUR;
    if (p >= 1) return null; // settle() clears it
    return f.dir * p * p * (Math.PI / 2) * 0.96; // gravity: slow creak, fast crash
  }

  // current landing-squash amount for a worker (0 = none)
  squashFor(id: number): number {
    return this.squashes.get(id)?.v ?? 0;
  }

  ropeFor(id: number): VerletRope | undefined {
    return this.ropes.get(id);
  }

  private tickRopes(game: Game, dt: number, wind: { amp: number; hz: number }, t: number): void {
    const seen = new Set<number>();
    for (const b of game.buildings) {
      if (b.kind !== 'rope' || b.state !== 'ready') continue;
      seen.add(b.id);
      let rope = this.ropes.get(b.id);
      if (!rope) {
        const rx = (b.x + b.ropeSide) * TILE + TILE / 2;
        const points = Math.min(10, Math.max(4, b.ropeBottomY - b.y + 2));
        rope = new VerletRope(rx, b.y * TILE + 7, rx, (b.ropeBottomY + 1) * TILE - 3, points);
        this.ropes.set(b.id, rope);
      }
      rope.release();
      // a sliding hand bows the rope where it holds on
      for (const w of game.workers) {
        const step = w.stepIdx < w.path.length ? w.path[w.stepIdx] : null;
        if (
          step?.kind === 'slide' &&
          w.cx === b.x &&
          w.cy === b.y &&
          step.x === b.x + b.ropeSide &&
          step.y === b.ropeBottomY
        ) {
          rope.grab(w.px * TILE + TILE / 2, w.py * TILE + 8);
        }
      }
      const phase = b.id * 1.7;
      rope.tick(dt, (i) =>
        wind.amp * 24 * (Math.sin(t * wind.hz + phase + i * 0.4) + 0.35 * Math.sin(t * wind.hz * 2.7 + i * 1.3))
      );
    }
    for (const id of [...this.ropes.keys()]) if (!seen.has(id)) this.ropes.delete(id);
  }

  private tickSquashes(dt: number): void {
    for (const [id, s] of this.squashes) {
      s.vel += (-SQUASH_K * s.v - SQUASH_C * s.vel) * dt;
      s.v += s.vel * dt;
      if (Math.abs(s.v) < 0.004 && Math.abs(s.vel) < 0.04) this.squashes.delete(id);
    }
  }

  // Land finished flights (with a dust puff), crash finished fellings, expire
  // ripples/puffs, and drop flights whose ground item left the world early
  // (picked up mid-arc, swallowed by the flood).
  private settle(game: Game, t: number): void {
    if (this.flights.size > 0) {
      const live = new Set<number>();
      for (const gi of game.groundItems) live.add(gi.id);
      for (const [id, f] of this.flights) {
        if (!live.has(id)) {
          this.flights.delete(id);
          continue;
        }
        if (t >= f.start + f.dur) {
          this.puff(f.tx + 0.5, f.ty + 0.9, '#cbbf9d');
          this.flights.delete(id);
        }
      }
    }
    for (const [id, f] of this.fellings) {
      if (t - f.start >= FELL_DUR) {
        this.puff(f.x + 0.5 + f.dir * 1.6, f.y + 0.8, '#8a9a6a');
        this.fellings.delete(id);
      }
    }
    this.ripples = this.ripples.filter((r) => t - r.start < RIPPLE_DUR);
    this.puffs = this.puffs.filter((p) => t - p.start < PUFF_DUR);
  }
}
