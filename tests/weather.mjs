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
