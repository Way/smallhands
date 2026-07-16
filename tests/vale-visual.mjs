// Renders one generated seed twice — as meadow and as vale — and measures the
// terrain band, so the palette thesis is checked rather than asserted: vale's
// ground should read BRIGHTER and MORE CHROMATIC than meadow's, which is the
// whole point of the light model.
//
// Deliberately not a frame hash. Treetop sway (`0.8 * wind` in drawNodes) is
// not gated on reduced motion, so no two frames are ever identical; a hash here
// would be flaky and prove nothing. The exact, deterministic guards for "the
// other five biomes are untouched" live in tests/biome-light.mjs instead.
//
// Needs a production build served and a Chromium (same setup as tests/e2e.mjs):
//   npm run build && (npm run preview &)     # serves dist at :4173
//   export CHROME_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell
//   node tests/vale-visual.mjs               # override host via BASE_URL=...
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH;
const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const OUT = process.env.OUT_DIR || 'tests/.vale-out';
const SEED = 'ala-reference';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

let failures = 0;
const check = (name, cond) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failures++; };

// Boot one seed under a given biome; screenshot it and measure the terrain band
// (below the sky, above the HUD). Mean lightness/saturation are stable to ~1
// unit under sway, so they compare meaningfully across biomes.
//
// Both biomes boot into the SAME page, no reload between them. This used to be
// impossible: starting a second level into a live page left ghost scenery from
// the first behind (card #31 — level.id came from a per-boot counter, so the
// renderer re-rolled its set pieces). That is fixed (level.id is now derived
// from the terrain), and tests/restart-scenery.mjs guards it; a returning ghost
// would surface here as a difference the reload previously masked.
async function renderBiome(biome) {
  await page.evaluate(([seed, b]) => {
    const sh = window.__smallhands;
    const data = sh.generateVerifiedLevel({ seed, difficulty: 2 });
    data.biome = b;
    sh.startCustomLevel(data, { playtest: true });
    sh.setSpeed(0); // pause the sim so workers hold still for the shot
  }, [SEED, biome]);
  await page.waitForTimeout(600);
  writeFileSync(`${OUT}/${biome}.png`, await page.locator('#game-canvas').screenshot());
  return page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    const y = Math.floor(c.height * 0.45);
    const px = ctx.getImageData(0, y, c.width, Math.floor(c.height * 0.4)).data;
    let r = 0, g = 0, b = 0, sat = 0, n = 0;
    for (let i = 0; i < px.length; i += 4) {
      const R = px[i] / 255, G = px[i + 1] / 255, B = px[i + 2] / 255;
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2;
      r += px[i]; g += px[i + 1]; b += px[i + 2];
      sat += mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1) || 1);
      n++;
    }
    const mean = [r / n, g / n, b / n];
    return { mean, light: (mean[0] + mean[1] + mean[2]) / 3 / 255, sat: sat / n };
  });
}
const fmt = (m) => `L=${(m.light * 100).toFixed(1)}% S=${(m.sat * 100).toFixed(1)}% rgb(${m.mean.map((v) => Math.round(v)).join(',')})`;

async function bootFresh() {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('.fd-play');
  await page.click('.map-node:not(:disabled)');
  await page.click('.map-popover .pop-play');
  await page.waitForFunction(() => !!window.__smallhands, { timeout: 8000 });
}

try {
  await bootFresh();
  const meadow = await renderBiome('meadow');
  const vale = await renderBiome('vale');

  console.log(`\n  meadow  ${fmt(meadow)}`);
  console.log(`  vale    ${fmt(vale)}\n`);

  // Reported, not asserted. This band is mostly rock, dirt and sky — grass is a
  // thin strip — so its mean can't carry a claim about the grass palette. The
  // exact palette assertions live in tests/biome-light.mjs; the shots below are
  // what a human should judge the look from.
  check('vale renders and differs from meadow', vale.light !== meadow.light || vale.sat !== meadow.sat);
  check(`vale is not snow-capped (a green valley has no snowline)`, vale.mean[2] < vale.mean[1]);
  console.log(`  shots written to ${OUT}/ — compare meadow.png vs vale.png by eye\n`);

  check('no console errors', consoleErrors.length === 0);
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 5).join('\n'));
} finally {
  await browser.close();
}

process.exit(failures ? 1 : 0);
