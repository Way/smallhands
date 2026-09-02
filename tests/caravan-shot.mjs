// Eyeball helper (not an assertion suite): renders the goal caravan at several
// load levels and at both convoy states, cropped tight, into tests/.caravan-out/.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { beginRun } from './enter.mjs';

const CHROME = process.env.CHROME_PATH;
const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const OUT = process.env.OUT_DIR || 'tests/.caravan-out';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('pageerror: ' + e.message));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(800);
await page.click('.fd-play');
await page.click('.map-node:not(:disabled)');
await page.click('.map-popover .pop-play');
await beginRun(page);
await page.waitForFunction(() => !!window.__smallhands, { timeout: 8000 });
await page.waitForTimeout(400);

// Apply a mutation and return the goal's CSS-pixel rect, so the shot can be
// clipped to it rather than fighting cam.clamp for a zoom on a small level.
async function frame(mut) {
  await page.evaluate((src) => {
    const sh = window.__smallhands;
    const g = sh.game;
    // eslint-disable-next-line no-new-func
    new Function('g', src)(g);
    sh.setSpeed(0);
    // Zoom past the point where the world fits the viewport, or cam.clamp
    // re-centres the camera and every manual cam.x/cam.y is thrown away.
    const goal = g.buildings.find((b) => b.kind === 'goal');
    const c = document.getElementById('game-canvas');
    sh.cam.zoom = 4;
    sh.cam.x = (goal.x + 2) * 64 - c.width / 2;
    sh.cam.y = (goal.y + 1.5) * 64 - c.height / 2;
  }, mut);
  await page.waitForTimeout(260);
  // Read the LIVE (already clamped) camera before clipping, so the crop lands
  // on the caravan even where the clamp moved it.
  return page.evaluate(() => {
    const sh = window.__smallhands;
    const goal = sh.game.buildings.find((b) => b.kind === 'goal');
    const cam = sh.cam;
    const c = document.getElementById('game-canvas');
    const dpr = c.width / c.clientWidth;
    const z = 16 * cam.zoom;
    const pad = 1.2 * z;
    return {
      x: Math.max(0, (goal.x * z - cam.x - pad) / dpr),
      y: Math.max(0, (goal.y * z - cam.y - pad) / dpr),
      width: (4 * z + pad * 2) / dpr,
      height: (3 * z + pad * 2) / dpr,
    };
  });
}

const shots = {
  'load-0': 'g.objectives.forEach(o => o.delivered = 0)',
  'load-1': 'g.objectives.forEach(o => o.delivered = 1)',
  'load-half': 'g.objectives.forEach(o => o.delivered = Math.ceil(o.amount / 2))',
  'load-full': 'g.objectives.forEach(o => o.delivered = o.amount)',
  'convoy-leaving': 'g.level.convoy = { open: 12, closed: 12 }; g.time = 12.5',
  'convoy-gone': 'g.level.convoy = { open: 12, closed: 12 }; g.time = 18',
  'convoy-returning': 'g.level.convoy = { open: 12, closed: 12 }; g.time = 24.6',
};
for (const [name, src] of Object.entries(shots)) {
  const clip = await frame(src);
  writeFileSync(`${OUT}/${name}.png`, await page.screenshot({ clip }));
  console.log('  wrote', name);
}
// and one wide shot so the caravan can be judged against the town hall next to it
await page.evaluate(() => {
  const sh = window.__smallhands;
  sh.cam.zoom = 2;
  sh.game.level.convoy = undefined;
});
await page.waitForTimeout(260);
writeFileSync(`${OUT}/wide.png`, await page.locator('#game-canvas').screenshot());
await browser.close();
