// The front door at phone widths: every fixed-width row must fit the screen, and
// the icon rows must fit it as ONE line.
//
// This needs a browser and it needs a sweep, because every failure it guards is a
// layout arithmetic question that no data assertion can answer and that nothing
// throws on. All four shipped at once:
//
//   - the hero production chain wrapped at any width under ~480px, and flex put
//     the break wherever the room ran out: at 390px the first line ended with an
//     arrow pointing at nothing and the second held the last two steps. That is
//     the card's complaint (#77) — the row says "the crew runs this line", and a
//     line that snaps in half mid-arrow says the opposite.
//   - the village skyline is seven fixed-size figures plus gaps, 390px wide, so a
//     320–360px viewport got a horizontal scrollbar on the WHOLE PAGE and the two
//     outer trees hung off both edges at once.
//   - the top bar wanted 345px (353px in German) of brand + Options + EN/DE and
//     had 276px at 320px: the language toggle ran off the right edge. At 390px
//     English fitted by exactly one pixel, which is not a fit.
//   - the wordmark's clamp floor (56px) is 321px of Pixelify — wider than a 320px
//     screen's 276px gutter — and a single unbreakable word cannot wrap its way
//     out of that, so the H1 alone scrolled the page sideways.
//
// So the assertions are about *slack*, not about the absence of a symptom, and the
// sweep runs in both languages and with touch emulation both on and off. The touch
// case is not paranoia: the (pointer: coarse) block sets thumb-sized padding on the
// same two controls the narrow-width block shrinks, media queries carry no
// specificity, and for one edit the coarse shorthand won — re-widening the toggle
// that used to fall off the screen, on phones only.
//
// Requires the production build served (default http://localhost:4173/ —
// `npm run preview`). Mirrors tests/landing.mjs for browser launch.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';
const WIDTHS = [320, 360, 375, 390, 412, 430, 480, 540, 600, 720, 900, 1280];
const LANGS = ['en', 'de'];

const CHAIN_MIN_ICON = 22; // px: the floor a shrinking chain icon must still clear
const BAR_SLACK = 12; // px the top bar's contents must leave inside their row
const EDGE_SLACK = 6; // px the full-bleed skyline must keep off both edges

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

// 12 widths × 2 languages × 2 pointer kinds × a dozen assertions is 1200 lines of
// "ok", which nobody reads and which hides the one line that matters. So a width
// that passes everything prints one line carrying its measurements — the numbers
// are the point, they are what a retune has to be judged against — and a width
// that fails prints every failing assertion in full.
let failures = 0;
let pending = [];
const check = (name, cond, extra = '') => pending.push({ name, cond, extra });
const flush = (label, summary) => {
  const bad = pending.filter((c) => !c.cond);
  failures += bad.length;
  if (bad.length) {
    console.log(`  FAIL ${label} — ${summary}`);
    for (const c of bad) console.log(`       ${c.name}${c.extra ? ' — ' + c.extra : ''}`);
  } else {
    console.log(`  ok   ${label} — ${summary}`);
  }
  pending = [];
};

// Everything measured in one pass in the page, so a resize can't land between two
// reads. Rows are grouped by the axis the row aligns on: the chain centres its
// items (an arrow is shorter than an icon), the skyline stands them on the ground.
const measure = () => {
  const rowsOf = (el, axis) => {
    const rows = [];
    for (const k of el.children) {
      const b = k.getBoundingClientRect();
      const at = axis === 'bottom' ? b.bottom : (b.top + b.bottom) / 2;
      let row = rows.find((r) => Math.abs(r.at - at) < 4);
      if (!row) rows.push((row = { at, items: [] }));
      row.items.push({
        kind: k.dataset && k.dataset.sprite ? 'icon' : 'arrow',
        name: (k.dataset && k.dataset.sprite) || k.textContent.trim(),
        w: Math.round(b.width * 10) / 10,
        h: Math.round(b.height * 10) / 10,
        right: b.right,
        left: b.left,
      });
    }
    return rows;
  };

  const chain = document.querySelector('.chain');
  const sky = document.querySelector('.fd-skyline');
  const bar = document.querySelector('.fd-topbar-in');
  const brand = document.querySelector('.fd-brand');
  const parts = ['.fd-brand', '.fd-options', '.seg'].map((s) => document.querySelector(s).getBoundingClientRect());
  const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
  const chainBox = chain.getBoundingClientRect();
  const chainPad = parseFloat(getComputedStyle(chain).paddingRight);
  const skyKids = [...sky.children].map((k) => k.getBoundingClientRect());

  return {
    inner: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
    chain: rowsOf(chain, 'mid').map((r) => r.items),
    // does anything in the row spill out of the panel that frames it?
    chainSpill: Math.round(
      Math.max(0, ...[...chain.children].map((k) => k.getBoundingClientRect().right - (chainBox.right - chainPad))) * 10,
    ) / 10,
    sky: rowsOf(sky, 'bottom').map((r) => r.items),
    skyEdges: [Math.round(Math.min(...skyKids.map((b) => b.left))), Math.round(Math.max(...skyKids.map((b) => b.right)))],
    bar: {
      room: bar.clientWidth,
      used: Math.round(parts.reduce((a, p) => a + p.width, 0) + gap * 2),
      segRight: Math.round(parts[2].right),
      // the mark-only bar below 380px would otherwise leave a nameless link:
      // the wordmark is display:none and the icon is aria-hidden
      brandName: (brand.getAttribute('aria-label') || brand.textContent).trim(),
      brandTextShown: getComputedStyle(brand.querySelector('span')).display !== 'none',
    },
  };
};

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});

// A phone is coarse AND narrow; a desktop window at the same width is only narrow.
// Both are swept because the two cases are governed by different rules.
for (const touch of [true, false]) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 860 },
    deviceScaleFactor: touch ? 3 : 1,
    isMobile: touch,
    hasTouch: touch,
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    console.log('[pageerror]', e.message);
    failures++;
  });
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  console.log(`\n${touch ? 'touch' : 'mouse'} (pointer: ${touch ? 'coarse' : 'fine'})`);
  for (const lang of LANGS) {
    await page.evaluate((l) => {
      const btn = document.querySelector(`.seg-btn[data-lang="${l}"]`);
      if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click();
    }, lang);
    await page.waitForTimeout(150);

    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 860 });
      await page.waitForTimeout(120);
      const m = await page.evaluate(measure);
      const at = `${lang} @${w}`;

      // 1. nothing anywhere on the page may scroll it sideways
      check(`${at}: page does not scroll sideways`, m.scroll <= m.inner, `scrollWidth ${m.scroll} vs ${m.inner}`);

      // 2. the chain is one line, in order, with every arrow between two icons
      const chainRows = m.chain;
      check(`${at}: chain stays on one line`, chainRows.length === 1,
        chainRows.map((r) => r.map((i) => i.name).join(' ')).join('  /  '));
      const orphan = chainRows.some((r) => r[0].kind === 'arrow' || r[r.length - 1].kind === 'arrow');
      check(`${at}: no line starts or ends with an arrow`, !orphan,
        orphan ? chainRows.map((r) => r.map((i) => i.name).join(' ')).join('  /  ') : 'every arrow sits between two steps');
      const icons = chainRows.flat().filter((i) => i.kind === 'icon');
      check(`${at}: chain shows all six steps`, icons.length === 6, `${icons.length} icons`);
      const smallest = Math.min(...icons.map((i) => i.w));
      check(`${at}: chain icons clear ${CHAIN_MIN_ICON}px`, smallest >= CHAIN_MIN_ICON, `smallest ${smallest}px`);
      check(`${at}: chain icons shrink together`, new Set(icons.map((i) => i.w)).size === 1,
        icons.map((i) => i.w).join(','));
      check(`${at}: chain stays inside its panel`, m.chainSpill <= 0.5, `${m.chainSpill}px past the padding`);

      // 3. the skyline is one row, square, inside the screen, town hall tallest
      check(`${at}: skyline stays on one row`, m.sky.length === 1, `${m.sky.length} rows`);
      const figures = m.sky.flat();
      check(`${at}: skyline keeps both edges off the screen edge`,
        m.skyEdges[0] >= EDGE_SLACK && m.skyEdges[1] <= m.inner - EDGE_SLACK,
        `${m.skyEdges[0]}..${m.skyEdges[1]} of ${m.inner}`);
      const squashed = figures.filter((f) => Math.abs(f.w - f.h) > 1);
      check(`${at}: skyline sprites stay square while shrinking`, squashed.length === 0,
        squashed.map((f) => `${f.name} ${f.w}x${f.h}`).join(', ') || `${figures.length} figures`);
      const tallest = figures.indexOf(figures.reduce((a, b) => (b.h > a.h ? b : a)));
      check(`${at}: the town hall is still the tallest thing on the ridge`, tallest === 3, `index ${tallest}`);

      // 4. the top bar leaves real slack and never clips the language toggle
      check(`${at}: top bar leaves ${BAR_SLACK}px slack`, m.bar.room - m.bar.used >= BAR_SLACK,
        `${m.bar.used}px used of ${m.bar.room}px`);
      check(`${at}: language toggle is fully on screen`, m.bar.segRight <= m.inner - EDGE_SLACK,
        `right edge ${m.bar.segRight} of ${m.inner}`);
      check(`${at}: the brand link has a name${m.bar.brandTextShown ? '' : ' (wordmark hidden)'}`,
        m.bar.brandName.length > 0, m.bar.brandName || 'nameless link');

      flush(
        at,
        `chain ${chainRows.length} row, icons ${smallest}px · sky ${m.skyEdges[0]}..${m.skyEdges[1]} · ` +
          `bar ${m.bar.room - m.bar.used}px slack${m.bar.brandTextShown ? '' : ', mark only'}`,
      );
    }
  }
  await ctx.close();
}

await browser.close();
if (failures) {
  console.log(`\nFRONT-DOOR MOBILE FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nFRONT-DOOR MOBILE PASS');
