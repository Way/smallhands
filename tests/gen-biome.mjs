// The Generate-a-level dialog's biome override is the only way to reach a biome
// the generator doesn't draw from (see GENERATED_BIOMES) — without it `vale` is
// unreachable in-game. Drives the real UI, not the debug hook.
//
//   npm run build && (npm run preview &)
//   export CHROME_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell
//   node tests/gen-biome.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

let failures = 0;
const check = (name, cond) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failures++; };

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('.fd-play');
  await page.click('.legend-btn.mine'); // custom-levels drawer holds the generator entry
  await page.waitForTimeout(400);

  // Find the Generate dialog's biome select among the gen-rows.
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /generate/i.test(b.textContent || ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('generate-level dialog opens', opened);
  await page.waitForTimeout(400);

  const opts = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('.gen-row select')];
    const biome = sels.find((s) => [...s.options].some((o) => o.value === 'vale'));
    return biome ? { values: [...biome.options].map((o) => o.value), labels: [...biome.options].map((o) => o.textContent) } : null;
  });
  check('a biome select exists in the dialog', !!opts);
  check('it defaults to "from seed" (empty = seed decides)', opts && opts.values[0] === '');
  check('every biome is offered, including vale', opts && ['meadow', 'autumn', 'chalk', 'redrock', 'slate', 'vale'].every((b) => opts.values.includes(b)));
  check('labels are translated, not raw keys', opts && !opts.labels.some((l) => /^(gen|biome)\./.test(l || '')));

  // Pick vale, play, and confirm the running level actually is vale.
  // Scope the Play lookup to the dialog's own .btn-row — the front door's
  // .fd-play button is still in the DOM and matches /play/i first otherwise.
  await page.evaluate(() => {
    const sels = [...document.querySelectorAll('.gen-row select')];
    const biome = sels.find((s) => [...s.options].some((o) => o.value === 'vale'));
    biome.value = 'vale';
    biome.dispatchEvent(new Event('change', { bubbles: true }));
    [...document.querySelectorAll('.btn-row button')].find((b) => /play/i.test(b.textContent || ''))?.click();
  });
  await page.waitForTimeout(1200);

  // Re-read the hook: startGame REPLACES the whole __smallhands object.
  const biome = await page.evaluate(() => window.__smallhands?.game?.level?.biome);
  check(`the running level is vale (got: ${biome})`, biome === 'vale');
  check('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.slice(0, 3).join('\n'));
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
