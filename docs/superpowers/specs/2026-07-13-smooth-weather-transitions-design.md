# Smooth Weather Transitions — Design

## Problem

Weather runs on a per-level looping schedule of phases (`WeatherPhase[]`,
e.g. `clear 45s → rain 30s`). At each phase boundary the visuals snap instantly:
the sky gradient, wet tint, rain streaks, tree wind, cloud speed/colour, and the
sun all change on a single frame. It reads as a hard cut rather than weather
rolling in.

## Goal

Crossfade the weather visuals over a few seconds at each phase boundary, so
weather eases in and out. **Visual-only** — gameplay is untouched.

## Non-goals (YAGNI)

- No gameplay ramp. `workFactor` (wet work penalty), storm lift blow-off, and
  flood water rise keep reading the discrete `weather` kind and flip exactly at
  the boundary. The forecast stays a precise, deterministic puzzle contract
  (as the existing `types.ts` comment protects).
- No new weather kinds.
- No per-level fade-duration tuning — one global constant.
- No save persistence of transition state (weather sim state isn't persisted
  today; reload settles to the current phase, which is fine).

## Design

### 1. Blend state (sim — deterministic)

`Sim.tickWeather` already advances `weatherIdx` at the boundary. Add transition
state driven off the existing flip:

- `weatherPrev: WeatherKind` — the kind being left.
- `weatherFadeT: number` — seconds elapsed since the last flip.

On each flip: `weatherPrev = <old kind>`, `weatherFadeT = 0`. Every tick while a
fade is in progress: `weatherFadeT += dt`.

At level start / construction, initialise **settled**: `weatherPrev = <first
kind>` and `weatherFadeT >= WEATHER_FADE`, so there is **no fade-in on spawn**.

New constant: `WEATHER_FADE = 3` (seconds), in `types.ts` beside
`WET_WORK_FACTOR`.

Expose one getter for the renderer:

```ts
get weatherBlend(): { from: WeatherKind; to: WeatherKind; t: number } {
  const to = this.weather;
  const t = Math.min(1, this.weatherFadeT / WEATHER_FADE);
  return { from: this.weatherPrev, to, t };
}
```

`t` ramps `0 → 1` across `WEATHER_FADE` after a flip, then holds at `1`. Across a
loop wrap (last phase → first phase) `from/to` reflect the real kinds, so the
wrap crossfades correctly.

The discrete `get weather()` is unchanged; all gameplay reads keep using it.

### 2. Render refactor — a single `WeatherLook` table

Today the per-kind visual constants are scattered as
`wx === 'storm' ? … : wx === 'rain' ? …` ternaries across `drawSky`,
`drawTrees`, and `drawWeatherFx`. Collapse them into one table.

```ts
interface WeatherLook {
  sky: [RGB, RGB, RGB];   // daytime gradient stops
  hills: [RGB, RGB];
  cloudCol: RGBA;         // cloud fill
  cloudSpeed: number;     // parallax drift multiplier
  rain: number;           // streak/tint intensity: clear 0, rain 1, storm ~1.6
  slant: number;          // streak slant
  tint: RGBA;             // wet dimming overlay
  wind: number;           // treetop sway amplitude
  windHz: number;         // sway frequency
}

function weatherLook(kind: WeatherKind): WeatherLook { /* the three presets */ }
function lerpLook(a: WeatherLook, b: WeatherLook, t: number): WeatherLook { /* per-field lerp; colours lerp in RGB */ }
```

Each frame the renderer computes once:

```ts
const { from, to, t } = game.weatherBlend;
const look = lerpLook(weatherLook(from), weatherLook(to), t);
```

`drawSky`, `drawTrees`, and `drawWeatherFx` read from `look` instead of
branching on `wx`. Blending falls out for free; the scattered constants are
centralised.

### 3. Per-element behaviour

- **Sun / moon**: sun alpha = `1 − clamp(look.rain, 0, 1)`, so the sun fades as
  clouds roll in and returns as they clear. Night is a **level flag**, not
  weather: night still overrides the sky gradient / hills / cloud colour to the
  night palette (moon shown), but the wet **tint and rain streaks still
  crossfade** at night via `look.rain` / `look.tint`.
- **Rain streaks & storm gusts**: count and opacity scale with blended
  `look.rain`, so precipitation thins out / thickens smoothly instead of
  popping. `reduceMotion` still skips streaks/gusts entirely; the crossfading
  tint alone carries the weather (unchanged policy).
- **Birds**: gate spawning on `to === 'clear'` (i.e. only spawn when heading
  into / already clear). Birds already mid-flight finish crossing the screen —
  graceful, no mid-air disappearance.
- **Cloud speed & tree wind**: driven by blended `look.cloudSpeed` / `look.wind`
  / `look.windHz`, so the wind picks up and dies down smoothly.

### 4. Testing

- **Headless esbuild sim** (fast, no browser):
  - After a flip, assert `weatherBlend.t` ramps `0 → 1` across `WEATHER_FADE`
    and holds at `1` thereafter.
  - Assert `from/to` are correct immediately after a flip and across a loop wrap
    (last kind → first kind).
  - Assert the discrete `weather` / `workFactor` still flip exactly at the
    boundary (gameplay unchanged).
- **Visual (browser)**: run the Campaign 2 storm/tide level, screenshot mid-
  transition to confirm the crossfade rather than a snap.

## Files touched

- `src/game/types.ts` — add `WEATHER_FADE`.
- `src/game/sim.ts` — `weatherPrev`, `weatherFadeT`, tick update, `weatherBlend`
  getter; settled init.
- `src/game/render.ts` — `WeatherLook` table + `lerpLook`; `drawSky`,
  `drawTrees`, `drawWeatherFx` read the blended look; sun-alpha / bird-gate.
- Test file for the sim blend assertions.
