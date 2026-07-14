// Teaser scene capture — plays the real game headlessly and records one webm
// clip per scene into video/public/clips/, plus a manifest.json describing
// where the "usable" window starts inside each recording (everything before
// it is scene setup: level boot, fast-forward, camera placement).
//
// Needs a production build served (npm run build && npm run preview) and a
// Chromium. Same conventions as tests/e2e.mjs:
//   BASE_URL     override the served game (default http://localhost:4173/)
//   CHROME_PATH  Chromium executable (default: Playwright's own install)
//   LANG_OVERRIDE 'de' (default) or 'en' — seeds the save slot's language
//
//   node video/capture.mjs            # capture every scene
//   node video/capture.mjs wetter nacht   # re-capture a subset
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIPS = join(HERE, 'public', 'clips');
const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const CHROME = process.env.CHROME_PATH || undefined;
const LANG = process.env.LANG_OVERRIDE || 'de';
const W = 1280;
const H = 720;

// ---------------------------------------------------------------------------
// In-page helpers, injected into every scene. All of them go through the
// game's real debug hook (window.__smallhands) and real placement APIs, so
// everything on screen is the actual simulation at work.
const PAGE_HELPERS = `(() => {
  const S = () => window.__smallhands;
  window.__cine = {
    game: () => S().game,
    // Frame a tile at the viewport centre (world tiles -> camera device px).
    lookAt(tx, ty, zoom) {
      const cam = S().cam;
      if (zoom) cam.zoom = zoom;
      cam.x = tx * 16 * cam.zoom - ${W} / 2;
      cam.y = ty * 16 * cam.zoom - ${H} / 2;
    },
    // Smooth eased pan between two tile-space anchors over durMs.
    pan(fromX, fromY, toX, toY, zoom, durMs) {
      const cam = S().cam;
      if (zoom) cam.zoom = zoom;
      const z = cam.zoom;
      const px = (t) => t * 16 * z - ${W} / 2;
      const py = (t) => t * 16 * z - ${H} / 2;
      const t0 = performance.now();
      const ease = (u) => u * u * (3 - 2 * u); // smoothstep
      return new Promise((resolve) => {
        (function step() {
          const u = Math.min(1, (performance.now() - t0) / durMs);
          const e = ease(u);
          cam.x = px(fromX) + (px(toX) - px(fromX)) * e;
          cam.y = py(fromY) + (py(toY) - py(fromY)) * e;
          if (u < 1) requestAnimationFrame(step);
          else resolve();
        })();
      });
    },
    // Kill tutorial hint toasts for clean footage (weather/system toasts stay).
    // Intro hints fire on the level's very first tick — before this can run —
    // so clearToasts() sweeps any already-visible toast out of the DOM too.
    muteHints() { const g = S().game; if (g && g.level) g.level.hints = []; },
    clearToasts() { document.querySelectorAll('.toast-wrap > *').forEach((e) => e.remove()); },
    // Built platform tiles on a row segment (T.PLATFORM === 5).
    platformCount(x0, x1, y) {
      const g = S().game;
      let n = 0;
      for (let x = x0; x <= x1; x++) if (g.world.get(x, y) === 5) n++;
      return n;
    },
    grant(items) { const g = S().game; for (const [k, v] of Object.entries(items)) g.stock[k] = (g.stock[k] || 0) + v; },
    markAll(fromX, toX) {
      const g = S().game;
      for (const n of g.nodes) if (n.x >= (fromX ?? -1e9) && n.x <= (toX ?? 1e9)) n.marked = true;
    },
    // Mark one unmarked node near tile x with the real click path (gold burst).
    markNear(x) {
      const g = S().game;
      const c = g.nodes.filter((n) => !n.marked).sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
      if (c) g.toggleMark(c.x, c.y);
      return c ? { x: c.x, y: c.y, kind: c.kind } : null;
    },
  };
})();`;

// ---------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootScene(browser, { needGame = true } = {}) {
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: CLIPS, size: { width: W, height: H } },
  });
  // Seed the save slot: all campaigns unlocked, sound off, language pinned.
  await context.addInitScript(`
    localStorage.setItem('smallhands-save-v1', JSON.stringify({
      completed: [1,2,3,4,5,6,7,8,9,10,11,12],
      completedCustom: [], records: {}, muted: true, lang: '${LANG}', effects: 'full',
    }));
  `);
  const page = await context.newPage();
  const startedAt = Date.now();
  page.on('pageerror', (e) => console.log('  pageerror:', e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  if (needGame) {
    await page.click('.fd-play');
    await page.click('.level-card:not(.locked)');
    await page.waitForFunction(() => !!window.__smallhands, { timeout: 8000 });
    await page.evaluate(PAGE_HELPERS);
  }
  return { context, page, startedAt };
}

async function startLevel(page, idx) {
  await page.evaluate((i) => window.__smallhands.startLevel(i), idx);
  await page.evaluate(PAGE_HELPERS); // startLevel rebuilds the debug hook
  await page.evaluate(() => window.__cine.muteHints());
}

const setSpeed = (page, s) => page.evaluate((v) => window.__smallhands.setSpeed(v), s);

// Record the usable window of a scene: returns {start, duration} in seconds
// relative to the recording origin (context creation ≈ video t=0).
async function window_(startedAt, seconds, body) {
  const start = (Date.now() - startedAt) / 1000;
  await body();
  await sleep(Math.max(0, seconds * 1000 - (Date.now() - startedAt - start * 1000)));
  return { start, duration: (Date.now() - startedAt) / 1000 - start };
}

async function finishScene(context, page, id) {
  const video = page.video();
  await context.close(); // flushes the recording
  const tmp = await video.path();
  const dest = join(CLIPS, `${id}.webm`);
  await rm(dest, { force: true });
  await rename(tmp, dest);
  return dest;
}

// ---------------------------------------------------------------------------
// Scenes. Each returns { start, duration } — the trim window for Remotion.
const SCENES = {
  // The animated title screen doubles as the opener and the end card.
  async title(browser) {
    const { context, page, startedAt } = await bootScene(browser, { needGame: false });
    await sleep(1200); // let the backdrop settle
    const win = await window_(startedAt, 9, async () => {});
    const file = await finishScene(context, page, 'title');
    return { file, ...win };
  },

  // Core loop: mark resources, the crew does the rest (level 1, First Steps).
  async mechanik(browser) {
    const { context, page, startedAt } = await bootScene(browser);
    await startLevel(page, 0);
    // Warm the level up so workers are already mid-job when we roll: mark the
    // two easternmost trees and fast-forward.
    await page.evaluate(() => {
      const g = window.__cine.game();
      const trees = g.nodes.filter((n) => n.kind === 'tree').sort((a, b) => b.x - a.x);
      for (const n of trees.slice(0, 2)) n.marked = true;
    });
    await setSpeed(page, 8);
    await sleep(4000);
    await setSpeed(page, 3);
    await page.evaluate(() => { window.__cine.clearToasts(); window.__cine.lookAt(15, 15, 3); });
    const win = await window_(startedAt, 10, async () => {
      // On camera: fresh harvest orders land with their gold spark burst while
      // the earlier crew is already chopping and hauling.
      (async () => {
        await sleep(700);
        await page.evaluate(() => window.__cine.markNear(14));
        await sleep(900);
        await page.evaluate(() => window.__cine.markNear(18));
        await sleep(900);
        await page.evaluate(() => window.__cine.markNear(22));
        await page.evaluate(() => window.__cine.pan(15, 15, 20, 15, 3, 6000));
      })();
    });
    const file = await finishScene(context, page, 'mechanik');
    return { file, ...win };
  },

  // Shape the world: a plank bridge grows across the lake (level 8 terrain).
  async bauen(browser) {
    const { context, page, startedAt } = await bootScene(browser);
    await startLevel(page, 7);
    await page.evaluate(() => {
      window.__cine.grant({ plank: 40, stone: 10, log: 10 });
      window.__cine.markAll(38); // goods beyond the lake: traffic once it's bridged
      const g = window.__cine.game();
      g.placeRampRun(14, 20, 16, 22); // the crew's way down to the shore
    });
    await setSpeed(page, 12);
    await sleep(5000); // ramp gets built, builders return to idle
    // Lay the bridge order and wait for the first plank to go down, then roll
    // the camera while the rest of the span grows across the water.
    await page.evaluate(() => window.__cine.game().placeBridgeRun(26, 23, 37, 23));
    await setSpeed(page, 5);
    await page.waitForFunction(() => window.__cine.platformCount(26, 37, 23) >= 1, { timeout: 60000 });
    await page.evaluate(() => { window.__cine.clearToasts(); window.__cine.lookAt(28, 20.5, 2); });
    const win = await window_(startedAt, 11, async () => {
      (async () => {
        await sleep(800);
        await page.evaluate(() => window.__cine.pan(28, 20.5, 34, 20.5, 2, 8000));
      })();
    });
    const file = await finishScene(context, page, 'bauen');
    return { file, ...win };
  },

  // Weather on a forecast: catch the clear->rain crossfade live (Monsoon Hollow).
  async wetter(browser) {
    const { context, page, startedAt } = await bootScene(browser);
    await startLevel(page, 5);
    await page.evaluate(() => window.__cine.markAll());
    await setSpeed(page, 20);
    await page.waitForFunction(() => window.__smallhands.game.weatherRemaining < 1.2, { timeout: 20000 });
    // Speed 2 keeps the sim lively even under screencast load (the render loop
    // clamps dt, so headless recording runs the sim below wall-clock at 1x).
    // Roll from the moment the sky flips: the rain toast, the darkening
    // crossfade and the slowed crew all land inside the window.
    await setSpeed(page, 2);
    await page.evaluate(() => { window.__cine.clearToasts(); window.__cine.lookAt(16, 16.5, 2); });
    await page.waitForFunction(() => window.__smallhands.game.weather === 'rain', { timeout: 20000 });
    const win = await window_(startedAt, 11, async () => {
      (async () => {
        await sleep(500);
        await page.evaluate(() => window.__cine.pan(16, 16.5, 21, 16.5, 2, 9000));
      })();
    });
    const file = await finishScene(context, page, 'wetter');
    return { file, ...win };
  },

  // Night shift: lantern light pools push back the dark (Lantern Ridge).
  async nacht(browser) {
    const { context, page, startedAt } = await bootScene(browser);
    await startLevel(page, 6);
    await page.evaluate(() => {
      window.__cine.grant({ log: 12, stone: 12, plank: 10 });
      window.__cine.markAll(0, 30);
      const g = window.__cine.game();
      g.placeBuilding('lantern', 14, 20);
      g.placeBuilding('lantern', 20, 19);
      g.placeBuilding('lantern', 27, 19);
    });
    await setSpeed(page, 12);
    await page.waitForFunction(
      () => window.__smallhands.game.buildings.filter((b) => b.kind === 'lantern' && b.state === 'ready').length >= 2,
      { timeout: 30000 }
    );
    await sleep(1500);
    await setSpeed(page, 2);
    await page.evaluate(() => { window.__cine.clearToasts(); window.__cine.lookAt(10, 17, 2); });
    const win = await window_(startedAt, 10, async () => {
      (async () => {
        await sleep(400);
        await page.evaluate(() => window.__cine.pan(10, 17, 24, 17, 2, 8500));
      })();
    });
    const file = await finishScene(context, page, 'nacht');
    return { file, ...win };
  },

  // The counterweight hoist: the heavier side sinks (The Turning Wheel).
  async hoist(browser) {
    const { context, page, startedAt } = await bootScene(browser);
    await startLevel(page, 9);
    await page.evaluate(() => {
      window.__cine.markAll();
      window.__cine.grant({ plank: 20, stone: 12, log: 12 });
      window.__cine.game().placeHoist(27, 16);
    });
    await setSpeed(page, 15);
    await page.waitForFunction(
      () => window.__smallhands.game.hoists.some((b) => b.state === 'ready'),
      { timeout: 40000 }
    );
    await page.evaluate(() => {
      const g = window.__cine.game();
      const b = g.hoists[0];
      g.toggleHoistRoute(b.id, 'upper', 'plank');
      g.toggleHoistRoute(b.id, 'upper', 'stone');
    });
    // Wait until cargo has actually been loaded into a car, so a wheel cycle
    // is imminent, then slow down and film it.
    await page.waitForFunction(() => {
      const b = window.__smallhands.game.hoists[0];
      return /plank|stone|log/.test(JSON.stringify(b.hoistUpper) + JSON.stringify(b.hoistLower));
    }, { timeout: 40000 });
    await setSpeed(page, 3);
    await page.evaluate(() => { window.__cine.clearToasts(); window.__cine.lookAt(27.5, 17.5, 3); });
    const win = await window_(startedAt, 10, async () => {});
    const file = await finishScene(context, page, 'hoist');
    return { file, ...win };
  },
};

// ---------------------------------------------------------------------------
const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(SCENES);
for (const n of names) if (!SCENES[n]) { console.error(`unknown scene "${n}" — have: ${Object.keys(SCENES).join(', ')}`); process.exit(1); }

await mkdir(CLIPS, { recursive: true });
const manifestPath = join(CLIPS, 'manifest.json');
let manifest = {};
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* first run */ }

const browser = await chromium.launch({ headless: true, executablePath: CHROME });
try {
  for (const name of names) {
    process.stdout.write(`scene ${name} … `);
    const t0 = Date.now();
    const { file, start, duration } = await SCENES[name](browser);
    manifest[name] = { file: `clips/${name}.webm`, start: +start.toFixed(2), duration: +duration.toFixed(2) };
    console.log(`ok (${((Date.now() - t0) / 1000).toFixed(0)}s wall, usable ${duration.toFixed(1)}s @ +${start.toFixed(1)}s)`);
  }
} finally {
  await browser.close();
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nwrote ${manifestPath}`);
