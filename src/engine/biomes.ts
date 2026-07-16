// Biome looks: palette + atmosphere data for the terrain tile family.
// A biome is pure presentation — tile semantics, movement and the puzzle
// grammar are identical everywhere. Campaign levels and the editor default to
// 'meadow' (the classic look); the generator picks a biome from its seed.

export type Biome = 'meadow' | 'autumn' | 'chalk' | 'redrock' | 'slate' | 'vale';
export const BIOMES: readonly Biome[] = ['meadow', 'autumn', 'chalk', 'redrock', 'slate', 'vale'];

// The pool the generator draws a biome from — deliberately NOT the same list as
// BIOMES. `rng.pick` maps one seed value through the array length, so appending
// a biome to the pool changes the biome every existing seed produces. The daily
// challenge is a shared seed, so that would silently repaint a level players
// compare with each other. Widen this list only as a deliberate act.
export const GENERATED_BIOMES: readonly Biome[] = ['meadow', 'autumn', 'chalk', 'redrock', 'slate'];

type Tint = [number, number, number];

// Directional light model for the terrain shading overlays. Real sunlight is
// warm and the shadow it leaves is filled by blue sky bounce — so a shadow is a
// *hue rotation*, not merely less light. Shading with neutral black drains the
// surface to grey instead, which is what flattens a saturated palette.
export interface LightLook {
  sun: Tint; // tints highlights: lit top faces and rims
  ambient: Tint; // tints shading: strata, cracks, shaded rims, ambient occlusion
  deep: Tint; // tints the depth fade far below the local surface
}

// The classic neutral shading — literally the colours drawTerrain has always
// hardcoded. Every pre-existing biome declares it, so their render is unchanged
// by construction: mixing an overlay toward [0,0,0] *is* `rgba(0,0,0,a)`.
const NEUTRAL_LIGHT: LightLook = {
  sun: [255, 255, 255],
  ambient: [0, 0, 0],
  deep: [8, 10, 18],
};

export interface BiomeLook extends LightLook {
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
    ...NEUTRAL_LIGHT,
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
    ...NEUTRAL_LIGHT,
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
    ...NEUTRAL_LIGHT,
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
    ...NEUTRAL_LIGHT,
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
    ...NEUTRAL_LIGHT,
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
  // A sunlit green valley. The one biome that spends the light model: warm sun,
  // cool sky-bounce shadow. Palette measured off low-poly reference art rather
  // than picked by eye, following one rule — as a surface turns away from the
  // light it goes *cooler*, not just darker (lit blades sit at hue ~93° and a
  // yellow bias for sunlight; shaded blades rotate ~+26° to ~119°).
  vale: {
    sun: [255, 246, 214], // warm midday sun
    ambient: [40, 64, 120], // blue sky filling the shadow
    deep: [18, 32, 72],
    blades: { g: '#81c76b', G: '#aadd81', k: '#488f47' },
    earth: { d: '#a46e44', D: '#7a4e2e', e: '#c98f5c' },
    stone: { r: '#9aa3ad', R: '#bcc4cb', k: '#727c88', K: '#535c66' },
    accent: '#f55b37',
    accent2: '#ffd21e',
    hillTint: [150, 205, 140],
    hillTintAmt: 0.3,
    skyTint: [190, 235, 255],
    skyTintAmt: 0.12,
    // A valley, not a highland: no snowline. Worth recording why, because the
    // reference art tempts otherwise — its snow is a *seasonal remap of the
    // whole scene*, not a cap on high ground, so it is a different feature from
    // `snowcaps` and does not belong here. (Measured, if a winter weather look
    // ever wants it: snow lit by blue sky is periwinkle — ~#a0bae1, hue 216° at
    // ~50% saturation — never white. That belongs in weather-look.ts.)
    snowcaps: false,
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
  vale: 'tree_vale',
};

// Sprite name for the tree a biome grows (defaults to the classic broadleaf).
export function treeSprite(b: Biome): string {
  return BIOME_TREE[b] ?? 'tree';
}
