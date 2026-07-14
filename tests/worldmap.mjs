// Browser test for the world-map level select: territories/fog, node popover,
// play flow, daily landmark, legend bar and the my-levels drawer.
// Needs `npm run build && npm run preview` and CHROME_PATH (see e2e.mjs).
//
// Note: on this branch the game still lives at /play/ (the front-door
// unification that serves the game at `/` via `.fd-play` — see the #4
// commit stream — has not landed here yet), so BASE_URL points at /play/
// and the title screen's `button.big-btn` is the entry click, matching the
// pattern already used by tests/editor-generator.mjs.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/play/';

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

let failures = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
};

await page.goto(BASE_URL);
await page.waitForTimeout(800);
await page.click('button.big-btn');
await page.waitForTimeout(400);

// ---- structure on a fresh profile ----
check('worldmap overlay shown', !!(await page.$('.overlay.worldmap')));
check('3 territories', (await page.$$('.territory')).length === 3);
check('2 territories fogged', (await page.$$('.territory.locked')).length === 2);
check('2 lock hints', (await page.$$('.terr-lock')).length === 2);
const nodes = await page.$$('.map-node');
check('12 level nodes', nodes.length === 12);
check('exactly 1 unlocked node', (await page.$$('.map-node:not(:disabled)')).length === 1);
check('daily lighthouse present', !!(await page.$('.map-daily')));
check('legend has 4 buttons', (await page.$$('.legend-btn')).length === 4);

// ---- popover open/close ----
await page.click('.map-node:not(:disabled)');
await page.waitForTimeout(150);
check('popover opens', !!(await page.$('.map-popover')));
check('popover has a name', ((await page.textContent('.map-popover .lv-name')) ?? '').length > 0);
check('popover has medal slots', !!(await page.$('.map-popover .medal-row')));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Escape closes popover', !(await page.$('.map-popover')));

// ---- drawer (empty on a fresh profile) ----
await page.click('.legend-btn.mine');
await page.waitForTimeout(150);
check('drawer opens', !!(await page.$('.custom-drawer')));
check('drawer shows empty hint', !!(await page.$('.drawer-empty')));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Escape closes drawer', !(await page.$('.custom-drawer')));

// ---- generator dialog reachable from the legend ----
await page.click('.legend-btn.generate');
await page.waitForTimeout(150);
check('generator dialog opens', !!(await page.$('.gen-box')));
await page.click('.gen-box .big-btn.secondary:has-text("Cancel"), .gen-box .btn-row .big-btn.secondary:last-child');
await page.waitForTimeout(150);

// ---- play flow: node -> popover -> Play boots the level ----
await page.click('.map-node:not(:disabled)');
await page.waitForTimeout(150);
await page.click('.map-popover .pop-play');
await page.waitForFunction(() => window.__smallhands, { timeout: 8000 });
const booted = await page.evaluate(() => ({
  hasGame: !!window.__smallhands.game,
  won: window.__smallhands.game.won,
}));
check('play boots a fresh level', booted.hasGame && booted.won === false);

// ---- editor reachable from the legend (back on the select first) ----
await page.hover('.menubar');
await page.click('.menubar .speed-btn:has-text("Levels")');
await page.waitForTimeout(400);
check('back on the worldmap', !!(await page.$('.overlay.worldmap')));
await page.click('.legend-btn.editor');
await page.waitForTimeout(300);
// abandoning the just-started level pops a confirm first
const confirmBtn = await page.$('.confirm-overlay .big-btn.danger');
if (confirmBtn) {
  await confirmBtn.click();
  await page.waitForTimeout(300);
}
check('editor opens from legend', !!(await page.$('.editor-panel')));

// ---- drawer shows a seeded custom level (fresh load) ----
await page.evaluate(() => {
  const lvl = {
    v: 1,
    id: 'test-custom-1',
    name: 'Seed Peak',
    desc: 'A seeded custom level for testing.',
    width: 32,
    height: 20,
    tiles: '0x640',
    nodes: [],
    townhall: { x: 4, y: 10 },
    goal: { x: 20, y: 10 },
    objectives: [{ item: 'plank', amount: 6 }],
    startStock: { log: 2 },
    startRoles: { hauler: 2, builder: 1, woodcutter: 1 },
    startWorkers: 4,
    startThLevel: 1,
  };
  localStorage.setItem('smallhands-custom-v1', JSON.stringify([lvl]));
});
await page.goto(BASE_URL);
await page.waitForTimeout(800);
await page.click('button.big-btn');
await page.waitForTimeout(400);

check('legend mine count badge shows 1', (await page.textContent('.legend-btn.mine .lg-count')) === '1');
await page.click('.legend-btn.mine');
await page.waitForTimeout(150);
check('drawer opens with the seeded level', !!(await page.$('.custom-drawer')));
const seededCards = await page.$$('.custom-drawer .level-card.custom');
check('drawer shows exactly one custom level card', seededCards.length === 1);
const seededActionBtns = await page.$$('.custom-drawer .level-card.custom .lv-action-btn');
check('custom card has exactly 3 action buttons', seededActionBtns.length === 3);
check(
  'custom card name matches the seeded level',
  (await page.textContent('.custom-drawer .level-card.custom .lv-name')) === 'Seed Peak'
);

await browser.close();
if (failures) {
  console.error(`WORLDMAP FAIL: ${failures} checks failed`);
  process.exit(1);
}
console.log('WORLDMAP PASS');
