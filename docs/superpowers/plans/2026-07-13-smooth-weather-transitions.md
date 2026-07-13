# Smooth Weather Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crossfade the weather visuals over a few seconds at each phase boundary so weather eases in/out instead of snapping on a single frame.

**Architecture:** The sim exposes a continuous `weatherBlend` (`{from, to, t}`) derived from the existing phase timer. A new pure module maps each `WeatherKind` to a numeric `WeatherLook` and lerps between two looks. The renderer computes one blended `WeatherLook` per frame and draws the sky, trees, and precipitation from it. Gameplay is untouched — `workFactor`, storm lift blow-off, and flood rise keep reading the discrete `weather` kind and flip exactly at the boundary.

**Tech Stack:** TypeScript, Canvas 2D, esbuild-bundled headless sim tests run under plain `node` (no browser).

## Global Constraints

- `WEATHER_FADE = 3` seconds — the single crossfade duration, no per-level override.
- Visual-only. Do NOT change `workFactor`, storm rider blow-off, flood water rise, or any other gameplay read of `weather`. The forecast stays a precise deterministic puzzle contract.
- No new `WeatherKind` values.
- No save persistence of transition state (weather sim state is not persisted today; reload settles to the current phase).
- Colours lerp in RGB. Night is a **level flag**, not weather: at night the sky gradient / hills / cloud colour stay the night palette, but the wet tint and rain streaks still crossfade.
- `reduceMotion` still skips rain streaks and gusts entirely; the crossfading tint alone carries the weather.

---

### Task 1: Sim blend state + `weatherBlend` getter

**Files:**
- Modify: `src/game/types.ts` (add `WEATHER_FADE` beside `WET_WORK_FACTOR`, ~line 252)
- Modify: `src/game/sim.ts` (fields ~line 138-140, `tickWeather` ~line 1278-1291, new getter in the weather section ~line 246)
- Test: `tests/weather.mjs` (new)

**Interfaces:**
- Consumes: existing `Sim.weatherIdx`, `Sim.weatherT`, `Sim.weatherSchedule`, `Sim.weather`, `WeatherKind`.
- Produces:
  - `WEATHER_FADE: number` exported from `types.ts`.
  - `Sim.weatherBlend: { from: WeatherKind; to: WeatherKind; t: number }` getter — `t` ramps `0→1` across `WEATHER_FADE` after a flip, then holds at `1`; settled (`t === 1`) at spawn.

- [ ] **Step 1: Write the failing test**

Create `tests/weather.mjs`:

```js
// Headless checks for the weather crossfade: the sim blend ramp and the pure
// WeatherLook lerp. Bundles the TS sources with esbuild and imports from an
// in-memory data URL, so it runs with plain `node` (same pattern as unit.mjs).
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const res = await build({
  stdin: {
    contents: `
      export { Game } from './src/game/sim.ts';
      export { LEVELS } from './src/game/levels.ts';
      export { WEATHER_FADE, WET_WORK_FACTOR } from './src/game/types.ts';
      export { weatherLook, lerpLook } from './src/game/weather-look.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const { Game, LEVELS, WEATHER_FADE, WET_WORK_FACTOR, weatherLook, lerpLook } = await import(
  'data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64')
);

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}`); failures++; }
}

// ---- sim blend ramp --------------------------------------------------------
{
  const def = LEVELS.find((l) => Array.isArray(l.weather) && l.weather.length >= 2);
  check('found a level with a >=2-phase weather schedule', !!def);
  const sched = def.weather;
  const g = new Game(def);
  const dt = 1 / 30;

  // spawn is settled — no fade-in from a phantom previous phase
  const b0 = g.weatherBlend;
  check('spawn blend is settled (t === 1)', b0.t === 1);
  check('spawn blend "to" is the first phase kind', b0.to === sched[0].kind);

  // tick to the first flip
  let guard = 0;
  while (g.weatherIdx === 0 && guard < 100000) { g.tick(dt); guard++; }
  check('weather advanced to phase 1', g.weatherIdx === 1);

  const b1 = g.weatherBlend;
  check('post-flip from = phase 0 kind', b1.from === sched[0].kind);
  check('post-flip to = phase 1 kind', b1.to === sched[1].kind);
  check('post-flip t is near 0 (fade just started)', b1.t < 0.2);

  // gameplay flips at the boundary, decoupled from the visual blend
  const expected = sched[1].kind === 'clear' ? 1 : WET_WORK_FACTOR;
  check('workFactor already reflects the new phase', g.workFactor === expected);

  // ramp to full over WEATHER_FADE, then hold
  const steps = Math.ceil(WEATHER_FADE / dt) + 2;
  for (let i = 0; i < steps; i++) g.tick(dt);
  check('blend reaches t === 1 after WEATHER_FADE', g.weatherBlend.t === 1);
  check('kind unchanged while still within phase 1', g.weatherIdx === 1);

  // loop wrap: last phase -> first phase still crossfades correctly
  guard = 0;
  while (g.weatherIdx !== 0 && guard < 500000) { g.tick(dt); guard++; }
  check('weather looped back to phase 0', g.weatherIdx === 0);
  const bw = g.weatherBlend;
  check('wrap from = last phase kind', bw.from === sched[sched.length - 1].kind);
  check('wrap to = first phase kind', bw.to === sched[0].kind);
  check('wrap restarted the fade (t < 1)', bw.t < 1);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/weather.mjs`
Expected: FAIL — esbuild cannot resolve `./src/game/weather-look.ts` (created in Task 2) OR `g.weatherBlend` is `undefined`. Either way the run errors/fails, proving the test exercises new code.

- [ ] **Step 3: Add the `WEATHER_FADE` constant**

In `src/game/types.ts`, directly under the `WET_WORK_FACTOR` line (~252):

```ts
// Seconds to crossfade the weather visuals when a phase flips. Visual-only —
// gameplay (workFactor, storm blow-off, flood rise) still flips at the boundary.
export const WEATHER_FADE = 3;
```

- [ ] **Step 4: Add the blend state fields**

In `src/game/sim.ts`, `WeatherKind` is already imported via `import type` (~line 35). Add `WEATHER_FADE` to the **value** import block from `./types` (the one containing `WET_WORK_FACTOR`, lines 1-22), keeping it alphabetical — insert it between `WALK_SPEED` and `WET_WORK_FACTOR`:

```ts
  WALK_SPEED,
  WEATHER_FADE,
  WET_WORK_FACTOR,
```

Then replace the weather field block (~line 138-140):

```ts
  // weather: index + elapsed time within the level's looping schedule
  weatherIdx = 0;
  private weatherT = 0;
```

with:

```ts
  // weather: index + elapsed time within the level's looping schedule
  weatherIdx = 0;
  private weatherT = 0;
  // visual crossfade: the kind we're leaving + seconds since the last flip.
  // Initialised settled (fade already complete) so there's no fade-in on spawn.
  private weatherPrev: WeatherKind = 'clear';
  private weatherFadeT = WEATHER_FADE;
```

- [ ] **Step 5: Advance the fade and record the previous kind on each flip**

In `src/game/sim.ts`, replace `tickWeather` (~line 1278-1291):

```ts
  private tickWeather(dt: number): void {
    const sched = this.weatherSchedule;
    if (!sched) return;
    this.weatherT += dt;
    this.weatherFadeT += dt;
    const phase = sched[this.weatherIdx % sched.length];
    if (this.weatherT >= phase.duration) {
      this.weatherT -= phase.duration;
      this.weatherPrev = phase.kind; // the kind we're leaving
      this.weatherIdx = (this.weatherIdx + 1) % sched.length;
      this.weatherFadeT = this.weatherT; // start the fade from the boundary (carry overflow)
      const kind = sched[this.weatherIdx].kind;
      this.onEvent({ type: 'weather', kind });
      // in flood levels, every downpour raises the water table one row
      if (kind === 'rain' && this.level.flood) this.riseWater();
    }
  }
```

- [ ] **Step 6: Add the `weatherBlend` getter**

In `src/game/sim.ts`, in the weather section (after `weatherRemaining`, ~line 246):

```ts
  // Continuous crossfade between the previous and current weather. `t` ramps
  // 0→1 across WEATHER_FADE after a flip, then holds at 1. Renderer-only.
  get weatherBlend(): { from: WeatherKind; to: WeatherKind; t: number } {
    const to = this.weather;
    if (!this.weatherSchedule) return { from: 'clear', to: 'clear', t: 1 };
    const t = Math.min(1, this.weatherFadeT / WEATHER_FADE);
    return { from: this.weatherPrev, to, t };
  }
```

- [ ] **Step 7: Run test to verify the sim-blend section passes**

Run: `node tests/weather.mjs`
Expected: the sim-blend `check`s print `ok`. The run still FAILS overall because esbuild cannot resolve `./src/game/weather-look.ts` yet — that module lands in Task 2. (If esbuild aborts on the missing import before any `ok` prints, that's expected; Task 2 makes the whole file run green.)

- [ ] **Step 8: Commit**

```bash
git add src/game/types.ts src/game/sim.ts tests/weather.mjs
git commit -m "feat(sim): weatherBlend crossfade state (visual-only)"
```

---

### Task 2: `WeatherLook` table + `lerpLook` (pure module)

**Files:**
- Create: `src/game/weather-look.ts`
- Test: `tests/weather.mjs` (append a section)

**Interfaces:**
- Consumes: `WeatherKind` from `./types`.
- Produces:
  - `type RGB = [number, number, number]`, `type RGBA = [number, number, number, number]`
  - `interface WeatherLook { sky: [RGB, RGB, RGB]; hills: [RGB, RGB]; cloudCol: RGBA; cloudSpeed: number; rain: number; slant: number; tint: RGBA; wind: number; windHz: number }`
  - `weatherLook(kind: WeatherKind): WeatherLook`
  - `lerpLook(a: WeatherLook, b: WeatherLook, t: number): WeatherLook`
  - `rgbCss(c: RGB): string`, `rgbaCss(c: RGBA): string`

- [ ] **Step 1: Write the failing test (append to `tests/weather.mjs`)**

Insert this block just before the final `console.log(...)`/`process.exit(...)` lines:

```js
// ---- pure WeatherLook lerp -------------------------------------------------
{
  const clr = weatherLook('clear');
  const rn = weatherLook('rain');
  check('clear look has rain intensity 0', clr.rain === 0);
  check('rain look has rain intensity 1', rn.rain === 1);
  check('storm look has rain intensity > 1', weatherLook('storm').rain > 1);

  check('lerp at t=0 returns the "from" rain', lerpLook(clr, rn, 0).rain === clr.rain);
  check('lerp at t=1 returns the "to" rain', lerpLook(clr, rn, 1).rain === rn.rain);

  const mid = lerpLook(clr, rn, 0.5);
  check('lerp midpoint rain is between the endpoints', mid.rain > clr.rain && mid.rain < rn.rain);
  const avgR = (clr.sky[0][0] + rn.sky[0][0]) / 2;
  check('lerp midpoint sky channel is the RGB average', Math.abs(mid.sky[0][0] - avgR) < 1e-6);
  check('lerp midpoint tint alpha is between', mid.tint[3] > clr.tint[3] && mid.tint[3] < rn.tint[3]);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/weather.mjs`
Expected: FAIL — `weatherLook`/`lerpLook` are `undefined` (module not created yet) or esbuild fails to resolve the module.

- [ ] **Step 3: Create the pure module**

Create `src/game/weather-look.ts`:

```ts
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
    cloudSpeed: 2.5,
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
    cloudSpeed: 9,
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

export const rgbCss = (c: RGB): string => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
export const rgbaCss = (c: RGBA): string =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${c[3].toFixed(3)})`;
```

- [ ] **Step 4: Run test to verify the whole file passes**

Run: `node tests/weather.mjs`
Expected: `ALL PASS` — every sim-blend and lerp `check` prints `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/game/weather-look.ts tests/weather.mjs
git commit -m "feat(render): WeatherLook table + lerpLook pure module"
```

---

### Task 3: Renderer sky/clouds/sun/birds read the blended look

**Files:**
- Modify: `src/game/render.ts` — imports (~line 1-6), `draw()` (~line 96-136), `drawSky()` (~line 149-256), `drawBirds()` (~line 261-268)

**Interfaces:**
- Consumes: `game.weatherBlend` (Task 1); `weatherLook`, `lerpLook`, `rgbCss`, `rgbaCss`, type `WeatherLook` (Task 2).
- Produces: a per-frame `look: WeatherLook` threaded into `drawSky`, `drawNodes`, `drawWeatherFx`. `drawSky(game, look, W, H, t, cam)`, `drawBirds(W, H, t, cam, calm)`.

This task wires render — it is verified by `tsc` + existing test suites staying green + a visual check, not a new unit test (canvas rendering has no headless assertion surface).

- [ ] **Step 1: Import the look helpers**

In `src/game/render.ts`, after the existing imports (~line 6):

```ts
import { weatherLook, lerpLook, rgbCss, rgbaCss } from './weather-look';
import type { WeatherLook } from './weather-look';
```

- [ ] **Step 2: Compute the blended look once per frame and thread it through**

In `draw()`, right after `this.lastT = timeSec;` (~line 107):

```ts
    const blend = game.weatherBlend;
    const look = lerpLook(weatherLook(blend.from), weatherLook(blend.to), blend.t);
```

Change the `drawSky` call (~line 109) to pass `look`:

```ts
    this.drawSky(game, look, W, H, timeSec, cam);
```

Change the `drawNodes` call (~line 124) to pass `look` as a trailing argument:

```ts
    this.drawNodes(game, timeSec, harvNode?.id ?? -1, this.harvestFocus, look);
```

Change the `drawWeatherFx` call (~line 135) to pass `look` instead of `game`:

```ts
    this.drawWeatherFx(look, W, H, timeSec);
```

- [ ] **Step 3: Rewrite `drawSky` to read the look**

Replace the `drawSky` signature and its colour-selection block. New signature (~line 149):

```ts
  private drawSky(game: Game, look: WeatherLook, W: number, H: number, t: number, cam: Camera): void {
```

Replace the palette block (old ~line 152-174, the `const wx = game.weather;` through the gradient `ctx.fillRect`) with:

```ts
    const night = !!game.level.night;

    // gradient stops + hill/cloud palettes per mood. Night is a level flag, not
    // weather: it overrides the sky palette, but the wet tint/streaks (drawn in
    // drawWeatherFx) still crossfade on top.
    let stops: [string, string, string];
    let hills: [string, string];
    let cloudCol: string;
    if (night) {
      stops = ['#0a1028', '#141e42', '#243654'];
      hills = ['#2a4a44', '#1d3833'];
      cloudCol = 'rgba(46,58,92,0.65)';
    } else {
      stops = [rgbCss(look.sky[0]), rgbCss(look.sky[1]), rgbCss(look.sky[2])];
      hills = [rgbCss(look.hills[0]), rgbCss(look.hills[1])];
      cloudCol = rgbaCss(look.cloudCol);
    }
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, stops[0]);
    g.addColorStop(0.55, stops[1]);
    g.addColorStop(1, stops[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
```

- [ ] **Step 4: Fade the sun with rain intensity**

Replace the `} else if (wx === 'clear') {` sun branch (old ~line 209-219) with an alpha-driven version so the sun fades as clouds roll in. The `if (night) { ...stars/moon... }` branch above it is unchanged:

```ts
    } else {
      // the sun fades out as precipitation builds and returns as it clears
      const sunA = 1 - Math.min(1, look.rain);
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
    }
```

- [ ] **Step 5: Drive cloud speed from the look**

Replace the cloud-speed line (old ~line 239):

```ts
    // clouds — the storm drives them hard across the sky
    const cloudSpeed = look.cloudSpeed;
```

- [ ] **Step 6: Gate bird spawning on calm skies**

Replace the birds line at the end of `drawSky` (old ~line 254-255):

```ts
    // birds keep to fair daylight skies; they stop spawning as rain builds but
    // any already aloft finish crossing (no mid-air disappearance)
    if (!night) this.drawBirds(W, H, t, cam, look.rain < 0.05);
```

Update the `drawBirds` signature (~line 261):

```ts
  private drawBirds(W: number, H: number, t: number, cam: Camera, calm: boolean): void {
```

And gate the spawn condition inside it (old ~line 267): change

```ts
    if (t >= this.nextBirdAt && this.birds.length < 12) {
```

to

```ts
    if (calm && t >= this.nextBirdAt && this.birds.length < 12) {
```

- [ ] **Step 7: Type-check and run the existing suites**

Run: `npm run build`
Expected: `tsc --noEmit` passes (0 errors) and the vite build completes. (Do not skip — this is the only automated gate for the render wiring.)

Run: `node tests/unit.mjs && node tests/campaign2.mjs && node tests/weather.mjs`
Expected: each prints `ALL PASS` (weather blend + gameplay unchanged).

- [ ] **Step 8: Visual check (browser)**

Follow the e2e/browse setup from the "Testing Smallhands" memory (`CHROME_PATH` → headless-shell + `npm run preview`). Load the Campaign 2 storm/tide level, let a `clear→rain` boundary pass, and confirm the sky gradient, cloud colour, and sun fade smoothly across ~3s rather than snapping. Screenshot before/mid/after.

- [ ] **Step 9: Commit**

```bash
git add src/game/render.ts
git commit -m "feat(render): sky, clouds, sun and birds crossfade with weather"
```

---

### Task 4: Trees and precipitation crossfade with the look

**Files:**
- Modify: `src/game/render.ts` — `drawNodes()` wind (~line 423-428), `drawWeatherFx()` (~line 873-913)

**Interfaces:**
- Consumes: the per-frame `look: WeatherLook` threaded in Task 3 (`drawNodes(..., look)`, `drawWeatherFx(look, W, H, t)`).
- Produces: no new API.

Verified by `tsc` + existing suites + a visual check, same as Task 3.

- [ ] **Step 1: Tree wind from the look**

In `drawNodes`, update the signature (~line 423):

```ts
  private drawNodes(game: Game, t: number, hoveredId: number, focus: number, look: WeatherLook): void {
```

Replace the two wind lines (old ~line 426-428):

```ts
    // the wind leans on the treetops: gentle by default, hard in a storm
    const wind = look.wind;
    const windHz = look.windHz;
```

- [ ] **Step 2: Rewrite `drawWeatherFx` to read the look**

Replace the whole method (old ~line 873-913). The wet tint always crossfades (even under `reduceMotion`); streak count/opacity/length/fall-speed and the storm gust lines scale continuously with `look.rain`, so precipitation thins out and thickens instead of popping:

```ts
  // Screen-space precipitation driven by the blended weather look: a wet tint,
  // falling streaks (more, longer, faster and slanted harder as a storm builds),
  // and horizontal gust lines that fade in only once it's genuinely stormy.
  private drawWeatherFx(look: WeatherLook, W: number, H: number, t: number): void {
    const rain = look.rain;
    if (rain < 0.01 && look.tint[3] < 0.01) return;
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
      for (let i = 0; i < 9; i++) {
        const h = tileHash(i, 41);
        const y = h * H;
        const x = mod(h * W - t * (600 + h * 300), W + 260) - 130;
        ctx.moveTo(x, y);
        ctx.lineTo(x + 46 + h * 30, y - 2);
      }
      ctx.stroke();
    }
  }
```

- [ ] **Step 3: Type-check and run the suites**

Run: `npm run build`
Expected: `tsc --noEmit` passes, vite build completes.

Run: `node tests/unit.mjs && node tests/campaign2.mjs && node tests/weather.mjs`
Expected: each prints `ALL PASS`.

- [ ] **Step 4: Visual check (browser)**

On the Campaign 2 storm/tide level, watch a `clear→rain` and a `rain→storm` boundary: streaks should thicken/thin and the tint deepen/lighten across ~3s; trees should ramp their sway rather than jerk. Confirm `reduceMotion` (options menu "reduced" effects) still crossfades the tint with no streaks.

- [ ] **Step 5: Commit**

```bash
git add src/game/render.ts
git commit -m "feat(render): trees and precipitation crossfade with weather"
```

---

### Task 5: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm run build && node tests/unit.mjs && node tests/campaign2.mjs && node tests/i18n.mjs && node tests/weather.mjs`
Expected: build clean; every suite prints `ALL PASS`. Campaign2 passing confirms gameplay (win states, workFactor) is unchanged.

- [ ] **Step 2: Confirm gameplay decoupling by inspection**

Grep for gameplay reads of weather and confirm none now route through `weatherBlend`:

Run: `grep -n "weatherBlend\|game.weather\b\|this.weather\b\|workFactor" src/game/sim.ts src/game/render.ts`
Expected: `weatherBlend` appears only in `render.ts` (the per-frame look) and its getter in `sim.ts`; `workFactor` / storm / flood logic still reads the discrete `weather`.

- [ ] **Step 3: End-to-end visual confirmation**

Run the storm/tide campaign level end-to-end (per the "Testing Smallhands" memory) through at least one full weather loop, capturing a short recording or before/mid/after screenshots of one transition. Confirm: no single-frame snap at any boundary; night level still darkens correctly with weather tint layered on top; birds only in clear skies.
