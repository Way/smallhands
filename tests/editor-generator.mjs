// End-to-end test for the level editor and the procedural generator.
// Requires the production build to be served (default http://localhost:4173).
//
//  1. Opens the editor from the level select, sculpts terrain, verifies,
//     playtests and returns to the editor.
//  2. Generates levels for a spread of seeds × difficulties and asserts the
//     static verifier accepts them and the simulation boots them.
//  3. Round-trips a level through the share-code encoder.
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
    // fall through
  }
  return undefined;
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('pageerror', (e) => {
  errors.push(e.message);
  console.log('[pageerror]', e.message);
});

function fail(msg) {
  console.error(`EDITOR/GEN FAIL: ${msg}`);
  process.exitCode = 1;
  return browser.close().then(() => process.exit(1));
}

await page.goto(BASE_URL);
await page.waitForTimeout(600);
await page.click('button.big-btn'); // Play → level select
await page.waitForTimeout(300);

// ---- 1. the editor ----------------------------------------------------------
await page.click('.level-card:has-text("Level editor")');
await page.waitForTimeout(400);
if (!(await page.$('.editor-panel'))) await fail('editor panel did not open');

// verify the blank level
await page.click('.ed-btn:has-text("Verify level")');
await page.waitForTimeout(200);
const reportGood = await page.$('.ed-report-line.good');
if (!reportGood) {
  const text = await page.$$eval('.ed-report-line', (els) => els.map((e) => e.textContent).join(' | '));
  await fail(`blank level should verify clean, got: ${text}`);
}
console.log('editor: blank level verifies clean');

// sculpt: dig a hole with the Dig tool via canvas clicks
await page.click('.editor-toolbar .tool-btn:has-text("Dig")');
const canvas = await page.$('#game-canvas');
const box = await canvas.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(150);
console.log('editor: dig tool applied without errors');

// playtest and come back
await page.click('.ed-btn:has-text("Playtest")');
await page.waitForTimeout(500);
if (!(await page.$('.toolbar:not(.editor-toolbar)'))) await fail('playtest did not start a game HUD');
console.log('editor: playtest boots the game');
await page.hover('.menubar'); // the corner menu auto-hides behind a pill; reveal it first
await page.click('.menubar .speed-btn:has-text("Levels")'); // returns to editor while playtesting
await page.waitForTimeout(400);
if (!(await page.$('.editor-panel'))) await fail('menu during playtest should return to the editor');
console.log('editor: playtest returns to the editor');

// exit the editor (confirm dialog may appear because the level is dirty)
await page.click('.ed-btn:has-text("Exit")');
await page.waitForTimeout(200);
const confirmBtn = await page.$('.confirm-overlay .big-btn.danger');
if (confirmBtn) await confirmBtn.click();
await page.waitForTimeout(300);
if (!(await page.$('.level-grid'))) await fail('exiting the editor should land on the level select');
console.log('editor: exit lands on level select');

// ---- 2. the generator --------------------------------------------------------
// start campaign level 1 so the debug hook exists
await page.click('.level-card:not(.locked)');
await page.waitForTimeout(400);

const genResult = await page.evaluate(() => {
  const sh = window.__smallhands;
  const seeds = ['oak-1', 'fern-2', 'gale-3', 'moss-4', 'flint-5', 'daily-2026-07-11'];
  const out = { checked: 0, problems: [], booted: 0 };
  for (const seed of seeds) {
    for (let d = 1; d <= 5; d++) {
      const data = sh.generateVerifiedLevel({ seed, difficulty: d });
      const report = sh.verifyLevel(data);
      out.checked++;
      if (!report.ok) {
        out.problems.push(`${seed} d${d}: ${report.problems.join('; ')}`);
      }
    }
  }
  // boot one generated level per difficulty in the real simulation
  for (let d = 1; d <= 5; d++) {
    const data = sh.generateVerifiedLevel({ seed: 'boot-test', difficulty: d });
    sh.startCustomLevel(data, {});
    const g = window.__smallhands.game;
    const kinds = g.buildings.map((b) => b.kind);
    if (!kinds.includes('townhall') || !kinds.includes('goal')) {
      out.problems.push(`boot d${d}: missing townhall/goal`);
      continue;
    }
    if (g.objectives.length === 0) {
      out.problems.push(`boot d${d}: no objectives`);
      continue;
    }
    out.booted++;
  }
  return out;
});
if (genResult.problems.length) await fail(`generator issues:\n${genResult.problems.join('\n')}`);
console.log(`generator: ${genResult.checked} seed×difficulty combos verified, ${genResult.booted}/5 booted in the sim`);

// determinism: same seed twice → identical level
const deterministic = await page.evaluate(() => {
  const sh = window.__smallhands;
  const a = sh.generateVerifiedLevel({ seed: 'repeat-me', difficulty: 3 });
  const b = sh.generateVerifiedLevel({ seed: 'repeat-me', difficulty: 3 });
  return a.tiles === b.tiles && a.name === b.name && JSON.stringify(a.nodes) === JSON.stringify(b.nodes);
});
if (!deterministic) await fail('generator is not deterministic for the same seed');
console.log('generator: deterministic for identical seeds');

// ---- 3. share-code round trip ---------------------------------------------------
const roundTrip = await page.evaluate(() => {
  const sh = window.__smallhands;
  const data = sh.generateVerifiedLevel({ seed: 'share-me', difficulty: 2 });
  const code = sh.encodeShareCode(data);
  const back = sh.decodeShareCode(code);
  return !!back && back.tiles === data.tiles && back.name === data.name && back.width === data.width;
});
if (!roundTrip) await fail('share code round trip corrupted the level');
console.log('share codes: encode → decode round trip intact');

// ---- 4. rope anchor mechanic -----------------------------------------------------
// Build a plateau in the editor, then in the real game: ladders up the east
// face for empty hands, a rope anchor on the west edge, and a stone on top
// that can ONLY come down by rope (7-tile drop, loaded workers survive 2).
const ropeResult = await page.evaluate(() => {
  const sh = window.__smallhands;
  sh.editor.open(sh.blankLevelData(64, 28));
  sh.editor.setTool('ground');
  // a shelf (rows 13..18) with a walk-through tunnel below it at ground level
  // (row 19), so both sides of the map stay connected for walkers
  for (let x = 40; x <= 50; x++) {
    for (let y = 18; y >= 13; y--) sh.editor.applyAt(x, y, false);
  }
  const data = sh.editor.serialize();
  data.objectives = [{ item: 'stone', amount: 1 }];
  data.nodes = [];
  sh.editor.close();
  sh.startCustomLevel(data, {});
  const g = window.__smallhands.game;
  g.stock.log = 20;
  g.stock.plank = 10;

  // rope on flat ground must be rejected
  if (g.placeRope(20, 19)) return { error: 'rope was allowed on flat ground' };

  // ladders up the east cliff face (empty hands only)
  for (let y = 13; y <= 19; y++) g.world.set(51, y, 6 /* T.LADDER */);
  // rope anchor on the west edge of the plateau
  if (!g.placeRope(40, 12)) return { error: 'placeRope rejected a valid cliff edge' };
  const rope = g.ropes[0];
  if (rope.ropeSide !== -1 || rope.ropeBottomY !== 19) {
    return { error: `rope geometry wrong: side ${rope.ropeSide}, bottom ${rope.ropeBottomY}` };
  }

  // the delivery: one stone stranded on the plateau
  g.groundItems.push({ id: 99999, item: 'stone', x: 45, y: 12, reserved: false, bounce: 0 });

  // let the sim run: builder climbs up, builds the rope; hauler climbs up,
  // picks up the stone, slides down the rope, delivers to stock, then goal
  let usedSlide = false;
  for (let i = 0; i < 60 * 240; i++) {
    g.tick(1 / 60);
    if (!usedSlide) {
      usedSlide = g.workers.some((w) => w.stepIdx < w.path.length && w.path[w.stepIdx].kind === 'slide' && w.carrying);
    }
    if (g.won) break;
  }
  const pathCheck = sh.findPath(g.world, g.transits, 45, 12, new Set([g.world.key(10, 19)]), true);
  return {
    ropeReady: rope.state === 'ready',
    usedSlide,
    won: g.won,
    delivered: g.objectives[0].delivered,
    cargoPathHasSlide: !!pathCheck && pathCheck.steps.some((s) => s.kind === 'slide'),
  };
});
if (ropeResult.error) await fail(ropeResult.error);
if (!ropeResult.ropeReady) await fail('rope anchor was never constructed by a builder');
if (!ropeResult.cargoPathHasSlide) await fail('carrying path off the plateau does not use the rope');
if (!ropeResult.usedSlide || !ropeResult.won) {
  await fail(`rope delivery failed: usedSlide=${ropeResult.usedSlide} won=${ropeResult.won} delivered=${ropeResult.delivered}`);
}
console.log('rope anchor: built by a builder, cargo slid down a 7-tile cliff, order delivered');

// ---- 5. medal ceremony & records --------------------------------------------------
// The rope-test win should trigger the medal ceremony and persist a record.
await page.waitForTimeout(2200); // win screen appears 1.6s after the win event
if (!(await page.$('.ceremony'))) await fail('win screen is missing the medal ceremony');
const cerState = await page.evaluate(() => {
  const medalName = document.querySelector('.medal-name')?.textContent ?? '';
  const gauge = !!document.querySelector('.gauge .you');
  const featsGot = document.querySelectorAll('.ceremony .feat.got').length;
  const featsAll = document.querySelectorAll('.ceremony .feat').length;
  const save = JSON.parse(localStorage.getItem('smallhands-save-v1') ?? '{}');
  const recs = save.records ?? {};
  const rec = Object.values(recs)[Object.keys(recs).length - 1];
  return { medalName, gauge, featsGot, featsAll, recCount: Object.keys(recs).length, rec };
});
if (!cerState.medalName) await fail('ceremony has no medal name');
if (!cerState.gauge) await fail('ceremony time gauge missing the player marker');
if (cerState.featsAll !== 2 || cerState.featsGot < 1) {
  await fail(`feats wrong: ${cerState.featsGot}/${cerState.featsAll} earned (expected no-demolish to be earned)`);
}
if (cerState.recCount < 1 || typeof cerState.rec?.bestTime !== 'number') {
  await fail('no personal-best record persisted to the save file');
}
console.log(`medals: ceremony shown ("${cerState.medalName}"), ${cerState.featsGot}/2 feats, record saved (best ${Math.round(cerState.rec.bestTime)}s)`);

// the trophy shelf should now appear on the level select
await page.click('.overlay .big-btn.secondary'); // "Levels"
await page.waitForTimeout(400);
if (!(await page.$('.shelf'))) await fail('trophy shelf missing from level select after earning a record');
if (!(await page.$('.level-card .medal-row'))) await fail('medal slots missing from level cards');
console.log('medals: trophy shelf and card slots visible on level select');
// head back into a level so the soak section has its debug hook
await page.click('.level-card:not(.locked)');
await page.waitForTimeout(400);

// simulate 60s of a generated level at speed to ensure no runtime errors
await page.evaluate(() => {
  const sh = window.__smallhands;
  const data = sh.generateVerifiedLevel({ seed: 'soak-test', difficulty: 3 });
  sh.startCustomLevel(data, {});
  const g = window.__smallhands.game;
  for (const n of g.nodes) n.marked = true;
  for (let i = 0; i < 60 * 60; i++) g.tick(1 / 60);
});
await page.waitForTimeout(300);
if (errors.length) await fail(`page errors during soak: ${errors.join(' | ')}`);
console.log('soak: 60s of simulated play on a generated level, no page errors');

await browser.close();
console.log('EDITOR/GEN PASS: editor, generator, share codes and soak all good');
