// Render-layer regression proof for smooth weather transitions: the sky pixel
// must interpolate CONTINUOUSLY across a phase flip, not snap. Boots the Monsoon
// Hollow weather level (index 5: clear 45s -> rain 30s, daytime), fast-forwards
// to just before the flip, drops to 1x, then samples the top-center canvas pixel
// + game.weatherBlend every frame from before the flip through the full
// WEATHER_FADE crossfade into settled rain.
//
// Needs a production build served and a Chromium (same setup as tests/e2e.mjs):
//   npm run build && (npm run preview &)     # serves dist at :4173
//   export CHROME_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell
//   node tests/weather-visual.mjs            # override host via BASE_URL=...
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH;
const BASE = process.env.BASE_URL || 'http://localhost:4173/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

let failures = 0;
const check = (name, cond) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failures++; };

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('.fd-play'); // Play -> level select
  await page.click('.map-node:not(:disabled)'); // boot any unlocked level to get the debug hook
  await page.click('.map-popover .pop-play');
  await page.waitForFunction(() => !!window.__smallhands, { timeout: 8000 });

  // Jump straight to the weather level (index 5 = id 6, Monsoon Hollow).
  await page.evaluate(() => window.__smallhands.startLevel(5));
  await page.waitForTimeout(300);

  const info = await page.evaluate(() => {
    const g = window.__smallhands.game;
    return { night: !!g.level.night, sched: g.level.weather, blend: g.weatherBlend };
  });
  console.log('level:', JSON.stringify(info));
  check('weather level has a >=2-phase schedule', Array.isArray(info.sched) && info.sched.length >= 2);
  check('level is daytime (sky gradient not overridden by night)', info.night === false);
  check('starts settled (t=1)', info.blend.t === 1);

  // Fast-forward through most of the clear phase, stopping ~2.5s before the flip
  // (still in clear), then drop to 1x so we capture the clear baseline AND the
  // full ~3s crossfade in real time.
  await page.evaluate(() => window.__smallhands.setSpeed(20));
  await page.waitForFunction(() => window.__smallhands.game.weatherRemaining < 2.5, { timeout: 15000 });
  await page.evaluate(() => window.__smallhands.setSpeed(1));

  // Record every frame from here (still clear) until the crossfade into rain
  // settles (to==='rain' && t>=1), or a 14s wall-clock safety cap.
  const timeline = await page.evaluate(() => new Promise((resolve) => {
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const sy = 8; // a sky row near the top
    const out = [];
    const t0 = performance.now();
    // Clouds drift across the sky with per-load-randomised seeds, and the sun
    // and birds sit up here too — any single pixel is unreliable. But the sky
    // gradient is flat across a row, so the bare-sky red is the *median* of a
    // full scan line (clouds/sun lighten it, birds darken it; both are the
    // minority). That isolates the gradient we're actually crossfading.
    function skyRed() {
      const row = ctx.getImageData(0, sy, canvas.width, 1).data;
      const reds = [];
      for (let i = 0; i < row.length; i += 4) reds.push(row[i]);
      reds.sort((a, b) => a - b);
      return reds[reds.length >> 1];
    }
    function frame() {
      const g = window.__smallhands.game;
      const b = g.weatherBlend;
      out.push({ t: +b.t.toFixed(3), from: b.from, to: b.to, r: skyRed(), wf: +g.workFactor.toFixed(2) });
      const settledRain = b.to === 'rain' && b.t >= 1;
      if (!settledRain && performance.now() - t0 < 14000) requestAnimationFrame(frame);
      else resolve(out);
    }
    requestAnimationFrame(frame);
  }));

  // Metrics: the crossfade is the to==='rain' subset (t 0->1); clear baseline is
  // the pre-flip to==='clear' frames.
  const clearSamples = timeline.filter((s) => s.to === 'clear');
  const fade = timeline.filter((s) => s.to === 'rain').sort((a, b) => a.t - b.t);
  const lo = fade[0], hi = fade[fade.length - 1];
  const distinctR = new Set(fade.map((s) => s.r));
  const clearR = clearSamples.length
    ? Math.round(clearSamples.reduce((a, s) => a + s.r, 0) / clearSamples.length)
    : lo.r;
  const midR = fade.filter((s) => s.t > 0.2 && s.t < 0.8).map((s) => s.r);
  const between = midR.filter((r) => r < clearR && r > hi.r).length;
  const wfSeen = [...new Set(timeline.map((s) => s.wf))];

  console.log(`samples=${timeline.length}  clearBaselineR=${clearR}  fade t ${lo.t}->${hi.t}  sky-R ${lo.r}->${hi.r}  distinctR=${distinctR.size}  midBetween=${between}`);
  console.log('workFactor values seen:', JSON.stringify(wfSeen));
  const step = Math.max(1, Math.floor(fade.length / 6));
  console.log('fade (t|sky-R|to):', fade.filter((_, i) => i % step === 0).slice(0, 7).map((s) => `${s.t}|R${s.r}|${s.to}`).join('  '));

  check('captured the flip and the full fade (t ~0 -> ~1)', lo.t < 0.1 && hi.t >= 0.99);
  check('sky darkens from clear baseline toward rain across the fade', clearR - hi.r >= 15);
  check('sky-R interpolates (>=8 distinct values, mids strictly between endpoints)', distinctR.size >= 8 && between >= 3);
  check('blend settled into rain (to=rain, t=1)', hi.to === 'rain' && hi.t >= 0.99);
  // The POINT is that gameplay flips discretely at the phase boundary while the
  // visuals crossfade — exactly two values, never a ramp. The wet number itself is
  // a balance knob (WEATHER_RULES, card #70), so assert the shape, not the value.
  check(
    `workFactor flipped discretely (${wfSeen.join(' -> ')}) — gameplay decoupled from the visual fade`,
    wfSeen.length === 2 && wfSeen.includes(1) && wfSeen.some((v) => v > 0 && v < 1)
  );
  check('no console errors', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('  console errors:', consoleErrors.slice(0, 5));
} catch (e) {
  console.log('THREW:', e.message);
  failures++;
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nVISUAL PASS' : `\n${failures} VISUAL FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
