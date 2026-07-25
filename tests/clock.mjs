// Level clock e2e: the HUD clock reads the world's TIME OF DAY (game.timeOfDay),
// a diegetic wall-clock chip — NOT the run's score timer. On a day map it holds
// at noon and does not tick, while the hidden score timer (game.time) still runs
// with the speed control, holds at ⏸, and resets on restart. The sim side is
// covered fast in tests/unit.mjs; this proves the chip is on screen, shows the
// day-of-time, and stays put while the score clock advances underneath it.
// Requires the production build to be served (default http://localhost:4173/ —
// `npm run preview`).
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { bundleExports } from './bundle.mjs';

// the real formatter, so this can't drift from what the HUD renders
const { fmtClock, LEVELS } = await bundleExports(`
  export { fmtClock } from './src/game/types.ts';
  export { LEVELS } from './src/game/levels.ts';
`);
// first level with a dynamic-weather schedule — the only place the clock's sky
// glyph doubles as the forecast trigger (card #62) — and the first non-clear
// phase in it, read from the schedule so a reshuffle can't quietly turn the
// "glyph follows the weather" assert into a no-op
const wxIdx = LEVELS.findIndex((l) => Array.isArray(l.weather) && l.weather.length >= 2);
if (wxIdx < 0) throw new Error('no dynamic-weather level to test the sky glyph against');
const wxPhase = LEVELS[wxIdx].weather.findIndex((p) => p.kind !== 'clear');
if (wxPhase < 0) throw new Error(`level ${wxIdx} has a weather schedule with no non-clear phase`);
const wxGlyph = { rain: '🌧️', storm: '🌩️' }[LEVELS[wxIdx].weather[wxPhase].kind];

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const found = execSync('ls /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1')
      .toString()
      .trim();
    if (found) return found;
  } catch {
    // fall through to playwright default resolution
  }
  return undefined;
}

let failed = false;
function check(label, cond) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failed = true;
}

const clockText = () => page.textContent('.clock .clock-time');
const gameTime = () => page.evaluate(() => window.__smallhands.game.time);
const timeOfDay = () => page.evaluate(() => window.__smallhands.game.timeOfDay);

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(BASE_URL);
await page.waitForTimeout(800);
await page.click('.fd-play');
await page.waitForTimeout(300);
await page.click('.map-node:not(:disabled)');
await page.click('.map-popover .pop-play');
await page.waitForTimeout(400);

// ---- the clock is on screen and reads the world's time of day ---------------
check('clock chip is visible', await page.isVisible('.clock .clock-time'));
// level 0 is a daytime map: the chip holds at noon, not a 0:00 stopwatch
check('clock renders the time of day', (await clockText()) === fmtClock(await timeOfDay()));
check('day map opens at noon', (await clockText()) === '12:00');

// ---- the diegetic clock HOLDS while the level runs (no cycle yet) ------------
await page.evaluate(() => window.__smallhands.setSpeed(1));
const clockBefore = await clockText();
const before = await gameTime();
await page.waitForTimeout(1200);
const after = await gameTime();
check('score timer advances at 1×', after > before + 0.5);
check('time-of-day clock does NOT tick with the score timer', (await clockText()) === clockBefore);
check('clock still shows noon, not the elapsed run', (await clockText()) === '12:00');

// ---- pause holds the (hidden) score timer -----------------------------------
await page.evaluate(() => window.__smallhands.setSpeed(0));
await page.waitForTimeout(50);
const pausedScore = await gameTime();
await page.waitForTimeout(700);
check('paused score timer does not advance', Math.abs((await gameTime()) - pausedScore) < 0.05);

// ---- speed stretches the score timer: 4× buys ~4× per wall second -----------
await page.evaluate(() => window.__smallhands.setSpeed(1));
const t1a = await gameTime();
await page.waitForTimeout(1000);
const t1b = await gameTime();
await page.evaluate(() => window.__smallhands.setSpeed(4));
const t4a = await gameTime();
await page.waitForTimeout(1000);
const t4b = await gameTime();
const ratio = (t4b - t4a) / (t1b - t1a);
console.log(`     (1× ${(t1b - t1a).toFixed(2)}s vs 4× ${(t4b - t4a).toFixed(2)}s per wall second → ${ratio.toFixed(2)}×)`);
check('4× runs the score timer markedly faster than 1×', ratio > 2.5 && ratio < 5.5);

// ---- restart resets the score timer; the day clock still reads noon ---------
await page.evaluate(() => window.__smallhands.startLevel(0));
await page.waitForTimeout(200);
check('restart resets the score timer', (await gameTime()) < 1);
check('restart clock still shows the day time of day', (await clockText()) === '12:00');

// ---- ONE sky glyph, and it carries the forecast (card #62) ------------------
// The island used to run a weather zone with its own ☀️ right next to the
// clock's day glyph — two identical suns whenever the weather was clear. There
// is now a single glyph: passive where there is no forecast, the forecast's own
// trigger where there is one.
const island = () =>
  page.evaluate(() => {
    const pill = document.querySelector('.island');
    const ics = pill.querySelectorAll('.clock-ic');
    const glyphs = [...pill.querySelectorAll('*')].filter(
      (e) => /^(☀️|🌙|🌇|🌧️|🌩️)$/u.test(e.textContent.trim()) && !e.closest('.island-pop')
    );
    const pop = document.querySelector('.weather-pop');
    const trigger = pill.querySelector('.clock .clock-ic');
    return {
      count: ics.length,
      glyphs: glyphs.length,
      tag: ics[0]?.tagName,
      text: ics[0]?.textContent,
      legacy: !!pill.querySelector('.weather-trigger'),
      popBuilt: !!pop,
      popOpen: pop ? !pop.hidden : false,
      // the class, not the tag, is what marks the glyph as the forecast trigger
      // — the styling and the tap disc key off it
      isTrigger: trigger?.classList.contains('wx-trigger') ?? false,
      // the glyph is not an .island-btn, so a reset that only sweeps those
      // leaves it lit and announced as expanded forever
      lit: trigger?.classList.contains('active') ?? false,
      expanded: trigger?.getAttribute('aria-expanded'),
      rateLit: [...document.querySelectorAll('.speed-pop .speed-btn.active')].length,
    };
  });

let isl = await island();
check('day map: exactly one sky glyph on the pill', isl.count === 1 && isl.glyphs === 1);
check('day map: the glyph is a passive span (no forecast to open)', isl.tag === 'SPAN');
check('day map: no forecast popover and no legacy weather zone', !isl.popBuilt && !isl.legacy);

await page.evaluate((i) => window.__smallhands.startLevel(i), wxIdx);
await page.waitForTimeout(400);
isl = await island();
check('weather map: still exactly one sky glyph', isl.count === 1 && isl.glyphs === 1);
check('weather map: the glyph is the forecast button', isl.tag === 'BUTTON' && isl.isTrigger);
await page.hover('.clock .wx-trigger');
await page.waitForTimeout(150);
isl = await island();
check('weather map: hovering the glyph opens the forecast', isl.popOpen);
check('weather map: the open glyph is lit and announced expanded', isl.lit && isl.expanded === 'true');
await page.mouse.move(700, 700);
await page.waitForTimeout(150);
isl = await island();
check('weather map: leaving the glyph closes the forecast', !isl.popOpen);
// the glyph is not an .island-btn: the dismissal sweep has to reach it anyway,
// or it stays lit (and aria-expanded="true") for the rest of the level
check('weather map: the closed glyph drops .active and aria-expanded', !isl.lit && isl.expanded === 'false');

// ...and the same sweep must NOT strip the speed popover's current-rate mark.
// Freeze the sim and click in-page: a running level keeps re-widening the
// resource digits, which slides the island's centre grid track under a real
// mouse click ("element is not stable"). ⏸ still marks the resume rate.
await page.evaluate(() => window.__smallhands.setSpeed(0));
await page.evaluate(() => document.querySelector('.island .speed-trigger').click());
await page.waitForTimeout(120);
check('speed popover marks the live rate', (await island()).rateLit === 1);
await page.evaluate(() => document.getElementById('game-canvas').click()); // outside-click dismissal
await page.waitForTimeout(120);
isl = await island();
check('dismissing the pill leaves the rate mark alone', isl.rateLit === 1);
check('dismissing the pill clears the glyph state too', !isl.lit && isl.expanded === 'false');
// the glyph tracks the live phase (weather/weatherRemaining are getters over
// the sim's private phase clock, so drive the index; tests/weather.mjs covers
// the advance itself)
await page.evaluate((i) => (window.__smallhands.game.weatherIdx = i), wxPhase);
await page.waitForTimeout(250);
isl = await island();
check(`weather map: the glyph follows the ${LEVELS[wxIdx].weather[wxPhase].kind} phase`, isl.text === wxGlyph);
check('weather map: rain does not add a second glyph', isl.count === 1 && isl.glyphs === 1);

await browser.close();
if (failed) {
  console.error('CLOCK E2E FAIL');
  process.exit(1);
}
console.log('CLOCK E2E PASS');
