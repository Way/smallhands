// Eyeball helper for the parallax-hill palette (card #76). Writes one PNG per
// (biome x weather x light) case to tests/.hills-out/ and prints the measured
// colour of each of the three distant layers, so a palette pass can be judged
// rather than argued.
//
// It is a HELPER, not the guard: the deterministic invariant ("an arid biome's
// hills must not read green") lives in tests/biome-light.mjs, which asserts on
// the same `biomeHills` the renderer calls. This file exists because the thing
// the card is actually about — does the horizon look like it belongs to the
// terrain — is a judgement no number settles.
//
// Layers are sampled at their own parallax baselines (drawDistantTerrain):
// horizon H*0.62-95.., midground H*0.72-60.., near scrub H*0.84-44... Terrain and
// set pieces are painted over all three, so each row's MEDIAN pixel is taken —
// the hill fill is the majority of a row up there, a cloud or a tree is not.
//
// Needs a production build served and a Chromium (same setup as tests/e2e.mjs):
//   npm run build && (npx vite preview --port 4188 --strictPort &)
//   export CHROME_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell
//   node tests/biome-hills.mjs               # override host via BASE_URL=...
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { beginRun } from './enter.mjs';

const CHROME = process.env.CHROME_PATH;
const BASE = process.env.BASE_URL || 'http://localhost:4188/';
const OUT = process.env.OUT_DIR || 'tests/.hills-out';
const SEED = 'ala-reference';

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

let failures = 0;
const check = (name, cond) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) failures++; };

// Rows chosen to land inside each layer's band for a mid-height crest. Sky is
// the reference the horizon layer is mixed toward.
//
// Only `horizon` and `mid` are asserted on. Where the third layer lands depends
// on the camera — on both campaign levels and the generated map the 0.79 row is
// already behind the playable grid, so what it reports there is the terrain's
// own colour, not the scrub silhouette. It is printed because it is a useful
// sanity check (the ground of an arid biome should be warm too) and left
// unasserted because it would be asserting the wrong thing. All three layers ARE
// pinned exactly, under every weather look, in tests/biome-light.mjs — which can
// compute them instead of hunting for them in a screenshot.
const ROWS = [['sky', 0.1], ['horizon', 0.58], ['mid', 0.66], ['near/ground', 0.79]];
const ASSERTED = ['horizon', 'mid'];

const hue = (c) => {
  const [r, g, b] = c.map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 0.004) return null;
  let h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};
const fmt = (c) => {
  const h = hue(c);
  return `rgb(${c.join(',')})${h === null ? ' grey  ' : ` h=${String(Math.round(h)).padStart(3)}°`}${c[0] > c[1] ? ' R>G' : ' G>=R'}`;
};
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

// Per-channel median of a scan row. A hill fill is flat, so every channel's
// median lands on the same pixel population in the cases that matter.
async function measure() {
  return page.evaluate((rows) => {
    const c = document.getElementById('game-canvas');
    const ctx = c.getContext('2d');
    const out = {};
    for (const [name, frac] of rows) {
      const px = ctx.getImageData(0, Math.round(c.height * frac), c.width, 1).data;
      const ch = [[], [], []];
      for (let i = 0; i < px.length; i += 4) { ch[0].push(px[i]); ch[1].push(px[i + 1]); ch[2].push(px[i + 2]); }
      out[name] = ch.map((a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; });
    }
    return out;
  }, ROWS);
}

// A generated level of one biome under a single forced weather phase — one long
// phase, so the blend is settled (t=1) and the shot is the preset itself rather
// than a crossfade caught halfway through it.
async function startCase(seed, biome, kind, night) {
  await page.evaluate(([s, b, k, n]) => {
    const sh = window.__smallhands;
    const data = sh.generateVerifiedLevel({ seed: s, difficulty: 2 });
    data.biome = b;
    data.world = { ...(data.world || {}), weather: [{ kind: k, duration: 9999 }] };
    if (n) data.world.night = true;
    sh.startCustomLevel(data, { playtest: true });
    sh.begin();
    sh.setShipping(true);
    sh.setSpeed(0); // hold the workers still for the shot
  }, [seed, biome, kind, night]);
}

async function shot(label) {
  await page.waitForTimeout(700);
  writeFileSync(`${OUT}/${label}.png`, await page.locator('#game-canvas').screenshot());
  const m = await measure();
  const where = await page.evaluate(() => {
    const g = window.__smallhands.game;
    return `${g.level.biome ?? 'meadow'} ${g.weatherBlend ? g.weatherBlend.to : '-'}${g.level.night ? ' night' : ''}`;
  });
  console.log(`\n  ${label}  [${where}]`);
  for (const [name] of ROWS) console.log(`    ${name.padEnd(8)} ${fmt(m[name])}`);
  return m;
}

try {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.click('.fd-play');
  await page.click('.map-node:not(:disabled)');
  await page.click('.map-popover .pop-play');
  await beginRun(page);
  await page.waitForFunction(() => !!window.__smallhands, { timeout: 8000 });

  const got = {};
  for (const biome of ['meadow', 'redrock', 'chalk']) {
    for (const kind of ['clear', 'rain', 'storm']) {
      await startCase(SEED, biome, kind, false);
      got[`${biome}-${kind}`] = await shot(`${biome}-${kind}`);
    }
    await startCase(SEED, biome, 'clear', true);
    got[`${biome}-night`] = await shot(`${biome}-night`);
  }

  // The two hand-authored redrock levels the card names, straight from the
  // campaign — different terrain shapes and camera than a generated map.
  for (const [label, idx] of [['lvl18', 17], ['lvl22', 21]]) {
    await page.evaluate((i) => {
      window.__smallhands.startLevel(i);
      window.__smallhands.begin();
      window.__smallhands.setShipping(true);
      window.__smallhands.setSpeed(0);
    }, idx);
    got[label] = await shot(label);
  }

  console.log(`\n  shots written to ${OUT}/\n`);

  // The card's complaint, as an oracle: on a redrock map no distant layer may
  // read green. Checked under all three weathers, because the hill colours are
  // the WEATHER look tinted — a fix that only works at clear noon is not one.
  for (const layer of ASSERTED) {
    for (const kind of ['clear', 'rain', 'storm']) {
      const c = got[`redrock-${kind}`][layer];
      check(`redrock ${kind}: ${layer} reads warm, not green  ${fmt(c)}`, c[0] > c[1]);
    }
  }
  for (const label of ['lvl18', 'lvl22']) {
    for (const layer of ASSERTED) {
      const c = got[label][layer];
      check(`campaign ${label}: ${layer} reads warm  ${fmt(c)}`, c[0] > c[1]);
    }
  }
  // Weather must still register on the hills — a tint strong enough to erase the
  // clear->storm difference trades one wrong picture for another.
  for (const layer of ASSERTED) {
    const d = lum(got['redrock-clear'][layer]) - lum(got['redrock-storm'][layer]);
    check(`redrock ${layer}: storm still darkens it (dL=${d.toFixed(1)})`, d >= 8);
  }
  // Night is a fixed cool palette shared by every biome; it must still win.
  const nightCool = lum(got['redrock-clear'].mid) - lum(got['redrock-night'].mid);
  check(`redrock night still darkens the ridge (dL=${nightCool.toFixed(1)})`, nightCool >= 30);

  check('no console errors', consoleErrors.length === 0);
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 5).join('\n'));
} catch (e) {
  console.log('THREW:', e.stack);
  failures++;
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall passed\n');
process.exit(failures ? 1 : 0);
