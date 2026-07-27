// Browser test for the world-map level select: territories/fog, node popover,
// play flow, daily landmark, legend bar and the my-levels drawer.
// Needs `npm run build && npm run preview` and CHROME_PATH (see e2e.mjs).
// The unified front door serves the game at `/`; `.fd-play` enters it.
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

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

await page.goto(BASE_URL);
await page.waitForTimeout(800);
await page.click('.fd-play');
await page.waitForTimeout(400);

// ---- structure on a fresh profile ----
check('worldmap overlay shown', !!(await page.$('.overlay.worldmap')));
check('4 territories', (await page.$$('.territory')).length === 4);
check('3 territories fogged', (await page.$$('.territory.locked')).length === 3);
check('3 lock hints', (await page.$$('.terr-lock')).length === 3);
const nodes = await page.$$('.map-node');
check('17 level nodes', nodes.length === 17);
check('exactly 1 unlocked node', (await page.$$('.map-node:not(:disabled)')).length === 1);
check('daily lighthouse present', !!(await page.$('.map-daily')));
check('legend has 4 buttons', (await page.$$('.legend-btn')).length === 4);

// ---- popover open/close ----
await page.click('.map-node:not(:disabled)');
await page.waitForTimeout(150);
check('popover opens', !!(await page.$('.map-popover')));
check('popover has a name', ((await page.textContent('.map-popover .lv-name')) ?? '').length > 0);
check('popover has medal slots', !!(await page.$('.map-popover .medal-row')));

// ---- level preview (card #72) ----
// The shot is rendered lazily, when the popover opens, by a throwaway Renderer
// over a throwaway Game. A blank rectangle would pass a mere presence check, so
// sample the pixels: a real map is many colours, an empty canvas is one.
const preview = await page.evaluate(() => {
  const c = document.querySelector('.map-popover .lv-shot-img');
  if (!c) return null;
  const p = document.createElement('canvas');
  p.width = c.width;
  p.height = c.height;
  p.getContext('2d').drawImage(c, 0, 0);
  const d = p.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const colors = new Set();
  for (let i = 0; i < d.length; i += 4 * 97) colors.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  return { w: c.width, h: c.height, colors: colors.size, ratio: c.width / c.height };
});
check('popover shows a map preview', !!preview);
check('preview has real pixels drawn', (preview?.colors ?? 0) > 20);
// The shot spans the whole level, so its aspect ratio is the world's — and the
// popover already prints those dimensions, which makes them checkable without a
// second source of truth. A preview framed on the camera instead of the map
// would fail here.
const meta = (await page.textContent('.map-popover .lv-meta')) ?? '';
const dims = /(\d+)\s*×\s*(\d+)/.exec(meta);
check('popover states the level size', !!dims);
check(
  'preview keeps the level aspect ratio',
  !!preview && !!dims && Math.abs(preview.ratio - Number(dims[1]) / Number(dims[2])) < 0.05
);

await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Escape closes popover', !(await page.$('.map-popover')));

// reopening must not lose the picture: the canvas is cached and re-parented,
// and a cache that hands back a detached node would silently show nothing
await page.click('.map-node:not(:disabled)');
await page.waitForTimeout(150);
check('preview survives a reopen', !!(await page.$('.map-popover .lv-shot-img')));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);

// ---- every pill lands inside the map, at every size ----
// `.overlay.worldmap` is overflow:hidden, so a pill that misses its visible box
// is silently cut off — no scrollbar, no error, just a missing Play button or a
// missing name. The preview made the pills ~100px taller and broke seven of
// seventeen at 1280×720 before fitPopover measured the flip. Only one node is
// unlocked on a fresh profile, so the rest are enabled by hand: `disabled` gates
// the pointer, not the click handler the popover hangs off.
async function sweepPillFit(w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    for (const n of document.querySelectorAll('.map-node')) n.disabled = false;
  });
  const n = await page.$$eval('.map-node', (els) => els.length);
  const bad = [];
  for (let i = 0; i < n; i++) {
    await page.evaluate((i) => document.querySelectorAll('.map-node')[i].click(), i);
    await page.waitForTimeout(80);
    const r = await page.evaluate(() => {
      const p = document.querySelector('.map-popover');
      if (!p) return null;
      const clip = document.querySelector('.overlay.worldmap').getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      // A scrollable pill must OPEN at the top: focusing Play — the last child —
      // would otherwise scroll the preview and the name out of view before the
      // player has seen either.
      const openedAtTop = p.scrollTop === 0;
      // ...and must still be able to reveal that Play button
      p.scrollTop = p.scrollHeight;
      const play = p.querySelector('.pop-play').getBoundingClientRect();
      return {
        out: Math.round(Math.max(clip.top - pr.top, pr.bottom - clip.bottom)),
        playIn: play.top >= clip.top - 1 && play.bottom <= clip.bottom + 1,
        openedAtTop,
      };
    }, i);
    if (!r) bad.push(`node ${i}: no popover`);
    else if (r.out > 0) bad.push(`node ${i}: ${r.out}px outside`);
    else if (!r.openedAtTop) bad.push(`node ${i}: opened scrolled past the preview`);
    else if (!r.playIn) bad.push(`node ${i}: Play unreachable`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(40);
  }
  check(`every pill fits the map at ${w}×${h}`, bad.length === 0, bad.slice(0, 4).join('; '));
}
await sweepPillFit(1280, 720);
// 900px wide keeps the desktop pill (the phone sheet takes over at 820), and
// 420 tall is short enough that the pills genuinely overflow their measured
// max-height — the only size where the scroll path is more than decorative.
await sweepPillFit(900, 420);
await page.setViewportSize({ width: 1440, height: 860 });
await page.waitForTimeout(250);

// ---- daily logbook: empty on a fresh profile ----
await page.click('.map-daily');
await page.waitForTimeout(150);
check('daily popover opens', !!(await page.$('.map-popover.daily')));
check('popover offers the logbook', !!(await page.$('.map-popover .pop-log')));
await page.click('.map-popover .pop-log');
await page.waitForTimeout(150);
check('logbook opens', !!(await page.$('.daily-drawer')));
check('logbook shows the empty hint', !!(await page.$('.daily-drawer .drawer-empty')));
check('logbook has no rows yet', (await page.$$('.daily-drawer .daily-row')).length === 0);
check('recent-days strip rendered', (await page.$$('.daily-drawer .log-dot')).length === 14);
check('no day is marked solved', (await page.$$('.daily-drawer .log-dot.solved')).length === 0);
check('today is marked in the strip', (await page.$$('.daily-drawer .log-dot.today')).length === 1);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Escape closes the logbook', !(await page.$('.daily-drawer')));

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
await page.click('.island .menu-trigger'); // the burger drops the menu popover
await page.click('.menu-pop .menu-item:has-text("Levels")');
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
await page.click('.fd-play');
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

// ---- logbook with a seeded daily history (today + the two days before) ----
const todayLabel = await page.evaluate(() => {
  const lbl = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const save = {
    completed: [],
    completedCustom: [`daily-${lbl(0)}`, `daily-${lbl(1)}`, `daily-${lbl(2)}`],
    records: {
      [`daily-${lbl(0)}`]: { bestTime: 214, medal: 'gold', feats: ['no-demolish'] },
      [`daily-${lbl(1)}`]: { bestTime: 355, medal: 'silver', feats: [] },
      [`daily-${lbl(2)}`]: { bestTime: 420, medal: null, feats: [] },
      c1: { bestTime: 90, medal: 'gold', feats: [] }, // campaign record must not leak in
    },
    muted: true,
    music: false,
  };
  localStorage.setItem('smallhands-save-v1', JSON.stringify(save));
  return lbl(0);
});
await page.goto(BASE_URL);
await page.waitForTimeout(800);
await page.click('.fd-play');
await page.waitForTimeout(400);
await page.click('.map-daily');
await page.waitForTimeout(150);
check('lighthouse popover shows the live streak', ((await page.textContent('.map-popover .lv-tags')) ?? '').includes('3'));
await page.click('.map-popover .pop-log');
await page.waitForTimeout(200);
const rows = await page.$$('.daily-drawer .daily-row');
check('logbook lists exactly the three dailies', rows.length === 3);
const rowNames = await page.$$eval('.daily-drawer .daily-row .lv-name', (els) => els.map((e) => e.textContent));
check(
  'rows are newest first',
  rowNames.length === 3 && rowNames[0] > rowNames[1] && rowNames[1] > rowNames[2]
);
check('newest row is today', rowNames[0] === todayLabel);
check(
  'rows show their own day on a tear-off calendar (not a frozen emoji)',
  (await page.textContent('.daily-drawer .daily-row .cal-day')) === todayLabel.slice(-2)
);
check('rows carry the best time', ((await page.textContent('.daily-drawer .daily-row .lv-best')) ?? '').includes('3:34'));
check('rows carry medal slots', (await page.$$('.daily-drawer .daily-row .medal-row')).length === 3);
check('a filled medal slot is shown', (await page.$$('.daily-drawer .daily-row .mslot.filled')).length >= 2);
check('every row offers replay', (await page.$$('.daily-drawer .daily-row .lv-action-btn')).length === 3);
check('strip marks three solved days', (await page.$$('.daily-drawer .log-dot.solved')).length === 3);
check('gold day is coloured gold', (await page.$$('.daily-drawer .log-dot.solved.gold')).length === 1);
const statsTxt = (await page.textContent('.daily-drawer .log-stats')) ?? '';
check('stats report 3 cleared and a 3-day streak', statsTxt.includes('3 cleared') && statsTxt.includes('3-day streak'));

// replay boots that day's mountain again
await page.click('.daily-drawer .daily-row .lv-action-btn');
await page.waitForFunction(() => window.__smallhands?.game, { timeout: 15000 });
const replayed = await page.evaluate(() => window.__smallhands.game.level.name);
check('replay boots the logged day', /\d{4}-\d{2}-\d{2}/.test(replayed));

// ...and with that run in progress, cancelling the abandon confirm must leave the
// logbook where it was instead of dropping the player on a bare map.
// `gameInProgress()` needs game.time > 3, so let the run breathe first.
await page.waitForFunction(() => window.__smallhands.game.time > 3.2, { timeout: 15000 });
await page.click('.island .menu-trigger');
await page.click('.menu-pop .menu-item:has-text("Levels")');
await page.waitForTimeout(400);
await page.click('.map-daily');
await page.waitForTimeout(150);
await page.click('.map-popover .pop-log');
await page.waitForTimeout(200);
await page.click('.daily-drawer .daily-row .lv-action-btn');
await page.waitForTimeout(250);
check('replay during a run asks before abandoning', !!(await page.$('.confirm-overlay')));
await page.click('.confirm-overlay .big-btn.secondary');
await page.waitForTimeout(200);
check('cancelling the abandon keeps the logbook open', !!(await page.$('.daily-drawer')));

await browser.close();
if (failures) {
  console.error(`WORLDMAP FAIL: ${failures} checks failed`);
  process.exit(1);
}
console.log('WORLDMAP PASS');
