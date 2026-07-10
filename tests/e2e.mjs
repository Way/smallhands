// End-to-end smoke test: drives a real browser through levels 1 and 2 and
// fails if they cannot be completed. Requires the production build to be
// served (default http://localhost:4173 — `npm run preview`).
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
await page.click('button.big-btn');
await page.waitForTimeout(300);
await page.click('.level-card:not(.locked)');
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
