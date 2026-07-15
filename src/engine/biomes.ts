// Biome looks: palette + atmosphere data for the terrain tile family.
// A biome is pure presentation — tile semantics, movement and the puzzle
// grammar are identical everywhere. Campaign levels and the editor default to
// 'meadow' (the classic look); the generator picks a biome from its seed.

export type Biome = 'meadow' | 'autumn' | 'chalk' | 'redrock' | 'slate';
export const BIOMES: readonly Biome[] = ['meadow', 'autumn', 'chalk', 'redrock', 'slate'];

type Tint = [number, number, number];

export interface BiomeLook {
  blades: { g: string; G: string; k: string }; // grass surface (mid / light / dark)
  earth: { d: string; D: string; e: string }; // dirt body (mid / dark / light)
  stone: { r: string; R: string; k: string; K: string }; // rock body
  accent: string; // flower petals, mushroom caps
  accent2: string; // secondary blossom / highlight
  hillTint: Tint; // parallax hills are mixed toward this…
  hillTintAmt: number; // …by this amount (0 = weather look untouched)
  skyTint: Tint;
  skyTintAmt: number;
  snowcaps: boolean; // high ground above the level's snowline turns white
}

// Snow surface shared by every snow-capped biome.
export const SNOW_BLADES = { g: '#dfe8f4', G: '#f6f9ff', k: '#b6c4d8' };

export const BIOME_LOOK: Record<Biome, BiomeLook> = {
  // the classic Smallhands look — palettes carried over verbatim
  meadow: {
    blades: { g: '#5cb14e', G: '#7ccb62', k: '#3f7a36' },
    earth: { d: '#8a5a35', D: '#6f4629', e: '#a4713f' },
    stone: { r: '#7b8494', R: '#98a2b3', k: '#5c6470', K: '#454b55' },
    accent: '#e26d8a',
    accent2: '#f0d868',
    hillTint: [0, 0, 0],
    hillTintAmt: 0,
    skyTint: [0, 0, 0],
    skyTintAmt: 0,
    snowcaps: false,
  },
  autumn: {
    blades: { g: '#c99a3f', G: '#e0b654', k: '#96702a' },
    earth: { d: '#8a5432', D: '#6e4026', e: '#a86c3e' },
    stone: { r: '#8a7f74', R: '#a99e90', k: '#665d53', K: '#4d463e' },
    accent: '#c8502e',
    accent2: '#e0862e',
    hillTint: [176, 138, 72],
    hillTintAmt: 0.35,
    skyTint: [255, 214, 150],
    skyTintAmt: 0.12,
    snowcaps: false,
  },
  chalk: {
    blades: { g: '#69b183', G: '#8bcf9d', k: '#47825d' },
    earth: { d: '#b5a476', D: '#95845c', e: '#cbbd90' },
    stone: { r: '#cfcaba', R: '#e5e1d4', k: '#a8a291', K: '#87816f' },
    accent: '#7f9fd8',
    accent2: '#e8e4f0',
    hillTint: [150, 190, 170],
    hillTintAmt: 0.25,
    skyTint: [200, 230, 240],
    skyTintAmt: 0.15,
    snowcaps: false,
  },
  redrock: {
    blades: { g: '#9aa04b', G: '#b6bc61', k: '#6f7434' },
    earth: { d: '#9c5a34', D: '#7c4426', e: '#b8703f' },
    stone: { r: '#b05a38', R: '#c97a4e', k: '#8a4227', K: '#66301c' },
    accent: '#d8b04c',
    accent2: '#77a06a',
    hillTint: [196, 120, 80],
    hillTintAmt: 0.4,
    skyTint: [255, 200, 160],
    skyTintAmt: 0.15,
    snowcaps: false,
  },
  slate: {
    blades: { g: '#569a6c', G: '#6fb883', k: '#3a7050' },
    earth: { d: '#6e5540', D: '#57432f', e: '#83674c' },
    stone: { r: '#66707f', R: '#828e9e', k: '#4c545f', K: '#383e47' },
    accent: '#a682c8',
    accent2: '#d8d2e6',
    hillTint: [110, 140, 150],
    hillTintAmt: 0.3,
    skyTint: [190, 210, 230],
    skyTintAmt: 0.12,
    snowcaps: true,
  },
};

// Sprite-name suffix for a biome ('' for meadow keeps all classic names valid).
export function biomeSuffix(b: Biome): string {
  return b === 'meadow' ? '' : `@${b}`;
}

// Which tree silhouette grows in a biome. Most keep the classic broadleaf;
// the arid biomes (chalk dunes, redrock desert) grow palms, and the
// snow-capped slate highlands grow snow-dusted pines. The sprite names here
// must be registered in sprites.ts. Biomes absent from this map fall back to
// the plain 'tree' via treeSprite().
export const BIOME_TREE: Partial<Record<Biome, string>> = {
  chalk: 'tree_palm',
  redrock: 'tree_palm',
  slate: 'tree_pine',
};

// Sprite name for the tree a biome grows (defaults to the classic broadleaf).
export function treeSprite(b: Biome): string {
  return BIOME_TREE[b] ?? 'tree';
}
