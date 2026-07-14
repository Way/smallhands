// Front-door smoke test: the unified site lives at `/`. This drives a real
// browser to check the front door renders, the bilingual toggle switches copy
// and persists to the shared save slot, its pixel-art icons actually draw,
// Play starts the game in place, and the old /play/ URL redirects home.
// Requires the production build served at http://localhost:4173/ (npm run preview).
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

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});

// A German browser should land in German automatically.
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => {
  console.log('[pageerror]', e.message);
  failures++;
});
await page.goto(BASE_URL);
await page.waitForTimeout(500);

check('logo reads Smallhands', (await page.textContent('h1.logo'))?.trim() === 'Smallhands');
check('auto-detects German (lede mentions Siedler)', /Siedler/.test(await page.textContent('.lede')));
check('DE toggle is pressed on a de-DE browser', (await page.getAttribute('.seg-btn[data-lang="de"]', 'aria-pressed')) === 'true');

const iconCount = await page.$$eval('canvas[data-sprite]', (cs) => cs.length);
check('pixel-art icons present', iconCount >= 10, `${iconCount} canvases`);
const painted = await page.$$eval('canvas[data-sprite]', (cs) =>
  cs.filter((c) => {
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
    return false;
  }).length,
);
check('every icon actually drew (non-blank)', painted === iconCount, `${painted}/${iconCount} painted`);
check('Play CTA present', (await page.$('.fd-play')) !== null);

// Toggling to English switches the copy and persists to the game's save slot.
await page.click('.seg-btn[data-lang="en"]');
await page.waitForTimeout(200);
check('EN toggle switches lede to Settlers', /Settlers/.test(await page.textContent('.lede')));
const savedLang = await page.evaluate(() => JSON.parse(localStorage.getItem('smallhands-save-v1') || '{}').lang);
check('language persisted to smallhands-save-v1', savedLang === 'en', `lang=${savedLang}`);

// The choice survives a reload.
await page.reload();
await page.waitForTimeout(400);
check('reload restores English', (await page.getAttribute('.seg-btn[data-lang="en"]', 'aria-pressed')) === 'true');

// Play starts the game in place (no navigation) and enters in-game mode.
await page.click('.fd-play');
await page.waitForTimeout(1000);
check('URL unchanged after Play', page.url().replace(/#.*$/, '') === BASE_URL, page.url());
check('body switched to in-game mode', (await page.getAttribute('body', 'class'))?.includes('in-game'));
check('a game overlay is showing', (await page.$('.overlay')) !== null);

// The old /play/ URL redirects to the unified front door.
await page.goto(BASE_URL + 'play/');
await page.waitForTimeout(500);
check('/play/ redirects home', page.url().replace(/#.*$/, '') === BASE_URL, page.url());

await browser.close();
if (failures) {
  console.log(`\nFRONT-DOOR SMOKE FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nFRONT-DOOR SMOKE PASS');
