import type { WeatherKind } from './types';

// Numeric look-and-feel for one weather kind. Everything here is lerp-able so a
// phase boundary crossfades for free. Colours are RGB(A) tuples (0-255, alpha 0-1).
export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];

export interface WeatherLook {
  sky: [RGB, RGB, RGB]; // daytime gradient stops (top → bottom)
  hills: [RGB, RGB]; // two parallax hill layers
  cloudCol: RGBA; // cloud fill
  cloudSpeed: number; // parallax drift multiplier
  rain: number; // precipitation intensity: clear 0, rain 1, storm 1.6
  slant: number; // streak slant
  tint: RGBA; // wet dimming overlay
  wind: number; // treetop sway amplitude
  windHz: number; // sway frequency
}

// Presets carried over verbatim from the old per-kind ternaries in render.ts.
const LOOKS: Record<WeatherKind, WeatherLook> = {
  clear: {
    sky: [[126, 196, 232], [168, 220, 240], [216, 240, 232]],
    hills: [[143, 199, 168], [111, 174, 140]],
    cloudCol: [255, 255, 255, 0.85],
    cloudSpeed: 1,
    rain: 0,
    slant: 0.14,
    tint: [40, 60, 90, 0],
    wind: 1,
    windHz: 1.2,
  },
  rain: {
    sky: [[94, 121, 148], [130, 152, 172], [170, 184, 192]],
    hills: [[122, 163, 146], [92, 138, 116]],
    cloudCol: [150, 160, 175, 0.9],
    cloudSpeed: 1.4,
    rain: 1,
    slant: 0.14,
    tint: [40, 60, 90, 0.12],
    wind: 1.5,
    windHz: 1.2,
  },
  storm: {
    sky: [[58, 70, 88], [86, 98, 116], [122, 132, 148]],
    hills: [[95, 125, 112], [72, 100, 90]],
    cloudCol: [88, 98, 114, 0.95],
    cloudSpeed: 4.5,
    rain: 1.6,
    slant: 0.55,
    tint: [18, 26, 44, 0.24],
    wind: 2.6,
    windHz: 2.6,
  },
};

export function weatherLook(kind: WeatherKind): WeatherLook {
  return LOOKS[kind];
}

const ln = (a: number, b: number, t: number): number => a + (b - a) * t;
const lrgb = (a: RGB, b: RGB, t: number): RGB => [ln(a[0], b[0], t), ln(a[1], b[1], t), ln(a[2], b[2], t)];
const lrgba = (a: RGBA, b: RGBA, t: number): RGBA => [
  ln(a[0], b[0], t),
  ln(a[1], b[1], t),
  ln(a[2], b[2], t),
  ln(a[3], b[3], t),
];

export function lerpLook(a: WeatherLook, b: WeatherLook, t: number): WeatherLook {
  // Settled (t===1, the >99% case) and t===0 need no interpolation — return the
  // shared preset directly and skip the per-frame allocation. Looks are read-only.
  if (t >= 1) return b;
  if (t <= 0) return a;
  return {
    sky: [lrgb(a.sky[0], b.sky[0], t), lrgb(a.sky[1], b.sky[1], t), lrgb(a.sky[2], b.sky[2], t)],
    hills: [lrgb(a.hills[0], b.hills[0], t), lrgb(a.hills[1], b.hills[1], t)],
    cloudCol: lrgba(a.cloudCol, b.cloudCol, t),
    cloudSpeed: ln(a.cloudSpeed, b.cloudSpeed, t),
    rain: ln(a.rain, b.rain, t),
    slant: ln(a.slant, b.slant, t),
    tint: lrgba(a.tint, b.tint, t),
    wind: ln(a.wind, b.wind, t),
    windHz: ln(a.windHz, b.windHz, t),
  };
}

// ---- biome atmosphere -------------------------------------------------------
//
// A biome does not own its sky and hills; it *leans* on the weather look's.
// The weather carries the value relationships — the two hill layers' separation
// and the whole clear→rain→storm darkening — and the biome rotates the hue.
// Applied after the weather blend, so a phase crossfade keeps working.
//
// These live here, exported, rather than inline in drawSky for one reason: they
// are the only colours in the scene no rendered frame can be asserted against
// (treetop sway means no two frames are equal — see tests/biome-light.mjs). A
// palette pass has to be checked against these numbers and then judged on
// screen, so both readers have to be able to call the *same* function the
// renderer does instead of re-deriving the mix and slowly drifting from it.

export const mixRgb = (c: RGB, to: readonly number[], amt: number): RGB =>
  amt <= 0 ? c : [c[0] + (to[0] - c[0]) * amt, c[1] + (to[1] - c[1]) * amt, c[2] + (to[2] - c[2]) * amt];

// How much sky each distant layer is drowned in (drawDistantTerrain). Aerial
// perspective: the horizon range is mostly sky, the midground ridge barely any,
// and the near scrub line none at all. Constants because the horizon layer is
// the one that reads greenest, so a guard on the hill palette has to be able to
// compute what the horizon actually ends up as, not just what the hills are.
export const HILL_SKY_MIX = { horizon: 0.55, mid: 0.15 } as const;

interface Atmosphere {
  hillTint: RGB;
  hillTintAmt: number;
  skyTint: RGB;
  skyTintAmt: number;
}

/** The daytime sky gradient stops a biome shows under a weather look. */
export function biomeSky(look: WeatherLook, bl: Atmosphere): [RGB, RGB, RGB] {
  return [
    mixRgb(look.sky[0], bl.skyTint, bl.skyTintAmt),
    mixRgb(look.sky[1], bl.skyTint, bl.skyTintAmt),
    mixRgb(look.sky[2], bl.skyTint, bl.skyTintAmt),
  ];
}

/** The two daytime parallax hill layers a biome shows under a weather look. */
export function biomeHills(look: WeatherLook, bl: Atmosphere): [RGB, RGB] {
  return [mixRgb(look.hills[0], bl.hillTint, bl.hillTintAmt), mixRgb(look.hills[1], bl.hillTint, bl.hillTintAmt)];
}

export const rgbCss = (c: RGB): string => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
export const rgbaCss = (c: RGBA): string =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${c[3].toFixed(3)})`;
