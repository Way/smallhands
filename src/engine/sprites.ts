// Original hand-authored pixel art, defined as string maps and rendered
// into an offscreen atlas at boot. Each character indexes into a palette.
// '.' is transparent.

import { BIOMES, BIOME_LOOK, SNOW_BLADES, biomeSuffix } from './biomes';
import type { Biome } from './biomes';

export interface SpriteDef {
  w: number;
  h: number;
  canvas: HTMLCanvasElement;
}

const sprites = new Map<string, SpriteDef>();

function makeSprite(name: string, palette: Record<string, string>, rows: string[]): void {
  const h = rows.length;
  const w = rows[0].length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const col = palette[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  sprites.set(name, { w, h, canvas: c });
}

export function sprite(name: string): SpriteDef {
  const s = sprites.get(name);
  if (!s) throw new Error(`missing sprite: ${name}`);
  return s;
}

// Deterministic tiny hash for tile variation.
export function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

// ---- terrain tile string maps, shared by every biome ----------------------
// Chars: g/G/k/L grass blades (mid/light/dark/lit-tip), d/D/e/c dirt
// (mid/dark/light/crevice), r/R/k/K rock. Palettes come from BIOME_LOOK, so one
// map = every biome. The grass and dirt tiles are generated (below) rather than
// hand-typed: dirt is a field of domed clods, grass is a lush cap over it.

// Cobbled earth: domed clods packed on a brick-offset grid, each lit along the
// top (e), mid-bodied (d) and shadowed at the base (D), separated by dark
// crevices (c). Deterministic and wrap-tiled so it repeats seamlessly.
// p maps the four clod tones onto a palette: crevice / lit-crown / mid / shadow.
function clodField(p: { c: string; e: string; d: string; D: string }): string[] {
  const N = 16;
  const g: string[][] = Array.from({ length: N }, () => Array(N).fill(p.c));
  const put = (x: number, y: number, ch: string) => {
    g[((y % N) + N) % N][((x % N) + N) % N] = ch;
  };
  for (let by = 0; by < N; by += 4) {
    const off = (by / 4) & 1 ? 3 : 0;
    for (let bx = -off; bx < N; bx += 5) {
      const jx = Math.round((tileHash(bx * 2 + 1, by) - 0.5) * 2);
      const jy = Math.round((tileHash(bx, by * 2 + 3) - 0.5) * 1.4);
      const ox = bx + 2 + jx;
      const oy = by + 2 + jy;
      const hw = tileHash(bx + 3, by + 1) > 0.5 ? 3 : 2; // half-width 2..3
      for (let dy = -1; dy <= 2; dy++) {
        const rw = dy === -1 || dy === 2 ? hw - 1 : hw; // round top + bottom
        for (let dx = -rw; dx <= rw; dx++) {
          const tone = dy <= -1 ? p.e : dy === 0 ? (dx < 0 ? p.e : p.d) : dy === 1 ? p.d : p.D;
          put(ox + dx, oy + dy, tone);
        }
      }
      if (tileHash(bx + 5, by + 2) > 0.7) put(ox - hw, oy - 1, p.e); // extra glint
    }
  }
  return g.map((r) => r.join(''));
}
const DIRT = { c: 'c', e: 'e', d: 'd', D: 'D' };
const DIRT_ROWS = clodField(DIRT);

// Lush grass cap over the cobbled earth: bright lit tips against the sky (with a
// ragged silhouette), a light then mid band, then dark roots that droop a row
// into the clods below. The lower 11 rows ARE the clod field, so the grass tile
// and the dirt tile beneath it read as one continuous body.
function grassField(): string[] {
  const rows = clodField(DIRT).map((r) => r.split(''));
  const band = (x: number, y: number): string => {
    const h = tileHash(x * 3 + 1, y * 7 + 2);
    if (y === 0) return h < 0.16 ? '.' : h < 0.55 ? 'L' : 'G'; // ragged lit tips
    if (y === 1) return h < 0.42 ? 'L' : 'G';
    if (y === 2) return h < 0.5 ? 'G' : 'g';
    if (y === 3) return h < 0.38 ? 'g' : 'k';
    return h < 0.32 ? 'k' : h < 0.58 ? 'g' : 'd'; // y===4: roots meeting earth
  };
  for (let y = 0; y < 5; y++) for (let x = 0; x < 16; x++) rows[y][x] = band(x, y);
  for (let x = 0; x < 16; x++) if (tileHash(x * 5 + 3, 9) < 0.3) rows[5][x] = 'k'; // droop
  return rows.map((r) => r.join(''));
}
const GRASS_ROWS = grassField();

// rock gets the same cobbled clods, mapped onto the stone palette so cliffs of
// rock read as chunky as the earth above them
const ROCK_ROWS = clodField({ c: 'K', e: 'R', d: 'r', D: 'k' });

// A grass tile whose top corner sits on a cliff lip: the corner pixels go
// transparent (the sky shows through = a rounded silhouette) and the blades
// wrap a little way down the exposed side.
function roundedGrass(rows: string[], left: boolean, right: boolean): string[] {
  const g = rows.map((r) => r.split(''));
  if (left) {
    g[0][0] = '.';
    g[0][1] = '.';
    g[1][0] = '.';
    for (let y = 2; y <= 5; y++) g[y][0] = 'k';
    g[2][1] = 'g';
    g[3][1] = 'g';
  }
  if (right) {
    g[0][15] = '.';
    g[0][14] = '.';
    g[1][15] = '.';
    for (let y = 2; y <= 5; y++) g[y][15] = 'k';
    g[2][14] = 'g';
    g[3][14] = 'g';
  }
  return g.map((r) => r.join(''));
}

// Snowed variant of a grass-topped tile: the blade rows deepen into a solid
// white cap (~5 rows) that ties into the earth below with a ragged melt line.
function snowRows(rows: string[]): string[] {
  return rows.map((row, y) => {
    if (y === 0) return row; // blade silhouette, whitened by the palette
    if (y > 4) return row;
    return row
      .split('')
      .map((c, x) => {
        if (y === 1) return c === 'G' ? 'G' : 'g';
        if (y === 2) return (x * 5 + 3) % 7 === 0 ? 'G' : 'g';
        if (y === 3) return (x + 1) % 3 === 0 ? c : 'g';
        return (x + 2) % 5 === 0 ? 'g' : c; // y === 4: last specks of snow
      })
      .join('');
  });
}

// The grass bank drawn over a 1-tile surface step (art rises to the right;
// the renderer mirrors it for left-rising steps). 16x18: the last two rows
// tuck the bank's foot over the blade rows of the tile below so the seam
// reads as one continuous slope. Pure decoration — the cell stays AIR.
function wedgeRows(): string[] {
  const rows: string[] = [];
  const body = (x: number, y: number) => ((x * 7 + y * 13) % 11 === 0 ? 'D' : (x * 5 + y * 3) % 13 === 0 ? 'e' : 'd');
  for (let y = 0; y < 16; y++) {
    let r = '';
    for (let x = 0; x < 16; x++) {
      const d = x - (15 - y);
      r += d < 0 ? '.' : d === 0 ? 'G' : d === 1 ? 'g' : d === 2 ? 'k' : body(x, y);
    }
    rows.push(r);
  }
  for (let y = 16; y < 18; y++) {
    let r = '';
    for (let x = 0; x < 16; x++) {
      r += x < y - 15 ? '.' : x === y - 15 ? 'k' : body(x, y);
    }
    rows.push(r);
  }
  return rows;
}

// A ramp: a solid earthen slope tile, drawn as one continuous piece of the
// terrain rather than a wooden wedge. Art rises to the right (the renderer
// mirrors it for left-climbers). The diagonal walking surface wears grass
// blades (lit tip G, blade g, dark root k); everything below-right of it is
// the same cobbled clod field as the dirt tile — sampled at the matching
// (x,y) so a dirt tile placed under the ramp continues the pattern seamlessly.
// The upper-left triangle above the slope stays transparent (air).
function rampRows(): string[] {
  const dirt = DIRT_ROWS; // per-position clod chars, wrap-tiled at 16
  const rows: string[] = [];
  for (let y = 0; y < 16; y++) {
    let r = '';
    for (let x = 0; x < 16; x++) {
      const d = x - (15 - y); // distance from the slope edge; <0 is air
      r += d < 0 ? '.' : d === 0 ? 'G' : d === 1 ? 'g' : d === 2 ? 'k' : dirt[y][x];
    }
    rows.push(r);
  }
  return rows;
}

// Grass strands drooping over a cliff lip into the neighbouring air cell
// (art hangs from the cell's left edge; mirrored for the other side).
const FRINGE_ROWS = [
  'LGLg..',
  'gGgGk.',
  'kgGgk.',
  '.kggk.',
  '..kgk.',
  '..kg..',
  '...k..',
];

// ---- scenic set pieces (one quiet monument per level, at most) -------------
// Chars: r/R/k/K stone, g/k grass creep. Drawn behind nodes and buildings.

const SETPIECE_ROWS: Record<string, string[]> = {
  setpiece_stones: [
    '..RRRRR...RRRR........',
    '..rKrrK...rKrK........',
    '..............RRRR....',
    '..rR..rR......rKrK....',
    '..rR..Rr..rR..........',
    '..Rr..rR..rR....rR....',
    '..rR..rR..Rr....Rr....',
    '..Rr..Rr..rR....rR....',
    '..rR..rR..rR....Rr....',
    '..Rr..Rr..Rr....rR....',
    '.grRg.rRg.gRr..grRg...',
    'g.g..g..g....gg..g.g..',
  ],
  setpiece_arch: [
    '....RRRRRR........',
    '...RKrrrKRR.......',
    '..Rr.....rR.......',
    '..rR......Rr......',
    '..Rr..............',
    '..rR..............',
    '..Rr........rR....',
    '..rR........Rr....',
    '..Rr........rR....',
    '..rR........Rr....',
    '.grRg......grRg...',
    'g.g..g......g.g.g.',
  ],
};
export const SETPIECE_KINDS = Object.keys(SETPIECE_ROWS);

// ---- surface props (tiny, muted, drawn behind everything that matters) ----

const PROP_ROWS: Record<string, string[]> = {
  prop_tuft: [
    '..g.G..',
    '.gG.g.g',
    '.kg.kgk',
    '..k..k.',
  ],
  prop_tuft2: [
    '.g.G.',
    'gGgg.',
    '.kk.g',
    '..k.k',
  ],
  prop_flower: [
    '.aaa.',
    '.aba.',
    '.aaa.',
    '..k..',
    '.gk..',
    '..kg.',
    '..k..',
  ],
  prop_flower2: [
    '.bb.',
    '.bb.',
    '..k.',
    '.gk.',
    '..k.',
  ],
  prop_pebble: [
    '.rRr..',
    'rRrrr.',
    'rrrKr.',
    '.KKK..',
  ],
  prop_mushroom: [
    '.aaa.',
    'aabaa',
    'aaaaa',
    '..e..',
    '..e..',
    '.ee..',
  ],
};
export const PROP_KINDS = Object.keys(PROP_ROWS);

// Register the full terrain family for one biome. Meadow keeps the classic
// unsuffixed names, so every existing sprite lookup stays valid.
function buildBiomeSet(b: Biome): void {
  const look = BIOME_LOOK[b];
  const sfx = biomeSuffix(b);
  const grassPal = { ...look.earth, ...look.blades };
  const variants: [string, boolean, boolean][] = [
    ['', false, false],
    ['_l', true, false],
    ['_r', false, true],
    ['_lr', true, true],
  ];
  for (const [v, l, r] of variants) {
    makeSprite(`tile_grass${v}${sfx}`, grassPal, l || r ? roundedGrass(GRASS_ROWS, l, r) : GRASS_ROWS);
  }
  makeSprite(`tile_dirt${sfx}`, look.earth, DIRT_ROWS);
  makeSprite(`tile_rock${sfx}`, look.stone, ROCK_ROWS);
  makeSprite(`tile_ramp${sfx}`, grassPal, rampRows());
  makeSprite(`wedge${sfx}`, grassPal, wedgeRows());
  makeSprite(`fringe${sfx}`, look.blades, FRINGE_ROWS);
  if (look.snowcaps) {
    const snowPal = { ...look.earth, ...SNOW_BLADES };
    const base = snowRows(GRASS_ROWS);
    for (const [v, l, r] of variants) {
      makeSprite(`tile_grass_snow${v}${sfx}`, snowPal, l || r ? roundedGrass(base, l, r) : base);
    }
    makeSprite(`wedge_snow${sfx}`, snowPal, wedgeRows());
    makeSprite(`fringe_snow${sfx}`, SNOW_BLADES, FRINGE_ROWS);
  }
  const propPal = {
    g: look.blades.g,
    G: look.blades.G,
    k: look.blades.k,
    a: look.accent,
    b: look.accent2,
    e: look.earth.e,
    r: look.stone.r,
    R: look.stone.R,
    K: look.stone.K,
  };
  for (const [name, rows] of Object.entries(PROP_ROWS)) {
    makeSprite(`${name}${sfx}`, propPal, rows);
  }
  // monuments share the biome's stone, with a little grass creeping up the feet
  const monPal = { r: look.stone.r, R: look.stone.R, k: look.stone.k, K: look.stone.K, g: look.blades.k };
  for (const [name, rows] of Object.entries(SETPIECE_ROWS)) {
    makeSprite(`${name}${sfx}`, monPal, rows);
  }
}

// ---- building composition helpers ----------------------------------------
// Buildings are drawn by stamping features onto a fixed W×H char grid, so every
// row is guaranteed the right width and features sit at exact coordinates
// (hand-typing 32-wide rows drifts). Each stamper takes single-char palette keys.
type Grid = string[][];
function bgrid(w: number, h: number): Grid {
  return Array.from({ length: h }, () => Array(w).fill('.'));
}
function bset(g: Grid, x: number, y: number, ch: string): void {
  if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = ch;
}
function bbox(g: Grid, x0: number, y0: number, x1: number, y1: number, ch: string): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) bset(g, x, y, ch);
}
function brows(g: Grid): string[] {
  return g.map((r) => r.join(''));
}
// A pitched roof between a narrow ridge (y0) and a full-width base (y1): sunlit
// rake edges + ridge, alternating shingle courses (mid/shadow), a dark eave.
function broof(g: Grid, cx: number, y0: number, y1: number, half: number, p: { hi: string; mid: string; sh: string; eave: string }): void {
  const span = y1 - y0 + 1;
  for (let y = y0; y <= y1; y++) {
    const hw = Math.max(1, Math.round((half * (y - y0 + 1)) / span));
    for (let x = cx - hw; x <= cx + hw; x++) {
      let ch = (y - y0) & 1 ? p.sh : p.mid; // shingle courses
      if (y === y1) ch = p.eave; // dark overhang
      if (x === cx - hw || x === cx + hw) ch = p.hi; // sunlit rake
      if (y === y0) ch = p.hi; // bright ridge cap
      bset(g, x, y, ch);
    }
  }
}
// A timber-frame wall: mid fill, lit top plate + left post, shadowed bottom
// plate + right post, and vertical studs.
function bwall(g: Grid, x0: number, y0: number, x1: number, y1: number, p: { W: string; w: string; k: string }): void {
  bbox(g, x0, y0, x1, y1, p.w);
  bbox(g, x0, y0, x1, y0, p.W); // top plate (lit)
  bbox(g, x0, y0, x0, y1, p.W); // left post (lit)
  bbox(g, x1, y0, x1, y1, p.k); // right post (shadow)
  bbox(g, x0, y1, x1, y1, p.k); // bottom plate (shadow)
  for (let x = x0 + 4; x < x1 - 1; x += 5) bbox(g, x, y0 + 1, x, y1 - 1, p.k); // studs
}
// A 4×4 framed window with a corner glint and a sill below.
function bwindow(g: Grid, x: number, y: number, p: { frame: string; glass: string; glint: string; sill: string }): void {
  bbox(g, x, y, x + 3, y + 3, p.frame);
  bbox(g, x + 1, y + 1, x + 2, y + 2, p.glass);
  bset(g, x + 1, y + 1, p.glint);
  bbox(g, x, y + 4, x + 3, y + 4, p.sill);
}
// A recessed, round-topped door.
function bdoor(g: Grid, x0: number, x1: number, y0: number, y1: number, p: { frame: string; door: string; recess: string }): void {
  bbox(g, x0, y0, x1, y1, p.frame);
  bbox(g, x0 + 1, y0 + 1, x1 - 1, y1, p.door);
  bbox(g, x0 + 1, y0 + 1, x1 - 1, y0 + 1, p.recess); // shadowed lintel
  bset(g, x0, y0, '.'); // arch corners
  bset(g, x1, y0, '.');
}
// Stacked stone foundation with offset block seams.
function bfoundation(g: Grid, x0: number, y0: number, x1: number, y1: number, p: { n: string; N: string; m: string }): void {
  bbox(g, x0, y0, x1, y1, p.n);
  bbox(g, x0, y0, x1, y0, p.N); // lit top course
  for (let y = y0; y <= y1; y++) {
    const off = (y - y0) & 1 ? 3 : 0;
    for (let x = x0 + off; x <= x1; x += 6) bset(g, x, y, p.m); // block seams
    bset(g, x1, y, p.m);
  }
}
// A cart wheel: a bright rim, a filled disc, four spokes and a lit hub boss.
// FILLED on purpose. Left open between the spokes it reads as a wire ring at this
// size, and the daylight through it turns the space under the bed into a gap the
// eye takes for stilts — which made the first pass look like a market stall.
// Stamp wheels BEFORE the bed so the bed hides their tops and they cross the
// body line the way a real wheel does.
function bwheel(
  g: Grid,
  cx: number,
  cy: number,
  r: number,
  p: { tyre: string; body: string; spoke: string; hub: string }
): void {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r + 0.4) continue;
      if (d > r - 1.1) bset(g, x, y, p.tyre);
      else if (dx === 0 || dy === 0) bset(g, x, y, p.spoke);
      else bset(g, x, y, p.body);
    }
  }
  bbox(g, cx - 1, cy - 1, cx + 1, cy + 1, p.spoke); // hub boss
  bset(g, cx, cy, p.hub);
}
// A canvas tilt over wagon hoops: shoulders curving in to a flat crown,
// alternating stripes, a sunlit crown line and a shaded hem. The stripes are
// what makes it read as cloth stretched over ribs rather than as a roof.
// Returns the canvas top per column (indexed from x0) so the caller can roll the
// cloth back over the hoops at one end without re-deriving the arch.
function btilt(
  g: Grid,
  x0: number,
  x1: number,
  yTop: number,
  yBot: number,
  p: { A: string; B: string; hi: string; hem: string }
): number[] {
  const cx = (x0 + x1) / 2;
  const half = (x1 - x0) / 2;
  const tops: number[] = [];
  for (let x = x0; x <= x1; x++) {
    const u = (x - cx) / half;
    const top = Math.round(yTop + (1 - Math.sqrt(Math.max(0, 1 - u * u))) * (yBot - yTop) * 0.62);
    const stripe = Math.floor((x - x0) / 3) % 2 === 0 ? p.A : p.B;
    for (let y = top; y <= yBot; y++) bset(g, x, y, stripe);
    bset(g, x, top, p.hi); // crown/shoulder catches the light
    bset(g, x, yBot, p.hem); // hem falls into shadow
    tops.push(top);
  }
  return tops;
}

export function buildAtlas(): void {
  // ---- terrain tiles (16x16), one family per biome ----
  for (const b of BIOMES) buildBiomeSet(b);
  const bedPal = { b: '#3a3f47', B: '#2c3037', k: '#484e58' };
  makeSprite('tile_bedrock', bedPal, [
    'bbbkbbbbBbbbbkbb',
    'bBbbbbkbbbbbbbbB',
    'bbbbBbbbbbkbbbbb',
    'kbbbbbbBbbbbbBbb',
    'bbbkbbbbbbBbbbbb',
    'bbbbbBbbkbbbbkbb',
    'bBbbbbbbbbbBbbbb',
    'bbbbkbbBbbbbbbbk',
    'bbBbbbbbbbkbbbbb',
    'bbbbbbkbbbbbbBbb',
    'kbbbBbbbbBbbbbbb',
    'bbbbbbbbbbbbkbbb',
    'bbkbbbBbbbbbbbbB',
    'bBbbbbbbbkbbBbbb',
    'bbbbkbbbbbbbbbbb',
    'bbbbbbbBbbbkbbbb',
  ]);
  const platPal = { p: '#c89858', P: '#e0b070', k: '#8f6a38', s: '#6f4f28' };
  makeSprite('tile_platform', platPal, [
    'PPpPPPpPPPPpPPPP',
    'pkpkpkpkkpkpkpkp',
    'skkskksskkskkssk',
    '.s..s...s...s...',
    '.s..s...s...s...',
    '.s..s...s...s...',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]);
  const ladPal = { l: '#c89858', L: '#e0b070', k: '#8f6a38' };
  makeSprite('tile_ladder', ladPal, [
    '..Ll........lL..',
    '..Ll........lL..',
    '..LlkkkkkkkklL..',
    '..LlLLLLLLLLlL..',
    '..Ll........lL..',
    '..Ll........lL..',
    '..Ll........lL..',
    '..LlkkkkkkkklL..',
    '..LlLLLLLLLLlL..',
    '..Ll........lL..',
    '..Ll........lL..',
    '..Ll........lL..',
    '..LlkkkkkkkklL..',
    '..LlLLLLLLLLlL..',
    '..Ll........lL..',
    '..Ll........lL..',
  ]);

  // ---- resource nodes ----
  const treePal = {
    t: '#7a4a26', T: '#935c31', g: '#3e8c3e', G: '#54ad4f', L: '#6fc763', k: '#2c6b2f',
  };
  makeSprite('tree', treePal, [
    '......GGGG......',
    '....GGLLLLGG....',
    '...GLLGGLLLLG...',
    '..GLLGGGGLLLLG..',
    '..GLGGkGGGLLGk..',
    '.GLLGGGkGGGLLGk.',
    '.GLGGkGGGGGLGGk.',
    '.GGLGGGkGGGGGkk.',
    '..GGkGGGGkGGkk..',
    '..kGGGkGGGGkk...',
    '...kkGGGkGkk....',
    '.....kTtkk......',
    '......Tt........',
    '......Tt........',
    '......Ttt.......',
    '.....TTttt......',
  ]);
  makeSprite('stump', { t: '#7a4a26', T: '#935c31' }, [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '......Tt........',
    '......Tt........',
    '......Ttt.......',
    '.....TTttt......',
  ]);
  // Arid biomes (chalk dunes, redrock desert) grow palms: a slim curved trunk
  // topped with a crown of drooping fronds and a pair of coconuts. Authored on
  // the same 16x16 grid as the broadleaf and stretched to 16x32 at draw time.
  const palmPal = {
    t: '#7a4a26', T: '#935c31', g: '#3e8c3e', G: '#54ad4f', L: '#6fc763',
    k: '#2c6b2f', c: '#8a5a2b',
  };
  makeSprite('tree_palm', palmPal, [
    '.......L........',
    '...L..LGL..L....',
    '..LGLLGGGLLGL...',
    '.LGGGGGkGGGGGL..',
    'LGGkGGGGGGGkGGL.',
    '..LGGGGkGGGGL...',
    '.....GcTcG......',
    '......Tt........',
    '......tT........',
    '......Tt........',
    '......tT........',
    '......Tt........',
    '......tT........',
    '......Tt........',
    '.....TtTt.......',
    '....TTttttt.....',
  ]);
  // Snow-capped slate highlands grow evergreen pines with snow settled on the
  // upper edge of each tier.
  const pinePal = {
    t: '#6a4a2e', T: '#835a38', g: '#2f6d43', G: '#3d8757', L: '#5aa877',
    k: '#204b30', S: '#eaf2ff',
  };
  makeSprite('tree_pine', pinePal, [
    '.......S........',
    '.......G........',
    '......SGk.......',
    '......GGG.......',
    '.....SGgGk......',
    '.....GGgGG......',
    '....SGgggGk.....',
    '....GGgggGG.....',
    '...SGgggggGk....',
    '...GGgggggGG....',
    '..SGgggggggGk...',
    '..GLgggggggGG...',
    '.SGgggggggggGk..',
    '....GGGtGGG.....',
    '......TtT.......',
    '.....TTttt......',
  ]);
  // The vale grows a low-poly-style broadleaf. Where the classic tree dapples
  // light through the canopy, this one reads as a single rounded mass with a
  // hard lit/shade split — sun from the upper left, sky-blue shade falling to
  // the lower right, matching the light model the biome's terrain shading uses.
  // Same 16x16 grid as the others, stretched to 16x32 at draw time.
  const valeTreePal = {
    t: '#7a4e2e', T: '#a46e44', L: '#aadd81', G: '#81c76b', k: '#488f47',
  };
  makeSprite('tree_vale', valeTreePal, [
    '......LLLL......',
    '....LLLLLLGG....',
    '...LLLLLLLGGGk..',
    '..LLLLLLLLGGGkk.',
    '..LLLLLLLGGGGkk.',
    '.LLLLLLLLGGGGGkk',
    '.LLLLLLLGGGGGGkk',
    '.LLLLLLGGGGGGGkk',
    '..LLLLLGGGGGGkk.',
    '..LLLLGGGGGGkkk.',
    '...LLLGGGGGkkk..',
    '....kkGGGkkk....',
    '......Tt........',
    '......Tt........',
    '......Ttt.......',
    '.....TTttt......',
  ]);
  const boulderPal = { r: '#8d97a8', R: '#aab4c4', k: '#69707d', K: '#525862' };
  makeSprite('boulder', boulderPal, [
    '................',
    '................',
    '................',
    '.....RRRrr......',
    '...RRRrrrrrk....',
    '..RRrrrrKrrrk...',
    '..Rrrrkrrrrrrk..',
    '.RRrrrrrrKrrrk..',
    '.Rrrkrrrrrrrrkk.',
    '.rrrrrrKrrrkrkk.',
    '.rrKrrrrrrrrrkk.',
    '.krrrrrkrrKrkkk.',
    '.kkrKrrrrrrkkkk.',
    '..kkkrrkrkkkkk..',
    '...kkkkkkkkkk...',
    '................',
  ]);
  const veinPal = { r: '#8d97a8', k: '#69707d', i: '#d38b53', I: '#ecab72', K: '#525862' };
  makeSprite('vein', veinPal, [
    '................',
    '................',
    '................',
    '................',
    '.....rrrrr......',
    '...rrrkrrrrk....',
    '..rrIirrrKrrk...',
    '..riIIirrrrrrk..',
    '.rrrIirrrIirrk..',
    '.rrrrrrrIiIrrk..',
    '.rKrrIirrIirkk..',
    '.rrrIiIirrrrkk..',
    '.krrrIirrKrkkk..',
    '..kkrrrkrkkkk...',
    '...kkkkkkkkk....',
    '................',
  ]);

  // ---- items (8x8) ----
  // a log lying on its side: a pale sawn end-ring on the left, bark barrel to
  // the right lit along the top. Reads as "cut wood" at HUD and 6px pip sizes.
  makeSprite('item_log', { k: '#402a14', l: '#7a4e26', L: '#9c6835', e: '#caa06a', E: '#eccb92' }, [
    '........',
    '.kkkkkk.',
    'keeLLLLk',
    'keElllLk',
    'keElllLk',
    'keellllk',
    '.kkkkkk.',
    '........',
  ]);
  // a neat stack of three sawn boards, staggered for depth: each board shows a
  // lit top face (P), a front face (p) and a shadowed end/underside (k).
  makeSprite('item_plank', { p: '#d3a45c', P: '#e8c084', k: '#96703a' }, [
    '..PPPPPP',
    '..pppppk',
    '.PPPPPPk',
    '.pppppk.',
    'PPPPPPk.',
    'pppppk..',
    'kkkkk...',
    '........',
  ]);
  makeSprite('item_stone', { s: '#9aa5b5', S: '#bcc6d4', k: '#6b7482' }, [
    '........',
    '..SSs...',
    '.SSsssk.',
    '.Sssksk.',
    'Sssssssk',
    'sskssssk',
    '.kkkkkk.',
    '........',
  ]);
  makeSprite('item_iron', { i: '#d38b53', I: '#ecab72', k: '#9c5f30' }, [
    '........',
    '..IIik..',
    '.IIiiik.',
    '.Iiikik.',
    '.iiiiik.',
    '.ikiiik.',
    '..kkkk..',
    '........',
  ]);
  makeSprite('item_spear', { s: '#c0c9d6', S: '#e4eaf2', w: '#8a5a2b', k: '#5f3c1b' }, [
    '......Sk',
    '.....SSk',
    '....wSk.',
    '...wk...',
    '..wk....',
    '.wk.....',
    'wk......',
    'k.......',
  ]);
  // shovel: wooden haft up-right, a steel spade blade at the foot
  makeSprite('item_shovel', { w: '#a8743c', k: '#5f3c1b', s: '#8f9aa8', S: '#cdd6e2' }, [
    '.....wk.',
    '.....wk.',
    '....wk..',
    '...wk...',
    '..sssss.',
    '.sSSSSSs',
    '.sSSSSs.',
    '..sss...',
  ]);

  // ---- smallies (10x12, two walk frames + climb + work) ----
  // 'H' = hat (recolored per role at draw time via separate hat sprites)
  const bodyPal = {
    s: '#f2c9a0', S: '#ffdcb8', // skin
    c: '#4a5568', C: '#5d6b82, ', // clothes
    b: '#3b4353', // boots
    e: '#2b2f38', // eyes
  };
  const clothes = { ...bodyPal, C: '#5d6b82' };
  makeSprite('ling_walk_a', clothes, [
    '..ssss....',
    '.sSSSSs...',
    '.sSeSeS...',
    '.sSSSSs...',
    '..CCCC....',
    '.cCCCCc...',
    '.cCCCCc...',
    '..cCCc....',
    '..cc.cc...',
    '..b...b...',
    '..b...b...',
    '.bb...bb..',
  ]);
  makeSprite('ling_walk_b', clothes, [
    '..ssss....',
    '.sSSSSs...',
    '.sSeSeS...',
    '.sSSSSs...',
    '..CCCC....',
    '.cCCCCc...',
    '.cCCCCc...',
    '..cCCc....',
    '...cc.....',
    '..b.b.....',
    '.b...b....',
    'bb...bb...',
  ]);
  makeSprite('ling_climb_a', clothes, [
    '.s.ssss...',
    '.ssSSSSs..',
    '.s.SeSe...',
    '...SSSS...',
    '..CCCC.s..',
    '.cCCCCss..',
    '.cCCCCs...',
    '..cCCc....',
    '..cc.c....',
    '..b..b....',
    '..b.......',
    '.bb..b....',
  ]);
  makeSprite('ling_work', clothes, [
    '..ssss....',
    '.sSSSSs...',
    '.sSeSeS...',
    '.sSSSSs...',
    '..CCCCs...',
    '.cCCCCss..',
    '.cCCCCs...',
    '..cCCc....',
    '..cc.cc...',
    '..b...b...',
    '..b...b...',
    '.bb...bb..',
  ]);
  // hats drawn over the head, one per role color
  const hatShape = (c: string, k: string) => {
    makeSprite(`hat_${c}`, { h: HAT_COLORS[c], k }, [
      '..hhhh....',
      '.hhhhhh...',
      'khhhhhhk..',
    ]);
  };
  const HAT_COLORS: Record<string, string> = {
    hauler: '#5aa2e8',
    builder: '#ffc94d',
    woodcutter: '#6fd66f',
    miner: '#f08a4b',
    digger: '#b07de0',
  };
  for (const role of Object.keys(HAT_COLORS)) hatShape(role, '#00000000');

  // ---- buildings ----
  // Authored at half resolution and drawn scaled 2x to their footprint:
  // townhall/goal 32x24 -> 64x48 (4x3 tiles), sawmill/forge 24x16 -> 48x32 (3x2).
  const thPal = {
    R: '#e0794f', r: '#c1543a', q: '#8f3428', // roof: rake/ridge, courses, eave shadow
    W: '#d8ad72', w: '#bd8c54', k: '#7c5830', // wall: lit, mid, dark posts/studs
    g: '#8fb9d4', G: '#dbeef9', b: '#4a3a28', o: '#2c2114', // glass, glint, frame, recess
    D: '#7a5230', // door planks
    n: '#8f97a3', N: '#b3bcc7', m: '#68707b', // foundation stone
    F: '#ffc94d', p: '#6b4a26', // flag, pole
  };
  const th = bgrid(32, 24);
  bbox(th, 15, 1, 15, 6, 'p'); // flag pole
  bbox(th, 16, 1, 18, 1, 'F');
  bbox(th, 16, 2, 17, 2, 'F');
  broof(th, 15, 5, 11, 15, { hi: 'R', mid: 'r', sh: 'q', eave: 'q' }); // overhanging pyramid roof
  bwall(th, 1, 12, 29, 20, { W: 'W', w: 'w', k: 'k' });
  bwindow(th, 4, 14, { frame: 'b', glass: 'g', glint: 'G', sill: 'o' });
  bwindow(th, 23, 14, { frame: 'b', glass: 'g', glint: 'G', sill: 'o' });
  bdoor(th, 13, 18, 14, 20, { frame: 'b', door: 'D', recess: 'o' });
  bfoundation(th, 1, 21, 29, 23, { n: 'n', N: 'N', m: 'm' });
  makeSprite('townhall', thPal, brows(th));
  const millPal = {
    R: '#c98a52', r: '#a06e3c', q: '#6e4a26', // wood-shingle roof
    W: '#d3a86e', w: '#b98850', k: '#7c5830',
    g: '#8fb9d4', G: '#dbeef9', b: '#4a3a28', o: '#2c2114',
    D: '#7a5230',
    n: '#8f97a3', N: '#b3bcc7', m: '#68707b',
    s: '#c2ccd8', S: '#e2e8ef', t: '#5c6470', // saw blade steel / hub / teeth
  };
  const mill = bgrid(24, 16);
  broof(mill, 11, 0, 4, 11, { hi: 'R', mid: 'r', sh: 'q', eave: 'q' });
  bwall(mill, 1, 5, 22, 12, { W: 'W', w: 'w', k: 'k' });
  bwindow(mill, 3, 7, { frame: 'b', glass: 'g', glint: 'G', sill: 'o' });
  bdoor(mill, 9, 13, 7, 12, { frame: 'b', door: 'D', recess: 'o' });
  bfoundation(mill, 1, 13, 22, 14, { n: 'n', N: 'N', m: 'm' });
  bbox(mill, 18, 7, 20, 9, 's'); // saw blade disc
  bset(mill, 19, 8, 'S');
  bset(mill, 19, 6, 't'); bset(mill, 19, 10, 't'); bset(mill, 17, 8, 't'); bset(mill, 21, 8, 't');
  makeSprite('sawmill', millPal, brows(mill));
  const forgePal = {
    R: '#6b7480', r: '#4c545f', q: '#333a44', // dark slate roof
    W: '#a5b0c2', w: '#8a94a6', k: '#5c6470', // stone-grey wall
    g: '#8fb9d4', G: '#dbeef9', b: '#2f333b', o: '#1c2027',
    D: '#454b55', // iron door
    n: '#6b7480', N: '#8a94a6', m: '#454b55',
    f: '#ff8c42', F: '#ffd27a', // forge fire
  };
  const forge = bgrid(24, 16);
  broof(forge, 10, 1, 4, 9, { hi: 'R', mid: 'r', sh: 'q', eave: 'q' });
  bbox(forge, 18, 0, 20, 4, 'k'); // chimney stack (rises through the roof)
  bbox(forge, 18, 0, 20, 0, 'q');
  bset(forge, 19, 0, 'f'); // ember at the flue
  bwall(forge, 1, 5, 22, 12, { W: 'W', w: 'w', k: 'k' });
  bwindow(forge, 4, 8, { frame: 'b', glass: 'f', glint: 'F', sill: 'o' }); // glowing forge mouth
  bdoor(forge, 10, 14, 7, 12, { frame: 'b', door: 'D', recess: 'o' });
  bfoundation(forge, 1, 13, 22, 14, { n: 'n', N: 'N', m: 'm' });
  makeSprite('forge', forgePal, brows(forge));
  // workshop: a carpenter's shed — mossy plank roof, a tool (shovel) mounted on
  // the wall to read as "where shovels are made". 3x2 footprint like the sawmill.
  const workshopPal = {
    R: '#8fae5f', r: '#6e8c47', q: '#4c6431', // mossy green plank roof
    W: '#d3a86e', w: '#b98850', k: '#7c5830',
    g: '#8fb9d4', G: '#dbeef9', b: '#4a3a28', o: '#2c2114',
    D: '#7a5230',
    n: '#8f97a3', N: '#b3bcc7', m: '#68707b',
    i: '#9aa5b5', I: '#cdd6e2', s: '#7c5830', // mounted shovel
  };
  const ws = bgrid(24, 16);
  broof(ws, 11, 0, 4, 11, { hi: 'R', mid: 'r', sh: 'q', eave: 'q' });
  bwall(ws, 1, 5, 22, 12, { W: 'W', w: 'w', k: 'k' });
  bwindow(ws, 3, 7, { frame: 'b', glass: 'g', glint: 'G', sill: 'o' });
  bdoor(ws, 9, 13, 7, 12, { frame: 'b', door: 'D', recess: 'o' });
  bfoundation(ws, 1, 13, 22, 14, { n: 'n', N: 'N', m: 'm' });
  bbox(ws, 18, 6, 18, 9, 's'); // shovel haft
  bbox(ws, 17, 9, 19, 10, 'i'); // blade
  bset(ws, 18, 10, 'I');
  makeSprite('workshop', workshopPal, brows(ws));
  // The delivery goal is the trade caravan (card #71) — the order sheet is not
  // handed to a temple, it is loaded onto a wagon that then rolls out. Two
  // sprites rather than one, on the same 4x3 footprint grid so they line up for
  // free: the DOCK stays put and keeps marking the delivery station while the
  // wagon is away on a `convoy` level, and the WAGON is what slides off it. The
  // wagon keeps the name `goal`, so the editor palette icon shows the wagon.
  const caravanPal = {
    C: '#f6ead0', R: '#c8503c', r: '#a33c2c', // canvas: cream stripe / red stripe / shaded red
    H: '#fff8e6', o: '#6d5636', // sunlit crown / hem shadow and tilt interior
    W: '#c08f56', w: '#a4753e', k: '#6b4a26', // wagon planks: lit / mid / dark
    b: '#4f3418', // ironwork, hoops, draw bar
    S: '#a4753e', u: '#f0dcbe', // wheel rim and spokes / hub glint
    F: '#ffd94d', // bow pennant
    n: '#a89474', N: '#c8b28a', m: '#7a6848', // kerb stone, chalked order board
  };
  const wagon = bgrid(32, 24);
  // Rows 0-1 stay clear: the bunting is drawn live over the sprite
  // (drawCaravanFlags) so it can wave.
  const tops = btilt(wagon, 5, 26, 2, 12, { A: 'C', B: 'R', hi: 'H', hem: 'o' }); // striped canvas over the hoops
  // The rear of the tilt has the canvas rolled back: bare hoops over a dark
  // interior, so the crates standing inside are visible and the dock's loading
  // ramp leads into something. Keeps the arch silhouette — only the cloth is
  // missing. Kept to a third of the span; wider, the stripes stop reading as a
  // caravan tilt at all.
  for (let x = 5; x <= 11; x++) {
    const top = tops[x - 5];
    bbox(wagon, x, top + 1, x, 12, 'o');
    bset(wagon, x, top, 'b'); // the rolled cloth's shadow line along the rim
  }
  for (const x of [5, 8, 11]) bbox(wagon, x, tops[x - 5], x, 12, 'b'); // three bare hoops
  // A light rim over the darkest disc on the wagon, under the LIGHTEST part of
  // the body: a wheel toned like its undercarriage merges into one brown mass,
  // and a grey iron tyre — the obvious choice — merges with the rock behind it.
  bwheel(wagon, 10, 18, 5, { tyre: 'S', body: 'b', spoke: 'w', hub: 'u' }); // rear wheel (big)
  bwheel(wagon, 24, 19, 4, { tyre: 'S', body: 'b', spoke: 'w', hub: 'u' }); // front wheel (small)
  bbox(wagon, 3, 12, 28, 15, 'w'); // wagon bed — the wheels cross its lower rows
  bbox(wagon, 3, 12, 28, 12, 'W'); // lit top rail
  bbox(wagon, 3, 15, 28, 15, 'b'); // iron-shod bottom rail
  for (let x = 6; x < 28; x += 5) bset(wagon, x, 13, 'k'); // plank seams
  // Boat-shaped belly under the bed, then the reach beam between the axles. Both
  // are here to close the daylight between the wheels: left open, the eye reads
  // the two wheels as legs and the whole wagon as a stall on stilts.
  bbox(wagon, 5, 16, 26, 17, 'W');
  bbox(wagon, 8, 17, 23, 17, 'w'); // the belly tapers as it goes down...
  bbox(wagon, 13, 18, 21, 18, 'w');
  bbox(wagon, 13, 19, 21, 19, 'k');
  bbox(wagon, 5, 16, 5, 17, 'b'); // ...between shadowed end posts
  bbox(wagon, 26, 16, 26, 17, 'b');
  bbox(wagon, 27, 9, 29, 11, 'k'); // driver's bench back
  bbox(wagon, 26, 11, 29, 11, 'W'); // bench plank
  bbox(wagon, 29, 13, 31, 14, 'b'); // draw bar out to the yoke — it faces the road
  bbox(wagon, 31, 11, 31, 13, 'b');
  bbox(wagon, 30, 4, 30, 11, 'b'); // bow pennant staff (the static one — it is the palette icon)
  bbox(wagon, 27, 4, 29, 4, 'F');
  bbox(wagon, 28, 5, 29, 5, 'F');
  bset(wagon, 29, 6, 'r');
  makeSprite('goal', caravanPal, brows(wagon));
  // The dock: the order board on its post, a kerb of flagstones the wheels stand
  // on, and the lashing post. This is the half that must still read as "deliver
  // here" with no wagon on it, so it is where the station's furniture lives —
  // and it is deliberately NOT a full-width deck, which only flattens the wagon.
  const dock = bgrid(32, 24);
  // The order board rides ABOVE the wagon's rear, not beside it: level with the
  // load it reads as one more crate in the pile.
  bbox(dock, 0, 2, 5, 8, 'k'); // order board frame
  bbox(dock, 1, 3, 4, 7, 'N'); // a chalked slate, not parchment — the canvas is already cream
  bbox(dock, 2, 4, 3, 4, 'r'); // ...with two lines of writing on it
  bbox(dock, 2, 6, 3, 6, 'm');
  bbox(dock, 2, 8, 3, 23, 'k'); // board post, down to the ground
  bbox(dock, 2, 8, 2, 23, 'w');
  bbox(dock, 27, 17, 28, 23, 'k'); // lashing post at the head of the wagon
  bbox(dock, 27, 17, 27, 23, 'w');
  // The loading ramp is dock furniture, NOT the wagon's tailgate. Hung off the
  // wagon it rolled away with it and read as a flight of steps floating in the
  // air; bolted to the dock it goes on saying "carry it up here".
  bbox(dock, 4, 16, 6, 17, 'W');
  bbox(dock, 2, 18, 5, 19, 'W');
  bbox(dock, 0, 20, 3, 21, 'w');
  bfoundation(dock, 0, 22, 31, 23, { n: 'n', N: 'N', m: 'm' }); // flagstone kerb
  for (const x of [8, 14, 20]) bset(dock, x, 22, 'm'); // wheel ruts worn into it
  makeSprite('goal_dock', caravanPal, brows(dock));
  // A lashed crate, drawn per delivered slice of the order sheet (crateLoad).
  // Kept to a lid seam and a rim: at the ~7px it is drawn, anything finer (an X
  // brace, individual slats) turns to mush.
  makeSprite('crate', { C: '#d8a86a', H: '#eec48c', k: '#6b4a26' }, [
    'kkkkkkkk',
    'kHHHHHCk',
    'kCCCCCCk',
    'kkkkkkkk',
    'kCCCCCCk',
    'kCCCCCCk',
    'kCCCCCCk',
    'kkkkkkkk',
  ]);
  // lift mast segment + car
  makeSprite('lift_mast', { m: '#7c5830', M: '#9a7040', k: '#5f3c1b' }, [
    'Mk............Mk',
    'Mk............Mk',
    'MkkkkkkkkkkkkkMk',
    'MkMMMMMMMMMMMMMk',
    'Mk............Mk',
    'Mk............Mk',
    'Mk............Mk',
    'MkkkkkkkkkkkkkMk',
    'MkMMMMMMMMMMMMMk',
    'Mk............Mk',
    'Mk............Mk',
    'Mk............Mk',
    'MkkkkkkkkkkkkkMk',
    'MkMMMMMMMMMMMMMk',
    'Mk............Mk',
    'Mk............Mk',
  ]);
  makeSprite('lift_car', { c: '#c89858', C: '#e0b070', k: '#8f6a38', m: '#454b55' }, [
    'm..............m',
    'm..............m',
    'm..............m',
    'm..............m',
    'm..............m',
    'm..............m',
    'm..............m',
    'm..............m',
    'm..............m',
    'm..............m',
    'CCCCCCCCCCCCCCCC',
    'ckckckckckckckck',
    '.kk..........kk.',
    '................',
    '................',
    '................',
  ]);
  makeSprite('lift_top', { c: '#7c5830', C: '#9a7040', k: '#5f3c1b', w: '#c89858' }, [
    '.kCCCCCCCCCCCCk.',
    '.kCwwwwwwwwwwCk.',
    '..k..........k..',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]);

  // rope anchor post (with a coiled spare rope at its side)
  makeSprite('rope_anchor', { p: '#7c5830', P: '#9a7040', k: '#5f3c1b', r: '#d8b271', R: '#c09a55' }, [
    '................',
    '................',
    '...kk...........',
    '..kPPk..........',
    '..kPpk..........',
    '..kPpk...rRr....',
    '..kPpk..rR.Rr...',
    '..kPpk..rR.Rr...',
    '..kPpk..rR.Rr...',
    '..kPpk...rRr....',
    '..kPpk..........',
    '..kPpk..........',
    '.kPPppk.........',
    'kPPPpppk........',
    'kkkkkkkk........',
    '................',
  ]);

  // counterweight hoist: a wooden post whose arm carries the pulley wheel out
  // over the cliff edge (art faces right; the renderer mirrors for side = -1)
  makeSprite('hoist_post', { p: '#7c5830', P: '#9a7040', k: '#5f3c1b', w: '#454b55', W: '#98a2b3', r: '#d8b271' }, [
    '..........kkk...',
    '.........kWWWk..',
    '..kkkkkkkkWwWk..',
    '..kPPPPPPkWwWk..',
    '..kPpk...kWWWk..',
    '..kPpk....kkk...',
    '..kPpk....r.....',
    '..kPpk....r.....',
    '..kPpk..........',
    '..kPpk..........',
    '..kPpk..........',
    '..kPpk..........',
    '.kPPppk.........',
    'kPPPpppk........',
    'kkkkkkkk........',
    '................',
  ]);
  // hoist car: an open cargo basket on a rope bridle
  makeSprite('hoist_car', { c: '#c89858', C: '#e0b070', k: '#8f6a38', r: '#d8b271' }, [
    '.......r........',
    '......rrr.......',
    '.....r...r......',
    '....r.....r.....',
    '...kC.....Ck....',
    '...kc.....ck....',
    '...kc.....ck....',
    '...kCCCCCCCk....',
    '...kkkkkkkkk....',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
  ]);

  // lantern post: iron cap, warm glass, wooden pole on a stone base
  makeSprite('lantern', { k: '#3a3f47', y: '#ffd94d', Y: '#fff3c0', o: '#f0a92e', p: '#7c5830', P: '#9a7040', s: '#98a2b3', S: '#7b8494' }, [
    '.......k........',
    '......kkk.......',
    '.....k...k......',
    '....kyYYyk......',
    '....kyYYyk......',
    '....koyyok......',
    '.....kkkk.......',
    '......Pp........',
    '......Pp........',
    '......Pp........',
    '......Pp........',
    '......Pp........',
    '......Pp........',
    '.....PPpp.......',
    '...sSssSss......',
    '..sssSssSss.....',
  ]);

  // medals: ribbon + disc with the amber ember of the Ember Road on every tier
  const medalRows = [
    '..rr........rr..',
    '..rRr......rRr..',
    '...rRr....rRr...',
    '...rRRr..rRRr...',
    '....rRRrrRRr....',
    '.....kkkkkk.....',
    '...kkGGGGGGkk...',
    '..kGGGGffGGGGk..',
    '.kGGGGfffFGGGGk.',
    '.kGGGGffFFGGGGk.',
    '.kGGGgfFFfgGGGk.',
    '.kGGGGgffgGGGGk.',
    '..kGGggggggGGk..',
    '...kGgggggggk...',
    '....kkggggkk....',
    '......kkkk......',
  ];
  const ember = { f: '#ffe094', F: '#ff8a3d' };
  makeSprite('medal_gold', { k: '#a06f14', G: '#ffd76e', g: '#f0a92e', r: '#a03028', R: '#e0554a', ...ember }, medalRows);
  makeSprite('medal_silver', { k: '#6d7a90', G: '#dfe7f2', g: '#aebccf', r: '#37699c', R: '#5aa2e8', ...ember }, medalRows);
  makeSprite('medal_bronze', { k: '#7a4a22', G: '#e0a06a', g: '#b87840', r: '#3f8f43', R: '#6fd66f', ...ember }, medalRows);

  // feat pin: a shield with a star
  makeSprite('pin_feat', { k: '#a06f14', S: '#5aa2e8', w: '#ffd76e' }, [
    '.kkkkkkkkkk.',
    'kSSSSSSSSSSk',
    'kSSSSwwSSSSk',
    'kSSSwwwwSSSk',
    'kSwwwwwwwwSk',
    'kSSwwwwwwSSk',
    'kSSSwwwwSSSk',
    'kSSwwSSwwSSk',
    '.kSSSSSSSSk.',
    '..kSSSSSSk..',
    '...kSSSSk...',
    '....kkkk....',
  ]);

  // crate for the town hall stockpile
  makeSprite('crate', { c: '#b98850', C: '#d3a86e', k: '#7c5830' }, [
    'kkkkkkkk',
    'kCCCCCCk',
    'kCkcckCk',
    'kCckkcCk',
    'kCckkcCk',
    'kCkcckCk',
    'kCCCCCCk',
    'kkkkkkkk',
  ]);

  // harvest mark flag
  makeSprite('mark', { f: '#ffc94d', F: '#ffe094', p: '#5f3c1b' }, [
    'p.......',
    'pFFf....',
    'pFff....',
    'pf......',
    'p.......',
    'p.......',
  ]);

  // stranded-goods warning glyph: amber disc with a crisp white exclamation
  // mark — short stem (rows2-3), a 1-row gap (row4), then the dot (row5),
  // both 2px wide and centered on the 8-wide disc (cols3-4).
  makeSprite('warn', { a: '#ff9d2e', A: '#ffc061', k: '#5a2f06', w: '#fff4e0' }, [
    '..AAAA..',
    '.AaaaaA.',
    'AaawwaaA',
    'Aaawwaak',
    'Aaaaaaak',
    'Aaawwaak',
    '.Aaaa.Ak',
    '..kkkk..',
  ]);

  // tool icons for the toolbar (14x14)
  makeSprite('icon_select', { w: '#e8eef7', k: '#9db0c9' }, [
    'w.............',
    'ww............',
    'www...........',
    'wwww..........',
    'wwwww.........',
    'wwwwww........',
    'wwwwwww.......',
    'wwwwwwww......',
    'wwwwk.........',
    'wwk.wk........',
    'wk..wk........',
    'k....wk.......',
    '.....wk.......',
    '......k.......',
  ]);
  makeSprite('icon_harvest', { f: '#ffc94d', F: '#ffe094', p: '#8a5a2b' }, [
    '..pp..........',
    '..ppFFFFFF....',
    '..ppFFFfff....',
    '..ppFFffff....',
    '..ppFfff......',
    '..pp..........',
    '..pp..........',
    '..pp..........',
    '..pp..........',
    '..pp..........',
    '..pp..........',
    '..pp..........',
    '..pp..........',
    '..pp..........',
  ]);
  // dig tool: a pickaxe — curved steel head over a wooden haft
  makeSprite('icon_dig', { i: '#8f9aa8', I: '#cdd6e2', k: '#7c5830' }, [
    '.i..........i.',
    '.iIi......iIi.',
    '..iIIiiiiIIi..',
    '...iIIIIIIi...',
    '.....kk.......',
    '.....kk.......',
    '.....kk.......',
    '.....kk.......',
    '.....kk.......',
    '.....kk.......',
    '.....kk.......',
    '.....kk.......',
    '....kkkk......',
    '..............',
  ]);
  makeSprite('icon_demolish', { r: '#ff7a6b', R: '#ffa79c', k: '#b34a3e' }, [
    'RR..........RR',
    'RRR........RRR',
    '.RRR......RRR.',
    '..RRR....RRR..',
    '...RRR..RRR...',
    '....RRRRRR....',
    '.....RRRR.....',
    '.....RRRR.....',
    '....RRRRRR....',
    '...RRR..RRR...',
    '..RRR....RRR..',
    '.RRR......RRR.',
    'RRR........RRR',
    'RR..........RR',
  ]);

  // map pin: the universal "here it is" marker — a teardrop with a light hole,
  // worn by the keep popover's find-on-map button (card #68)
  makeSprite('icon_pin', { p: '#b33f31', P: '#ff7a6b', d: '#ffe6de' }, [
    '.....pppp.....',
    '...ppPPPPpp...',
    '..pPPPPPPPPp..',
    '..pPPddddPPp..',
    '..pPPddddPPp..',
    '..pPPddddPPp..',
    '..pPPPPPPPPp..',
    '...pPPPPPPp...',
    '....pPPPPp....',
    '.....pPPp.....',
    '.....pPPp.....',
    '......pp......',
    '..............',
    '..............',
  ]);

  // living-world icons for the front-door "world that fights back" band ------
  // crescent moon: the turning day. Cool silver disc with a shaded terminator
  // (c) carving the crescent out of the right side.
  makeSprite('moon', { m: '#e8eefc', M: '#b9c6e0', c: '#8b99b6' }, [
    '.....mmmm.....',
    '...mmMMMMm....',
    '..mMMMMc......',
    '..mMMMc.......',
    '.mMMMM........',
    '.mMMMc........',
    '.mMMMM........',
    '.mMMMM........',
    '.mMMMc........',
    '.mMMMM........',
    '..mMMMc.......',
    '..mMMMMc......',
    '...mmMMMMm....',
    '.....mmmm.....',
  ]);
  // storm: a dark cloud, a gold bolt, and blue rain streaks.
  makeSprite('storm', { c: '#aab6ce', C: '#7d8aa6', y: '#ffd94d', r: '#7fb2ec' }, [
    '....ccccc.....',
    '..ccCCCCCcc...',
    '.cCCCCCCCCCc..',
    'cCCCCCCCCCCCc.',
    '.CCCCCCCCCCC..',
    '..CCCCCCCCC...',
    '..r...yy...r..',
    '.r...yy...r...',
    '..r.yy....r...',
    '.r.yyyyy..r...',
    '..r...yy..r...',
    '.r...yy...r...',
    '..r.yy....r...',
    '.r........r...',
  ]);
  // wave: the rising tide — stacked bands of water topped with foam crests.
  makeSprite('wave', { f: '#e8f4ff', w: '#7fb2ec', W: '#3f7fc8' }, [
    '..............',
    '...ff....ff...',
    '..fWWf..fWWf..',
    '.fWWWWffWWWWf.',
    '.WWWWWWWWWWWW.',
    '.wWWWWWWWWWWw.',
    '..ff...ff...f.',
    '.fWWWfWWWfWWWf',
    'WWWWWWWWWWWWWW',
    'wWWWWWWWWWWWWw',
    '..f...ff...f..',
    '.fWWWfWWWfWWWf',
    'WWWWWWWWWWWWWW',
    'wwwwwwwwwwwwww',
  ]);
}

// Convenience: draw a sprite scaled to fit a square HUD canvas.
export function drawIconTo(canvas: HTMLCanvasElement, name: string, size = 16): void {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const s = sprite(name);
  const scale = Math.min(size / s.w, size / s.h);
  const dw = s.w * scale;
  const dh = s.h * scale;
  ctx.drawImage(s.canvas, (size - dw) / 2, (size - dh) / 2, dw, dh);
}
