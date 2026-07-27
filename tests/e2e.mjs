// End-to-end smoke test: drives a real browser through levels 1 and 2 and
// fails if they cannot be completed. Requires the production build to be
// served (default http://localhost:4173/ — `npm run preview`; the game is
// served at the site's single front door, `/`).
//
// Uses the game's window.__smallhands debug hook to act as a scripted player:
// it marks resources and places buildings, then the simulation does the rest.
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

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(BASE_URL);
await page.waitForTimeout(800);
await page.click('.fd-play');
await page.waitForTimeout(300);
await page.click('.map-node:not(:disabled)');
await page.click('.map-popover .pop-play');
await page.waitForTimeout(400);

async function waitForWin(label, pollFn, maxPolls) {
  for (let i = 0; i < maxPolls; i++) {
    await page.waitForTimeout(2000);
    const s = await page.evaluate(pollFn);
    if (i % 10 === 0) console.log(`[${label}]`, JSON.stringify(s));
    if (s.won) {
      console.log(`[${label}] WON in ${s.t}s of sim time`);
      return true;
    }
  }
  return false;
}

// ---- Level 1: harvest -> sawmill -> deliver planks -------------------------
console.log('Level 1: First Steps');
await page.evaluate(() => {
  const { game, setSpeed } = window.__smallhands;
  for (const n of game.nodes) n.marked = true;
  setSpeed(4);
});
const won1 = await waitForWin(
  'level1',
  () => {
    const g = window.__smallhands.game;
    if (!g.buildings.some((b) => b.kind === 'sawmill')) g.placeBuilding('sawmill', 33, 17);
    return { won: g.won, t: Math.round(g.time), obj: g.objectives.map((o) => `${o.item}:${o.delivered}/${o.amount}`).join(' ') };
  },
  90
);
if (!won1) {
  console.error('FAIL: level 1 not completed');
  await browser.close();
  process.exit(1);
}

// ---- the win screen's solution snapshot (card #72) -------------------------
// The ceremony draws the finished map with a SECOND Renderer over the same
// Game. Both halves are asserted here: that the picture is real, and that the
// live renderer still receives its lookEvents afterwards — MotionLayer.update
// drains that outbox on every call, so a second Renderer is one line away from
// starving the first one (card #58).
await page.waitForSelector('.win-shot', { timeout: 10_000 });
const shot = await page.evaluate(async () => {
  const c = document.querySelector('.ws-img');
  const g = window.__smallhands.game;
  let colors = 0;
  if (c) {
    const p = document.createElement('canvas');
    p.width = c.width;
    p.height = c.height;
    p.getContext('2d').drawImage(c, 0, 0);
    const d = p.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < d.length; i += 4 * 197) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    colors = seen.size;
  }
  // the live renderer must still be draining the sim's cosmetic outbox
  g.lookEvents.push({ type: 'probe' });
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return {
    has: !!c,
    ratio: c ? c.width / c.height : 0,
    worldRatio: g.world.w / g.world.h,
    colors,
    caption: document.querySelector('.ws-cap')?.textContent ?? '',
    // a figcaption only names its figure when it is a direct child of one
    captionBound: document.querySelector('.ws-cap')?.parentElement?.tagName === 'FIGURE',
    actions: document.querySelectorAll('.ws-btn').length,
    lookLeft: g.lookEvents.length,
  };
});
const shotProblems = [];
if (!shot.has) shotProblems.push('no snapshot canvas in the win overlay');
if (shot.colors <= 20) shotProblems.push(`snapshot looks blank (${shot.colors} colours)`);
if (Math.abs(shot.ratio - shot.worldRatio) > 0.05) {
  shotProblems.push(`snapshot is not the whole map (${shot.ratio} vs world ${shot.worldRatio})`);
}
if (!shot.caption.trim()) shotProblems.push('snapshot has no caption');
if (!shot.captionBound) shotProblems.push('caption is not a direct child of its figure');
// headless Chromium supports downloads, so at least Save PNG must be offered
if (shot.actions < 1) shotProblems.push('snapshot offers no way to keep it');
if (shot.lookLeft !== 0) shotProblems.push('live renderer stopped draining lookEvents');
if (shotProblems.length) {
  console.error('FAIL: win snapshot —', shotProblems.join('; '));
  await browser.close();
  process.exit(1);
}
console.log(`[win-shot] ok — ${shot.colors} colours, ${shot.actions} actions, "${shot.caption}"`);

// ---- Level 2: cargo lift + ladder logistics up a cliff ----------------------
console.log('Level 2: The Cliff Shrine');
await page.waitForTimeout(2200);
await page.evaluate(() => {
  window.__smallhands.startLevel(1);
  const { game, setSpeed } = window.__smallhands;
  for (const n of game.nodes) n.marked = true;
  game.placeLift(23, 20);
  setSpeed(4);
});
const won2 = await waitForWin(
  'level2',
  () => {
    const g = window.__smallhands.game;
    if (!g.buildings.some((b) => b.kind === 'sawmill')) g.placeBuilding('sawmill', 9, 20);
    for (const y of [19, 18, 17, 16, 15, 14]) {
      if (g.world.get(23, y) === 0) g.placeLadder(23, y);
    }
    return { won: g.won, t: Math.round(g.time), obj: g.objectives.map((o) => `${o.item}:${o.delivered}/${o.amount}`).join(' ') };
  },
  120
);
await browser.close();
if (!won2) {
  console.error('FAIL: level 2 not completed');
  process.exit(1);
}
console.log('E2E PASS: levels 1 and 2 completed');
