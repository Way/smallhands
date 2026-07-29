// Toolbar chip labels must fit their 52px chip in BOTH languages — and when one
// doesn't fit, it must break at a space, never inside a word.
//
// This needs a browser because it is a text-metrics question: no data assertion can
// tell you that "Lastenaufzug" is 55px wide at 9px. It also cannot be eyeballed
// reliably, because a chip only shows the tools its level allows — the German lift
// chip read "Lastenaufz / ug" for weeks, on levels 14-22 only, and reached a
// marketing trailer that way.
//
// The chips are rebuilt from the same classes the HUD uses (`.toolbar` > `.tool-btn`
// > `.tool-label`), so the real cascade applies without booting one level per tool.
// Both breakpoints are measured: the mobile rule widens the chip to 54px but also
// grows the font to 10px, so fitting at desktop does not imply fitting on a phone.
//
// The assertion is SLACK, not the absence of a wrap, and that distinction is the
// whole point: "Lastenaufzug" measured 48.0px inside a 48px content box — a fit by
// zero margin that this very suite first reported as passing, while the shipped
// trailer plainly showed "Lastenaufz / ug". Text metrics move with font hinting and
// the browser's device-scale flags, so anything filling its box is already broken;
// it just hasn't been rasterised on the wrong machine yet.
import { chromium } from 'playwright-core';
import { D } from '../src/engine/i18n.ts';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';
const LANGS = { en: 0, de: 1 };
const MAX_LINES = 2; // the chip is 52px tall: a 26px icon leaves room for two 9px lines
const SLACK = 4; // px a single word must have left over inside the chip's content box

// Every tool the toolbar can show, with the text it would paint: the short label
// where one is defined, exactly as ui.ts does it (tOr('tool.<id>.short', …label)).
const TOOL_IDS = Object.keys(D)
  .filter((k) => /^tool\.[a-z]+\.label$/.test(k))
  .map((k) => k.split('.')[1]);

const chipText = (id, i) => {
  const short = D[`tool.${id}.short`];
  return (short ?? D[`tool.${id}.label`])[i];
};

let fails = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) fails++;
};

const measure = (chips) => {
  const bar = document.createElement('div');
  bar.className = 'toolbar';
  // fixed and off to the side: laid out for real (rects need it) but out of the way
  bar.style.cssText = 'position:fixed;left:0;bottom:0;z-index:99999;visibility:hidden';
  for (const { id, text } of chips) {
    const btn = document.createElement('button');
    btn.className = 'tool-btn';
    const cv = document.createElement('canvas');
    btn.appendChild(cv);
    const span = document.createElement('span');
    span.className = 'tool-label';
    span.dataset.tool = id;
    span.textContent = text;
    btn.appendChild(span);
    bar.appendChild(btn);
  }
  document.body.appendChild(bar);
  const out = [];
  for (const span of bar.querySelectorAll('.tool-label')) {
    const node = span.firstChild;
    const r = document.createRange();

    // Which lines does the text actually occupy? NOT getClientRects() on the span:
    // `.tool-label` is a flex item, so it is block-ified and returns exactly one rect
    // (its border box) no matter how many lines it holds — the first version of this
    // suite believed that rect and therefore never saw a wrap at all. Per-character
    // Ranges are inline text boxes, so their `top` genuinely changes per line.
    const lines = [];
    let start = 0;
    let top = null;
    for (let i = 1; i <= node.length; i++) {
      r.setStart(node, i - 1);
      r.setEnd(node, i);
      const t = Math.round(r.getBoundingClientRect().top);
      if (top === null) top = t;
      if (t !== top) {
        lines.push(node.data.slice(start, i - 1));
        start = i - 1;
        top = t;
      }
    }
    lines.push(node.data.slice(start));

    // True width of the longest word, measured with wrapping switched OFF — a Range
    // over an already-wrapped word returns the union of its line boxes, which is the
    // wrap width rather than the word's, and reads as "48.9px" for every word too
    // long to fit (that is why two labels of different lengths measured identically).
    const wrap = span.style.whiteSpace;
    span.style.whiteSpace = 'nowrap';
    let widest = 0;
    let at = 0;
    for (const word of span.textContent.split(/(\s+)/)) {
      if (word.trim()) {
        r.setStart(node, at);
        r.setEnd(node, at + word.length);
        widest = Math.max(widest, r.getBoundingClientRect().width);
      }
      at += word.length;
    }
    span.style.whiteSpace = wrap;

    // The room a word has is the CHIP's content box, not the label's own width: the
    // span is a shrink-to-fit flex item, so its own clientWidth is just the text back
    // again (measuring against that reported every label as "tight").
    const room = span.parentElement.clientWidth;
    out.push({
      tool: span.dataset.tool,
      text: span.textContent,
      lines: lines.length,
      clipped: widest > room + 0.5,
      widest: Math.round(widest * 10) / 10,
      room,
      // a legal break consumes a space, so the line before it ends in whitespace
      brokenMidWord: lines.some((l, i) => i < lines.length - 1 && !/\s$/.test(l)),
    });
  }
  bar.remove();
  return out;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  for (const [w, where] of [[1280, 'desktop'], [390, 'mobile']]) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const [lang, i] of Object.entries(LANGS)) {
      const chips = TOOL_IDS.map((id) => ({ id, text: chipText(id, i) }));
      const rows = await page.evaluate(measure, chips);
      const broken = rows.filter((r) => r.brokenMidWord);
      const clipped = rows.filter((r) => r.clipped);
      const tall = rows.filter((r) => r.lines > MAX_LINES);
      const tight = rows.filter((r) => r.widest > r.room - SLACK);
      check(
        `${where} ${lang}: no chip label breaks inside a word`,
        broken.length === 0,
        broken.map((r) => `${r.tool}="${r.text}"`).join(', ') || `${rows.length} labels`
      );
      check(
        `${where} ${lang}: every word clears the chip by ${SLACK}px`,
        tight.length === 0,
        tight.map((r) => `${r.tool}="${r.text}" ${r.widest}/${r.room}px`).join(', ') ||
          `widest ${Math.max(...rows.map((r) => r.widest))}px of ${rows[0].room}px`
      );
      check(
        `${where} ${lang}: no chip label is clipped`,
        clipped.length === 0,
        clipped.map((r) => `${r.tool}="${r.text}"`).join(', ') || 'all fit'
      );
      check(
        `${where} ${lang}: no chip label runs past ${MAX_LINES} lines`,
        tall.length === 0,
        tall.map((r) => `${r.tool}="${r.text}" (${r.lines})`).join(', ') || 'all short enough'
      );
    }
  }
} finally {
  await browser.close();
}

console.log(fails ? `\nTOOL LABELS FAIL (${fails})` : '\nTOOL LABELS PASS');
process.exit(fails ? 1 : 0);
