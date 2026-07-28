// The goal caravan's look, as numbers.
//
// The delivery goal is a wagon that is *loaded* and then *rolls out* — so what it
// looks like is a function of two sim facts: how much of the order sheet is
// filled (the crates in the bed) and where the dock window stands (the wagon on
// the road or back at the dock). Both live here rather than in `render.ts` so
// they can be checked without a canvas: the crate count is the only place the
// player reads progress off the world itself, and the roll is the one animation
// that must agree with `Game.convoyOpen` on every tick or the wagon accepts
// cargo while it is visibly gone.
//
// Nothing here reads the clock or rolls dice: `t`/`remaining` come from the sim,
// so a replayed seed replays the same wagon (see docs/architecture.md).

export interface ConvoyWindow {
  open: number;
  closed: number;
}

export interface CaravanRoll {
  /** How far the wagon stands from its dock, in tiles. 0 = parked and loading. */
  shift: number;
  /** Wagon opacity — 0 once it is over the horizon and nothing may be loaded. */
  alpha: number;
  /** True only while the wheels are turning, which is what the dust reads off. */
  rolling: boolean;
}

/** Tiles the wagon travels off-dock before it is out of sight. */
export const CARAVAN_TRIP = 7;
/** Seconds the departure (and the return) takes. */
export const CARAVAN_ROLL_TIME = 1.4;
// Where each crate of the load stands, as pixel offsets from the wagon sprite's
// top-left at its 2x footprint scale. They are authored against the sprite's
// rolled-back rear canvas (sprite cells x 5..11, y 2..12 → screen x 10..23,
// y 4..24) and ordered bottom-first, so the pile GROWS as the order fills
// instead of rearranging itself, and the last crate stays under the arch.
export const CRATE_SPOTS: readonly (readonly [number, number])[] = [
  [11, 18], [18, 18], // standing on the bed floor
  [11, 12], [18, 12], // second course
  [14, 6], // and one on top, centred
];
/** Size a crate is drawn at, px. */
export const CRATE_PX = 6;
/** Crates the bed shows when the order sheet is full. Derived, so the cap and
 *  the layout above cannot fall out of step. */
export const CARAVAN_CRATES = CRATE_SPOTS.length;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// `docked`/`remaining` are `Game.convoyOpen` / `Game.convoyRemaining`. Both are
// derived from `time`, so the roll needs no state of its own and survives a
// restart — the wagon is wherever the schedule says it is, mid-animation
// included. Without a convoy schedule the wagon simply never leaves.
export function caravanRoll(convoy: ConvoyWindow | undefined, docked: boolean, remaining: number): CaravanRoll {
  if (!convoy) return { shift: 0, alpha: 1, rolling: false };
  const phase = docked ? convoy.open : convoy.closed;
  // How long ago the window flipped. A window shorter than the roll itself would
  // otherwise show a wagon teleporting: clamping to the phase keeps the slide
  // inside the window it belongs to.
  const roll = Math.min(CARAVAN_ROLL_TIME, phase);
  const elapsed = Math.max(0, phase - remaining);
  const k = clamp01(roll > 0 ? elapsed / roll : 1);
  const shift = (docked ? 1 - k : k) * CARAVAN_TRIP;
  // Fade over the far half of the trip only, so the wagon reads as *travelling*
  // near the dock and as *gone* at the end, instead of as a ghost the whole way.
  return { shift, alpha: clamp01(2 * (1 - shift / CARAVAN_TRIP)), rolling: k < 1 };
}

// Crates standing in the bed: the order sheet, told by the world instead of the
// HUD. Deliberately not a plain floor() — the first delivery must move the pile
// (otherwise an early plank reads as "nothing happened"), and a full sheet must
// show every crate even when rounding would land a hair short.
export function crateLoad(delivered: number, total: number, cap = CARAVAN_CRATES): number {
  if (total <= 0 || delivered <= 0) return 0;
  if (delivered >= total) return cap;
  return Math.min(cap - 1, Math.max(1, Math.round((delivered / total) * cap)));
}
