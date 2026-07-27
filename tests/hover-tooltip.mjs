// Regression (card #73): the HOVER cost readouts must track live stock EVERY
// FRAME, not only when the pointer moves — the twin of tests/drag-tooltip.mjs,
// which guards the same rule for a held drag-run.
//
// Reproduces "I select a building and wait for enough resources: the tooltip
// still says I need planks after I have them". Waiting is precisely the case
// where the cursor does NOT move, so a readout refreshed only on pointermove
// freezes at the numbers it had when the player stopped moving.
//
// Two surfaces, one rule:
//   1. the placement shortfall badge under the cursor (Hud.showPlacementNeeds)
//   2. the toolbar chip's tooltip cost (Hud.showTooltip)
//
// Requires the production build served (default :4173 — `npm run preview`) and
// a Chromium (CHROME_PATH, see the testing-smallhands note). Drives the real
// pointer path with synthetic PointerEvents.
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
await page.waitForFunction(() => window.__smallhands);
await page.waitForTimeout(300);

const result = await page.evaluate(async () => {
  const frames = (n) =>
    new Promise((res) => {
      let i = 0;
      const step = () => (++i >= n ? res() : requestAnimationFrame(step));
      requestAnimationFrame(step);
    });
  const { startLevel, setSpeed, setTool, cam } = window.__smallhands;
  const canvas = document.querySelector('canvas');
  const dpr = canvas.width / canvas.clientWidth;
  const TILE = 16;

  startLevel(0);
  const game = window.__smallhands.game;
  setSpeed(0); // freeze the sim: only our explicit stock edits move affordability
  const zero = () => {
    for (const k of Object.keys(game.stock)) game.stock[k] = 0;
  };
  const plenty = () => {
    for (const k of Object.keys(game.stock)) game.stock[k] = 99;
  };

  // ---- 1. the placement badge under a still cursor -------------------------
  zero();
  // Read the LIVE (already-clamped) camera — never set it (small worlds
  // re-center on resize). Find an on-screen tile where a cost-bearing tool is
  // short and darkness isn't what reddens the ghost (darkness owns the slot).
  const onScreen = (x, y) => x > 4 && x < window.innerWidth - 4 && y > 4 && y < window.innerHeight - 4;
  const toClient = (tx, ty) => ({
    x: ((tx + 0.5) * TILE * cam.zoom - cam.x) / dpr,
    y: ((ty + 0.5) * TILE * cam.zoom - cam.y) / dpr,
  });
  let pick = null;
  for (const tool of ['ramp', 'platform', 'bridge', 'ladder']) {
    if (!game.toolUnlocked(tool)) continue;
    if (game.placementShortfall(tool).length === 0) continue; // nothing to be short of
    for (let ty = 0; ty < game.world.h && !pick; ty++) {
      for (let tx = 0; tx < game.world.w; tx++) {
        const c = toClient(tx, ty);
        if (!onScreen(c.x, c.y)) continue;
        if (game.darkBlocks(tool, tx, ty)) continue;
        pick = { tool, tx, ty, cx: c.x, cy: c.y };
        break;
      }
    }
    if (pick) break;
  }
  if (!pick) return { error: 'no on-screen tile with a cost-bearing unlocked tool found' };

  setTool(pick.tool);
  const pe = (type, x, y) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: y,
        button: 0,
        bubbles: true,
      })
    );
  pe('pointermove', pick.cx, pick.cy); // first render of the badge
  await frames(2);

  const readBadge = () => {
    const tip = [...document.querySelectorAll('.tooltip')].find((t) => t.querySelector('.tt-cost'));
    if (!tip) return { present: false };
    return {
      present: true,
      text: tip.querySelector('.tt-cost b')?.textContent ?? '',
      insufficient: !!tip.querySelector('.tt-cost .insufficient'),
    };
  };
  const badgeBefore = readBadge();

  // the crew delivers while the cursor is HELD STILL (no pointermove at all)
  plenty();
  await frames(4);
  const badgeAfter = readBadge();

  // ---- 2. the toolbar chip's tooltip --------------------------------------
  // leave the canvas so the placement badge can't be mistaken for the chip's
  // tooltip, then hover a chip whose cost we cannot currently pay
  pe('pointerleave', pick.cx, pick.cy);
  zero();
  await frames(2);

  const me = (btn, type) => btn.dispatchEvent(new MouseEvent(type, { bubbles: false }));
  const readChipTip = () => {
    const tip = [...document.querySelectorAll('.tooltip')].find((t) => t.querySelector('.tt-cost'));
    if (!tip) return { present: false };
    return { present: true, insufficient: !!tip.querySelector('.tt-cost .insufficient') };
  };
  let chip = null;
  for (const btn of document.querySelectorAll('.tool-btn')) {
    me(btn, 'mouseenter');
    if (readChipTip().insufficient) {
      chip = btn;
      break;
    }
    me(btn, 'mouseleave');
  }
  if (!chip) return { error: 'no toolbar chip priced above an empty stock', badgeBefore, badgeAfter };

  const chipBefore = readChipTip();
  // stock arrives while the pointer rests on the chip — no mouse event fires
  plenty();
  await frames(4);
  const chipAfter = readChipTip();

  return {
    pick: { tool: pick.tool, tx: pick.tx, ty: pick.ty },
    badgeBefore,
    badgeAfter,
    chipBefore,
    chipAfter,
  };
});

await browser.close();
console.log(JSON.stringify(result, null, 2));

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}`);
  if (!cond) failures++;
}
check('a shortfall badge is shown while the tool is unaffordable', result.badgeBefore?.present === true);
check('badge before: the missing resource is red', result.badgeBefore?.insufficient === true);
check(
  'stock arrives with the cursor still: the badge clears itself',
  result.badgeAfter?.present === false
);
check('a toolbar chip tooltip prices its tool in red when broke', result.chipBefore?.insufficient === true);
check(
  'stock arrives with the pointer resting on the chip: the cost stops being red',
  result.chipAfter?.present === true && result.chipAfter?.insufficient === false
);
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
