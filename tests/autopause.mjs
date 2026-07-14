// Auto-pause-on-blur e2e: verifies that losing focus freezes the running sim
// and that regaining focus raises a resume dialog instead of silently continuing.
// Requires the production build to be served (default http://localhost:4173/ —
// `npm run preview`). Mirrors tests/e2e.mjs for browser launch + entry flow.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

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

// Run at 2x so we can prove the exact speed is restored, not just "unpaused".
await page.evaluate(() => window.__smallhands.setSpeed(2));
check('level running, not paused', !(await page.evaluate(() => window.__smallhands.game.paused)));

// ---- blur -> auto-pause -----------------------------------------------------
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
await page.waitForTimeout(50);
check('blur pauses the sim', await page.evaluate(() => window.__smallhands.game.paused));

// ---- focus -> resume dialog, still paused (no silent resume) ----------------
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForTimeout(50);
check('resume dialog shown on focus', (await page.locator('.resume-overlay').count()) === 1);
check('still paused until dismissed', await page.evaluate(() => window.__smallhands.game.paused));

// A second focus event must not stack a second dialog.
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForTimeout(50);
check('resume dialog not duplicated', (await page.locator('.resume-overlay').count()) === 1);

// Keyboard must not leak past the modal dialog: Space (which toggles pause) is
// swallowed, so the sim can't be unpaused behind the overlay.
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })));
await page.waitForTimeout(30);
check('Space does not unpause behind the dialog', await page.evaluate(() => window.__smallhands.game.paused));
check('dialog still up after Space', (await page.locator('.resume-overlay').count()) === 1);

// ---- click Resume -> unpaused at the original speed -------------------------
await page.click('.resume-overlay .big-btn');
await page.waitForTimeout(50);
check('resume dialog dismissed', (await page.locator('.resume-overlay').count()) === 0);
check('sim resumes on Resume', !(await page.evaluate(() => window.__smallhands.game.paused)));

// ---- visibilitychange path (tab switch) -------------------------------------
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(50);
check('hidden tab pauses the sim', await page.evaluate(() => window.__smallhands.game.paused));

await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
});
await page.waitForTimeout(50);
check('resume dialog shown when tab visible again', (await page.locator('.resume-overlay').count()) === 1);
check('still paused until dismissed (tab)', await page.evaluate(() => window.__smallhands.game.paused));

// ---- manual pause must not trigger the dialog -------------------------------
await page.click('.resume-overlay .big-btn'); // clear dialog, resumes to 2x
await page.waitForTimeout(50);
await page.evaluate(() => window.__smallhands.setSpeed(0)); // player pauses on purpose
await page.evaluate(() => window.dispatchEvent(new Event('blur')));
await page.evaluate(() => window.dispatchEvent(new Event('focus')));
await page.waitForTimeout(50);
check('no dialog when already paused by player', (await page.locator('.resume-overlay').count()) === 0);
check('player pause is left untouched', await page.evaluate(() => window.__smallhands.game.paused));

await browser.close();
if (failed) {
  console.error('AUTOPAUSE E2E FAIL');
  process.exit(1);
}
console.log('AUTOPAUSE E2E PASS');
