// The version the player sees must be the version the report carries, and it must
// be a real date. Three surfaces read one build-time stamp (__VERSION__, defined in
// vite.config.ts): the front-door footer, the options menu, and the bug report's
// Build line (which carries __BUILD__ = __VERSION__ + '+' + sha).
//
// This suite never recomputes the date. Re-deriving it here would duplicate the
// arithmetic in vite.config.ts, and a duplicated derivation drifts and then goes on
// passing while the screen is wrong. It asserts only that the surfaces agree and
// that the shape is a date — which is also what catches the 'dev' fallback reaching
// a production build, a failure the build itself reports as success.
//
// Requires the production build served at http://localhost:4173/ (npm run preview):
// `define` substitution only happens in a real build, so a dev server would assert
// against the literal token.
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => {
  console.log('[pageerror]', e.message);
  failures++;
});

await page.goto(BASE_URL);
await page.waitForTimeout(500);

// ---------------------------------------------------------- 1. the front door
// The label and the number share one line ("Version 2026.07.29"); strip the
// leading label word so the assertion is about the number itself.
const footerLine = (await page.textContent('.fd-version'))?.trim() ?? '';
const shown = footerLine.replace(/^\s*\S+\s+/, '').trim();
const DATE = /^\d{4}\.\d{2}\.\d{2}$/;
check(
  'footer shows a calendar version, not the dev fallback',
  DATE.test(shown),
  `footer reads "${footerLine}"`,
);

// ------------------------------------------------------------- 2. the options menu
// Reached from the front door rather than from a level: it is the same showOptions()
// either way, and style.css keeps that overlay visible in front-door mode on purpose.
// .opt-value is unique to the version row, and carries the number with no label.
await page.click('.fd-options');
await page.waitForTimeout(250);
const inOptions = (await page.textContent('.opt-value'))?.trim() ?? '';
check(
  'options row shows the same version as the footer',
  inOptions === shown && shown !== '',
  `options="${inOptions}" footer="${shown}"`,
);

// -------------------------------------------------------------- 3. the bug report
// The report is in-level only (it carries a snapshot of the live map), so this walks
// the same path tests/report-e2e.mjs does. __BUILD__ is the shown version plus the
// short sha: same-day pushes share a version, and this is where they separate.
await page.click('.options-box .big-btn'); // Back → front door
await page.waitForTimeout(250);
await page.click('.fd-play');
await page.waitForTimeout(300);
await page.click('.map-node:not(:disabled)');
await page.click('.map-popover .pop-play');
await page.waitForTimeout(600);

await page.click('.island .menu-trigger');
await page.waitForTimeout(150);
await page.click('.menu-pop .report-open');
await page.waitForTimeout(400);

const md = await page.textContent('.report-preview');
const buildLine = md.split('\n').find((l) => l.startsWith('- **Build:**')) ?? '';
check('the report has a Build line', buildLine !== '', md.slice(0, 200));
check(
  'the reported build starts with the version on screen',
  buildLine.startsWith(`- **Build:** ${shown}+`),
  buildLine,
);

await browser.close();
if (failures) {
  console.log(`\nVERSION FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nVERSION PASS');
