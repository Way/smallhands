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
  makeSprite('tile_ramp', platPal, [
    '...............P',
    '..............PP',
    '.............Ppp',
    '............Ppkp',
    '...........Ppksk',
    '..........Ppksk.',
    '.........Ppkskk.',
    '........Ppkskks.',
    '.......Ppkskkskk',
    '......Ppkskkskks',
    '.....Ppkskkskksk',
    '....Ppkskkskkskk',
    '...Ppkskkskkskks',
    '..Ppkskkskkskksk',
    '.Ppkskkskkskkskk',
    'Ppkskkskkskkskks',
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

  // ---- smallhands (10x12, two walk frames + climb + work) ----
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
  const goalPal = {
    R: '#e0cda6', r: '#c8b28a', q: '#93815f', // sandstone pediment roof
    W: '#e0cda6', w: '#c8b28a', k: '#93815f', // sandstone wall / columns
    g: '#c9a6ec', G: '#eaddfb', b: '#5f4a2b', o: '#3f3018', // portal glow, frame, recess
    D: '#8a5aa8', v: '#a878c8', B: '#c8a0e0', // portal fill, banner mid / light
    n: '#a89474', N: '#c8b28a', m: '#7a6848',
    p: '#6b4a26',
  };
  const goal = bgrid(32, 24);
  bbox(goal, 15, 1, 15, 5, 'p'); // banner pole
  bbox(goal, 16, 1, 19, 1, 'B');
  bbox(goal, 16, 2, 18, 2, 'v');
  bbox(goal, 16, 3, 17, 3, 'v');
  broof(goal, 15, 5, 11, 15, { hi: 'R', mid: 'r', sh: 'q', eave: 'q' });
  bwall(goal, 1, 12, 29, 20, { W: 'W', w: 'w', k: 'k' });
  bwindow(goal, 4, 14, { frame: 'b', glass: 'g', glint: 'G', sill: 'o' });
  bwindow(goal, 23, 14, { frame: 'b', glass: 'g', glint: 'G', sill: 'o' });
  bdoor(goal, 12, 18, 13, 20, { frame: 'b', door: 'D', recess: 'g' }); // glowing delivery portal
  bset(goal, 15, 16, 'G');
  bfoundation(goal, 1, 21, 29, 23, { n: 'n', N: 'N', m: 'm' });
  makeSprite('goal', goalPal, brows(goal));
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
