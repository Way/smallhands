// Mobile/touch e2e: drives the game with an emulated phone (390×844, DPR 3,
// touch) and verifies the touch experience end to end:
//   - the front door's Play flows into the level select and a level starts
//   - the phone starts zoomed in (DPR-aware default) and pinch steps the zoom
//   - harvest toggles on the tap itself (free + reversible → no confirm step)
//   - tap-to-aim + confirm for costly tools: the ✓ commits, ✕ discards
//   - selecting a building parks its draft ghost immediately (✓ Build pends)
//   - one-finger drags pan the camera and never fire the armed tool
//   - run tools grow tap by tap and report affordable/total tiles
//   - the compact HUD: collapsible info pills, the tap-toggled island popovers
//   - hit zones are thumb-sized (44px+ for primary controls)
// Requires the production build served (default http://localhost:4173/ —
// `npm run preview`). Mirrors tests/e2e.mjs for browser launch.
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

let failed = false;
function check(label, cond) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failed = true;
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const cdp = await page.context().newCDPSession(page);

// Low-level touch gestures playwright's touchscreen.tap() can't express.
async function touchDrag(from, to, steps = 8) {
  const pt = (p) => [{ x: p.x, y: p.y, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from) });
  for (let i = 1; i <= steps; i++) {
    const p = {
      x: from.x + ((to.x - from.x) * i) / steps,
      y: from.y + ((to.y - from.y) * i) / steps,
    };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(p) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function pinch(center, fromGap, toGap, steps = 10) {
  const pts = (gap) => [
    { x: center.x - gap / 2, y: center.y, id: 1 },
    { x: center.x + gap / 2, y: center.y, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(fromGap) });
  for (let i = 1; i <= steps; i++) {
    const gap = fromGap + ((toGap - fromGap) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(gap) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

// CSS-pixel screen position of a tile's centre (for touchscreen taps).
async function tileToScreen(tx, ty) {
  return page.evaluate(([x, y]) => {
    const { cam } = window.__smallhands;
    const canvas = document.getElementById('game-canvas');
    const dpr = canvas.width / canvas.clientWidth;
    return {
      x: ((x + 0.5) * 16 * cam.zoom - cam.x) / dpr,
      y: ((y + 0.5) * 16 * cam.zoom - cam.y) / dpr,
    };
  }, [tx, ty]);
}

await page.goto(BASE_URL);
await page.waitForTimeout(800);

// ---- front door → level select → level 1 -----------------------------------
check('front door: coarse pointer emulated', await page.evaluate(() => matchMedia('(pointer: coarse)').matches));
await page.tap('.fd-play');
await page.waitForTimeout(400);
const node = page.locator('.map-node:not(:disabled)').first();
const nodeBox = await node.boundingBox();
check('map node is a 44px+ touch target', nodeBox.width >= 44 && nodeBox.height >= 44);
await node.tap();
await page.tap('.map-popover .pop-play');
await page.waitForTimeout(500);
check('level started', await page.evaluate(() => !!window.__smallhands?.game));

// mobile toasts live at the top, under the HUD pills — they must never float
// mid-screen where they'd swallow the taps and pinches aimed at the map
check('toasts sit in the top half of the screen', await page.evaluate(() => {
  const wrap = document.querySelector('.toast-wrap');
  return wrap && wrap.getBoundingClientRect().top < window.innerHeight / 2;
}));
// dismiss the tutorial/rotate toasts the way a player would before playing on
await page.evaluate(() => document.querySelectorAll('.toast').forEach((tst) => tst.remove()));

// ---- DPR-aware zoom default + pinch ----------------------------------------
check('phone starts at zoom 4 (DPR≥2 default)', await page.evaluate(() => window.__smallhands.cam.zoom === 4));
await pinch({ x: 195, y: 420 }, 90, 260);
await page.waitForTimeout(150);
const zoomAfterIn = await page.evaluate(() => window.__smallhands.cam.zoom);
check(`pinch-out zooms in (zoom ${zoomAfterIn})`, zoomAfterIn > 4);
await pinch({ x: 195, y: 420 }, 260, 90);
await page.waitForTimeout(150);
const zoomAfterOut = await page.evaluate(() => window.__smallhands.cam.zoom);
check(`pinch-in zooms back out (zoom ${zoomAfterOut})`, zoomAfterOut < zoomAfterIn);

// ---- compact HUD: collapsed pills + accordion --------------------------------
check('objectives panel collapsed to its pill', await page.evaluate(() => {
  const row = document.querySelector('.objectives .obj-row');
  return row && getComputedStyle(row).display === 'none';
}));
await page.tap('.crew > h3');
check('crew pill folds out on tap', await page.evaluate(() => {
  const crew = document.querySelector('.crew');
  const row = crew.querySelector('.role-row');
  return crew.classList.contains('open') && getComputedStyle(row).display !== 'none';
}));
const roleBtn = await page.locator('.role-btn').first().boundingBox();
check('role stepper is a 36px+ touch target', roleBtn.width >= 36 && roleBtn.height >= 36);
await page.tap('.objectives > h3');
check('accordion: opening objectives closes crew', await page.evaluate(() => {
  return document.querySelector('.objectives').classList.contains('open') &&
    !document.querySelector('.crew').classList.contains('open');
}));
await page.tap('.objectives > h3'); // fold everything away again

// ---- the island rides the top centre; the dock owns the bottom ----------------
check('island sits top centre, zoom bottom right, dock at the bottom', await page.evaluate(() => {
  const island = document.querySelector('.island').getBoundingClientRect();
  const zoom = document.querySelector('.zoombar').getBoundingClientRect();
  const dock = document.querySelector('.toolbar').getBoundingClientRect();
  const mid = window.innerWidth / 2;
  return (
    island.top < 120 &&
    Math.abs((island.left + island.right) / 2 - mid) < 8 && // centred
    zoom.right > window.innerWidth - 60 &&
    zoom.top > window.innerHeight / 2 &&
    dock.bottom > window.innerHeight - 120
  );
}));

// the phone has no room for the island to share a row with the resource strip
check('island clears the resource strip', await page.evaluate(() => {
  const island = document.querySelector('.island').getBoundingClientRect();
  const res = document.querySelector('.res-bar').getBoundingClientRect();
  return island.bottom <= res.top;
}));

// ---- island popovers: tap-toggled ---------------------------------------------
const speedPopShown = () => page.evaluate(() => !document.querySelector('.speed-pop').hidden);
check('speed popover starts closed', !(await speedPopShown()));
await page.tap('.island .speed-trigger');
check('speed popover opens on tap', await speedPopShown());
const speedBtn = await page.locator('.speed-pop .speed-btn').first().boundingBox();
check('speed buttons are 44px+ touch targets', speedBtn.width >= 44 && speedBtn.height >= 44);
await page.tap('.island .speed-trigger');
check('speed popover closes on second tap', !(await speedPopShown()));

// opening the burger must not leave the speed popover open behind it
await page.tap('.island .speed-trigger');
await page.tap('.island .menu-trigger');
check('burger popover replaces the speed popover', await page.evaluate(() => {
  return !document.querySelector('.menu-pop').hidden && document.querySelector('.speed-pop').hidden;
}));
// a tap on the world dismisses it — the old flyouts could only close each other
await page.tap('#game-canvas');
check('tapping outside closes the popover', await page.evaluate(() => {
  return document.querySelector('.menu-pop').hidden;
}));

// ---- tap-to-aim + confirm (harvest) ------------------------------------------
// centre the camera on the first tree so the tap lands clear of the HUD
const tree = await page.evaluate(() => {
  const { game, cam } = window.__smallhands;
  const n = game.nodes.find((nd) => nd.kind === 'tree');
  const canvas = document.getElementById('game-canvas');
  cam.x = (n.x + 0.5) * 16 * cam.zoom - canvas.width / 2;
  cam.y = (n.y + 0.5) * 16 * cam.zoom - canvas.height / 2;
  cam.clamp(game, canvas.width, canvas.height);
  return { x: n.x, y: n.y };
});
await page.tap('.tool-btn:nth-child(2)'); // Harvest sits second in the dock
check('arming a tool shows the aim-hint bar', await page.locator('.confirm-bar .cb-hint').isVisible());
const treePos = await tileToScreen(tree.x, tree.y);
await page.touchscreen.tap(treePos.x, treePos.y);
await page.waitForTimeout(120);
// harvest is free + reversible, so the tap toggles the mark directly — no ✓ step
check('harvest tap marks instantly', await page.evaluate(([tx, ty]) => {
  const { game } = window.__smallhands;
  const n = game.nodes.find((nd) => nd.x === tx && nd.y === ty);
  return n.marked;
}, [tree.x, tree.y]));
check('no ✓ button pends after an instant mark', (await page.locator('.cb-confirm').count()) === 0);
await page.touchscreen.tap(treePos.x, treePos.y);
await page.waitForTimeout(120);
check('second tap unmarks', await page.evaluate(([tx, ty]) => {
  const { game } = window.__smallhands;
  const n = game.nodes.find((nd) => nd.x === tx && nd.y === ty);
  return !n.marked;
}, [tree.x, tree.y]));
await page.touchscreen.tap(treePos.x, treePos.y); // leave it marked for the pan test
await page.waitForTimeout(120);

// ---- one-finger drag pans, never places ---------------------------------------
const before = await page.evaluate(() => {
  const { cam, game } = window.__smallhands;
  return { camX: cam.x, marked: game.nodes.filter((n) => n.marked).length };
});
await touchDrag({ x: 200, y: 400 }, { x: 90, y: 400 });
await page.waitForTimeout(120);
const after = await page.evaluate(() => {
  const { cam, game } = window.__smallhands;
  return { camX: cam.x, marked: game.nodes.filter((n) => n.marked).length };
});
check('one-finger drag pans the camera', after.camX !== before.camX);
check('panning never fires the armed tool', after.marked === before.marked);

// ---- run tool: taps grow the run, bar reports tiles ----------------------------
await page.tap('.cb-cancel'); // drop harvest back to Inspect
await page.waitForTimeout(80);
check('✕ hands back the Inspect tool', await page.evaluate(() => window.__smallhands.game && document.querySelector('.confirm-bar') === null));
const ladderBtnIdx = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.tool-btn')];
  return btns.findIndex((b) => b.querySelector('.tool-key')?.textContent === '3') + 1;
});
await page.tap(`.tool-btn:nth-child(${ladderBtnIdx})`); // Ladder (key 3)
const mid = await page.evaluate(() => {
  const { cam } = window.__smallhands;
  const canvas = document.getElementById('game-canvas');
  const tx = Math.floor((cam.x + canvas.width / 2) / (16 * cam.zoom));
  const ty = Math.floor((cam.y + canvas.height / 2) / (16 * cam.zoom));
  return { tx, ty };
});
const midPos = await tileToScreen(mid.tx, mid.ty);
await page.touchscreen.tap(midPos.x, midPos.y);
await page.waitForTimeout(120);
check('run tool aim shows affordable/total tiles', await page.locator('.confirm-bar .cb-count').isVisible());

// ---- building tools: the draft ghost parks itself the moment the tool is
// selected — a ✓ Build pends right away, no blind first tap needed ------------
const sawBtnIdx = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.tool-btn')];
  return btns.findIndex((b) => b.querySelector('.tool-key')?.textContent === '5') + 1;
});
await page.tap(`.tool-btn:nth-child(${sawBtnIdx})`); // Sawmill (key 5)
await page.waitForTimeout(120);
check('selecting a building parks a draft with a pending ✓', await page.locator('.cb-confirm').isVisible());
check('no building placed by selecting the tool', await page.evaluate(() => {
  const { game } = window.__smallhands;
  return !game.buildings.some((b) => b.kind === 'sawmill');
}));
check('the draft names the tap-to-move hint in the same bar', await page.locator('.confirm-bar .cb-hint').isVisible());
// A building is armed and aimed in one step, so ✕ drops the tool outright —
// it must never fall back to an aim hint for a state that cannot exist.
await page.tap('.cb-cancel');
await page.waitForTimeout(120);
check('✕ on a building draft dismisses the bar outright', (await page.locator('.confirm-bar').count()) === 0);
check('✕ on a building draft hands back the Inspect tool', await page.evaluate(() =>
  document.querySelector('.tool-btn.active')?.querySelector('.tool-key')?.textContent === '1'));

// ---- tapped-open panels track live state (card #33) --------------------------
// Mobile has no hover hint, so the town-hall panel IS the only readout for the
// upgrade cost (missing resources) and progress (build time). It must refresh
// as stock changes — not freeze on the snapshot it opened with.
await page.evaluate(() => window.__smallhands.setTool('select'));
const thTile = await page.evaluate(() => {
  const { game, cam } = window.__smallhands;
  const b = game.buildings.find((bd) => bd.kind === 'townhall');
  const canvas = document.getElementById('game-canvas');
  cam.x = (b.x + 0.5) * 16 * cam.zoom - canvas.width / 2;
  cam.y = (b.y + 0.5) * 16 * cam.zoom - canvas.height / 2;
  cam.clamp(game, canvas.width, canvas.height);
  return { x: b.x, y: b.y };
});
// open the panel while the upgrade is UNaffordable → its cost renders red
await page.evaluate(() => { const g = window.__smallhands.game; for (const k in g.stock) g.stock[k] = 0; });
const thPos = await tileToScreen(thTile.x, thTile.y);
await page.touchscreen.tap(thPos.x, thPos.y);
await page.waitForTimeout(120);
check('tapping the town hall opens its panel', (await page.locator('.th-toast').count()) > 0);
check('town-hall cost shows red when unaffordable', await page.evaluate(() =>
  document.querySelector('.th-toast')?.querySelectorAll('.insufficient').length > 0));
// flood resources — a LIVE panel clears the red and enables the Upgrade button
await page.evaluate(() => { const g = window.__smallhands.game; for (const k in g.stock) g.stock[k] = 999; });
await page.waitForTimeout(200);
check('town-hall cost refreshes (no stale red) once affordable', await page.evaluate(() =>
  document.querySelector('.th-toast')?.querySelectorAll('.insufficient').length === 0));
check('town-hall Upgrade button enables once affordable', await page.evaluate(() => {
  const btn = document.querySelector('.th-toast .th-mini');
  return btn && !btn.disabled;
}));

// ---- inspect-hint build % counts in 1% steps, not coarse 5% jumps (#33) ------
// The hint's signature used to quantize progress to 1/20, so the % it renders
// (1/100) froze between 5% buckets. Prove a sub-5% change now updates the text.
await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
const bp = await page.evaluate(() => {
  const { game, cam } = window.__smallhands;
  const canvas = document.getElementById('game-canvas');
  const px = 16 * cam.zoom;
  const dpr = canvas.width / canvas.clientWidth;
  const scr = (x, y) => ({ x: ((x + 0.5) * px - cam.x) / dpr, y: ((y + 0.5) * px - cam.y) / dpr });
  // an empty tile (no building covers it) near screen centre and clear of the
  // HUD margins, so the tap lands on our blueprint — not the town hall (4-wide
  // footprint) nor a top/bottom HUD control that would swallow the touch
  const safe = (s) => s.x > 70 && s.x < canvas.clientWidth - 70 && s.y > 220 && s.y < canvas.clientHeight - 220;
  const cx = Math.floor((cam.x + canvas.width / 2) / px), cy = Math.floor((cam.y + canvas.height / 2) / px);
  let found = null;
  for (let r = 0; r < 14 && !found; r++)
    for (let dy = -r; dy <= r && !found; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx, yy = cy + dy;
        if (xx < 0 || yy < 0 || xx >= game.world.w || yy >= game.world.h) continue;
        const s = scr(xx, yy);
        if (!safe(s) || game.buildingAt(xx, yy)) continue;
        found = { xx, yy, s };
        break;
      }
  if (!found) return { ok: false };
  const b = game.addBuilding('sawmill', found.xx, found.yy, false); // blueprint
  b.progress = 0.06; // BUILD_TIME.sawmill=6 → 1%
  window.__smallhands.setSpeed(0); // freeze the sim so only our progress applies
  window.__smallhands.setTool('select');
  return { ok: true, id: b.id, cx: found.s.x, cy: found.s.y };
});
check('found an on-screen tile for the blueprint', bp.ok);
await page.touchscreen.tap(bp.cx, bp.cy);
await page.waitForTimeout(120);
const hintPct = () => page.evaluate(() => {
  const m = document.querySelector('.tooltip')?.textContent?.match(/(\d+)%/);
  return m ? Number(m[1]) : null;
});
check('inspecting the blueprint shows its build %', (await hintPct()) === 1);
// +2% of build time: same old 1/20 bucket, so the OLD sig would freeze at 1%
await page.evaluate((id) => { window.__smallhands.game.buildings.find((b) => b.id === id).progress = 0.18; }, bp.id);
await page.waitForTimeout(120);
check('build % updates in 1% steps (not frozen in a 5% bucket)', (await hintPct()) === 3);

if (process.env.SHOT_PATH) await page.screenshot({ path: process.env.SHOT_PATH });
await browser.close();
console.log(failed ? '\nMOBILE E2E FAILED' : '\nMOBILE E2E PASS');
process.exit(failed ? 1 : 0);
