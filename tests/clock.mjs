// Level clock e2e: the HUD clock must read GAME time — stretching with the
// speed control, holding at ⏸, and resetting when the level restarts.
// The sim side is covered fast in tests/unit.mjs; this proves the chip is on
// screen and wired to game.time. Requires the production build to be served
// (default http://localhost:4173/ — `npm run preview`).
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { bundleExports } from './bundle.mjs';

// the real formatter, so this can't drift from what the HUD renders
const { fmtTime } = await bundleExports(`export { fmtTime } from './src/game/types.ts';`);

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

// ---- the clock is on screen and starts near zero ----------------------------
check('clock chip is visible', await page.isVisible('.clock .clock-time'));
check('clock starts at 0:0x', /^0:0\d$/.test(await clockText()));

// ---- it counts up while the level runs --------------------------------------
await page.evaluate(() => window.__smallhands.setSpeed(1));
const before = await gameTime();
await page.waitForTimeout(1200);
const after = await gameTime();
check('game time advances at 1×', after > before + 0.5);
check('clock is counting up', (await clockText()) !== '0:00');

// ---- pause holds it ---------------------------------------------------------
await page.evaluate(() => window.__smallhands.setSpeed(0));
await page.waitForTimeout(50);
const paused = await clockText();
// exact match is only race-free while the sim is frozen
check('paused clock renders exactly the sim time', paused === fmtTime(await gameTime()));
await page.waitForTimeout(700);
check('paused clock does not advance', (await clockText()) === paused);

// ---- speed stretches it: 4× buys ~4× the game time per wall second -----------
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
check('4× runs the clock markedly faster than 1×', ratio > 2.5 && ratio < 5.5);

// ---- restart resets it ------------------------------------------------------
await page.evaluate(() => window.__smallhands.startLevel(0));
await page.waitForTimeout(200);
check('restart resets the clock', /^0:0\d$/.test(await clockText()));

await browser.close();
if (failed) {
  console.error('CLOCK E2E FAIL');
  process.exit(1);
}
console.log('CLOCK E2E PASS');
