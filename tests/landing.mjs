// Landing-page smoke test: the site's front door lives at `/`, the game at
// `/play/`. This drives a real browser to check the landing renders, the
// bilingual toggle switches copy and persists to the shared save slot, its
// pixel-art icons actually draw, and the "Play" call-to-action reaches the
// game. Requires the production build to be served (default
// http://localhost:4173/ — `npm run preview`).
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
await page.waitForTimeout(400);

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
check('Play CTA points at ./play/', (await page.getAttribute('a.big-btn', 'href')) === './play/');

// Toggling to English switches the copy and persists to the game's save slot.
await page.click('.seg-btn[data-lang="en"]');
await page.waitForTimeout(150);
check('EN toggle switches lede to Settlers', /Settlers/.test(await page.textContent('.lede')));
const savedLang = await page.evaluate(() => JSON.parse(localStorage.getItem('smallhands-save-v1') || '{}').lang);
check('language persisted to smallhands-save-v1', savedLang === 'en', `lang=${savedLang}`);

// The choice survives a reload.
await page.reload();
await page.waitForTimeout(300);
check('reload restores English', (await page.getAttribute('.seg-btn[data-lang="en"]', 'aria-pressed')) === 'true');

// Play reaches the game, and it boots in the language the landing persisted.
await page.click('a.big-btn');
await page.waitForTimeout(1200);
check('navigated to /play/', page.url().includes('/play/'), page.url());
check('game canvas present', (await page.$('#game-canvas')) !== null);
check(
  'game boots in the persisted language (English)',
  (await page.textContent('.title-sub').catch(() => null)) === 'Tiny workers · Big plans',
);

await browser.close();
if (failures) {
  console.log(`\nLANDING SMOKE FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nLANDING SMOKE PASS');
