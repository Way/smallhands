// One offscreen draw of an entire level onto a throwaway canvas: the still
// image behind the level-select previews, the win screen's solution snapshot
// and the bug report's overview shot.
//
// Deliberately not a method on Renderer. Every caller wants a *second*,
// disposable renderer, and the one subtlety worth centralising is that a second
// Renderer sharing a live Game eats that game's lookEvents — MotionLayer.update
// drains the cosmetic outbox on every call, including the reduced-motion early
// return (card #58). Every still in the game goes through here so nobody has to
// rediscover that starving the live renderer is one `new Renderer` away.

import { TILE } from './types';
import type { Game } from './sim';
import { Camera, Renderer } from './render';
import { canvasDataUrl } from './share';

export interface MapShotOptions {
  maxW?: number;
  maxH?: number;
  // Never magnify past this, so a tiny tutorial map does not become a wall of
  // fat pixels in a frame sized for a sprawling one.
  maxZoom?: number;
  // Leave the sim's in-flight particles out of the picture. A still of the map
  // wants the map — the win burst is a moment, not a structure, and it is
  // different on every run.
  hideParticles?: boolean;
}

// Widest a full-size shot may get: big enough to read individual tiles on a
// large map, small enough that the PNG stays attachable and shareable.
export const SHOT_FULL: MapShotOptions = { maxW: 2048, maxH: 1400, maxZoom: 2 };

// Level-select preview: a postcard, not a document. Sized for the 250px popover
// on a 2× screen.
export const SHOT_THUMB: MapShotOptions = { maxW: 512, maxH: 320, maxZoom: 2 };

export function renderMapShot(game: Game, opts: MapShotOptions = {}): HTMLCanvasElement | null {
  const maxW = opts.maxW ?? 2048;
  const maxH = opts.maxH ?? 1400;
  const maxZoom = opts.maxZoom ?? 2;

  const worldW = game.world.w * TILE;
  const worldH = game.world.h * TILE;
  const fit = Math.min(maxZoom, maxW / worldW, maxH / worldH);
  // Draw at 1:1 even when the target is smaller than the world. The renderer
  // draws with smoothing off, so at a fractional zoom the nearest-neighbour
  // scaler drops whole rows of source pixels and a one-pixel ladder rung or
  // rope simply vanishes. Below 1:1 we draw full size and then downscale *with*
  // smoothing, which keeps thin structures as a soft line instead of deleting
  // them.
  const drawZoom = Math.max(fit, 1);

  const off = document.createElement('canvas');
  off.width = Math.ceil(worldW * drawZoom);
  off.height = Math.ceil(worldH * drawZoom);

  const cam = new Camera();
  cam.x = 0;
  cam.y = 0;
  cam.zoom = drawZoom;

  const renderer = new Renderer(off);
  // Static frame: no springs, ropes or bird animation to settle for a still.
  renderer.effectsReduced = true;

  // Hand this renderer its own throwaway outbox so it cannot eat breadcrumbs
  // the live renderer has not drawn yet.
  const liveLook = game.lookEvents;
  const liveParticles = game.particles;
  game.lookEvents = [];
  if (opts.hideParticles) game.particles = [];
  try {
    renderer.draw(game, cam, { tool: 'select', tx: -1, ty: -1, visible: false }, 0);
  } catch {
    return null;
  } finally {
    game.lookEvents = liveLook;
    game.particles = liveParticles;
  }

  if (fit >= 1) return off;

  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(worldW * fit));
  small.height = Math.max(1, Math.round(worldH * fit));
  const sctx = small.getContext('2d');
  if (!sctx) return off;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(off, 0, 0, small.width, small.height);
  return small;
}

export function mapShotDataUrl(game: Game, opts: MapShotOptions = {}): string | null {
  const canvas = renderMapShot(game, opts);
  return canvas ? canvasDataUrl(canvas) : null;
}
