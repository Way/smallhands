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
// 280px is a folded cover screen, 320px an SE — the two narrowest widths anyone
// actually holds, and the ones the fixed parts of a row are measured against.
const WIDTHS = [280, 320, 360, 375, 390, 412, 430, 480, 540, 600, 720, 900, 1280];
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
  // The bar's two flex items, not its three controls: the gap between Options and
  // EN/DE is internal to the actions group and already inside its width. And the
  // room is the CONTENT box — clientWidth includes the .wrap gutter, so measuring
  // against it reported 139px of slack at 320px where there are 88px, and would
  // have called a row that overhangs the safe-area inset by 30px a comfortable fit.
  const parts = ['.fd-brand', '.fd-topbar-actions'].map((s) => document.querySelector(s).getBoundingClientRect());
  const seg = document.querySelector('.seg').getBoundingClientRect();
  const barCs = getComputedStyle(bar);
  const gap = parseFloat(barCs.columnGap) || 0;
  const room = bar.clientWidth - parseFloat(barCs.paddingLeft) - parseFloat(barCs.paddingRight);
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
    lang: document.documentElement.lang,
    lede: document.querySelector('.lede').textContent.trim(),
    bar: {
      room: Math.round(room),
      used: Math.round(parts.reduce((a, p) => a + p.width, 0) + gap),
      segRight: Math.round(seg.right),
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
  const copySeen = new Set();
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

      // 0. this pass really is in the language it claims. The German copy is the
      // wider of the two — it is 8px more top bar and it is what a slack figure
      // has to survive — so a toggle click that silently stopped working would
      // turn half of this sweep into a second English run and still print "de".
      check(`${at}: the page is really in ${lang}`, m.lang === lang, `<html lang="${m.lang}">`);
      copySeen.add(m.lede);

      // 1. nothing anywhere on the page may scroll it sideways
      check(`${at}: page does not scroll sideways`, m.scroll <= m.inner, `scrollWidth ${m.scroll} vs ${m.inner}`);

      // 2. the chain is one line, in order, with every arrow between two icons
      const chainRows = m.chain;
      check(`${at}: chain stays on one line`, chainRows.length === 1,
        chainRows.map((r) => r.map((i) => i.name).join(' ')).join('  /  '));
      // A corollary of the line count while the row is a plain flex row (the DOM
      // starts and ends with an icon), kept because it is the card's actual
      // complaint and so belongs in the failure message by name — and because a
      // future deliberate break (a spacer, a grid) could satisfy one and not the
      // other.
      const orphan = chainRows.some((r) => r[0].kind === 'arrow' || r[r.length - 1].kind === 'arrow');
      check(`${at}: no line starts or ends with an arrow`, !orphan,
        orphan ? chainRows.map((r) => r.map((i) => i.name).join(' ')).join('  /  ') : 'every arrow sits between two steps');
      const icons = chainRows.flat().filter((i) => i.kind === 'icon');
      check(`${at}: chain shows all six steps`, icons.length === 6, `${icons.length} icons`);
      const smallest = Math.min(...icons.map((i) => i.w));
      check(`${at}: chain icons clear ${CHAIN_MIN_ICON}px`, smallest >= CHAIN_MIN_ICON, `smallest ${smallest}px`);
      // Equal to within a pixel, not identical: flex hands the deficit out in
      // fractions and the row lands on 23.6, 23.5, 23.6… — a spread of one device
      // pixel is layout rounding, and "identical" fails on it about as often as
      // not (the same trap tests/mobile.mjs rounds away for its tap targets).
      const spread = Math.max(...icons.map((i) => i.w)) - Math.min(...icons.map((i) => i.w));
      check(`${at}: chain icons shrink together`, spread <= 1, `${spread.toFixed(1)}px apart: ${icons.map((i) => i.w).join(',')}`);
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
          `bar ${m.bar.used}/${m.bar.room}px${m.bar.brandTextShown ? '' : ', mark only'}`,
      );
    }
  }
  // Both languages were swept, so both ledes must have been seen: identical copy
  // across the two passes means the toggle moved nothing.
  check('the two language passes rendered different copy', copySeen.size === LANGS.length,
    `${copySeen.size} distinct lede(s) across ${LANGS.length} languages`);
  flush(`${touch ? 'touch' : 'mouse'}: languages`, `${copySeen.size} distinct ledes`);
  await ctx.close();
}

await browser.close();
if (failures) {
  console.log(`\nFRONT-DOOR MOBILE FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nFRONT-DOOR MOBILE PASS');
