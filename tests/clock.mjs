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
const { fmtClock } = await bundleExports(`export { fmtClock } from './src/game/types.ts';`);

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

await browser.close();
if (failed) {
  console.error('CLOCK E2E FAIL');
  process.exit(1);
}
console.log('CLOCK E2E PASS');
