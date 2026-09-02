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

// ---- the delivery switch ----------------------------------------------------
// Level 3, not level 2: level 2's goal sits past the lift the player has not
// built yet, so nothing ever reaches it — shut or open, 0 or 120 sim-seconds,
// it makes no difference (confirmed headlessly before picking this level).
// Testing "shut delivers nothing" against a goal that is unreachable either
// way cannot catch an inverted gate. Level 3 is the level tests/held.mjs
// itself calls "the reported bug in its purest form": its plank order (6) is
// already fully in starting stock, so an OPEN hatch ships one in well under a
// second of sim time — no sawmill, no lift, nothing built first — which makes
// both the negative and the positive control meaningful here.
await page.evaluate(() => window.__smallhands.startLevel(2));
await page.waitForTimeout(300);
check('a held level opens with the hatch shut', await page.evaluate(() => window.__smallhands.game.shipping === false));
await page.click('.ready-btn');
await page.waitForTimeout(300);
check('Start does not open the hatch', await page.evaluate(() => window.__smallhands.game.shipping === false));

check('the HUD says the hatch is shut', (await page.locator('.ship-row.shut').count()) === 1);
await page.waitForTimeout(2500);
check(
  'a shut hatch delivers nothing',
  await page.evaluate(() => window.__smallhands.game.objectives.every((o) => o.delivered === 0))
);

await page.click('.ship-row');
await page.waitForTimeout(120);
check('the HUD row opens the hatch', await page.evaluate(() => window.__smallhands.game.shipping === true));
check('the row stops reading shut', (await page.locator('.ship-row.shut').count()) === 0);

// Positive control: the row above only proves the negative (shut ⇒ nothing
// delivered). Without this, an inverted gate in the sim — setShipping(true)
// failing to actually lift it — would pass every check so far while shipping
// nothing. waitForFunction's 2nd argument is the page function's own arg, not
// options — pass undefined explicitly or the timeout below is silently
// ignored in favour of Playwright's 30s default.
await page.waitForFunction(
  () => window.__smallhands.game.objectives.some((o) => o.delivered > 0),
  undefined,
  { timeout: 8000 }
);
check(
  'an open hatch actually delivers',
  await page.evaluate(() => window.__smallhands.game.objectives.some((o) => o.delivered > 0))
);

await page.click('.ship-row');
await page.waitForTimeout(120);
check('the HUD row shuts it again', await page.evaluate(() => window.__smallhands.game.shipping === false));

// ---- the wagon's own panel carries the same switch, and must not go stale ---
// Pin the goal's inspect panel, then flip shipping through the __smallhands
// hook — NOT the panel's own button, NOT the HUD row — so the only thing that
// can refresh the label is buildingHintSig picking up g.shipping. Before that
// fix this button freezes on whatever label it opened with, because nothing
// in its signature changed.
//
// Pause the sim first. Without this, a hauler still mid-flight from the
// positive-delivery check above can land (or another turn back) in the
// background and tick `o.delivered`, which IS already in the signature — so
// the panel would refresh for the wrong reason and this check would pass
// whether or not shipping itself is tracked. hud.update() keeps running every
// rAF frame regardless of pause (only the tick accumulator gates on `speed`),
// so the label can still refresh here — just only for a reason we control.
await page.evaluate(() => window.__smallhands.setSpeed(0));
// Level 3's goal sits at the map's west edge (goal(g, 0)), so centering the
// camera on it the naive way (cam.x negative) gets clamped back to 0 — the
// goal then renders near the LEFT edge, not screen centre, and a click at
// the viewport's centre misses it entirely. Read the LIVE (already-clamped)
// camera back before computing where to click, the same fix caravan-shot.mjs
// uses for its own crop math ("the crop lands on the caravan even where the
// clamp moved it").
await page.evaluate(() => {
  const { game, cam } = window.__smallhands;
  const b = game.buildings.find((bd) => bd.kind === 'goal');
  const canvas = document.getElementById('game-canvas');
  cam.zoom = 4; // a comfortable click target for the 4x3 footprint
  cam.x = (b.x + 2) * 16 * cam.zoom - canvas.width / 2;
  cam.y = (b.y + 1.5) * 16 * cam.zoom - canvas.height / 2;
  cam.clamp(game, canvas.width, canvas.height);
});
const goalCenter = await page.evaluate(() => {
  const { game, cam } = window.__smallhands;
  const b = game.buildings.find((bd) => bd.kind === 'goal');
  const canvas = document.getElementById('game-canvas');
  const dpr = canvas.width / canvas.clientWidth;
  return {
    x: ((b.x + 2) * 16 * cam.zoom - cam.x) / dpr,
    y: ((b.y + 1.5) * 16 * cam.zoom - cam.y) / dpr,
  };
});
await page.mouse.click(goalCenter.x, goalCenter.y);
await page.waitForTimeout(150);
check('the goal panel pins', (await page.locator('.tooltip.pinned').count()) === 1);
const shipBtn = () => page.evaluate(() => document.querySelector('.tooltip.pinned .tt-btn')?.textContent ?? null);
const labelShut = await shipBtn();
check('the pinned panel has a delivery button while shut', !!labelShut);
await page.evaluate(() => window.__smallhands.setShipping(true));
await page.waitForTimeout(150);
const labelOpen = await shipBtn();
check(
  'the pinned panel label follows a hook-driven flip, not just its own button',
  !!labelOpen && labelOpen !== labelShut
);
await page.evaluate(() => window.__smallhands.setShipping(false));
await page.waitForTimeout(150);
const labelShutAgain = await shipBtn();
check('...and follows it back again', labelShutAgain === labelShut);

await browser.close();
console.log(failed ? '\nFAILURES' : '\nall ok');
process.exit(failed ? 1 : 0);
