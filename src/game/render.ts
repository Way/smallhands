import { FOOTPRINTS, T, TILE, BUILD_TIME, TOOL_DEFS, TH_LEVELS } from './types';
import type { Building, Tool } from './types';
import { sprite, tileHash } from '../engine/sprites';
import { footprintH, footprintW, liftTopFor, ropeDropFor, canPlaceLadder, canPlacePlatform, canPlaceRamp, canPlaceBuilding } from './world';
import type { Game } from './sim';

export class Camera {
  x = 0; // world px at left edge
  y = 0;
  zoom = 2;
  // device px reserved on the right (e.g. the editor panel) so map content is
  // never framed underneath it — the usable viewport shrinks from the right.
  rightInset = 0;

  clamp(game: Game, vw: number, vh: number): void {
    const worldW = game.world.w * TILE * this.zoom;
    const worldH = game.world.h * TILE * this.zoom;
    const avw = vw - this.rightInset; // usable width once the right inset is reserved
    this.x = Math.max(Math.min(this.x, worldW - avw), Math.min(0, (worldW - avw) / 2));
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
  // transient celebration effects (e.g. town-hall upgrade), timed off the render clock
  private effects: { x: number; y: number; start: number; from: number; to: number }[] = [];
  private lastT = 0;
  // Harvest-cursor feel: an eased 0..1 that rises while a harvestable node sits
  // under the Harvest cursor, driving both the lock-on reticle and the hovered
  // node's anticipation. `lastGhostT` gives us a dt for the ease.
  private harvestFocus = 0;
  private lastGhostT = 0;
  private readonly reduceMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    this.lastT = timeSec;

    this.drawSky(W, H, timeSec, cam);

    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    ctx.scale(cam.zoom, cam.zoom);

    // Which harvestable node (if any) is under the Harvest cursor this frame, and
    // how "locked on" we are — eased so the reticle and node reaction ramp smoothly.
    const harvNode =
      hover.visible && hover.tool === 'harvest' ? game.nodeAt(hover.tx, hover.ty) : undefined;
    const dt = Math.min(0.05, Math.max(0, timeSec - this.lastGhostT));
    this.lastGhostT = timeSec;
    this.harvestFocus += ((harvNode ? 1 : 0) - this.harvestFocus) * Math.min(1, dt * 14);

    this.drawTerrain(game, cam);
    this.drawNodes(game, timeSec, harvNode?.id ?? -1, this.harvestFocus);
    this.drawBuildings(game, timeSec);
    this.drawStockpile(game);
    this.drawGroundItems(game, timeSec);
    this.drawWorkers(game, timeSec);
    this.drawParticles(game);
    this.drawEffects(timeSec);
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
      // main body defines the rounded left/right ends; lobes stay interior so
      // there's no raised lobe poking past the tip (which read as a blue beak/notch)
      ctx.ellipse(cx, cy, 42 * c.s, 14 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 2 * c.s, cy - 4 * c.s, 30 * c.s, 12 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(cx - 14 * c.s, cy - 8 * c.s, 20 * c.s, 11 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 12 * c.s, cy - 9 * c.s, 22 * c.s, 12 * c.s, 0, 0, Math.PI * 2);
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
          case T.RAMP:
            name = 'tile_ramp';
            break;
        }
        if (name === 'tile_ramp') {
          // face the slope toward the higher neighbour. The run climbs to the
          // left when a ramp sits up-left OR down-right of this tile — checking
          // both ends means the top cap of an up-left run mirrors correctly too
          // (its only ramp neighbour is the tile below-right). Default art climbs
          // right, so only up-left runs get mirrored.
          const upLeft = world.get(x - 1, y - 1) === T.RAMP || world.get(x + 1, y + 1) === T.RAMP;
          const spr = sprite('tile_ramp').canvas;
          if (upLeft) {
            ctx.save();
            ctx.translate(px + TILE, py);
            ctx.scale(-1, 1);
            ctx.drawImage(spr, 0, 0);
            ctx.restore();
          } else {
            ctx.drawImage(spr, px, py);
          }
        } else if (name) {
          ctx.drawImage(sprite(name).canvas, px, py);
        }
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

  // `hoveredId`/`focus` drive the Harvest-cursor anticipation: the node under the
  // cursor leans/lifts (tree) or shivers (boulder/vein) as `focus` (0..1) ramps.
  private drawNodes(game: Game, t: number, hoveredId: number, focus: number): void {
    const { ctx } = this;
    const osc = this.reduceMotion ? 0 : 1;
    for (const n of game.nodes) {
      const anticip = n.id === hoveredId ? focus : 0;
      const wob = n.wobble > 0 ? Math.sin(t * 40) * 1.2 : 0;
      const px = n.x * TILE + wob;
      if (n.kind === 'tree') {
        if (n.yieldLeft > 0) {
          // hovered trees sway wider and lift toward the order
          const sway = Math.sin(t * 1.2 + n.x) * (0.8 + anticip * 1.8 * osc);
          const lift = anticip * 1.2;
          ctx.drawImage(sprite('tree').canvas, px + sway * 0.5, (n.y - 1) * TILE - lift, TILE, 32);
        } else {
          ctx.drawImage(sprite('stump').canvas, n.x * TILE, n.y * TILE);
        }
      } else if (n.yieldLeft > 0) {
        const shiver = Math.sin(t * 26) * anticip * 0.7 * osc;
        const lift = anticip * 0.8;
        ctx.drawImage(sprite(n.kind === 'boulder' ? 'boulder' : 'vein').canvas, px + shiver, n.y * TILE - lift);
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
      if (b.kind === 'rope') {
        this.drawRope(b, t);
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
        if (b.kind === 'townhall') {
          this.drawTownhallDecor(b, game.thLevel, t);
          this.drawTownhallBadge(b, game.thLevel);
          if (game.thUpgrade) {
            const up = game.thUpgrade;
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.fillRect(px + 2, py - 6, fw - 4, 3);
            ctx.fillStyle = '#6fd66f';
            ctx.fillRect(px + 2, py - 6, (fw - 4) * Math.min(1, up.progress / up.time), 3);
          }
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

  // Level-based decorations drawn over the base town-hall sprite (footprint unchanged).
  private drawTownhallDecor(b: Building, level: number, t: number): void {
    if (level < 2) return;
    const { ctx } = this;
    const px = b.x * TILE;
    const py = b.y * TILE;
    const fw = footprintW(b) * TILE;
    const fh = footprintH(b) * TILE;
    const cx = px + fw / 2;
    const peakY = py + Math.round(fh * 0.18);
    const eaveY = py + Math.round(fh * 0.46);
    const gold = level >= 3;
    const flagCol = gold ? '#ffd94d' : '#c05a44';
    const buntA = gold ? '#ffe07a' : '#f0e4c8'; // festive alternating cloth
    const buntB = gold ? '#e0a92e' : '#c8503c';
    const wave = (phase: number) => Math.sin(t * 3 + phase) * 1.5;

    // L3: golden roof glow over the roof triangle
    if (gold) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = '#ffe07a';
      ctx.beginPath();
      ctx.moveTo(cx, py + Math.round(fh * 0.12));
      ctx.lineTo(px + 3, eaveY);
      ctx.lineTo(px + fw - 3, eaveY);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#fff3c0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, peakY);
      ctx.lineTo(px + 7, eaveY - 1);
      ctx.moveTo(cx, peakY);
      ctx.lineTo(px + fw - 7, eaveY - 1);
      ctx.stroke();
      ctx.restore();
    }

    // bunting garland hung along the eave
    const buntN = 6;
    const bx0 = px + 6;
    const bx1 = px + fw - 6;
    const sagAt = (i: number) => Math.sin((Math.PI * i) / buntN) * 2;
    ctx.strokeStyle = gold ? '#e0a92e' : '#6b4a26';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= buntN; i++) {
      const fx = bx0 + ((bx1 - bx0) * i) / buntN;
      const y = eaveY - 2 + sagAt(i);
      if (i === 0) ctx.moveTo(fx, y);
      else ctx.lineTo(fx, y);
    }
    ctx.stroke();
    for (let i = 0; i < buntN; i++) {
      const fx = bx0 + ((bx1 - bx0) * (i + 0.5)) / buntN;
      const top = eaveY - 2 + sagAt(i + 0.5);
      ctx.fillStyle = i % 2 === 0 ? buntA : buntB;
      ctx.beginPath();
      ctx.moveTo(fx - 2, top);
      ctx.lineTo(fx + 2, top);
      ctx.lineTo(fx, top + 4);
      ctx.closePath();
      ctx.fill();
    }

    // waving flags on short poles at the roof corners
    const flag = (fx: number, dir: number, phase: number) => {
      const top = peakY + 1;
      const bot = eaveY - 1;
      ctx.strokeStyle = '#5f3c1b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(fx, top - 5);
      ctx.lineTo(fx, bot);
      ctx.stroke();
      const w = wave(phase);
      ctx.fillStyle = flagCol;
      ctx.beginPath();
      ctx.moveTo(fx, top - 5);
      ctx.lineTo(fx + dir * 6, top - 3 + w);
      ctx.lineTo(fx, top - 1);
      ctx.closePath();
      ctx.fill();
    };
    flag(px + 6, 1, 0);
    flag(px + fw - 6, -1, Math.PI);

    // L3: gold finial atop the sprite's flagpole (~col 15 of 32 → px+30)
    if (gold) {
      const fxp = px + 30;
      const fyp = py + 1;
      ctx.fillStyle = '#fff3c0';
      ctx.beginPath();
      ctx.moveTo(fxp, fyp - 3);
      ctx.lineTo(fxp + 2, fyp);
      ctx.lineTo(fxp, fyp + 3);
      ctx.lineTo(fxp - 2, fyp);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Always-on level indicator: filled pips = current level, floating above the hall.
  private drawTownhallBadge(b: Building, level: number): void {
    const { ctx } = this;
    const px = b.x * TILE;
    const py = b.y * TILE;
    const fw = footprintW(b) * TILE;
    const cx = px + fw / 2;
    const total = TH_LEVELS.length;
    const gap = 7;
    const span = (total - 1) * gap;
    const by = py - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(cx - span / 2 - 5, by - 4, span + 10, 8);
    for (let i = 0; i < total; i++) {
      const dx = cx - span / 2 + i * gap;
      ctx.beginPath();
      ctx.moveTo(dx, by - 3);
      ctx.lineTo(dx + 3, by);
      ctx.lineTo(dx, by + 3);
      ctx.lineTo(dx - 3, by);
      ctx.closePath();
      if (i < level) {
        ctx.fillStyle = '#ffd94d';
        ctx.fill();
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = '#8a6a10';
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fill();
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.stroke();
      }
    }
  }

  // Spawn a celebration burst + "Crew N → M" cue over the town hall on upgrade.
  addUpgradeEffect(worldX: number, worldY: number, newLevel: number): void {
    const from = TH_LEVELS[Math.max(0, newLevel - 2)].maxWorkers;
    const to = TH_LEVELS[newLevel - 1].maxWorkers;
    this.effects.push({ x: worldX, y: worldY, start: this.lastT, from, to });
  }

  private drawEffects(t: number): void {
    const { ctx } = this;
    const DUR = 2.0;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      const age = t - e.start;
      if (age < 0 || age > DUR) {
        this.effects.splice(i, 1);
        continue;
      }
      const p = age / DUR;
      // sparkle burst
      const N = 12;
      for (let k = 0; k < N; k++) {
        const ang = (k / N) * Math.PI * 2 + e.start * 3;
        const spd = 12 + (k % 3) * 7;
        const dist = spd * age;
        const sx = e.x + Math.cos(ang) * dist;
        const sy = e.y + Math.sin(ang) * dist - age * 6;
        const a = Math.max(0, 1 - p);
        if (a <= 0) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = k % 2 ? '#ffe89a' : '#ffffff';
        const s = 1.6 * (1 - p);
        ctx.fillRect(sx - s, sy - s, s * 2, s * 2);
      }
      // floating crew-cap cue
      const ty = e.y - 6 - age * 12;
      ctx.globalAlpha = Math.max(0, 1 - p);
      ctx.font = '7px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.fillStyle = '#ffd94d';
      const txt = `Crew ${e.from} → ${e.to}`;
      ctx.strokeText(txt, e.x, ty);
      ctx.fillText(txt, e.x, ty);
      ctx.textAlign = 'left';
    }
    ctx.globalAlpha = 1;
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

  private drawRope(b: Building, t: number): void {
    const { ctx } = this;
    const px = b.x * TILE;
    const py = b.y * TILE;
    ctx.globalAlpha = b.state === 'blueprint' ? 0.45 : 1;
    ctx.drawImage(sprite('rope_anchor').canvas, px, py);
    // rope: from the post top, over the edge, hanging down the drop column
    const rx = (b.x + b.ropeSide) * TILE + TILE / 2;
    const sway = b.state === 'ready' ? Math.sin(t * 1.6 + b.id) * 1.2 : 0;
    const botY = (b.ropeBottomY + 1) * TILE - 3;
    ctx.strokeStyle = '#d8b271';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 5, py + 3);
    ctx.lineTo(rx, py + 7);
    ctx.quadraticCurveTo(rx + sway, (py + botY) / 2, rx + sway * 0.4, botY);
    ctx.stroke();
    // knots so climbing hands (and eyes) find purchase
    ctx.fillStyle = '#c09a55';
    const span = Math.max(1, b.ropeBottomY - b.y);
    for (let y = b.y + 1; y <= b.ropeBottomY; y += 2) {
      const f = (y - b.y) / span;
      const kx = rx + sway * (f < 0.5 ? f * 2 : (1 - f) * 2 + 0.4 * (2 * f - 1));
      ctx.fillRect(kx - 1, y * TILE + 5, 3, 2);
    }
    ctx.globalAlpha = 1;
    if (b.state === 'blueprint') {
      const need = BUILD_TIME.rope ?? 4;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(px, py - 5, TILE, 3);
      ctx.fillStyle = '#ffc94d';
      ctx.fillRect(px, py - 5, TILE * Math.min(1, b.progress / need), 3);
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
      } else if (step?.kind === 'climb' || step?.kind === 'lift' || step?.kind === 'slide') {
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

  // Four corner-brackets that frame a box and tighten as `lock` (0..1) rises —
  // the Harvest lock-on. Also usable, later, for demolish (red) etc.
  private reticle(
    box: { x: number; y: number; w: number; h: number },
    lock: number,
    t: number,
    color: string
  ): void {
    const { ctx } = this;
    const pulse = 0.55 + Math.sin(t * 6) * 0.2;
    const ins = 3 - lock * 2.4; // loose when scanning, tight when locked
    const len = 3 + lock * 2;
    const x0 = box.x - ins;
    const y0 = box.y - ins;
    const x1 = box.x + box.w + ins;
    const y1 = box.y + box.h + ins;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5 + lock * 0.5;
    const corner = (x: number, y: number, dx: number, dy: number) => {
      ctx.beginPath();
      ctx.moveTo(x + 0.5 + dx * len, y + 0.5);
      ctx.lineTo(x + 0.5, y + 0.5);
      ctx.lineTo(x + 0.5, y + 0.5 + dy * len);
      ctx.stroke();
    };
    corner(x0, y0, 1, 1);
    corner(x1, y0, -1, 1);
    corner(x0, y1, 1, -1);
    corner(x1, y1, -1, -1);
    if (lock > 0.1) {
      ctx.globalAlpha = 0.14 * lock * pulse * 1.6;
      ctx.fillStyle = color;
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.globalAlpha = 1;
  }

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
        if (n) {
          const box =
            n.kind === 'tree'
              ? { x: n.x * TILE, y: (n.y - 1) * TILE, w: TILE, h: 2 * TILE }
              : { x: n.x * TILE, y: n.y * TILE, w: TILE, h: TILE };
          this.reticle(box, this.harvestFocus, t, '#ffc94d');
          // preview the flag you're about to plant (unmarked nodes only — marked
          // ones already fly the real flag)
          if (!n.marked) {
            const bounce = Math.sin(t * 3) * 1.5;
            const topY = n.kind === 'tree' ? (n.y - 2) * TILE : (n.y - 1) * TILE + 6;
            ctx.globalAlpha = 0.35 + Math.sin(t * 5) * 0.12;
            ctx.drawImage(sprite('mark').canvas, n.x * TILE + 5, topY - 4 + bounce);
            ctx.globalAlpha = 1;
          }
        } else {
          // bare ground: a faint tick on the target tile — the hoe cursor leads
          ctx.strokeStyle = 'rgba(232,238,247,0.35)';
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 4.5, py + 4.5, TILE - 9, TILE - 9);
        }
        break;
      }
      case 'ladder': {
        const ok = canPlaceLadder(game.world, tx, ty) && game.ladderWood() !== null;
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
      case 'ramp': {
        // at-rest preview of the anchor tile (a drag then previews the full run)
        const ok = canPlaceRamp(game.world, tx, ty, null) && game.canAfford({ plank: 1 });
        ctx.globalAlpha = 0.6;
        ctx.drawImage(sprite('tile_ramp').canvas, px, py);
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
      case 'rope': {
        const drop = ropeDropFor(game.world, tx, ty);
        const ropeCost = TOOL_DEFS.find((d) => d.id === 'rope')?.cost ?? {};
        const ok = drop !== null && game.canAfford(ropeCost) && game.toolUnlocked('rope');
        if (drop !== null) {
          ctx.globalAlpha = 0.6;
          ctx.drawImage(sprite('rope_anchor').canvas, px, py);
          ctx.globalAlpha = 1;
          const gx = (tx + drop.side) * TILE;
          ctx.strokeStyle = ok ? `rgba(111,214,111,${pulse + 0.3})` : `rgba(255,122,107,${pulse + 0.3})`;
          ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
          ctx.strokeRect(gx + 0.5, py + 0.5, TILE - 1, (drop.bottomY - ty + 1) * TILE - 1);
        } else {
          outline(false);
        }
        break;
      }
      case 'demolish': {
        const t2 = game.world.get(tx, ty);
        const b = game.buildingAt(tx, ty);
        const ok = t2 === T.LADDER || t2 === T.PLATFORM || t2 === T.RAMP || (!!b && b.kind !== 'townhall' && b.kind !== 'goal');
        outline(ok);
        break;
      }
    }
  }
}
