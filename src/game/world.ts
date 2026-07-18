import { T, TILE } from './types';
import type { Building, ResourceNode } from './types';

// The tile world: terrain grid plus lookups the nav graph needs.
export class World {
  w: number;
  h: number;
  tiles: Uint8Array;
  // Cells that act as floor support without being terrain (lift landings).
  extraSupport = new Set<number>();

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): T {
    if (!this.inBounds(x, y)) return T.BEDROCK;
    return this.tiles[this.idx(x, y)] as T;
  }

  set(x: number, y: number, t: T): void {
    if (this.inBounds(x, y)) this.tiles[this.idx(x, y)] = t;
  }

  isSolid(x: number, y: number): boolean {
    const t = this.get(x, y);
    return t === T.DIRT || t === T.GRASS || t === T.ROCK || t === T.BEDROCK;
  }

  // Can a smallhand's body occupy this cell?
  isPassable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const t = this.get(x, y);
    return t === T.AIR || t === T.LADDER;
  }

  // Does this cell provide floor support for the cell above it?
  isSupport(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true; // world edge acts as floor
    const t = this.get(x, y);
    if (t === T.DIRT || t === T.GRASS || t === T.ROCK || t === T.BEDROCK || t === T.PLATFORM || t === T.LADDER || t === T.RAMP) return true;
    return this.extraSupport.has(this.idx(x, y));
  }

  // Can a smallhand stand in this cell?
  isStandable(x: number, y: number): boolean {
    if (!this.isPassable(x, y)) return false;
    if (this.get(x, y) === T.LADDER) return true;
    return this.isSupport(x, y + 1);
  }

  key(x: number, y: number): number {
    return this.idx(x, y);
  }
}

// ---- placement validation ------------------------------------------------

export function canPlaceLadder(world: World, x: number, y: number): boolean {
  if (world.get(x, y) !== T.AIR) return false;
  // Attach to a wall, stand on the ground, or stack on another ladder.
  if (world.isSolid(x - 1, y) || world.isSolid(x + 1, y)) return true;
  if (world.isSupport(x, y + 1)) return true;
  if (world.get(x, y - 1) === T.LADDER) return true;
  return false;
}

export function canPlacePlatform(world: World, x: number, y: number): boolean {
  if (world.get(x, y) !== T.AIR) return false;
  // Must touch something on either side or below (no floating platforms).
  return (
    world.isSolid(x - 1, y) ||
    world.isSolid(x + 1, y) ||
    world.get(x - 1, y) === T.PLATFORM ||
    world.get(x + 1, y) === T.PLATFORM ||
    world.isSolid(x, y + 1)
  );
}

// A ramp tile is a support tile placed either with solid contact (the anchor of
// a run) or diagonally adjacent to the previous ramp tile in the run. It always
// needs clear headroom (the cell above, where a worker stands, must be passable).
export function canPlaceRamp(
  world: World,
  x: number,
  y: number,
  prev: { x: number; y: number } | null
): boolean {
  if (world.get(x, y) !== T.AIR) return false; // never overwrite terrain/other tiles
  if (!world.isPassable(x, y - 1)) return false; // headroom for the worker standing on top
  if (!prev) {
    // anchor: must touch something solid so the run isn't floating. Ramps chain
    // diagonally, so an existing ramp counts as support horizontally OR
    // diagonally — this lets a lone tile fill a gap between two ramps in a 45deg
    // chain (each of which already traces back to solid ground).
    return (
      world.isSolid(x - 1, y) ||
      world.isSolid(x + 1, y) ||
      world.isSupport(x, y + 1) ||
      world.get(x - 1, y) === T.RAMP ||
      world.get(x + 1, y) === T.RAMP ||
      world.get(x - 1, y - 1) === T.RAMP ||
      world.get(x + 1, y - 1) === T.RAMP ||
      world.get(x - 1, y + 1) === T.RAMP ||
      world.get(x + 1, y + 1) === T.RAMP
    );
  }
  // chain step: exactly one diagonal from the previous ramp tile (fixed 45deg pitch)
  return Math.abs(x - prev.x) === 1 && Math.abs(y - prev.y) === 1;
}

// The buildable 45deg ramp chain from anchor (ax,ay) toward (tx,ty). Snaps to the
// shorter axis so it stays 1:1, and stops at the first cell that fails validation.
export function rampRunCells(
  world: World,
  ax: number,
  ay: number,
  tx: number,
  ty: number
): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  const dx = Math.sign(tx - ax);
  const sy = Math.sign(ty - ay);
  if (dx === 0 || sy === 0) {
    if (canPlaceRamp(world, ax, ay, null)) cells.push({ x: ax, y: ay });
    return cells;
  }
  const n = Math.min(Math.abs(tx - ax), Math.abs(ty - ay));
  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i <= n; i++) {
    const cx = ax + i * dx;
    const cy = ay + i * sy;
    if (!canPlaceRamp(world, cx, cy, prev)) break;
    // Ascending (dragging up): a loaded hauler hops from prev's stand cell up to
    // this one, which needs headroom two cells above prev (canPlaceRamp only
    // clears the stand cell one above). Without it the ramp places but can't be
    // climbed under a low ceiling — truncate the run at the last reachable tile.
    // Descending runs are walked/fallen down, so they don't need this clearance.
    if (prev && sy < 0 && !world.isPassable(prev.x, prev.y - 2)) break;
    cells.push({ x: cx, y: cy });
    prev = { x: cx, y: cy };
  }
  return cells;
}

// A ramp tile has no stored orientation — it is a single T.RAMP kind — so its
// facing (which way the 45deg slope leans) is derived here and consumed only by
// the renderer. Returns true when the tile climbs LEFT (mirror the art), false
// when it climbs RIGHT (the default sprite). A run is one continuous slope face,
// so a tile in a chain follows its diagonal neighbours; a standalone tile has no
// chain to read, so it leans toward whichever side the terrain edge (the ledge
// it climbs against) is on — the card's "rotate depending on which side the edge
// is located". Ambiguous cases (a chain-less tile with an edge on both sides or
// neither) keep the default right-climbing art.
export function rampFacesLeft(world: World, x: number, y: number): boolean {
  // "\" chain (top-left → bottom-right): the slope climbs left.
  if (world.get(x - 1, y - 1) === T.RAMP || world.get(x + 1, y + 1) === T.RAMP) return true;
  // "/" chain (bottom-left → top-right): the slope climbs right.
  if (world.get(x + 1, y - 1) === T.RAMP || world.get(x - 1, y + 1) === T.RAMP) return false;
  // Standalone: lean toward the adjacent solid ledge it climbs against.
  const edgeL = world.isSolid(x - 1, y) || world.isSolid(x - 1, y - 1);
  const edgeR = world.isSolid(x + 1, y) || world.isSolid(x + 1, y - 1);
  return edgeL && !edgeR;
}

// Facing for a whole drag-run preview, before any tile is laid (the run's cells
// aren't in the world yet, so rampFacesLeft can't read them as chain neighbours).
// A diagonal run is one slope face read straight off its drag direction; a
// single-axis / single-tile run falls back to the standalone terrain-edge rule.
export function rampRunFacesLeft(world: World, ax: number, ay: number, ex: number, ey: number): boolean {
  const dx = Math.sign(ex - ax);
  const dy = Math.sign(ey - ay);
  if (dx !== 0 && dy !== 0) return dx === dy; // down-right / up-left "\" climbs left
  return rampFacesLeft(world, ax, ay);
}

// The buildable horizontal bridge run at row ay from ax toward tx. The anchor
// must satisfy the platform rule; each later tile just extends the deck we are
// laying (a bridge spans a gap), so it only needs clear air — canPlacePlatform
// can't see the run's own tiles since they aren't placed yet. Stops at the first
// non-air cell so the run never overwrites terrain or another structure.
export function bridgeRunCells(
  world: World,
  ax: number,
  ay: number,
  tx: number,
  _ty: number
): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  const dx = Math.sign(tx - ax) || 1;
  const n = Math.abs(tx - ax);
  for (let i = 0; i <= n; i++) {
    const cx = ax + i * dx;
    const ok = i === 0 ? canPlacePlatform(world, cx, ay) : world.get(cx, ay) === T.AIR;
    if (!ok) break;
    cells.push({ x: cx, y: ay });
  }
  return cells;
}

// The buildable vertical ladder column from anchor (ax,ay) toward ty (tx is
// ignored — ladders climb straight up a wall, so the run snaps to the anchor's
// column). The anchor must satisfy the ladder rule; each later cell attaches to
// the run tile it abuts — a ladder above when descending, a ladder below (which
// counts as support, see World.isSupport) when ascending — so like a bridge deck
// it only needs clear air. Stops at the first non-air cell.
export function ladderRunCells(
  world: World,
  ax: number,
  ay: number,
  _tx: number,
  ty: number
): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  if (!canPlaceLadder(world, ax, ay)) return cells;
  cells.push({ x: ax, y: ay });
  const sy = Math.sign(ty - ay);
  if (sy === 0) return cells;
  const n = Math.abs(ty - ay);
  for (let i = 1; i <= n; i++) {
    const cy = ay + i * sy;
    if (world.get(ax, cy) !== T.AIR) break;
    cells.push({ x: ax, y: cy });
  }
  return cells;
}

// ---- digging --------------------------------------------------------------
// A tile is diggable terrain if it is natural solid ground (dirt/grass/rock —
// never BEDROCK), sits off the world's outer ring, and is not the support tile
// directly under a building footprint (no support cascade exists, so removing
// it would leave the building floating). This is the geometry-only test used
// for the interior of a dig run; the anchor also needs a reachable face below.
function isDiggableTerrain(world: World, buildings: Building[], x: number, y: number): boolean {
  if (x <= 0 || y <= 0 || x >= world.w - 1 || y >= world.h - 1) return false; // world edge
  const t = world.get(x, y);
  if (t === T.BEDROCK) return false;
  if (!world.isSolid(x, y)) return false; // only natural solid ground digs (not AIR/built tiles)
  for (const b of buildings) {
    const fp = FOOTPRINTS[b.kind];
    if (x >= b.x && x < b.x + fp.w && y === b.y + fp.h) return false; // its support row
  }
  return true;
}

// Can the player mark this single cell to dig? Beyond being diggable terrain it
// needs an existing standable cell orthogonally beside it (left/right for a
// tunnel, above for a shaft) so a digger has somewhere to stand and reach it.
export function canDig(world: World, buildings: Building[], x: number, y: number): boolean {
  if (!isDiggableTerrain(world, buildings, x, y)) return false;
  return world.isStandable(x - 1, y) || world.isStandable(x + 1, y) || world.isStandable(x, y - 1);
}

// The cells a dig drag would mark, from anchor (ax,ay) toward (tx,ty), snapped to
// the dominant axis so one drag carves either a horizontal tunnel or a vertical
// shaft. Like a bridge/ladder run, only the ANCHOR needs a reachable face now —
// the interior opens progressively as the run is dug, so later cells only need
// to be diggable terrain. Stops at the first cell that isn't.
export function digRunCells(
  world: World,
  buildings: Building[],
  ax: number,
  ay: number,
  tx: number,
  ty: number
): { x: number; y: number }[] {
  if (!canDig(world, buildings, ax, ay)) return [];
  const cells = [{ x: ax, y: ay }];
  const adx = Math.abs(tx - ax);
  const ady = Math.abs(ty - ay);
  if (adx === 0 && ady === 0) return cells;
  const dx = adx >= ady ? Math.sign(tx - ax) : 0;
  const dy = adx >= ady ? 0 : Math.sign(ty - ay);
  const n = Math.max(adx, ady);
  for (let i = 1; i <= n; i++) {
    const cx = ax + i * dx;
    const cy = ay + i * dy;
    if (!isDiggableTerrain(world, buildings, cx, cy)) break;
    cells.push({ x: cx, y: cy });
  }
  return cells;
}

export function canPlaceBuilding(
  world: World,
  buildings: Building[],
  nodes: ResourceNode[],
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  // Footprint cells must be clear air; the row below must be solid ground.
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      if (world.get(x + dx, y + dy) !== T.AIR) return false;
    }
    if (!world.isSolid(x + dx, y + h)) return false;
  }
  // No overlap with other buildings (with 1 tile breathing room horizontally).
  for (const b of buildings) {
    const bw = footprintW(b);
    const bh = footprintH(b);
    if (x < b.x + bw + 1 && x + w + 1 > b.x && y < b.y + bh && y + h > b.y) return false;
  }
  // No overlap with resource nodes.
  for (const n of nodes) {
    if (n.yieldLeft <= 0) continue;
    if (n.x >= x && n.x < x + w && n.y >= y - 1 && n.y < y + h) return false;
  }
  return true;
}

import { FOOTPRINTS } from './types';

export function footprintW(b: Building): number {
  return FOOTPRINTS[b.kind].w;
}

export function footprintH(b: Building): number {
  return b.kind === 'lift' ? b.y - b.liftTopY + 1 : FOOTPRINTS[b.kind].h;
}

// A lift is placed on a standable base cell and must have a cliff wall
// directly beside it. It rises to the first ledge on that wall side.
// Returns the top landing y, or null if the spot is invalid.
export function liftTopFor(world: World, x: number, y: number): number | null {
  if (!world.isStandable(x, y)) return null;
  for (const side of [-1, 1]) {
    if (!world.isSolid(x + side, y)) continue;
    // climb the wall upward until the wall side opens into a ledge
    for (let ty = y - 2; ty >= 1; ty--) {
      if (world.get(x, ty) !== T.AIR) break; // mast path blocked
      if (world.isStandable(x + side, ty) && !world.isSolid(x + side, ty)) {
        if (y - ty >= 3) return ty; // needs to be worth a lift
        break;
      }
      if (!world.isSolid(x + side, ty)) break; // wall gap without a ledge
    }
  }
  return null;
}

// A rope anchor sits on a standable cliff-edge cell and hangs its rope over
// the side into the adjacent air column, down to the first landing. Only
// worth building when the drop is too far to simply hop down with cargo.
// Returns the hanging side and bottom landing y, or null if invalid.
export function ropeDropFor(world: World, x: number, y: number): { side: number; bottomY: number } | null {
  if (!world.isStandable(x, y) || world.get(x, y) === T.LADDER) return null;
  for (const side of [-1, 1]) {
    const dx = x + side;
    // the drop column starts as open air you would fall into
    if (!world.isPassable(dx, y) || world.isStandable(dx, y)) continue;
    let fy = y;
    let ok = true;
    while (!world.isStandable(dx, fy)) {
      fy++;
      if (fy >= world.h || !world.isPassable(dx, fy)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (fy - y >= 3) return { side, bottomY: fy }; // short drops don't need a rope
  }
  return null;
}

export function tileToWorld(t: number): number {
  return t * TILE;
}
