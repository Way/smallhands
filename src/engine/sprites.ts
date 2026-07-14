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
// Chars: g/G/k grass blades (mid/light/dark), d/D/e dirt (mid/dark/light),
// r/R/k/K rock. Palettes come from BIOME_LOOK, so one map = five biomes.

const GRASS_ROWS = [
  'GgGGgGgGGgGGgGGg',
  'gkGgkgGkgGgkGgkg',
  'dedddeddddededdd',
  'ddddDdddeddddDdd',
  'dDddddDdddddeddd',
  'dddedddddDdddddD',
  'ddDdddedddddDddd',
  'ddddddddDedddddd',
  'dedddDddddddedDd',
  'dddDddddedDddddd',
  'Dddddedddddddded',
  'ddddDdddDddddddd',
  'ddeddddddddeDddd',
  'dDdddedDdddddddd',
  'ddddDddddddDdedd',
  'dddddddDeddddddd',
];

const DIRT_ROWS = [
  'ddddDdddeddddDdd',
  'dDddddDdddddeddd',
  'dddedddddDdddddD',
  'ddDdddedddddDddd',
  'ddddddddDeddddde',
  'dedddDddddddedDd',
  'dddDddddedDddddd',
  'DdddDedddddddded',
  'ddddDdddDddddddd',
  'ddeddddddddeDddd',
  'dDdddedDdddddddd',
  'ddddDddddddDdedd',
  'dddddddDeddddddd',
  'dedDddddddDddddd',
  'ddddddeddddddDdd',
  'dDdddddddedddddd',
];

const ROCK_ROWS = [
  'rrRrrrkrrrrRrrrr',
  'rRrrrrrrkrrrrrkr',
  'rrrkrrrRrrrkrrrr',
  'krrrrKrrrrrrrRrr',
  'rrrRrrrrrkrrrrrr',
  'rrrrrkrrrrrKrrrk',
  'rKrrrrrrRrrrrrrr',
  'rrrrRrrrrrrkrrRr',
  'rrkrrrrKrrrrrrrr',
  'Rrrrrkrrrrrrkrrr',
  'rrrrrrrRrrKrrrrR',
  'rrKrrrrrrrrrrkrr',
  'rrrrkrRrrrrrrrrr',
  'krrrrrrrrkrRrrrr',
  'rrrRrrrKrrrrrrkr',
  'rrrrrrrrrrrkrrrr',
];

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
  'gG....',
  'kgg...',
  '.kg...',
  '.kk...',
  '..k...',
  '..k...',
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
  makeSprite('item_log', { l: '#8a5a2b', L: '#a8743c', k: '#5f3c1b' }, [
    '........',
    '.kllllk.',
    'kLLLLLlk',
    'lLkllkLl',
    'lLlkklll',
    'kLLLLLlk',
    '.kllllk.',
    '........',
  ]);
  makeSprite('item_plank', { p: '#d3a45c', P: '#e8c084', k: '#96703a' }, [
    '........',
    '......Pk',
    '....PPpk',
    '..PPppk.',
    'PPppkk..',
    'Pppk....',
    'ppk.....',
    'kk......',
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
  };
  for (const role of Object.keys(HAT_COLORS)) hatShape(role, '#00000000');

  // ---- buildings ----
  // Authored at half resolution and drawn scaled 2x to their footprint:
  // townhall/goal 32x24 -> 64x48 (4x3 tiles), sawmill/forge 24x16 -> 48x32 (3x2).
  const thPal = {
    w: '#b98850', W: '#d3a86e', k: '#7c5830', r: '#b8503c', R: '#d4694f', d: '#5f3c1b',
    F: '#ffc94d', s: '#cfe3f5', p: '#6b4a26',
  };
  makeSprite('townhall', thPal, [
    '...............p................',
    '...............pFFFF............',
    '...............pFFF.............',
    '...............pF...............',
    '...............p................',
    '..........RRRRRRRRRRR...........',
    '........RRrrrrrrrrrrrRR.........',
    '......RRrrrrrrrrrrrrrrrRR.......',
    '....RRrrrrrrrrrrrrrrrrrrrRR.....',
    '..RRrrrrrrrrrrrrrrrrrrrrrrrRR...',
    '.RRrrrrrrrrrrrrrrrrrrrrrrrrrRR..',
    '.WWWWWWWWWWWWWWWWWWWWWWWWWWWWW..',
    '.WwwkwwwkwwwWwwwkwwwkwwwWwwkwW..',
    '.WwsswwwwwwwwwwwwwwwwwwwwwsswW..',
    '.WwsswwkwwwwwwwddddwwwwkwwsswW..',
    '.WwwwwwwwwwwwwwddddwwwwwwwwwwW..',
    '.WkwwwWwwkwwwwwddddwwwwwWwwwkW..',
    '.WwwwwwwwwwwwwwddddwwwwwwwwwwW..',
    '.WwwkwwwwwWwwwwddddwwwWwwwkwwW..',
    '.WwwwwwkwwwwwwwddddwwwwwwwwwwW..',
    '.WWWWWWWWWWWWWWWWWWWWWWWWWWWWW..',
    '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
    '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
    '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
  ]);
  const millPal = {
    w: '#b98850', W: '#d3a86e', k: '#7c5830', r: '#8a94a6', R: '#a5b0c2', d: '#5f3c1b', s: '#e0b070', b: '#6b7482',
  };
  makeSprite('sawmill', millPal, [
    '......RRRRRRRRRR........',
    '....RRrrrrrrrrrrRR......',
    '..RRrrrrrrrrrrrrrrRR....',
    '.RRrrrrrrrrrrrrrrrrRR...',
    '.WWWWWWWWWWWWWWWWWWWW...',
    '.WwkwwwkwwwWwwwkwwkwW...',
    '.WwwwwwwwwwwwwwwwwwwW.b.',
    '.Wwsswwwwwddddwwwwsswbbb',
    '.Wwsswwkwwddddwwkwssbbbb',
    '.WwwwwwwwwddddwwwwwwWbbb',
    '.WkwwwWwwwddddwwwwwkW.b.',
    '.WwwwwwwwwddddwwWwwwW...',
    '.WWWWWWWWWWWWWWWWWWWW...',
    '.kkkkkkkkkkkkkkkkkkkk...',
    '.kkkkkkkkkkkkkkkkkkkk...',
    '........................',
  ]);
  const forgePal = {
    w: '#8a94a6', W: '#a5b0c2', k: '#5c6470', r: '#454b55', d: '#2f333b', f: '#ff8c42', F: '#ffb26b',
  };
  makeSprite('forge', forgePal, [
    '.....rrr......F.........',
    '.....rrr......Ff........',
    '...rrrrrrr....ff........',
    '..rrrrrrrrr...rr........',
    '.WWWWWWWWWWWWWWWWWWWW...',
    '.WwkwwwkwwwWwwrrwwkwW...',
    '.WwwwwwwwwwwwwrrwwwwW...',
    '.WwFFwwwwwddddwwwwwwW...',
    '.WwffwwkwwddddwwkwwkW...',
    '.WwffwwwwwddddwwwwwwW...',
    '.WkffwWwwwddddwwwwwkW...',
    '.WwffwwwwwddddwwWwwwW...',
    '.WWWWWWWWWWWWWWWWWWWW...',
    '.kkkkkkkkkkkkkkkkkkkk...',
    '.kkkkkkkkkkkkkkkkkkkk...',
    '........................',
  ]);
  const goalPal = {
    s: '#c8b28a', S: '#e0cda6', k: '#93815f', b: '#8a5aa8', B: '#a878c8', d: '#5f4a2b', p: '#6b4a26',
  };
  makeSprite('goal', goalPal, [
    '..............p.................',
    '..............pBBBB.............',
    '..............pBBB..............',
    '..............pB................',
    '..............p.................',
    '.........SSSSSSSSSSSS...........',
    '........SssssssssssssS..........',
    '.......SsskssssksssssS..........',
    '......SsssssssssssskssS.........',
    '.....SSSSSSSSSSSSSSSSSSS........',
    '....SssksssssksssssksssS........',
    '....SsssssssssssssssssssS.......',
    '...SSSSSSSSSSSSSSSSSSSSSSS......',
    '...SsssksssssdddddssssksssS.....',
    '..SssssssssssdddddsssssssssS....',
    '..SskssssskssdddddsskssssksS....',
    '..SssssssssssdddddssssssssssS...',
    '.SsssskssssssdddddssssskssssS...',
    '.SsssssssskssdddddsssssssssssS..',
    '.SsskssssssssdddddsskssssskssS..',
    '.SSSSSSSSSSSSSSSSSSSSSSSSSSSSS..',
    '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
    '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
    '.kkkkkkkkkkkkkkkkkkkkkkkkkkkkk..',
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
