// Regression for card #31: starting a level into an already-running page must
// render identically to the first boot. The bug was that levelDefFromData minted
// a fresh `id` from a monotonic counter on every boot, and the renderer keys its
// scenic decoration (set pieces, waterfalls, rock strata) off level.id — so the
// SAME terrain grew DIFFERENT ghost scenery on its second boot, following render
// order rather than level content.
//
// The oracle is the set of drawImage calls on the game canvas (source size @
// destination), NOT a pixel hash: treetop sway keeps the render clock advancing
// so no two frames are ever pixel-equal (see tests/vale-visual.mjs). We freeze
// the render clock (the rAF timestamp the frame loop draws with) to a constant,
// which removes sway and makes a boot's draw set fully deterministic; any leftover
// per-boot difference is then a real leak.
//
//   npm run build && (npm run preview -- --port <p> &)
//   export CHROME_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell
//   BASE_URL=http://localhost:<p>/ node tests/restart-scenery.mjs
import { chromium } from 'playwright-core';

const CHROME = process.env.CHROME_PATH;
const BASE = process.env.BASE_URL || 'http://localhost:4173/';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) { failures++; if (extra) console.log('       ' + extra); }
};

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(800);
await page.click('.fd-play');
await page.click('.map-node:not(:disabled)');
await page.click('.map-popover .pop-play');
await page.waitForFunction(() => !!window.__smallhands, { timeout: 8000 });

// Freeze the render clock (constant rAF timestamp) so sway can't perturb the
// draw set, and record every drawImage on the game canvas while __rec is on.
await page.evaluate(() => {
  const T = 100000;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf(() => cb(T));
  window.__draws = [];
  window.__rec = false;
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.drawImage;
  proto.drawImage = function (img, ...a) {
    if (window.__rec && this.canvas && this.canvas.id === 'game-canvas') {
      const dx = a.length >= 6 ? a[4] : a[0];
      const dy = a.length >= 6 ? a[5] : a[1];
      window.__draws.push(`${img.width}x${img.height}@${Math.round(dx)},${Math.round(dy)}`);
    }
    return orig.apply(this, [img, ...a]);
  };
});

const start = (seed, biome) => page.evaluate(([seed, biome]) => {
  const sh = window.__smallhands; // re-read: the whole object is replaced on every startGame
  const d = sh.generateVerifiedLevel({ seed, difficulty: 2 });
  d.biome = biome;
  sh.startCustomLevel(d, { playtest: true });
  sh.setSpeed(0); // pause so workers hold still
}, [seed, biome]);

// One boot's deterministic draw set (frozen clock → identical every frame).
const capture = () => page.evaluate(() => new Promise((res) => {
  window.__draws = [];
  window.__rec = true;
  const raf = window.requestAnimationFrame;
  raf(() => raf(() => raf(() => { window.__rec = false; res([...new Set(window.__draws)]); })));
}));

const diff = (a, b) => {
  const A = new Set(a), B = new Set(b);
  const extra = [...B].filter((k) => !A.has(k));
  const missing = [...A].filter((k) => !B.has(k));
  return { extra, missing, equal: extra.length === 0 && missing.length === 0 };
};

try {
  // 1) Same level, back to back: the second boot must draw exactly what the first did.
  await start('ala-reference', 'meadow');
  const first = await capture();
  await start('ala-reference', 'meadow');
  const second = await capture();
  const d1 = diff(first, second);
  check(
    'same level twice renders identically',
    d1.equal,
    `+${d1.extra.length} ghost draw(s): ${d1.extra.join(' ')}  -${d1.missing.length}: ${d1.missing.join(' ')}`
  );

  // 2) Interleave a different level, then return: booting another map between two
  //    boots of the same map must not corrupt the second render (the "follows
  //    render order, not content" hazard).
  await start('ala-reference', 'meadow');
  const before = await capture();
  await start('ghost-probe-other', 'meadow');
  await capture();
  await start('ala-reference', 'meadow');
  const after = await capture();
  const d2 = diff(before, after);
  check(
    'same level renders identically after another level was booted between',
    d2.equal,
    `+${d2.extra.length}: ${d2.extra.join(' ')}  -${d2.missing.length}: ${d2.missing.join(' ')}`
  );

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join('\n'));
} finally {
  await browser.close();
}

process.exit(failures ? 1 : 0);
