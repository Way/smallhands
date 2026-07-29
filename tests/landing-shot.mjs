// Landing-page layout guard + eyeball helper (card #25). Two jobs, because the
// front-door sections are the one surface where a number can be right and the
// page still wrong:
//
//   Asserted here — the page never scrolls sideways at three widths in both
//   languages, and every campaign renders a name, a level count and a hook. The
//   counts themselves are frontdoor-data.mjs's job; what THIS suite adds is that
//   the derived values actually reach the DOM, which no headless data test can
//   see. It also pins the pressure grid's 3-then-2 shape: those cards carry an
//   nth-child span that has to be undone at the mobile breakpoint, and leaving it
//   on spills into implicit tracks so the row of three renders narrower than the
//   row of two — 16px, verified by deleting the reset, which is exactly the kind
//   of wrong that survives an eyeball pass and every count check.
//
//   Not asserted — whether the campaign roll-call reads as a table of contents
//   and whether each icon is legible at 34px. The stills in tests/.landing-out/
//   are for that, and `pressure-icons.png` is the one that decides an icon: each
//   glyph at true size beside a 4× blow-up. Two icons have been replaced on that
//   evidence alone (the shovel for `vein`, `tile_platform` for `ration`) and
//   nothing measurable would have said so in either case.
//
// Needs the production build served and a Chromium, same as every browser suite:
//   npm run build && npx vite preview --port 4211 --strictPort
//   CHROME_PATH=… BASE_URL=http://localhost:4211/ npm run test:landing-shot
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { bundleExports } from './bundle.mjs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const OUT = process.env.OUT_DIR || 'tests/.landing-out';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const found = execSync('ls /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1').toString().trim();
    if (found) return found;
  } catch {
    // fall through to playwright's own resolution
  }
  return undefined;
}

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

// The expected row count comes from the level table, not from a floor written
// here: `>= 4` with five campaigns shipping would stay green through a rendering
// regression that dropped the last row — the same hardcoded-count failure this
// whole change exists to remove, in the one suite that can see the DOM.
const { LEVELS } = await bundleExports(`export { LEVELS } from './src/game/levels.ts';`);
const CAMPAIGNS = new Set(LEVELS.map((l) => l.campaign ?? 1)).size;

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});

// The three widths that change the layout: desktop (pressure grid 3+2), tablet
// portrait (same grid, tightest columns) and phone (everything one column).
const VIEWS = [
  { tag: 'desktop', w: 1280, h: 1100, cols: 3 },
  { tag: 'tablet', w: 820, h: 1000, cols: 3 },
  { tag: 'phone', w: 390, h: 844, cols: 1 },
];

for (const view of VIEWS) {
  for (const lang of ['en', 'de']) {
    const ctx = await browser.newContext({
      viewport: { width: view.w, height: view.h },
      locale: lang === 'de' ? 'de-DE' : 'en-US',
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => {
      console.log('  [pageerror]', e.message);
      failures++;
    });
    await page.goto(BASE);
    await page.waitForTimeout(700);

    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      camps: [...document.querySelectorAll('.camp')].map((c) => ({
        // firstChild, not textContent: the count pill is a child of the same h3.
        name: c.querySelector('h3')?.firstChild?.textContent?.trim() ?? '',
        count: c.querySelector('.camp-count')?.textContent?.trim() ?? '',
        hook: c.querySelector('p')?.textContent?.trim() ?? '',
      })),
      // Rounded: a grid track is a float, and comparing raw widths for equality
      // reds on 327.99999 vs 328.00001 under load.
      pressures: [...document.querySelectorAll('.world-grid > *')].map((e) =>
        Math.round(e.getBoundingClientRect().width),
      ),
      feats: [...document.querySelectorAll('.feats li span')].map((e) => e.textContent?.trim() ?? ''),
    }));

    const at = `${view.tag}/${lang}`;
    check(`${at}: no horizontal overflow`, m.overflow <= 0, `${m.overflow}px`);
    check(
      `${at}: every campaign in LEVELS has a row`,
      m.camps.length === CAMPAIGNS,
      `${m.camps.length} rows, ${CAMPAIGNS} campaigns`,
    );
    // A placeholder that never got filled, or an i18n key echoed instead of a
    // name, both land in the DOM looking like copy. Catch them by shape.
    for (const [i, c] of m.camps.entries()) {
      check(
        `${at}: campaign ${i + 1} is named, counted and pitched`,
        c.name.length > 2 && !c.name.includes('map.terr') && /\d/.test(c.count) && c.hook.length > 20,
        `${c.name} / ${c.count} / ${c.hook.slice(0, 24)}…`,
      );
    }
    // The 3-then-2 pyramid: the first three cards share one width, the last two
    // share a wider one. On phones every card is full width instead.
    const uniq = [...new Set(m.pressures)];
    if (view.cols === 1) {
      check(`${at}: pressure cards are full width`, uniq.length === 1, m.pressures.join(','));
    } else {
      check(
        `${at}: pressure grid is 3 narrow then 2 wide`,
        uniq.length === 2 && m.pressures.slice(0, 3).every((w) => w === m.pressures[0]) && m.pressures[3] > m.pressures[0],
        m.pressures.join(','),
      );
    }
    // Every count on the page arrives from LEVELS/TOOL_DEFS through a {c}/{n}
    // placeholder, so a raw brace in the rendered text means one went unfilled.
    check(`${at}: no unfilled placeholder`, !m.feats.concat(m.camps.map((c) => c.count)).some((s) => /[{}]/.test(s)));

    // The pressure icons, each at its true 34px and blown up 4× beside it. This
    // is the view that decides an icon: the band stills show it in place, but a
    // 34px glyph inside a 1280px page is too small to judge, and every icon this
    // page has lost was lost at this magnification (`tile_platform` reading as a
    // grating rather than a limit, the shovel as a thin dark shape). Drawn from
    // the canvases the page already painted, so it is the shipped rendering and
    // not a re-implementation of it.
    if (view.tag === 'desktop' && lang === 'en') {
      await page.evaluate(() => {
        const host = document.createElement('div');
        host.id = 'icon-strip';
        host.style.cssText =
          'position:fixed;inset:0;z-index:99999;background:#141a26;display:flex;gap:34px;' +
          'align-items:center;justify-content:center;font:11px system-ui;color:#9fb0c8';
        for (const card of document.querySelectorAll('.world-grid > .mech')) {
          const src = card.querySelector('canvas');
          const col = document.createElement('div');
          col.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px';
          for (const px of [34, 168]) {
            const big = document.createElement('canvas');
            big.width = big.height = px;
            const g = big.getContext('2d');
            g.imageSmoothingEnabled = false; // nearest-neighbour: show the pixels
            g.drawImage(src, 0, 0, px, px);
            big.style.cssText = `width:${px}px;height:${px}px;background:rgba(0,0,0,.25);border:1px solid #2a3444`;
            col.appendChild(big);
          }
          const label = document.createElement('div');
          label.textContent = src.dataset.sprite;
          col.appendChild(label);
          host.appendChild(col);
        }
        document.body.appendChild(host);
      });
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${OUT}/pressure-icons.png` });
      await page.evaluate(() => document.getElementById('icon-strip')?.remove());
    }

    for (const [name, sel] of [
      ['world', '.world-grid'],
      ['camps', '.camps'],
      ['feats', '.feats'],
    ]) {
      await page.evaluate((s) => document.querySelector(s)?.closest('.band')?.scrollIntoView(), sel);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${name}-${view.tag}-${lang}.png` });
    }
    await ctx.close();
  }
}

await browser.close();
if (failures) {
  console.log(`\nLANDING SHOT FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log(`\nLANDING SHOT PASS — stills in ${OUT}/ (look at them: no number says whether an icon reads)`);
