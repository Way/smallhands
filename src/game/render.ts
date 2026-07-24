import { FOOTPRINTS, HOIST_CYCLE, T, TILE, BUILD_TIME, TOOL_DEFS, TH_LEVELS, LANTERN_RADIUS } from './types';
import type { Building, Tool } from './types';
import { sprite, tileHash, PROP_KINDS } from '../engine/sprites';
import { BIOME_LOOK, biomeSuffix, treeSprite } from '../engine/biomes';
import type { Biome } from '../engine/biomes';
import { t } from '../engine/i18n';
import { footprintH, footprintW, liftTopFor, ropeDropFor, canPlaceLadder, canPlacePlatform, canPlaceRamp, canPlaceBuilding, rampFacesLeft } from './world';
import type { Game } from './sim';
import { weatherLook, lerpLook, rgbCss, rgbaCss } from './weather-look';
import type { WeatherLook, RGB, RGBA } from './weather-look';
import { MotionLayer, RIPPLE_DUR, PUFF_DUR } from './motion';

// A terrain shading overlay in one of the biome's light-model colours. Callers
// resolve these once per frame, never per tile — the shading loop is hot.
const shade = (c: RGB, a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;

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
  // Occasional birds crossing the sky — mostly a lone glider, sometimes a small
  // V-flock (which is just several spawned together). Each bird's position is a
  // pure function of the render clock (`st` = spawn time) so frame hitches never
  // accumulate. `nextBirdAt` schedules the next spawn; the sky is empty between.
  private birds: {
    sx: number; sy: number; st: number; vx: number; scale: number; phase: number; flap: number; bob: number;
  }[] = [];
  private nextBirdAt = 0;
  // transient celebration effects (e.g. town-hall upgrade), timed off the render clock
  private effects: { x: number; y: number; start: number; from: number; to: number }[] = [];
  private lastT = 0;
  // Harvest-cursor feel: an eased 0..1 that rises while a harvestable node sits
  // under the Harvest cursor, driving both the lock-on reticle and the hovered
  // node's anticipation. `lastGhostT` gives us a dt for the ease.
  private harvestFocus = 0;
  private lastGhostT = 0;
  // look-physics (motion.ts): render-only springs, ropes and arcs. Fed from
  // the sim's lookEvents outbox; never read back by the simulation.
  private motion = new MotionLayer();
  // effects can be dialed down via the options menu; the OS-level
  // reduced-motion preference is always respected on top of that
  effectsReduced = false;
  // A one-shot "locate" ping set by main.ts's onLocate handler: a pulsing ring
  // over a world tile that fades out after LOCATE_RING_DUR. bornAt is in the
  // renderer's own seconds clock (the `timeSec` passed to draw()).
  locateRing: { x: number; y: number; bornAt: number } | null = null;
  private readonly LOCATE_RING_DUR = 1.6;
  private readonly reduceMotionPref =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  private get reduceMotion(): boolean {
    return this.reduceMotionPref || this.effectsReduced;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    for (let i = 0; i < 6; i++) {
      this.cloudSeeds.push({
        x: Math.random() * 2400,
        y: 20 + Math.random() * 160,
        s: 0.7 + Math.random() * 1.6,
        v: 2 + Math.random() * 3,
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

    const blend = game.weatherBlend;
    const look = lerpLook(weatherLook(blend.from), weatherLook(blend.to), blend.t);

    // advance the look-physics layer (drains the sim's cosmetic outbox);
    // under reduced motion it stays empty and every element draws static
    this.motion.update(game, timeSec, { amp: look.wind, hz: look.windHz }, this.reduceMotion);

    this.drawSky(game, look, W, H, timeSec, cam);

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
    this.drawValleyFog(game, cam, timeSec);
    this.drawSetPiece(game);
    this.drawNodes(game, timeSec, harvNode?.id ?? -1, this.harvestFocus, look);
    this.drawBuildings(game, timeSec);
    this.drawDigOrders(game, timeSec);
    this.drawStockpile(game);
    this.drawGroundItems(game, timeSec);
    this.drawWater(game, cam, timeSec);
    this.drawWaterfall(game, cam, timeSec);
    this.drawRipples(timeSec);
    this.drawWorkers(game, timeSec);
    this.drawParticles(game);
    this.drawPuffs(timeSec);
    this.drawEffects(timeSec);
    ctx.restore();

    // screen-space atmosphere: rain/storm streaks, then the night's darkness
    this.drawWeatherFx(look, W, H, timeSec);
    this.drawDarkness(game, cam, W, H, timeSec);

    // the placement ghost and drag-run preview stay fully bright above the dark
    ctx.save();
    ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    ctx.scale(cam.zoom, cam.zoom);
    if (hover.visible) this.drawGhost(game, hover, timeSec);
    this.drawStrandedMarkers(game, timeSec);
    this.drawLocateRing(timeSec);
    overlay?.(ctx);
    ctx.restore();

    // screen-space: arrows toward off-screen stranded goods (on top of everything)
    this.drawStrandedEdgeArrows(game, cam, W, H, timeSec);
  }

  // ---- sky & parallax -------------------------------------------------------

  private drawSky(game: Game, look: WeatherLook, W: number, H: number, t: number, cam: Camera): void {
    const { ctx } = this;
    // night intensity now: 0 day .. 1 deep night. Fixed on day/static-night maps
    // (0 / 1), a live curve on a day↔night cycle — so the sky eases through dusk.
    const nA = game.nightAmount();

    // the biome leans on the daytime atmosphere (applied after the weather
    // blend so crossfades keep working); the fixed night palette is crossfaded
    // in by nA on top, so a cycle level slides day→night rather than snapping.
    const bl = BIOME_LOOK[(game.level.biome ?? 'meadow') as Biome];
    const bmix = (c: RGB, to: readonly number[], amt: number): RGB =>
      amt <= 0 ? c : [c[0] + (to[0] - c[0]) * amt, c[1] + (to[1] - c[1]) * amt, c[2] + (to[2] - c[2]) * amt];
    const mix3 = (a: RGB, b: RGB, t: number): RGB =>
      t <= 0 ? a : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const mix4 = (a: RGBA, b: RGBA, t: number): RGBA =>
      t <= 0 ? a : [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];

    // day palettes (biome-tinted) and the fixed night palette, crossfaded by nA.
    // Night is a level condition, not weather: it overrides the sky palette, but
    // the wet tint/streaks (drawn in drawWeatherFx) still crossfade on top.
    const dayStops: [RGB, RGB, RGB] = [
      bmix(look.sky[0], bl.skyTint, bl.skyTintAmt),
      bmix(look.sky[1], bl.skyTint, bl.skyTintAmt),
      bmix(look.sky[2], bl.skyTint, bl.skyTintAmt),
    ];
    const dayHills: [RGB, RGB] = [
      bmix(look.hills[0], bl.hillTint, bl.hillTintAmt),
      bmix(look.hills[1], bl.hillTint, bl.hillTintAmt),
    ];
    const nightStops: [RGB, RGB, RGB] = [
      [10, 16, 40],
      [20, 30, 66],
      [36, 54, 84],
    ];
    const nightHills: [RGB, RGB] = [
      [42, 74, 68],
      [29, 56, 51],
    ];
    const stopsRgb: [RGB, RGB, RGB] = [
      mix3(dayStops[0], nightStops[0], nA),
      mix3(dayStops[1], nightStops[1], nA),
      mix3(dayStops[2], nightStops[2], nA),
    ];
    const hillsRgb: [RGB, RGB] = [mix3(dayHills[0], nightHills[0], nA), mix3(dayHills[1], nightHills[1], nA)];
    const cloudCol = rgbaCss(mix4(look.cloudCol, [46, 58, 92, 0.65], nA));
    const stops = [rgbCss(stopsRgb[0]), rgbCss(stopsRgb[1]), rgbCss(stopsRgb[2])];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, stops[0]);
    g.addColorStop(0.55, stops[1]);
    g.addColorStop(1, stops[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // stars fade in as night deepens (skip the loop entirely by day)
    if (nA > 0.02) {
      for (let i = 0; i < 70; i++) {
        const sx = (tileHash(i, 3) * (W + 120) - 60 - cam.x * 0.015 + W * 2) % W;
        const sy = tileHash(i, 11) * H * 0.55 - cam.y * 0.012;
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * (0.4 + tileHash(i, 5)) + i));
        ctx.fillStyle = `rgba(220,230,255,${(0.5 * tw * nA).toFixed(3)})`;
        const s = tileHash(i, 7) > 0.85 ? 2 : 1;
        ctx.fillRect(sx, sy, s, s);
      }
    }
    // the moon rises with the night; the sun burns through the day (and fades as
    // rain builds). At dusk both hang faintly — sunset over a rising moon.
    if (nA > 0.02) {
      ctx.save();
      ctx.globalAlpha = nA;
      const mx = W * 0.78 - cam.x * 0.02;
      const my = H * 0.16 - cam.y * 0.02;
      ctx.fillStyle = '#e8ecf6';
      ctx.beginPath();
      ctx.arc(mx, my, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c9d2e6';
      for (const [dx, dy, r] of [
        [-8, -4, 5],
        [7, 6, 4],
        [4, -9, 3],
      ] as const) {
        ctx.beginPath();
        ctx.arc(mx + dx, my + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    const sunA = (1 - Math.min(1, look.rain)) * (1 - nA);
    if (sunA > 0.01) {
      ctx.save();
      ctx.globalAlpha = sunA;
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.arc(W * 0.82 - cam.x * 0.02, H * 0.16 - cam.y * 0.02, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffe89a';
      ctx.beginPath();
      ctx.arc(W * 0.82 - cam.x * 0.02, H * 0.16 - cam.y * 0.02, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // distant terrain in three strict parallax layers: a sky-drowned horizon
    // range, a mid ridge with biome character (plus its dressing), and a near
    // scrub line. Contrast rises toward the playable grid, never above it.
    this.drawDistantTerrain(game, W, H, cam, hillsRgb, stopsRgb[1], bmix);

    // clouds — the storm drives them hard across the sky
    const cloudSpeed = look.cloudSpeed;
    ctx.fillStyle = cloudCol;
    for (const c of this.cloudSeeds) {
      const cx = ((c.x + t * c.v * cloudSpeed - cam.x * 0.06) % (W + 320)) - 160;
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

    // birds keep to fair daylight skies; they stop spawning as rain builds or
    // dusk deepens, but any already aloft finish crossing (no mid-air vanish)
    if (nA < 0.5) this.drawBirds(W, H, t, cam, look.rain < 0.05);
  }

  // ---- distant terrain (three-layer parallax) --------------------------------
  //
  // Layer recipe (miniature-diorama rules): the HORIZON range is heavily sky-
  // tinted and barely moves; the MIDGROUND ridge carries the biome's shape
  // language and a little dressing (tree line, snow tips); the NEAR scrub line
  // is the strongest silhouette but still flatter than any playable tile.
  // Everything is a pure function of camera + biome, so it never flickers.

  private silhouette(
    W: number,
    H: number,
    cam: Camera,
    par: number,
    col: string,
    base: number,
    amp: number,
    shape: (wx: number) => number
  ): void {
    const { ctx } = this;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const wx = (x + cam.x * par) * 0.008;
      ctx.lineTo(x, H * base - shape(wx) * amp - cam.y * par * 0.3);
    }
    ctx.lineTo(W, H);
    ctx.fill();
  }

  private drawDistantTerrain(
    game: Game,
    W: number,
    H: number,
    cam: Camera,
    hills: [RGB, RGB],
    skyMid: RGB,
    bmix: (c: RGB, to: readonly number[], amt: number) => RGB
  ): void {
    const { ctx } = this;
    const biome = (game.level.biome ?? 'meadow') as Biome;

    // shape vocabulary (all return 0..1 crest height)
    const tri = (v: number) => Math.abs((((v % 2) + 2) % 2) - 1);
    const rolling = (wx: number) => (Math.sin(wx) + Math.sin(wx * 2.7 + 1.4) * 0.5 + 1.5) / 3;
    const peaks = (wx: number) => tri(wx * 0.9) * 0.72 + tri(wx * 2.2 + 0.6) * 0.28;
    const buttes = (wx: number) => {
      const r = rolling(wx);
      return (Math.floor(r * 3) / 3) * 0.85 + r * 0.15; // stepped mesa tops
    };
    const dunes = (wx: number) => Math.abs(Math.sin(wx * 0.8)) * 0.82 + (Math.sin(wx * 2.1) + 1) * 0.05;

    const horizonShape = biome === 'redrock' ? buttes : biome === 'chalk' ? dunes : peaks;
    const midShape = biome === 'redrock' ? buttes : biome === 'chalk' ? dunes : rolling;

    // 1. horizon range — drowned in sky to read as far distance
    const horizonCol = bmix(hills[0], skyMid, 0.55);
    this.silhouette(W, H, cam, 0.05, rgbCss(horizonCol), 0.62, 95, horizonShape);
    // snow tips on the highest horizon peaks of snow-capped biomes
    if (BIOME_LOOK[biome].snowcaps) {
      ctx.fillStyle = rgbCss(bmix(horizonCol, [246, 249, 255], 0.6));
      for (let x = 0; x <= W; x += 8) {
        const wx = (x + cam.x * 0.05) * 0.008;
        const s = horizonShape(wx);
        if (s > 0.74) {
          const y = H * 0.62 - s * 95 - cam.y * 0.05 * 0.3;
          ctx.fillRect(x - 2, y, 5, 2 + (s - 0.74) * 26);
        }
      }
    }

    // 2. midground ridge + dressing
    const midCol = bmix(hills[0], skyMid, 0.15);
    this.silhouette(W, H, cam, 0.12, rgbCss(midCol), 0.72, 60, midShape);
    const treeline = BIOME_LOOK[biome].treeline;
    if (treeline !== 'none') {
      // a distant tree line along the mid crest, anchored in layer space so it
      // parallaxes with its hill; conifers for the highlands, blobs elsewhere
      const par = 0.12;
      const treeCol = rgbCss(bmix(midCol, [0, 0, 0], 0.14));
      ctx.fillStyle = treeCol;
      const g0 = Math.floor((cam.x * par) / 26) - 1;
      const g1 = Math.floor((cam.x * par + W) / 26) + 1;
      for (let gcell = g0; gcell <= g1; gcell++) {
        const h1 = tileHash(((gcell % 8191) + 8191) % 8191, 23);
        if (h1 < 0.4) continue;
        const xw = gcell * 26 + h1 * 16;
        const sx = xw - cam.x * par;
        const cy = H * 0.72 - midShape(xw * 0.008) * 60 - cam.y * par * 0.3;
        const s = 3 + h1 * 3;
        if (treeline === 'conifers') {
          ctx.beginPath();
          ctx.moveTo(sx, cy - s * 1.6);
          ctx.lineTo(sx - s * 0.55, cy + 1);
          ctx.lineTo(sx + s * 0.55, cy + 1);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(sx, cy - s * 0.7, s * 0.62, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillRect(sx - 0.5, cy - s * 0.4, 1, s * 0.6);
        }
      }
    }

    // 3. near scrub line — the strongest of the three, still soft
    this.silhouette(W, H, cam, 0.24, rgbCss(hills[1]), 0.84, 44, rolling);
  }

  // Occasional birds drifting across the upper sky and leaving. Purely decorative,
  // so reduced-motion skips them entirely. They share the clouds' slow parallax so
  // they sit in the sky plane, and are drawn as flapping seagull silhouettes.
  private drawBirds(W: number, H: number, t: number, cam: Camera, calm: boolean): void {
    if (this.reduceMotion) return;
    const { ctx } = this;
    const PAR = 0.06;

    if (this.nextBirdAt === 0) this.nextBirdAt = t + 2 + Math.random() * 5;
    if (calm && t >= this.nextBirdAt && this.birds.length < 12) {
      this.spawnBirds(W, H, t);
      this.nextBirdAt = t + 26 + Math.random() * 30;
    }

    // drop a bird only once it has exited the *far* edge in its travel direction —
    // never while it's still entering (camera parallax can hold it just off-screen)
    this.birds = this.birds.filter((b) => {
      const x = b.sx + b.vx * (t - b.st) - cam.x * PAR;
      return b.vx > 0 ? x < W + 80 : x > -80;
    });

    ctx.strokeStyle = 'rgba(60,72,92,0.55)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const b of this.birds) {
      const age = t - b.st;
      const x = b.sx + b.vx * age - cam.x * PAR;
      const y = b.sy - cam.y * PAR + Math.sin(age * 0.8 + b.bob) * 1.5;
      const span = 6 * b.scale;
      const flap = Math.sin(age * b.flap + b.phase) * 0.5 + 0.5; // 0..1 wingbeat
      // a gull silhouette: wings arch up from the body and the tips angle back
      // down; the arch height animates with the wingbeat
      const arch = span * (0.2 + 0.55 * flap);
      const tip = span * 0.05;
      ctx.lineWidth = Math.max(1, 1.3 * b.scale);
      ctx.beginPath();
      ctx.moveTo(x - span, y + tip);
      ctx.quadraticCurveTo(x - span * 0.45, y - arch, x, y);
      ctx.quadraticCurveTo(x + span * 0.45, y - arch, x + span, y + tip);
      ctx.stroke();
    }
  }

  // Spawn one flight: ~20% a small V-flock of 3–5, otherwise a lone bird. Random
  // direction; flock members fan out behind the leader on alternating arms.
  private spawnBirds(W: number, H: number, t: number): void {
    const dir = Math.random() < 0.5 ? 1 : -1;
    // cross the whole view in 9–15s regardless of resolution, so the sky is empty
    // far more often than not (spawns are ~26–56s apart)
    const vx = (dir * (W + 80)) / (9 + Math.random() * 6);
    const baseY = H * 0.12 + Math.random() * H * 0.24;
    const startX = dir > 0 ? -60 : W + 60; // fully off-screen so it eases in
    const scale = 1.3 + Math.random() * 0.9;
    const flap = 5 + Math.random() * 3; // wingbeat speed (rad/s)
    const count = Math.random() < 0.2 ? 3 + Math.floor(Math.random() * 3) : 1;
    const gapX = 14 * scale;
    const gapY = 8 * scale;
    for (let i = 0; i < count; i++) {
      const rank = Math.ceil(i / 2); // 0 = leader, then pairs fan out behind
      const side = i % 2 === 0 ? 1 : -1;
      this.birds.push({
        sx: startX - dir * rank * gapX,
        sy: baseY + side * rank * gapY,
        st: t,
        vx,
        scale: scale * (1 - rank * 0.06), // trailing birds read slightly smaller
        phase: Math.random() * Math.PI * 2,
        flap,
        bob: Math.random() * Math.PI * 2,
      });
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

  // Topmost solid row per column (world.h for a column of pure air). Rebuilt
  // every frame — the grid is at most 160×60, and the editor sculpts terrain
  // live — and reused by depth shading, wedges, fringes, props and the snowline.
  private surfCache: number[] = [];

  private surfaceRows(world: { w: number; h: number; isSolid(x: number, y: number): boolean }): number[] {
    const surf = this.surfCache;
    surf.length = world.w;
    for (let x = 0; x < world.w; x++) {
      let sy = world.h;
      for (let y = 0; y < world.h; y++) {
        if (world.isSolid(x, y)) {
          sy = y;
          break;
        }
      }
      surf[x] = sy;
    }
    return surf;
  }

  private drawTerrain(game: Game, cam: Camera): void {
    const { ctx } = this;
    const { world } = game;
    const r = this.visibleRange(game, cam);
    const biome = (game.level.biome ?? 'meadow') as Biome;
    const sfx = biomeSuffix(biome);
    const blook = BIOME_LOOK[biome];
    const surf = this.surfaceRows(world);
    // Edge/geology shading in the biome's light: highlights carry the sun's
    // colour, shading carries the sky's. Resolved here, once, because the loop
    // below runs for every visible solid tile. The classic biomes declare white
    // sun over black ambient, so these come out as the neutral overlays they
    // have always been.
    const sunTop = shade(blook.sun, 0.12);
    const sunRim = shade(blook.sun, 0.08);
    const shStrata = shade(blook.ambient, 0.09);
    const shSpeck = shade(blook.ambient, 0.07);
    const shCrack = shade(blook.ambient, 0.18);
    const shRim = shade(blook.ambient, 0.12);
    const shAo = shade(blook.ambient, 0.1);
    // edge enrichment: the grass lip's drop shadow, an overhang's shaded
    // underside, and chunky clods clinging to exposed earth/rock faces
    const shLip = shade(blook.ambient, 0.24);
    const shLip2 = shade(blook.ambient, 0.13);
    const shUnder = shade(blook.ambient, 0.2);
    const shClump = shade(blook.ambient, 0.17);
    const shClumpDk = shade(blook.ambient, 0.3);
    const sunClump = shade(blook.sun, 0.16);

    // snow-capped biomes: everything at or above the snowline wears white.
    // The line hangs off the map's highest summit so it never shifts with the
    // camera, and only exists at all when the terrain is tall enough to earn it.
    let snowY = -1;
    if (blook.snowcaps) {
      let minS = world.h;
      let maxS = 0;
      for (let x = 0; x < world.w; x++) {
        if (surf[x] < minS) minS = surf[x];
        if (surf[x] > maxS && surf[x] < world.h) maxS = surf[x];
      }
      if (maxS - minS >= 6) snowY = minS + 4;
    }
    const strata = (game.level.id % 4) + 1;

    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const t = world.get(x, y);
        if (t === T.AIR) continue;
        const px = x * TILE;
        const py = y * TILE;
        const airL = !world.isSolid(x - 1, y);
        const airR = !world.isSolid(x + 1, y);
        const exposedTop = !world.isSolid(x, y - 1);
        let name: string | null = null;
        switch (t) {
          case T.GRASS: {
            // lip corners round off (transparent pixels let the sky through)
            // and the blades wrap a little way down the exposed side
            const variant = exposedTop && (airL || airR) ? (airL && airR ? '_lr' : airL ? '_l' : '_r') : '';
            const snow = snowY >= 0 && y <= snowY ? '_snow' : '';
            name = `tile_grass${snow}${variant}${sfx}`;
            break;
          }
          case T.DIRT:
            name = `tile_dirt${sfx}`;
            break;
          case T.ROCK:
            name = `tile_rock${sfx}`;
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
            name = `tile_ramp${sfx}`;
            break;
        }
        if (t === T.RAMP) {
          // Face the slope the right way: along its diagonal chain, or — for a
          // standalone tile — toward the terrain ledge it climbs against (see
          // rampFacesLeft). Default art climbs right, so only left-climbers flip.
          const facesLeft = rampFacesLeft(world, x, y);
          const spr = sprite(name!).canvas;
          if (facesLeft) {
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
        // variation, geology and edge shading on solid terrain
        if (world.isSolid(x, y)) {
          const h = tileHash(x, y);
          const depth = y - (surf[x] ?? y);
          const body = t === T.ROCK || t === T.DIRT;
          // deep ground fades darker (measured from the local surface, so
          // cliff faces show a light-to-dark gradation top to bottom)
          if (body && depth >= 3) {
            const a = Math.min(0.2, (depth - 2) * 0.03);
            ctx.fillStyle = shade(blook.deep, a);
            ctx.fillRect(px, py, TILE, TILE);
          }
          // sedimentary strata: a broken darker band every few rows, with a
          // little jitter per short segment so the line reads hand-laid
          if (body && depth >= 1 && (y + strata) % 4 === 0 && tileHash(x >> 1, y) < 0.8) {
            ctx.fillStyle = shStrata;
            ctx.fillRect(px, py + 4 + Math.floor(tileHash(x >> 2, y) * 3), TILE, 1);
          }
          if (h > 0.82) {
            ctx.fillStyle = shSpeck;
            ctx.fillRect(px + 4, py + 6, 5, 3);
          }
          // the odd crack on exposed rock faces
          if (t === T.ROCK && (airL || airR) && h > 0.55 && h < 0.63) {
            ctx.fillStyle = shCrack;
            const cx = px + 4 + (Math.floor(h * 100) % 6);
            ctx.fillRect(cx, py + 3, 1, 4);
            ctx.fillRect(cx + 1, py + 7, 1, 3);
          }
          if (exposedTop && t !== T.GRASS) {
            ctx.fillStyle = sunTop;
            ctx.fillRect(px, py, TILE, 2);
          }
          if (airL) {
            ctx.fillStyle = sunRim;
            ctx.fillRect(px, py, 2, TILE);
          }
          if (airR) {
            ctx.fillStyle = shRim;
            ctx.fillRect(px + TILE - 2, py, 2, TILE);
          }
          // soft ambient occlusion where a wall rises beside a walkable surface
          if (exposedTop) {
            if (world.isSolid(x - 1, y - 1)) {
              ctx.fillStyle = shAo;
              ctx.fillRect(px, py, 3, TILE);
            }
            if (world.isSolid(x + 1, y - 1)) {
              ctx.fillStyle = shAo;
              ctx.fillRect(px + TILE - 3, py, 3, TILE);
            }
          }
          const earth = t === T.DIRT || t === T.ROCK;
          // the grass lip casts a soft shadow onto the earth it caps
          if (earth && world.get(x, y - 1) === T.GRASS) {
            ctx.fillStyle = shLip;
            ctx.fillRect(px, py, TILE, 2);
            ctx.fillStyle = shLip2;
            ctx.fillRect(px, py + 2, TILE, 2);
          }
          // the underside of an overhang falls into shadow
          if (!world.isSolid(x, y + 1)) {
            ctx.fillStyle = shUnder;
            ctx.fillRect(px, py + TILE - 2, TILE, 2);
          }
          // chunky clods across an exposed earth/rock face: each a lit crown over
          // a shaded body with a dark undercut, scattered deterministically so
          // the raw cliff face reads as clumped earth rather than a flat wall
          if (earth && (airL || airR)) {
            for (let k = 0; k < 3; k++) {
              const h1 = tileHash(x * 4 + k * 37, y * 3 + 11);
              if (h1 < 0.32) continue;
              const cw = 3 + Math.floor(tileHash(x + k * 5, y * 2 + 1) * 3); // 3..5 wide
              const cxp = px + 1 + Math.floor(tileHash(x * 2 + 3, y + k * 9) * (TILE - cw - 2));
              const cy = py + 2 + Math.floor(h1 * (TILE - 7));
              ctx.fillStyle = shClump;
              ctx.fillRect(cxp, cy, cw, 3);
              ctx.fillStyle = sunClump;
              ctx.fillRect(cxp, cy - 1, cw - 1, 1);
              ctx.fillStyle = shClumpDk;
              ctx.fillRect(cxp, cy + 3, cw, 1);
            }
          }
        }
      }
    }

    this.drawTerrainDressing(game, r, surf, sfx, snowY);
  }

  // ---- scenic layer (fog, monuments, waterfalls) ------------------------------
  //
  // One-off atmosphere, all render-only and deterministic per level: nothing
  // here exists for the sim, the verifier, placement or the editor. Everything
  // draws between the terrain and the things that live on it, so gameplay
  // always sits in front, crisp.

  // Tiny deterministic hash of a level id (string or number) for scenic rolls.
  private static levelHash(id: string | number): number {
    const s = String(id);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return ((h >>> 0) % 9973) / 9973;
  }

  // Valley fog: a faint mist pooled over the lowest ground so deep floors read
  // deep. A slow breath unless motion is reduced; shallow maps earn no fog.
  private drawValleyFog(game: Game, cam: Camera, t: number): void {
    const { ctx } = this;
    const { world } = game;
    const surf = this.surfCache; // filled by drawTerrain this frame
    let lo = 0; // lowest ground row (largest y)
    let hi = world.h; // highest summit row
    for (let x = 0; x < world.w; x++) {
      if (surf[x] >= world.h) continue;
      if (surf[x] > lo) lo = surf[x];
      if (surf[x] < hi) hi = surf[x];
    }
    if (lo - hi < 8) return;
    const breathe = this.reduceMotion ? 0 : Math.sin(t * 0.3) * 0.02;
    const a = (0.11 - 0.04 * game.nightAmount()) + breathe;
    const topY = (lo - 5) * TILE;
    const botY = (lo + 3) * TILE;
    const g = ctx.createLinearGradient(0, topY, 0, botY);
    g.addColorStop(0, 'rgba(226,236,248,0)');
    g.addColorStop(1, `rgba(226,236,248,${a.toFixed(3)})`);
    ctx.fillStyle = g;
    const r = this.visibleRange(game, cam);
    ctx.fillRect(r.x0 * TILE, topY, (r.x1 - r.x0 + 1) * TILE, botY - topY);
  }

  // One quiet monument per level, at most: standing stones or a ruined arch on
  // the highest level span, well clear of the town hall and the caravan.
  private drawSetPiece(game: Game): void {
    const roll = Renderer.levelHash(game.level.id);
    if (roll < 0.45) return; // most levels stay plain
    const { ctx } = this;
    const { world } = game;
    const surf = this.surfCache;
    // the highest flat run at least 6 columns wide
    let best: { x0: number; x1: number; y: number } | null = null;
    let run = 0;
    for (let x = 1; x <= world.w; x++) {
      if (x < world.w && surf[x] < world.h && surf[x] === surf[x - 1]) {
        run++;
        continue;
      }
      if (run >= 5 && (!best || surf[x - 1] < best.y)) best = { x0: x - 1 - run, x1: x - 1, y: surf[x - 1] };
      run = 0;
    }
    if (!best) return;
    const cx = Math.floor((best.x0 + best.x1) / 2);
    for (const b of game.buildings) {
      if ((b.kind === 'townhall' || b.kind === 'goal') && Math.abs(b.x + 2 - cx) < 7) return;
    }
    if (world.get(cx, best.y) !== T.GRASS) return;
    const sfx = biomeSuffix((game.level.biome ?? 'meadow') as Biome);
    const kind = roll > 0.72 ? 'setpiece_stones' : 'setpiece_arch';
    const spr = sprite(`${kind}${sfx}`).canvas;
    ctx.drawImage(spr, cx * TILE + TILE / 2 - spr.width / 2, best.y * TILE - spr.height);
  }

  // A scenic waterfall, only where it means something: the tallest cliff face
  // that drops straight into open water gets a thin animated fall and a foam
  // patch. Recomputed per frame (cheap), so rising flood water re-homes it.
  private drawWaterfall(game: Game, cam: Camera, t: number): void {
    if (Renderer.levelHash(`${game.level.id}~fall`) < 0.2) return; // a few levels stay still
    const { ctx } = this;
    const { world } = game;
    const surf = this.surfCache;
    let best: { x: number; topY: number; botY: number } | null = null;
    for (let x = 0; x < world.w; x++) {
      // topmost water cell of this column, if it is open to the sky
      let wy = -1;
      for (let y = 0; y < world.h; y++) {
        const tt = world.get(x, y);
        if (tt === T.WATER) {
          wy = y;
          break;
        }
        if (tt !== T.AIR) break;
      }
      if (wy < 0) continue;
      // only decorate honest pools: the plunge cell needs support below and
      // banks (or more water) beside — never point a fall at floating water
      if (
        world.get(x, wy + 1) === T.AIR ||
        world.get(x - 1, wy) === T.AIR ||
        world.get(x + 1, wy) === T.AIR
      ) {
        continue;
      }
      for (const side of [-1, 1]) {
        const sy = surf[x + side];
        if (sy === undefined || sy >= world.h) continue;
        const drop = wy - sy;
        if (drop >= 3 && (!best || drop > best.botY - best.topY)) {
          best = { x, topY: sy, botY: wy };
        }
      }
    }
    if (!best) return;
    const r = this.visibleRange(game, cam);
    if (best.x < r.x0 - 1 || best.x > r.x1 + 1) return;
    const px = best.x * TILE + TILE / 2;
    const top = best.topY * TILE + 2;
    const bot = best.botY * TILE + 3;
    const osc = this.reduceMotion ? 0 : 1;
    // the stream: a translucent ribbon with brighter chunks sliding down it
    ctx.fillStyle = 'rgba(120,180,230,0.66)';
    ctx.fillRect(px - 1, top, 3, bot - top);
    ctx.fillStyle = 'rgba(250,253,255,0.85)';
    for (let y = top + (((t * 46 * osc) % 8) | 0); y < bot; y += 8) {
      ctx.fillRect(px - 1, y, 3, 3);
    }
    // foam where it lands
    const foam = 0.5 + Math.sin(t * 5) * 0.15 * osc;
    ctx.fillStyle = `rgba(235,246,255,${foam.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(px, bot, 5.5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // The organic layer over the raw tiles: grass banks on 1-tile steps, blades
  // drooping over cliff lips, and hash-scattered surface props. All of it is
  // deterministic decoration in AIR cells — collision and placement never see it.
  private drawTerrainDressing(
    game: Game,
    r: { x0: number; y0: number; x1: number; y1: number },
    surf: number[],
    sfx: string,
    snowY: number
  ): void {
    const { ctx } = this;
    const { world } = game;

    // grass banks: wherever the surface steps by exactly 1 between two natural
    // grass columns, a wedge in the air cell turns the right angle into a slope
    for (let x = Math.max(0, r.x0 - 1); x <= Math.min(world.w - 2, r.x1 + 1); x++) {
      const a = surf[x];
      const b = surf[x + 1];
      if (Math.abs(a - b) !== 1) continue;
      const lowX = a > b ? x : x + 1; // larger y = lower ground
      const hiX = lowX === x ? x + 1 : x;
      const wy = Math.max(a, b) - 1; // the air cell atop the lower column
      if (world.get(lowX, wy + 1) !== T.GRASS || world.get(hiX, wy) !== T.GRASS) continue;
      if (world.get(lowX, wy) !== T.AIR) continue; // never over ladders, platforms, water
      const spr = sprite(`wedge${snowY >= 0 && wy <= snowY ? '_snow' : ''}${sfx}`).canvas;
      if (hiX > lowX) {
        ctx.drawImage(spr, lowX * TILE, wy * TILE); // art rises to the right
      } else {
        ctx.save();
        ctx.translate(lowX * TILE + TILE, wy * TILE);
        ctx.scale(-1, 1);
        ctx.drawImage(spr, 0, 0);
        ctx.restore();
      }
    }

    // lip fringes + surface props, one look at each visible column's surface
    for (let x = Math.max(0, r.x0 - 1); x <= Math.min(world.w - 1, r.x1 + 1); x++) {
      const sy = surf[x];
      if (sy >= world.h || sy - 1 < r.y0 - 1 || sy - 1 > r.y1) continue;
      if (world.get(x, sy) !== T.GRASS) continue;
      if (world.get(x, sy - 1) !== T.AIR) continue;
      const snow = snowY >= 0 && sy <= snowY;
      const fname = `fringe${snow ? '_snow' : ''}${sfx}`;
      // blades droop over real cliff lips (≥2 drops; 1-steps wear wedges instead)
      if (x + 1 < world.w && surf[x + 1] - sy >= 2 && world.get(x + 1, sy) === T.AIR) {
        ctx.drawImage(sprite(fname).canvas, (x + 1) * TILE, sy * TILE);
      }
      if (x - 1 >= 0 && surf[x - 1] - sy >= 2 && world.get(x - 1, sy) === T.AIR) {
        ctx.save();
        ctx.translate(x * TILE, sy * TILE);
        ctx.scale(-1, 1);
        ctx.drawImage(sprite(fname).canvas, 0, 0);
        ctx.restore();
      }
      // props keep to locally level ground (never colliding with a wedge) and
      // stay below the snowline; muted, small, and drawn before anything alive
      if (!snow && surf[x - 1] === sy && surf[x + 1] === sy) {
        const h = tileHash(x * 3 + 1, sy * 5 + 2);
        if (h < 0.32) {
          const kind = PROP_KINDS[Math.floor(tileHash(x * 7 + 3, sy) * PROP_KINDS.length) % PROP_KINDS.length];
          const spr = sprite(`${kind}${sfx}`).canvas;
          const jx = Math.floor(tileHash(x, sy * 3) * (TILE - spr.width));
          ctx.drawImage(spr, x * TILE + jx, sy * TILE - spr.height);
        }
      }
    }
  }

  // `hoveredId`/`focus` drive the Harvest-cursor anticipation: the node under the
  // cursor leans/lifts (tree) or shivers (boulder/vein) as `focus` (0..1) ramps.
  private drawNodes(game: Game, t: number, hoveredId: number, focus: number, look: WeatherLook): void {
    const { ctx } = this;
    const osc = this.reduceMotion ? 0 : 1;
    // the wind leans on the treetops: gentle by default, hard in a storm
    const wind = look.wind;
    const windHz = look.windHz;
    // the tree silhouette follows the biome (palm on sand, pine on snow, …)
    const treeImg = sprite(treeSprite((game.level.biome ?? 'meadow') as Biome)).canvas;
    for (const n of game.nodes) {
      const anticip = n.id === hoveredId ? focus : 0;
      const wob = n.wobble > 0 ? Math.sin(t * 40) * 1.2 : 0;
      const px = n.x * TILE + wob;
      if (n.kind === 'tree') {
        if (n.yieldLeft > 0) {
          // hovered trees sway wider and lift toward the order. The sway is a
          // horizontal shear pivoted at the trunk foot: zero drift at the base,
          // full drift at the crown — so the trunk stays planted and only the
          // treetop rocks in the wind.
          const sway = Math.sin(t * windHz + n.x) * (0.8 * wind + anticip * 1.8 * osc);
          const lift = anticip * 1.2;
          const top = (n.y - 1) * TILE - lift;
          const baseY = top + 32; // trunk foot on the ground
          const pivotX = px + TILE / 2;
          ctx.save();
          ctx.translate(pivotX, baseY);
          ctx.transform(1, 0, -sway / 32, 1, 0, 0); // shear grows toward the crown
          ctx.translate(-pivotX, -baseY);
          ctx.drawImage(treeImg, px, top, TILE, 32);
          ctx.restore();
        } else {
          ctx.drawImage(sprite('stump').canvas, n.x * TILE, n.y * TILE);
          // the felled trunk topples about its foot, then dust takes over
          const fall = this.motion.fellingFor(n.id);
          if (fall !== null) {
            const pivotX = n.x * TILE + TILE / 2;
            const baseY = (n.y + 1) * TILE;
            ctx.save();
            ctx.translate(pivotX, baseY);
            ctx.rotate(fall);
            ctx.drawImage(treeImg, -TILE / 2, -32, TILE, 32);
            ctx.restore();
          }
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

  // Pending dig plan: an amber hatch + pulsing dashed outline over each marked
  // cell, so a tunnel/shaft the player painted reads as "queued to be removed".
  private drawDigOrders(game: Game, t: number): void {
    if (game.digOrders.size === 0) return;
    const { ctx } = this;
    const w = game.world.w;
    const pulse = this.reduceMotion ? 0.5 : 0.5 + Math.sin(t * 4) * 0.25;
    ctx.save();
    for (const idx of game.digOrders) {
      const x = idx % w;
      const y = (idx / w) | 0;
      const px = x * TILE;
      const py = y * TILE;
      ctx.fillStyle = `rgba(230,150,60,${0.16 + pulse * 0.12})`;
      ctx.fillRect(px, py, TILE, TILE);
      // diagonal hatch marks the cell as "to be carved out" (clipped to the tile)
      ctx.save();
      ctx.beginPath();
      ctx.rect(px, py, TILE, TILE);
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,196,120,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let o = -TILE; o < TILE; o += 5) {
        ctx.moveTo(px + o, py);
        ctx.lineTo(px + o + TILE, py + TILE);
      }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = `rgba(255,170,80,${0.55 + pulse * 0.35})`;
      ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
    }
    ctx.restore();
  }

  private drawBuildings(game: Game, t: number): void {
    const { ctx } = this;
    for (const b of game.buildings) {
      if (b.kind === 'lift') {
        this.drawLift(b);
        continue;
      }
      if (b.kind === 'rope') {
        this.drawRope(b);
        continue;
      }
      if (b.kind === 'hoist') {
        this.drawHoist(b);
        continue;
      }
      const fw = footprintW(b) * TILE;
      const fh = footprintH(b) * TILE;
      const px = b.x * TILE;
      const py = b.y * TILE;
      const spr = sprite(b.kind).canvas;

      // a soft contact shadow grounds a finished building on the terrain
      if (b.state === 'ready') {
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        ctx.beginPath();
        ctx.ellipse(px + fw / 2, py + fh - 1, fw * 0.44, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();
      }

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
        if (b.kind === 'lantern') {
          // a warm halo + flame flicker; the real "light" is the darkness hole
          const fl = this.reduceMotion ? 0.5 : 0.5 + Math.sin(t * 9 + b.id) * 0.5;
          const cx = px + TILE / 2;
          const cy = py + 5;
          const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, TILE * 2.2);
          grad.addColorStop(0, `rgba(255,196,90,${0.22 + fl * 0.06})`);
          grad.addColorStop(1, 'rgba(255,196,90,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(cx, cy, TILE * 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
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
      if (b.state === 'ready' && (b.kind === 'sawmill' || b.kind === 'forge' || b.kind === 'workshop')) {
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
        if (b.paused) {
          // held: two little bars so a paused producer reads at a glance
          const bx = px + fw - 8;
          const by = py + 2;
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(bx - 1, by - 1, 8, 9);
          ctx.fillStyle = '#ffd94d';
          ctx.fillRect(bx, by, 2, 7);
          ctx.fillRect(bx + 4, by, 2, 7);
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

  private drawEffects(now: number): void {
    const { ctx } = this;
    const DUR = 2.0;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      const age = now - e.start;
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
      const txt = t('fx.crew', { a: e.from, b: e.to });
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

  private drawRope(b: Building): void {
    const { ctx } = this;
    const px = b.x * TILE;
    const py = b.y * TILE;
    ctx.globalAlpha = b.state === 'blueprint' ? 0.45 : 1;
    ctx.drawImage(sprite('rope_anchor').canvas, px, py);
    // rope: from the post top, over the edge, hanging down the drop column
    const rx = (b.x + b.ropeSide) * TILE + TILE / 2;
    const botY = (b.ropeBottomY + 1) * TILE - 3;
    const rope = b.state === 'ready' ? this.motion.ropeFor(b.id) : undefined;
    if (rope) {
      // look-physics: a verlet chain that sways in the wind and bows under a
      // sliding worker (reduced motion falls back to the static line below)
      ctx.strokeStyle = '#d8b271';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 5, py + 3);
      for (let i = 0; i < rope.n; i++) ctx.lineTo(rope.x[i], rope.y[i]);
      ctx.stroke();
      // knots so climbing hands (and eyes) find purchase
      ctx.fillStyle = '#c09a55';
      for (let i = 1; i < rope.n; i += 2) ctx.fillRect(rope.x[i] - 1, rope.y[i], 3, 2);
    } else {
      ctx.strokeStyle = '#d8b271';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 5, py + 3);
      ctx.lineTo(rx, py + 7);
      ctx.quadraticCurveTo(rx, (py + botY) / 2, rx, botY);
      ctx.stroke();
      // knots so climbing hands (and eyes) find purchase
      ctx.fillStyle = '#c09a55';
      for (let y = b.y + 1; y <= b.ropeBottomY; y += 2) {
        ctx.fillRect(rx - 1, y * TILE + 5, 3, 2);
      }
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

  // The counterweight hoist: a pulley post at the cliff edge, two cargo cars
  // hanging in the drop column. During a cycle the heavy car visibly drags the
  // light one up — the animation IS the mechanic's advertisement.
  private drawHoist(b: Building): void {
    const { ctx } = this;
    const px = b.x * TILE;
    const py = b.y * TILE;
    ctx.globalAlpha = b.state === 'blueprint' ? 0.45 : 1;
    // post (art faces right; mirror when the cars hang on the left)
    const post = sprite('hoist_post').canvas;
    if (b.ropeSide < 0) {
      ctx.save();
      ctx.translate(px + TILE, py);
      ctx.scale(-1, 1);
      ctx.drawImage(post, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(post, px, py);
    }
    if (b.state === 'ready') {
      const rx = (b.x + b.ropeSide) * TILE + TILE / 2;
      const wheelY = py + 4;
      const topY = py + 6;
      const botY = b.ropeBottomY * TILE + 6;
      // eased swap progress: cars trade ends while busy, rest at the stations
      const p = b.hoistBusy ? Math.min(1, b.hoistT / HOIST_CYCLE) : 0;
      const e = p * p * (3 - 2 * p);
      const yUp = topY + (botY - topY) * e; // the (former) upper car, descending
      const yLo = botY - (botY - topY) * e; // the lower car, being dragged up
      const car = sprite('hoist_car').canvas;
      // the cars pass on offset ropes so they don't overlap mid-swap
      for (const [cx, cy, contents] of [
        [rx - 3, yUp, b.hoistUpper],
        [rx + 3, yLo, b.hoistLower],
      ] as const) {
        ctx.strokeStyle = '#d8b271';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, wheelY);
        ctx.lineTo(cx, cy + 1);
        ctx.stroke();
        ctx.drawImage(car, cx - TILE / 2, cy);
        // up to 3 item pips riding in the basket
        let drawn = 0;
        for (const [k, v] of Object.entries(contents)) {
          for (let i = 0; i < (v ?? 0) && drawn < 3; i++, drawn++) {
            ctx.drawImage(sprite(`item_${k}`).canvas, cx - 6 + drawn * 4, cy + 3, 6, 6);
          }
        }
      }
    }
    ctx.globalAlpha = 1;
    if (b.state === 'blueprint') {
      const need = BUILD_TIME.hoist ?? 6;
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
      // look-physics: mid-arc items tumble from their source to the rest tile;
      // delay-gated flights (a felling tree's log) stay hidden until they fly
      const flight = this.motion.flightFor(gi.id);
      if (flight === 'hidden') continue;
      if (flight) {
        ctx.save();
        ctx.translate(flight.x * TILE + TILE / 2, flight.y * TILE + 11);
        ctx.rotate(flight.rot);
        ctx.drawImage(sprite(`item_${gi.item}`).canvas, -4, -4);
        ctx.restore();
        continue;
      }
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

  // A dropped item a loaded hauler could never carry out (see
  // Game.strandedGroundItems) gets a pulsing amber "!" above it, drawn in the
  // post-darkness pass (see draw()) so it still reads over the night veil.
  private drawStrandedMarkers(game: Game, t: number): void {
    const stranded = game.strandedGroundItems();
    if (!stranded.length) return;
    const { ctx } = this;
    const spr = sprite('warn').canvas;
    const bob = this.reduceMotion ? 0 : Math.sin(t * 4) * 1.5;
    for (const gi of stranded) {
      ctx.drawImage(spr, gi.x * TILE + 4, (gi.y - 1) * TILE - 2 + bob);
    }
  }

  private drawLocateRing(t: number): void {
    const ring = this.locateRing;
    if (!ring) return;
    const age = t - ring.bornAt;
    if (age < 0 || age >= this.LOCATE_RING_DUR) { this.locateRing = null; return; }
    const { ctx } = this;
    const cx = (ring.x + 0.5) * TILE;
    const cy = (ring.y + 0.5) * TILE;
    const fade = 1 - age / this.LOCATE_RING_DUR; // 1 → 0 over the lifetime
    const wob = this.reduceMotion ? 0 : (0.5 + Math.sin(t * 6) * 0.5) * 0.9;
    const r = TILE * (2.2 + wob);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffd66a';
    ctx.globalAlpha = 0.9 * fade;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.5 * fade;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  // Screen-edge arrows pointing at stranded ground items that are scrolled out of
  // view (closes the #47 off-screen deferral). On-screen items are already
  // covered by the #47 warning glyph, so those are skipped.
  private drawStrandedEdgeArrows(game: Game, cam: Camera, W: number, H: number, t: number): void {
    const stranded = game.strandedGroundItems();
    if (!stranded.length) return;
    const { ctx } = this;
    const scale = TILE * cam.zoom;
    const pad = 18;
    const topInset = 96;              // clear the topbar HUD band
    const minX = pad, maxX = W - cam.rightInset - pad;
    const minY = topInset, maxY = H - pad;
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
    const bob = this.reduceMotion ? 0 : Math.sin(t * 4) * 2;
    ctx.save();
    for (const gi of stranded) {
      const sx = (gi.x + 0.5) * scale - cam.x;
      const sy = (gi.y + 0.5) * scale - cam.y;
      if (sx >= 0 && sx <= W - cam.rightInset && sy >= 0 && sy <= H) continue; // on-screen
      const ex = Math.max(minX, Math.min(maxX, sx));
      const ey = Math.max(minY, Math.min(maxY, sy));
      const ang = Math.atan2(sy - midY, sx - midX);
      ctx.save();
      ctx.translate(ex, ey + bob);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = '#ff9d2e';
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  // Water is drawn OVER terrain, nodes and loose items so anything the flood
  // has claimed reads as submerged through the translucent surface.
  private drawWater(game: Game, cam: Camera, t: number): void {
    const { ctx } = this;
    const { world } = game;
    const r = this.visibleRange(game, cam);
    const osc = this.reduceMotion ? 0 : 1;
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        if (world.get(x, y) !== T.WATER) continue;
        const px = x * TILE;
        const py = y * TILE;
        ctx.fillStyle = 'rgba(36,92,156,0.82)';
        ctx.fillRect(px, py, TILE, TILE);
        if (world.get(x, y - 1) !== T.WATER) {
          // surface cell: a rolling highlight band + a crisp waterline
          const ph = Math.sin(t * 1.8 * osc + x * 0.9) * 1.5;
          ctx.fillStyle = 'rgba(190,225,250,0.5)';
          ctx.fillRect(px, py + 2 + ph, TILE, 2);
          ctx.fillStyle = 'rgba(220,240,255,0.65)';
          ctx.fillRect(px, py, TILE, 1);
        } else {
          // depth shading so deep water reads darker than the shallows
          ctx.fillStyle = 'rgba(8,28,64,0.22)';
          ctx.fillRect(px, py, TILE, TILE);
        }
        // the odd glint
        if (tileHash(x, y) > 0.92) {
          const glint = (Math.sin(t * 2.4 * osc + x * 1.7 + y) + 1) / 2;
          ctx.fillStyle = `rgba(255,255,255,${(glint * 0.18).toFixed(3)})`;
          ctx.fillRect(px + 5, py + 6, 4, 1);
        }
      }
    }
  }

  // Expanding rings where goods met the water (look-physics; empty when
  // reduced motion is on). Drawn over the water so the loss reads clearly.
  private drawRipples(t: number): void {
    const { ctx } = this;
    for (const r of this.motion.ripples) {
      const age = t - r.start;
      const a = Math.max(0, 1 - age / RIPPLE_DUR);
      if (a <= 0) continue;
      ctx.strokeStyle = `rgba(220,240,255,${(a * 0.5).toFixed(3)})`;
      ctx.lineWidth = 1;
      for (const lag of [0, 0.22]) {
        const rr = (age - lag) * 16;
        if (rr <= 1) continue;
        ctx.beginPath();
        ctx.ellipse(r.x * TILE, r.y * TILE, rr, rr * 0.35, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // Little dust fans for landings — items thumping down, workers dropping,
  // felled trunks crashing. Each speck is a pure function of the puff's age,
  // so no per-frame state accumulates.
  private drawPuffs(t: number): void {
    const { ctx } = this;
    for (const p of this.motion.puffs) {
      const age = t - p.start;
      const a = Math.max(0, 1 - age / PUFF_DUR);
      if (a <= 0) continue;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = a * 0.55;
      for (let i = 0; i < 5; i++) {
        const ang = i * 2.4 + p.start * 7; // deterministic fan per puff
        const d = 2 + age * 12;
        const sx = p.x * TILE + Math.cos(ang) * d;
        const sy = p.y * TILE + Math.sin(ang) * d * 0.35 - age * 10;
        const s = Math.max(0.5, 1.6 * (1 - age));
        ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Screen-space precipitation driven by the blended weather look: a wet tint,
  // falling streaks (more, longer, faster and slanted harder as a storm builds),
  // and horizontal gust lines that fade in only once it's genuinely stormy.
  private drawWeatherFx(look: WeatherLook, W: number, H: number, t: number): void {
    const rain = look.rain;
    if (rain < 0.01 && look.tint[3] < 0.001) return; // nothing to draw (same tint epsilon as below)
    const { ctx } = this;
    if (look.tint[3] > 0.001) {
      ctx.fillStyle = rgbaCss(look.tint);
      ctx.fillRect(0, 0, W, H);
    }
    if (this.reduceMotion) return; // the tint alone carries the weather
    const mod = (v: number, m: number) => ((v % m) + m) % m;
    const stormy = Math.min(1, Math.max(0, (rain - 1) / 0.6)); // 0 at rain, 1 at storm
    const n = Math.round(120 * Math.min(1.6, rain));
    const fall = 640 + 310 * stormy;
    const slant = look.slant;
    const len = 10 + 5 * stormy;
    ctx.strokeStyle = `rgba(188,206,228,${(0.36 * Math.min(1, rain)).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const h1 = tileHash(i, 13);
      const h2 = tileHash(i, 29);
      const y = mod(h2 * (H + 60) + t * fall * (0.8 + h1 * 0.4), H + 60) - 30;
      const x = mod(h1 * (W + 120) - t * fall * slant, W + 120) - 60;
      ctx.moveTo(x, y);
      ctx.lineTo(x - slant * len, y + len);
    }
    ctx.stroke();
    if (stormy > 0.01) {
      // gusts screaming past horizontally, fading in with the storm
      ctx.strokeStyle = `rgba(220,230,245,${(0.14 * stormy).toFixed(3)})`;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const h = tileHash(i, 41);
        const y = h * H;
        const x = mod(h * W - t * (380 + h * 160), W + 260) - 130;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 46 + h * 30, y - 2);
      }
      ctx.stroke();
    }
  }

  // Night: a dark veil over the world with soft holes punched out around every
  // light source. Composited on an offscreen canvas so the holes blend cleanly.
  private darkCanvas: HTMLCanvasElement | null = null;

  private drawDarkness(game: Game, cam: Camera, W: number, H: number, t: number): void {
    // the veil deepens with the night — nothing by day, a gentle dimming through
    // dusk, full dark once night has fallen. Light-source holes stay full-cut.
    const nA = game.nightAmount();
    if (nA <= 0.001) return;
    const { ctx } = this;
    if (!this.darkCanvas) this.darkCanvas = document.createElement('canvas');
    const dc = this.darkCanvas;
    if (dc.width !== W || dc.height !== H) {
      dc.width = W;
      dc.height = H;
    }
    const dctx = dc.getContext('2d')!;
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, W, H);
    dctx.fillStyle = `rgba(8,12,32,${(0.84 * nA).toFixed(3)})`;
    dctx.fillRect(0, 0, W, H);
    dctx.globalCompositeOperation = 'destination-out';
    const scale = TILE * cam.zoom;
    const flicker = this.reduceMotion ? 0 : 1;
    for (const s of game.lightSources()) {
      const sx = s.x * scale - cam.x;
      const sy = s.y * scale - cam.y;
      const r = s.r * scale * (1 + Math.sin(t * 7 + s.x * 3.1) * 0.015 * flicker);
      if (sx < -r || sx > W + r || sy < -r || sy > H + r) continue;
      const grad = dctx.createRadialGradient(sx, sy, r * 0.22, sx, sy, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.72, 'rgba(0,0,0,0.72)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = grad;
      dctx.beginPath();
      dctx.arc(sx, sy, r, 0, Math.PI * 2);
      dctx.fill();
    }
    // each smallhand carries a tiny hand-lamp so the crew stays readable
    for (const w of game.workers) {
      const sx = (w.px + 0.5) * scale - cam.x;
      const sy = (w.py + 0.5) * scale - cam.y;
      const r = 1.9 * scale;
      if (sx < -r || sx > W + r || sy < -r || sy > H + r) continue;
      const grad = dctx.createRadialGradient(sx, sy, r * 0.1, sx, sy, r);
      grad.addColorStop(0, 'rgba(0,0,0,0.6)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      dctx.fillStyle = grad;
      dctx.beginPath();
      dctx.arc(sx, sy, r, 0, Math.PI * 2);
      dctx.fill();
    }
    ctx.drawImage(dc, 0, 0);
  }

  private drawWorkers(game: Game, t: number): void {
    const { ctx } = this;
    for (const w of game.workers) {
      if (w.spawnT > 0.3) continue;
      const step = w.stepIdx < w.path.length ? w.path[w.stepIdx] : null;
      // Walking a ramp means walking its diagonal (card #59): the cell is half
      // earth, so lift the feet to the slope's midline instead of sinking them
      // into it. Blended over the step in progress so stepping onto or off a
      // slope glides rather than snapping half a tile.
      const lift = (cx: number, cy: number) => (game.world.get(cx, cy) === T.RAMP ? TILE / 2 : 0);
      let foot = lift(w.cx, w.cy);
      if (step) {
        const to = lift(step.x, step.y);
        if (to !== foot) {
          // Follow the ROW when the step changes rows: a fall or a rope slide
          // travels horizontally first and only then drops (tickMove zeroes dy
          // while dx is unspent), so blending on the horizontal component would
          // float the walker up half a tile before they leave the old row.
          const rows = Math.abs(step.y - w.cy);
          const done = rows > 0 ? Math.abs(w.py - w.cy) / rows : Math.abs(w.px - w.cx);
          foot += (to - foot) * Math.min(1, Math.max(0, done));
        }
      }
      const px = w.px * TILE + TILE / 2;
      const py = w.py * TILE + TILE - foot;
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
      // landing squash-and-stretch, pivoted at the feet (rebound overshoots
      // into a brief stretch); 0 when reduced motion is on
      const squash = this.motion.squashFor(w.id);
      if (squash !== 0) ctx.scale(1 + squash * 0.7, 1 - squash);
      ctx.drawImage(spr, -5, -12);
      ctx.drawImage(sprite(`hat_${w.role}`).canvas, -5, -14);
      // a digger at work holds a shovel out front, bobbing with each bite
      if (w.role === 'digger' && w.working) {
        const swing = Math.sin(w.animT * 10) * 1.4;
        ctx.drawImage(sprite('item_shovel').canvas, 2, -6 + swing);
      }
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

  // Preview the patch a lantern would light from the aimed cell, so the player
  // can place it without guessing. Faithful to the sim: same centre
  // ((tx+0.5, ty+0.5)) and LANTERN_RADIUS the finished lantern uses for isLit,
  // and the same soft warm disc the night veil punches around a real light. The
  // ghost draws after drawDarkness, so at night the previewed area visibly
  // brightens; the dashed ring marks the exact lit boundary. Static (no flicker)
  // to stay deterministic and reduce-motion-safe.
  private drawLanternRange(tx: number, ty: number): void {
    const { ctx } = this;
    const cx = (tx + 0.5) * TILE;
    const cy = (ty + 0.5) * TILE;
    const r = LANTERN_RADIUS * TILE;
    ctx.save();
    const grad = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
    grad.addColorStop(0, 'rgba(255,201,109,0.30)');
    grad.addColorStop(0.72, 'rgba(255,201,109,0.13)');
    grad.addColorStop(1, 'rgba(255,201,109,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,214,120,0.85)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
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
          const lit = game.isLit(n.x, n.y);
          this.reticle(box, this.harvestFocus, t, lit ? '#ffc94d' : '#7f8ea6');
          // preview the flag you're about to plant (unmarked nodes only — marked
          // ones already fly the real flag; unlit ones refuse the order)
          if (!n.marked && lit) {
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
        const ok =
          canPlacePlatform(game.world, tx, ty) &&
          game.canAfford({ plank: 1 }) &&
          !game.darkBlocks('platform', tx, ty);
        ctx.globalAlpha = 0.6;
        ctx.drawImage(sprite('tile_platform').canvas, px, py);
        ctx.globalAlpha = 1;
        outline(ok);
        break;
      }
      case 'ramp': {
        // at-rest preview of the anchor tile (a drag then previews the full run)
        const ok =
          canPlaceRamp(game.world, tx, ty, null) &&
          game.canAfford({ plank: 1 }) &&
          !game.darkBlocks('ramp', tx, ty);
        ctx.globalAlpha = 0.6;
        // preview the same facing the laid tile will take (toward the ledge),
        // in this level's biome earth so it matches the terrain it lands in
        const sfx = biomeSuffix((game.level.biome ?? 'meadow') as Biome);
        const spr = sprite(`tile_ramp${sfx}`).canvas;
        if (rampFacesLeft(game.world, tx, ty)) {
          ctx.save();
          ctx.translate(px + TILE, py);
          ctx.scale(-1, 1);
          ctx.drawImage(spr, 0, 0);
          ctx.restore();
        } else {
          ctx.drawImage(spr, px, py);
        }
        ctx.globalAlpha = 1;
        outline(ok);
        break;
      }
      case 'dig': {
        // green when this cell can be marked to dig, red when it can't
        // (bedrock, world edge, under a building, no reachable face — or too dark)
        outline(game.canDig(tx, ty) && !game.darkBlocks('dig', tx, ty));
        break;
      }
      case 'sawmill':
      case 'forge':
      case 'workshop':
      case 'lantern': {
        const fp = FOOTPRINTS[tool];
        const cost = TOOL_DEFS.find((d) => d.id === tool)?.cost ?? {};
        const ok =
          canPlaceBuilding(game.world, game.buildings, game.nodes, tx, ty, fp.w, fp.h) &&
          game.canAfford(cost) &&
          game.toolUnlocked(tool) &&
          // at night, workshops need a lit site — lanterns go anywhere
          !game.darkBlocks(tool, tx, ty);
        // show the area this lantern would light before it's placed (under the
        // sprite/outline so those stay legible on top)
        if (tool === 'lantern') this.drawLanternRange(tx, ty);
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
        const ok =
          topY !== null &&
          game.canAfford(liftCost) &&
          game.toolUnlocked('lift') &&
          !game.darkBlocks('lift', tx, ty);
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
        const ok =
          drop !== null &&
          game.canAfford(ropeCost) &&
          game.toolUnlocked('rope') &&
          !game.darkBlocks('rope', tx, ty);
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
      case 'hoist': {
        const drop = ropeDropFor(game.world, tx, ty);
        const hoistCost = TOOL_DEFS.find((d) => d.id === 'hoist')?.cost ?? {};
        const ok =
          drop !== null &&
          game.canAfford(hoistCost) &&
          game.toolUnlocked('hoist') &&
          !game.darkBlocks('hoist', tx, ty);
        if (drop !== null) {
          ctx.globalAlpha = 0.6;
          const post = sprite('hoist_post').canvas;
          if (drop.side < 0) {
            ctx.save();
            ctx.translate(px + TILE, py);
            ctx.scale(-1, 1);
            ctx.drawImage(post, 0, 0);
            ctx.restore();
          } else {
            ctx.drawImage(post, px, py);
          }
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
