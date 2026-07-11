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
    if (t === T.DIRT || t === T.GRASS || t === T.ROCK || t === T.BEDROCK || t === T.PLATFORM || t === T.LADDER) return true;
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
