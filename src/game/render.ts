import { FOOTPRINTS, T, TILE, BUILD_TIME, TOOL_DEFS } from './types';
import type { Building, Tool } from './types';
import { sprite, tileHash } from '../engine/sprites';
import { footprintH, footprintW, liftTopFor, canPlaceLadder, canPlacePlatform, canPlaceBuilding } from './world';
import type { Game } from './sim';

export class Camera {
  x = 0; // world px at left edge
  y = 0;
  zoom = 2;

  clamp(game: Game, vw: number, vh: number): void {
    const worldW = game.world.w * TILE * this.zoom;
    const worldH = game.world.h * TILE * this.zoom;
    this.x = Math.max(Math.min(this.x, worldW - vw), Math.min(0, (worldW - vw) / 2));
    this.y = Math.max(Math.min(this.y, worldH - vh + 40), Math.min(0, (worldH - vh) / 2));
  }

  screenToTile(sx: number, sy: number): { x: number; y: number } {
    return {
      x: Math.floor((sx + this.x) / (TILE * this.zoom)),
      y: Math.floor((sy + this.y) / (TILE * this.zoom)),
    };
  }
}

export interface HoverState {
  tool: Tool;
  tx: number;
  ty: number;
  visible: boolean;
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cloudSeeds: { x: number; y: number; s: number; v: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 9; i++) {
      this.cloudSeeds.push({
        x: Math.random() * 2400,
        y: 20 + Math.random() * 160,
        s: 0.7 + Math.random() * 1.6,
        v: 2.5 + Math.random() * 5,
      });
    }
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.canvas.clientWidth * dpr);
    this.canvas.height = Math.floor(this.canvas.clientHeight * dpr);
  }

  get viewW(): number {
    return this.canvas.width;
  }

  get viewH(): number {
    return this.canvas.height;
  }

  draw(
    game: Game,
    cam: Camera,
    hover: HoverState,
    timeSec: number,
    overlay?: (ctx: CanvasRenderingContext2D) => void
  ): void {
    const { ctx } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.imageSmoothingEnabled = false;

    this.drawSky(W, H, timeSec, cam);

    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    ctx.scale(cam.zoom, cam.zoom);

    this.drawTerrain(game, cam);
    this.drawNodes(game, timeSec);
    this.drawBuildings(game, timeSec);
    this.drawStockpile(game);
    this.drawGroundItems(game, timeSec);
    this.drawWorkers(game, timeSec);
    this.drawParticles(game);
    if (hover.visible) this.drawGhost(game, hover, timeSec);
    overlay?.(ctx);

    ctx.restore();
  }

  // ---- sky & parallax -------------------------------------------------------

  private drawSky(W: number, H: number, t: number, cam: Camera): void {
    const { ctx } = this;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#7ec4e8');
    g.addColorStop(0.55, '#a8dcf0');
    g.addColorStop(1, '#d8f0e8');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // sun
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(W * 0.82 - cam.x * 0.02, H * 0.16 - cam.y * 0.02, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe89a';
    ctx.beginPath();
    ctx.arc(W * 0.82 - cam.x * 0.02, H * 0.16 - cam.y * 0.02, 26, 0, Math.PI * 2);
    ctx.fill();

    // distant hills, two parallax layers
    for (const [par, col, base, amp] of [
      [0.12, '#8fc7a8', 0.72, 60],
      [0.24, '#6fae8c', 0.84, 44],
    ] as const) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 12) {
        const wx = (x + cam.x * par) * 0.008;
        const y = H * base - (Math.sin(wx) + Math.sin(wx * 2.7 + 1.4) * 0.5) * amp - cam.y * par * 0.3;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.fill();
    }

    // clouds
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (const c of this.cloudSeeds) {
      const cx = ((c.x + t * c.v - cam.x * 0.06) % (W + 320)) - 160;
      const cy = c.y - cam.y * 0.05;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 42 * c.s, 13 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 26 * c.s, cy - 8 * c.s, 26 * c.s, 11 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - 30 * c.s, cy - 4 * c.s, 22 * c.s, 9 * c.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---- world layers ------------------------------------------------------------

  private visibleRange(game: Game, cam: Camera): { x0: number; y0: number; x1: number; y1: number } {
    const ts = TILE * cam.zoom;
    return {
      x0: Math.max(0, Math.floor(cam.x / ts) - 1),
      y0: Math.max(0, Math.floor(cam.y / ts) - 1),
      x1: Math.min(game.world.w - 1, Math.ceil((cam.x + this.canvas.width) / ts) + 1),
      y1: Math.min(game.world.h - 1, Math.ceil((cam.y + this.canvas.height) / ts) + 1),
    };
  }

  private drawTerrain(game: Game, cam: Camera): void {
    const { ctx } = this;
    const { world } = game;
    const r = this.visibleRange(game, cam);
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const t = world.get(x, y);
        if (t === T.AIR) continue;
        const px = x * TILE;
        const py = y * TILE;
        let name: string | null = null;
        switch (t) {
          case T.GRASS:
            name = 'tile_grass';
            break;
          case T.DIRT:
            name = 'tile_dirt';
            break;
          case T.ROCK:
            name = 'tile_rock';
            break;
          case T.BEDROCK:
            name = 'tile_bedrock';
            break;
          case T.PLATFORM:
            name = 'tile_platform';
            break;
          case T.LADDER:
            name = 'tile_ladder';
            break;
        }
        if (name) ctx.drawImage(sprite(name).canvas, px, py);
        // subtle variation + edge shading on solid terrain
        if (world.isSolid(x, y)) {
          const h = tileHash(x, y);
          if (h > 0.82) {
            ctx.fillStyle = 'rgba(0,0,0,0.07)';
            ctx.fillRect(px + 4, py + 6, 5, 3);
          }
          if (!world.isSolid(x, y - 1) && t !== T.GRASS) {
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(px, py, TILE, 2);
          }
          if (!world.isSolid(x - 1, y)) {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillRect(px, py, 2, TILE);
          }
          if (!world.isSolid(x + 1, y)) {
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.fillRect(px + TILE - 2, py, 2, TILE);
          }
        }
      }
    }
  }

  private drawNodes(game: Game, t: number): void {
    const { ctx } = this;
    for (const n of game.nodes) {
      const wob = n.wobble > 0 ? Math.sin(t * 40) * 1.2 : 0;
      const px = n.x * TILE + wob;
      if (n.kind === 'tree') {
        if (n.yieldLeft > 0) {
          const sway = Math.sin(t * 1.2 + n.x) * 0.8;
          ctx.drawImage(sprite('tree').canvas, px + sway * 0.5, (n.y - 1) * TILE, TILE, 32);
        } else {
          ctx.drawImage(sprite('stump').canvas, n.x * TILE, n.y * TILE);
        }
      } else if (n.yieldLeft > 0) {
        ctx.drawImage(sprite(n.kind === 'boulder' ? 'boulder' : 'vein').canvas, px, n.y * TILE);
      }
      if (n.marked && n.yieldLeft > 0) {
        const bounce = Math.sin(t * 3) * 1.5;
        const topY = n.kind === 'tree' ? (n.y - 2) * TILE : (n.y - 1) * TILE + 6;
        ctx.drawImage(sprite('mark').canvas, n.x * TILE + 5, topY - 4 + bounce);
      }
    }
  }

  private drawBuildings(game: Game, t: number): void {
    const { ctx } = this;
    for (const b of game.buildings) {
      if (b.kind === 'lift') {
        this.drawLift(b);
        continue;
      }
      const fw = footprintW(b) * TILE;
      const fh = footprintH(b) * TILE;
      const px = b.x * TILE;
      const py = b.y * TILE;
      const spr = sprite(b.kind).canvas;

      if (b.state === 'blueprint') {
        ctx.globalAlpha = 0.45;
        ctx.drawImage(spr, px, py, fw, fh);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#5aa2e8';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, fw - 1, fh - 1);
        // progress bar
        const need = BUILD_TIME[b.kind] ?? 5;
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(px + 2, py - 5, fw - 4, 3);
        ctx.fillStyle = '#ffc94d';
        ctx.fillRect(px + 2, py - 5, (fw - 4) * Math.min(1, b.progress / need), 3);
      } else {
        ctx.drawImage(spr, px, py, fw, fh);
        if (b.processing) {
          // little puff animation over working buildings
          const puff = (t * 12) % 10;
          ctx.fillStyle = `rgba(240,240,240,${0.5 - puff * 0.04})`;
          ctx.beginPath();
          ctx.arc(px + fw - 8, py - 3 - puff, 2.5 + puff * 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (b.kind === 'townhall' && game.thUpgrade) {
          const up = game.thUpgrade;
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          ctx.fillRect(px + 2, py - 6, fw - 4, 3);
          ctx.fillStyle = '#6fd66f';
          ctx.fillRect(px + 2, py - 6, (fw - 4) * Math.min(1, up.progress / up.time), 3);
        }
      }
      // input/output pips on production buildings
      if (b.state === 'ready' && (b.kind === 'sawmill' || b.kind === 'forge')) {
        let ix = px + 2;
        for (const [k, v] of Object.entries(b.inputs)) {
          for (let i = 0; i < Math.min(v ?? 0, 4); i++) {
            ctx.drawImage(sprite(`item_${k}`).canvas, ix, py + fh - 7, 6, 6);
            ix += 5;
          }
        }
        let ox = px + fw - 8;
        for (const [k, v] of Object.entries(b.outputs)) {
          for (let i = 0; i < Math.min(v ?? 0, 4); i++) {
            ctx.drawImage(sprite(`item_${k}`).canvas, ox, py + fh - 7, 6, 6);
            ox -= 5;
          }
        }
      }
      if (b.kind === 'goal') {
        // delivered progress ring of items over the goal
        const total = game.objectives.reduce((s, o) => s + o.amount, 0);
        const done = game.objectives.reduce((s, o) => s + o.delivered, 0);
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(px + 2, py - 6, fw - 4, 4);
        ctx.fillStyle = '#a878c8';
        ctx.fillRect(px + 2, py - 6, (fw - 4) * (total ? done / total : 0), 4);
      }
    }
  }

  private drawLift(b: Building): void {
    const { ctx } = this;
    const px = b.x * TILE;
    const mast = sprite('lift_mast').canvas;
    for (let y = b.liftTopY; y <= b.y; y++) {
      ctx.globalAlpha = b.state === 'blueprint' ? 0.45 : 0.9;
      ctx.drawImage(mast, px, y * TILE);
    }
    ctx.globalAlpha = b.state === 'blueprint' ? 0.45 : 1;
    ctx.drawImage(sprite('lift_top').canvas, px, b.liftTopY * TILE);
    // the car
    ctx.drawImage(sprite('lift_car').canvas, px, b.liftCarY * TILE);
    ctx.globalAlpha = 1;
    if (b.state === 'blueprint') {
      const need = BUILD_TIME.lift ?? 6;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(px, b.liftTopY * TILE - 5, TILE, 3);
      ctx.fillStyle = '#ffc94d';
      ctx.fillRect(px, b.liftTopY * TILE - 5, TILE * Math.min(1, b.progress / need), 3);
    }
  }

  private drawStockpile(game: Game): void {
    const { ctx } = this;
    const th = game.townhall;
    const total = Object.values(game.stock).reduce((s, v) => s + v, 0);
    const crates = Math.min(6, Math.ceil(total / 5));
    const bx = (th.x + FOOTPRINTS.townhall.w) * TILE + 2;
    const by = (th.y + FOOTPRINTS.townhall.h) * TILE;
    for (let i = 0; i < crates; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      ctx.drawImage(sprite('crate').canvas, bx + col * 9, by - 8 - row * 9);
    }
  }

  private drawGroundItems(game: Game, t: number): void {
    const { ctx } = this;
    for (const gi of game.groundItems) {
      const bounce = gi.bounce > 0 ? Math.abs(Math.sin(gi.bounce * 12)) * 4 : 0;
      const px = gi.x * TILE + 4;
      const py = gi.y * TILE + TILE - 9 - bounce;
      ctx.drawImage(sprite(`item_${gi.item}`).canvas, px, py);
      if (!gi.reserved) {
        // gentle glint so loose goods are noticeable
        const glint = (Math.sin(t * 2 + gi.id) + 1) / 2;
        ctx.fillStyle = `rgba(255,255,255,${glint * 0.25})`;
        ctx.fillRect(px + 1, py + 1, 6, 6);
      }
    }
  }

  private drawWorkers(game: Game, t: number): void {
    const { ctx } = this;
    for (const w of game.workers) {
      if (w.spawnT > 0.3) continue;
      const px = w.px * TILE + TILE / 2;
      const py = w.py * TILE + TILE;
      const step = w.stepIdx < w.path.length ? w.path[w.stepIdx] : null;
      let body = 'ling_walk_a';
      if (w.working) {
        body = Math.sin(w.animT * 10) > 0 ? 'ling_work' : 'ling_walk_a';
      } else if (step?.kind === 'climb' || step?.kind === 'lift') {
        body = 'ling_climb_a';
      } else if (step) {
        body = Math.sin(w.animT * 14) > 0 ? 'ling_walk_a' : 'ling_walk_b';
      }
      const spr = sprite(body).canvas;
      ctx.save();
      ctx.translate(px, py);
      if (w.facing < 0) ctx.scale(-1, 1);
      ctx.drawImage(spr, -5, -12);
      ctx.drawImage(sprite(`hat_${w.role}`).canvas, -5, -14);
      ctx.restore();

      // carried item above the head
      if (w.carrying) {
        const bob = Math.sin(w.animT * 14) * 0.8;
        ctx.drawImage(sprite(`item_${w.carrying}`).canvas, px - 4, py - 21 + bob);
      }
      // waiting indicator (queued at a busy lift)
      if (w.waiting) {
        const blink = Math.sin(t * 6) > 0;
        if (blink) {
          ctx.fillStyle = '#e8eef7';
          ctx.font = '7px monospace';
          ctx.fillText('…', px - 2, py - 15);
        }
      }
    }
  }

  private drawParticles(game: Game): void {
    const { ctx } = this;
    for (const p of game.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x * TILE - p.size / 2, p.y * TILE - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // ---- placement ghost -----------------------------------------------------------

  private drawGhost(game: Game, hover: HoverState, t: number): void {
    const { ctx } = this;
    const { tool, tx, ty } = hover;
    const px = tx * TILE;
    const py = ty * TILE;
    const pulse = 0.5 + Math.sin(t * 5) * 0.15;

    const outline = (ok: boolean, w = 1, h = 1) => {
      ctx.strokeStyle = ok ? `rgba(111,214,111,${pulse + 0.3})` : `rgba(255,122,107,${pulse + 0.3})`;
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, w * TILE - 1, h * TILE - 1);
      ctx.fillStyle = ok ? 'rgba(111,214,111,0.15)' : 'rgba(255,122,107,0.15)';
      ctx.fillRect(px, py, w * TILE, h * TILE);
    };

    switch (tool) {
      case 'select':
        ctx.strokeStyle = `rgba(232,238,247,${pulse})`;
        ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
        break;
      case 'harvest': {
        const n = game.nodeAt(tx, ty);
        outline(!!n);
        break;
      }
      case 'ladder': {
        const ok = canPlaceLadder(game.world, tx, ty) && game.canAfford({ log: 1 });
        ctx.globalAlpha = 0.6;
        ctx.drawImage(sprite('tile_ladder').canvas, px, py);
        ctx.globalAlpha = 1;
        outline(ok);
        break;
      }
      case 'platform': {
        const ok = canPlacePlatform(game.world, tx, ty) && game.canAfford({ plank: 1 });
        ctx.globalAlpha = 0.6;
        ctx.drawImage(sprite('tile_platform').canvas, px, py);
        ctx.globalAlpha = 1;
        outline(ok);
        break;
      }
      case 'sawmill':
      case 'forge': {
        const fp = FOOTPRINTS[tool];
        const cost = TOOL_DEFS.find((d) => d.id === tool)?.cost ?? {};
        const ok =
          canPlaceBuilding(game.world, game.buildings, game.nodes, tx, ty, fp.w, fp.h) &&
          game.canAfford(cost) &&
          game.toolUnlocked(tool);
        ctx.globalAlpha = 0.55;
        const spr = sprite(tool).canvas;
        ctx.drawImage(spr, 0, 0, fp.w * TILE, fp.h * TILE, px, py, fp.w * TILE, fp.h * TILE);
        ctx.globalAlpha = 1;
        outline(ok, fp.w, fp.h);
        break;
      }
      case 'lift': {
        const topY = liftTopFor(game.world, tx, ty);
        const liftCost = TOOL_DEFS.find((d) => d.id === 'lift')?.cost ?? {};
        const ok = topY !== null && game.canAfford(liftCost) && game.toolUnlocked('lift');
        if (topY !== null) {
          ctx.globalAlpha = 0.5;
          for (let y = topY; y <= ty; y++) {
            ctx.drawImage(sprite('lift_mast').canvas, px, y * TILE);
          }
          ctx.globalAlpha = 1;
          ctx.strokeStyle = ok ? `rgba(111,214,111,${pulse + 0.3})` : `rgba(255,122,107,${pulse + 0.3})`;
          ctx.strokeRect(px + 0.5, topY * TILE + 0.5, TILE - 1, (ty - topY + 1) * TILE - 1);
        } else {
          outline(false);
        }
        break;
      }
      case 'demolish': {
        const t2 = game.world.get(tx, ty);
        const b = game.buildingAt(tx, ty);
        const ok = t2 === T.LADDER || t2 === T.PLATFORM || (!!b && b.kind !== 'townhall' && b.kind !== 'goal');
        outline(ok);
        break;
      }
    }
  }
}
