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
  check('post-flip t is near 0 (fade just started)', b1.t < 0.05);

  // the fade ramps in lockstep with real time: +1.5s of sim advances t by 1.5/WEATHER_FADE
  for (let i = 0; i < Math.round(1.5 / dt); i++) g.tick(dt);
  const b2 = g.weatherBlend;
  check('blend t ramps at 1/WEATHER_FADE per second', Math.abs(b2.t - b1.t - 1.5 / WEATHER_FADE) < 0.05);

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

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
