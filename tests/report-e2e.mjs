// Browser smoke for the report overlay (card #58). Requires the production
// build to be served (default http://localhost:4173/ — `npm run preview`).
//
// The pure half of the feature is covered headlessly in tests/report.mjs; this
// suite exists for the parts only a browser can answer: does the overlay open
// from the menu, does it pause and resume the run, does the clipboard path
// work, and does the download actually emit three files?
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

let failures = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 860 },
  permissions: ['clipboard-read', 'clipboard-write'],
  acceptDownloads: true,
});
const page = await context.newPage();
page.on('pageerror', (e) => {
  console.log('[pageerror]', e.message);
  failures++;
});

await page.goto(BASE_URL);
await page.waitForTimeout(700);
await page.click('.fd-play');
await page.waitForTimeout(300);
await page.click('.map-node:not(:disabled)');
await page.click('.map-popover .pop-play');
await beginRun(page);
await page.waitForTimeout(600);

// play a little, so the snapshot has a non-trivial run behind it
await page.waitForTimeout(1500);

await page.click('.island .menu-trigger');
await page.waitForTimeout(150);
await page.click('.menu-pop .report-open');
await page.waitForTimeout(400);

check('the overlay opens from the menu', (await page.locator('.report-box').count()) === 1);
check(
  'opening the report pauses the run',
  await page.evaluate(() => window.__smallhands.game.paused === true)
);

const preview = await page.textContent('.report-preview');
check('the preview is populated', preview.length > 400);
check('the preview carries a live level code', /SMH1\.[A-Za-z0-9+/=]{40,}/.test(preview));
check('the preview carries the run state', preview.includes('## Run state') && preview.includes('## Workers'));

// typing updates the preview, and does not leak into the game's shortcuts
await page.fill('.report-text', 'the digger will not cross the gap');
await page.waitForTimeout(150);
const typed = await page.textContent('.report-preview');
check('typing flows into the report', typed.includes('the digger will not cross the gap'));
check(
  'typing does not retool the game behind the overlay',
  await page.evaluate(() => window.__smallhands.game.paused === true)
);

// a key that IS a game shortcut ('-' zooms) must be swallowed by the textarea
const zoomBefore = await page.evaluate(() => window.__smallhands.cam?.zoom ?? null);
await page.focus('.report-text');
await page.keyboard.press('Minus');
await page.waitForTimeout(120);
const zoomAfter = await page.evaluate(() => window.__smallhands.cam?.zoom ?? null);
check('a shortcut key typed in the textarea does not zoom the map', zoomBefore === zoomAfter);

// clipboard
await page.click('.report-box .report-copy');
await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('copy puts the whole report on the clipboard', clip.includes('# Smallhands') && clip.includes('SMH1.'));

// download: one gesture, three files
const dir = mkdtempSync(join(tmpdir(), 'smallhands-report-'));
const seen = [];
context.on('download', async (d) => {
  const name = d.suggestedFilename();
  seen.push(name);
  await d.saveAs(join(dir, name));
});
await page.click('.report-box .report-download');
await page.waitForTimeout(4000);
check(`download emits three files (got ${seen.length}: ${seen.join(', ')})`, seen.length === 3);
check('the markdown file is there', seen.some((n) => n.endsWith('.md')));
check('the viewport screenshot is there', seen.some((n) => n.endsWith('-viewport.png')));
check('the whole-map screenshot is there', seen.some((n) => n.endsWith('-map.png')));

// the status line is honest about what happened, not a blanket "saved"
const status = await page.textContent('.report-status');
check(`the status reports the send (${JSON.stringify(status)})`, /3/.test(status));

// closing resumes
await page.click('.report-box .report-close');
await page.waitForTimeout(400);
check('the overlay closes', (await page.locator('.report-box').count()) === 0);
check(
  'closing resumes the run',
  await page.evaluate(() => window.__smallhands.game.paused === false)
);

// Escape closes too, including from the textarea — the global keydown handler
// bails on TEXTAREA targets, so the overlay has to handle this itself.
await page.click('.island .menu-trigger');
await page.waitForTimeout(150);
await page.click('.menu-pop .report-open');
await page.waitForTimeout(400);
check('the overlay reopens', (await page.locator('.report-box').count()) === 1);
await page.focus('.report-text');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Escape from inside the textarea closes the overlay', (await page.locator('.report-box').count()) === 0);
check(
  'and resumes the run',
  await page.evaluate(() => window.__smallhands.game.paused === false)
);

// Escape must also work when focus has left the overlay — clicking the backdrop
// moves it to <body>, where a listener bound to the overlay would never see it.
await page.click('.island .menu-trigger');
await page.waitForTimeout(150);
await page.click('.menu-pop .report-open');
await page.waitForTimeout(400);
await page.evaluate(() => document.activeElement.blur());
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Escape works with focus outside the overlay', (await page.locator('.report-box').count()) === 0);

// A double-click on the menu entry must not stack two overlays while the
// lazily-imported chunk is still loading.
await page.click('.island .menu-trigger');
await page.waitForTimeout(150);
await page.evaluate(() => {
  const b = document.querySelector('.menu-pop .report-open');
  b.click();
  b.click();
});
await page.waitForTimeout(600);
check('a double click opens exactly one overlay', (await page.locator('.report-box').count()) === 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

await browser.close();
console.log(failures === 0 ? 'REPORT E2E PASS' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
