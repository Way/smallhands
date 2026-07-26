// Headless checks for the weather crossfade: the sim blend ramp and the pure
// WeatherLook lerp. Bundles the TS sources with rolldown (see bundle.mjs) and
// imports from an in-memory data URL, so it runs with plain `node`.
import { bundleExports } from './bundle.mjs';

const { Game, LEVELS, WEATHER_FADE, WEATHER_RULES, weatherEffects, weatherLook, lerpLook } = await bundleExports(`
  export { Game } from './src/game/sim.ts';
  export { LEVELS } from './src/game/levels.ts';
  export { WEATHER_FADE, WEATHER_RULES, weatherEffects } from './src/game/types.ts';
  export { weatherLook, lerpLook } from './src/game/weather-look.ts';
`);

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
  check('workFactor already reflects the new phase', g.workFactor === WEATHER_RULES[sched[1].kind].work);

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

// ---- the rule table: each sky does its OWN, nameable thing (card #70) ------
{
  const R = WEATHER_RULES;
  check('clear costs nothing at all', R.clear.work === 1 && R.clear.wheels && R.clear.lanternLight === 1);
  check('rain and storm slow work by DIFFERENT amounts', R.rain.work !== R.storm.work);
  check('rain is the gentler one', R.rain.work > R.storm.work);
  check('rain leaves the wheels turning', R.rain.wheels === true);
  check('only a storm brakes the wheels', R.storm.wheels === false);
  check('only a storm pulls the lantern light in', R.rain.lanternLight === 1 && R.storm.lanternLight < 1);

  // the readout list is generated from the table, so it can never drift from it
  const ids = (kind, flood = false) => weatherEffects(kind, flood).map((e) => e.id).join(',');
  check('clear reads as "nothing to plan around"', ids('clear') === 'none');
  check('rain reads exactly one effect', ids('rain') === 'work');
  check('storm reads all three', ids('storm') === 'work,wheels,light');
  check('a flood level adds the tide to rain only', ids('rain', true) === 'work,flood' && ids('storm', true) === 'work,wheels,light');
  const pct = weatherEffects('storm').find((e) => e.id === 'work').pct;
  check('the work penalty is the whole-percent the player reads', pct === Math.round((1 - R.storm.work) * 100));
}

// ---- storm rules land in the sim -------------------------------------------
{
  // a night level with a storm phase: the lantern circle must pull in with it
  const def = LEVELS.find((l) => l.night && (l.weather ?? []).some((p) => p.kind === 'storm'));
  check('found a night level with a storm phase', !!def);
  const g = new Game(def);
  const dt = 1 / 30;
  const calmR = g.lanternRadius;
  check('wheels turn while it is not storming', g.wheelsLocked === (g.weather === 'storm'));
  let guard = 0;
  while (g.weather !== 'storm' && guard < 500000) { g.tick(dt); guard++; }
  check('reached the storm phase', g.weather === 'storm');
  check('the storm brakes the wheels', g.wheelsLocked === true);
  check('the storm pulls the lantern light in', g.lanternRadius < calmR);
  check('lantern radius matches the rule exactly', Math.abs(g.lanternRadius - calmR * WEATHER_RULES.storm.lanternLight) < 1e-9);
  // the sheltered fires do NOT dim — the home yard never goes dark in a gale
  const th = g.lightSources().find((s) => Math.abs(s.r - 9) < 1e-9);
  check('the town hall fire keeps its full radius through a storm', !!th);
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
