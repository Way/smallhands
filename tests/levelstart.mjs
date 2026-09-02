// The Start card: a level opens held, the player can look around behind the card,
// and Start begins the run. The three failures this guards are all silent ones —
// an overlay that eats the camera drag, a card that clearOverlay() removes and
// nobody puts back, and a pause button on a level that has not begun.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { beginRun } from './enter.mjs';

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

// ---- the level opens held ---------------------------------------------------
check('the level opens in muster', await page.evaluate(() => window.__smallhands.game.phase === 'muster'));
check('the Start card is up', (await page.locator('.ready-overlay').count()) === 1);
check('the card names the level', ((await page.textContent('.ready-card')) ?? '').length > 10);

// the clock really is frozen — not merely paused
const t0 = await page.evaluate(() => window.__smallhands.game.time);
await page.waitForTimeout(700);
check('the run clock is frozen', (await page.evaluate(() => window.__smallhands.game.time)) === t0);

// ---- looking around still works ---------------------------------------------
// The whole point of the card is that the player can read the map behind it, so
// the overlay must not take the pointer. A full-screen .overlay does by default.
check(
  'the card layer does not take the pointer',
  await page.evaluate(() => getComputedStyle(document.querySelector('.ready-overlay')).pointerEvents === 'none')
);
check(
  'the button does take the pointer',
  await page.evaluate(() => getComputedStyle(document.querySelector('.ready-btn')).pointerEvents !== 'none')
);
const cam0 = await page.evaluate(() => window.__smallhands.cam.x);
await page.keyboard.down('d');
await page.waitForTimeout(400);
await page.keyboard.up('d');
check('the camera still pans behind the card', (await page.evaluate(() => window.__smallhands.cam.x)) !== cam0);

// ---- the crew musters --------------------------------------------------------
check(
  'nobody is given work while held',
  await page.evaluate(() => window.__smallhands.game.workers.every((w) => w.task === null))
);

// ---- the speed control is off ------------------------------------------------
check(
  'the speed control is disabled while held',
  await page.evaluate(() => !!document.querySelector('.island .speed-trigger')?.hasAttribute('disabled'))
);
await page.keyboard.press(' ');
await page.waitForTimeout(60);
check('Space does not pause a held level', await page.evaluate(() => window.__smallhands.game.phase === 'run'));

// Space started it. Re-enter to test the options round trip from a held level.
await page.evaluate(() => window.__smallhands.startLevel(0));
await page.waitForTimeout(300);
check('a fresh level is held again', await page.evaluate(() => window.__smallhands.game.phase === 'muster'));

// ---- the card survives the options round trip --------------------------------
// showOptions calls clearOverlay(), which removes every .overlay. Without
// syncReadyOverlay the player closes the options menu and finds a level stuck in
// muster with no way to start it: a softlock that throws nothing and logs nothing.
// The island's menu popover holds four rows in this order: levels · restart ·
// options · report. The divider between them is a div, so the .menu-item locator
// counts only the buttons.
await page.click('.island .menu-trigger');
await page.waitForTimeout(150);
await page.locator('.menu-pop .menu-item').nth(2).click();
await page.waitForTimeout(300);
check('the options menu opened', (await page.locator('.options-box').count()) === 1);
await page.click('.options-box .big-btn'); // Back → resumeGame
await page.waitForTimeout(300);
check('the Start card comes back after the options menu', (await page.locator('.ready-overlay').count()) === 1);
check('still held after the options menu', await page.evaluate(() => window.__smallhands.game.phase === 'muster'));

// ---- the button starts the run -----------------------------------------------
await page.click('.ready-btn');
await page.waitForTimeout(300);
check('the Start card is gone', (await page.locator('.ready-overlay').count()) === 0);
check('the level runs', await page.evaluate(() => window.__smallhands.game.phase === 'run'));
check('the speed control is live again', await page.evaluate(() => !document.querySelector('.island .speed-trigger')?.hasAttribute('disabled')));
await page.waitForTimeout(600);
check('the run clock moves', (await page.evaluate(() => window.__smallhands.game.time)) > 0.3);

// ---- beginRun still works from the hook --------------------------------------
await page.evaluate(() => window.__smallhands.startLevel(0));
await page.waitForTimeout(300);
await beginRun(page);
check('the hook starts a held level too', await page.evaluate(() => window.__smallhands.game.phase === 'run'));

await browser.close();
console.log(failed ? '\nFAILURES' : '\nall ok');
process.exit(failed ? 1 : 0);
