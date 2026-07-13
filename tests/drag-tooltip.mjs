// Regression: the drag-build cost tooltip must track live stock EVERY FRAME
// while a run drag is held — not only when the pointer moves. Reproduces
// "tooltip on click-and-drag building costs does not update for missing
// resources": we arm an affordable 1-tile ramp/platform run, then (without
// moving the cursor) drop plank stock to zero. The on-canvas ghost already
// recomputes per frame; the readout must flip to red "0/1" too.
//
// Requires the production build served (default :4173 — `npm run preview`) and
// a Chromium (CHROME_PATH, see the testing-smallhands note). Drives the real
// pointer path with synthetic PointerEvents.
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

await page.goto(BASE_URL);
await page.waitForTimeout(800);
await page.click('button.big-btn');
await page.waitForTimeout(300);
await page.click('.level-card:not(.locked)');
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
  // synthetic pointers can't be captured/released — no-op both (see the note).
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};

  const dpr = canvas.width / canvas.clientWidth;
  const TILE = 16;
  // Find a level with an unlocked plank-based run tool and an on-screen tile
  // where a single-tile run is valid. Read the LIVE (already-clamped) camera —
  // never set it (small worlds re-center on resize).
  const onScreen = (x, y) => x > 4 && x < window.innerWidth - 4 && y > 4 && y < window.innerHeight - 4;
  let pick = null;
  for (let lvl = 0; lvl < 9 && !pick; lvl++) {
    startLevel(lvl);
    const game = window.__smallhands.game;
    setSpeed(0); // freeze the sim: only our explicit stock edit moves affordability
    game.stock.plank = 5; // affordable for a single-tile run
    const zoom = cam.zoom;
    const toClient = (tx, ty) => ({
      x: ((tx + 0.5) * TILE * zoom - cam.x) / dpr,
      y: ((ty + 0.5) * TILE * zoom - cam.y) / dpr,
    });
    for (const tool of ['ramp', 'platform']) {
      if (!game.toolUnlocked(tool)) continue;
      for (let ty = 0; ty < game.world.h && !pick; ty++) {
        for (let tx = 0; tx < game.world.w; tx++) {
          const c = toClient(tx, ty);
          if (!onScreen(c.x, c.y)) continue;
          const rows = game.runPlan(tool, tx, ty, tx, ty).rows;
          if (rows.length === 1 && rows[0].item === 'plank') {
            pick = { lvl, tool, tx, ty, cx: c.x, cy: c.y };
            break;
          }
        }
      }
      if (pick) break;
    }
  }
  if (!pick) return { error: 'no level with an on-screen single-tile plank run found' };

  const game = window.__smallhands.game;
  setTool(pick.tool);
  const pe = (type, x, y) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, button: 0, bubbles: true })
    );
  pe('pointerdown', pick.cx, pick.cy);
  pe('pointermove', pick.cx, pick.cy); // arm + first render of the readout
  await frames(2);

  const read = () => {
    const tip = [...document.querySelectorAll('.tooltip')].find((t) => t.querySelector('.tt-cost'));
    if (!tip) return { present: false };
    return {
      present: true,
      text: tip.querySelector('.tt-cost b')?.textContent ?? '',
      insufficient: !!tip.querySelector('.tt-cost .insufficient'),
    };
  };
  const before = read();

  // resources go missing while the cursor is HELD STILL (no pointermove).
  game.stock.plank = 0;
  await frames(4);
  const after = read();

  return { pick: { lvl: pick.lvl, tool: pick.tool, tx: pick.tx, ty: pick.ty }, before, after };
});

await browser.close();
console.log(JSON.stringify(result, null, 2));

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}`);
  if (!cond) failures++;
}
check('a run drag readout is shown', result.before?.present === true);
check('affordable before: shows the total, not insufficient', result.before?.insufficient === false);
check('stock drops to 0 with the cursor still: readout flips to insufficient', result.after?.insufficient === true);
check('after: readout shows have/need 0/1', result.after?.text === '0/1');
console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
