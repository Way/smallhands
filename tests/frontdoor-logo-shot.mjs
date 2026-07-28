// Eyeball helper for the front-door wordmark raise (`fd-logo-raise`).
//
// The raise is a baseline-anchored vertical squash, and the property that makes
// it read as *growth* rather than as an unveiling is that every glyph is whole
// at every stop — a squashed A keeps its crossbar. No assertion can settle
// that; a bottom-up clip reveal would satisfy any height check you could write
// and still look wrong in motion. So this writes one PNG per stop and a human
// looks at them, the same bargain `caravan-shot` and `biome-hills` make.
//
// Freezing is done with a negative `animation-delay` plus `paused`, which seeks
// the animation to an exact offset instead of racing a timer — so the stops are
// reproducible and match the keyframe percentages by construction.
//
// Requires the production build served at http://localhost:4173/ (npm run preview).
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';
const OUT = new URL('.logo-out/', import.meta.url).pathname;

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

// The keyframe stops, as authored. Height is checked against these rather than
// against a fitted easing, because the keyframes *are* the measurement.
const STOPS = [
  [0, 0],
  [0.05, 0.09],
  [0.1, 0.19],
  [0.2, 0.47],
  [0.3, 0.67],
  [0.4, 0.81],
  [0.5, 0.92],
  [0.6, 1],
];

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => {
  console.log('[pageerror]', e.message);
  failures++;
});
await page.goto(BASE_URL);
await page.waitForTimeout(600);

// Full height with the animation cleared, to normalise the measured stops against.
const full = await page.evaluate(() => {
  const el = document.querySelector('#frontdoor .logo');
  el.style.animation = 'none';
  return el.getBoundingClientRect().height;
});
check('wordmark has a measurable height', full > 20, `${full.toFixed(1)}px`);

console.log('\n  stop      scaleY   expected');
for (const [t, expected] of STOPS) {
  const h = await page.evaluate((sec) => {
    const el = document.querySelector('#frontdoor .logo');
    el.style.animation = 'fd-logo-raise 0.6s linear 1 forwards';
    el.style.animationDelay = `-${sec}s`;
    el.style.animationPlayState = 'paused';
    return el.getBoundingClientRect().height;
  }, t);
  const got = h / full;
  console.log(`  t=${t.toFixed(2)}s   ${got.toFixed(3)}    ${expected.toFixed(3)}`);
  check(`stop ${t.toFixed(2)}s tracks its keyframe`, Math.abs(got - expected) < 0.04, `${got.toFixed(3)} vs ${expected.toFixed(3)}`);

  const box = await page.locator('#frontdoor .hero-in').boundingBox();
  await page.screenshot({
    path: `${OUT}t${String(Math.round(t * 100)).padStart(3, '0')}.png`,
    clip: { x: box.x, y: Math.max(0, box.y - 10), width: box.width, height: 250 },
  });
}

// Growth is monotonic and anchored: the wordmark's *bottom* must not move, or
// the letters are sliding rather than growing out of the baseline.
const bottoms = [];
for (const [t] of STOPS) {
  bottoms.push(
    await page.evaluate((sec) => {
      const el = document.querySelector('#frontdoor .logo');
      el.style.animation = 'fd-logo-raise 0.6s linear 1 forwards';
      el.style.animationDelay = `-${sec}s`;
      el.style.animationPlayState = 'paused';
      return el.getBoundingClientRect().bottom;
    }, t),
  );
}
const drift = Math.max(...bottoms) - Math.min(...bottoms);
check('baseline stays put across the raise', drift < 1.5, `${drift.toFixed(2)}px drift`);

// Reduced motion must land on the finished wordmark, not on a frozen squash.
const rmCtx = await browser.newContext({
  locale: 'en-US',
  viewport: { width: 1280, height: 900 },
  reducedMotion: 'reduce',
});
const rmPage = await rmCtx.newPage();
await rmPage.goto(BASE_URL);
await rmPage.waitForTimeout(500);
const rm = await rmPage.evaluate(() => {
  const el = document.querySelector('#frontdoor .logo');
  const cs = getComputedStyle(el);
  return { h: el.getBoundingClientRect().height, opacity: cs.opacity };
});
check('reduced motion shows the wordmark full height', Math.abs(rm.h - full) < 2, `${rm.h.toFixed(1)}px vs ${full.toFixed(1)}px`);
check('reduced motion shows the wordmark opaque', Number(rm.opacity) > 0.99, `opacity ${rm.opacity}`);

await browser.close();
console.log(`\n  wrote ${STOPS.length} stops to tests/.logo-out/`);
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
