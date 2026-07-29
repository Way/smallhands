// Teaser caption fit: the trailer's lower third must clear the in-game tool dock.
//
// Worth its own suite because the failure it guards shipped for weeks in the most
// visible place the project has. The caption block sat at a hand-tuned `bottom:
// 8.5%`, the dock sits bottom-centre in the same band, and the yellow sub-line
// printed straight across the chip row in eight of the fourteen scenes — including
// the poster the front door shows before anyone presses play. Nothing could see it:
// the trailer is a rendered artifact, and no test measured the overlay against the
// HUD (card #79).
//
// So this measures. It imports the renderer's own overlay (`pageLib`) and its own
// caption deck (`copy.mjs`) — never a copy of either — mounts the overlay on the
// real game, and walks EVERY level with EVERY line of the deck in BOTH languages.
// Every level, because the dock's width is the level's `allowedTools` and a chip's
// label wraps to a second line at some widths (`Rope Anchor`, `Seilanker`); every
// line, because German runs wider than English and a caption that wraps grows the
// block, so the deck's longest line is not obviously its tallest.
//
// What it cannot do is tell you whether the lower third READS well — that still
// has to be looked at (`--storyboard`).
//
// Usage: BASE_URL=http://localhost:4173/ CHROME_PATH=… node tests/teaser-caption.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { pageLib } from '../tools/trailer/page-lib.mjs';
import { COPY } from '../tools/trailer/copy.mjs';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';
// The render's own frame. The rule is resolution-independent (it is measured), but
// the acceptance criterion on the card is 1280×720, so that is what gets asserted.
const W = 1280;
const H = 720;
// The gap the caption must keep. Below this a reader sees text that only just
// missed the buttons rather than a lower third that was placed.
const MIN_GAP = 10;
// A few generated worlds, because the biome cuts run on `generateVerifiedLevel`
// output and nobody authors its tool set. Not the renderer's own three seeds — the
// property under test is that NO generated dock moves the band, which is broader
// than those cuts and does not rot when the biome selection changes.
const SEEDS = ['teaser-0', 'teaser-3', 'teaser-7'];

let fails = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) fails++;
};

// Runs entirely in the page: for every level, fit the caption to that level's dock,
// then print each line of the deck into it and measure the block against the dock's
// ink. Returns one row per (level, caption) so node can report the worst case.
const probe = ({ deck, seeds }) => {
  const out = [];
  const keys = Object.keys(deck).filter((k) => deck[k].h || deck[k].sub);
  // Every level the deck can stage. The campaign, walked until the index runs off
  // the end (startGame throws on an undefined level) — plus GENERATED levels, because
  // the three biome cuts run on `generateVerifiedLevel` output, whose tool set nobody
  // authored. Those cuts hide the HUD but still carry a caption spanning all three,
  // so a generated dock of a different height would move the band under live text.
  const boots = [
    ...Array.from({ length: 60 }, (_, i) => ({ generated: false, run: () => window.__smallhands.startLevel(i) })),
    ...seeds.map((seed) => ({
      generated: true,
      run: () => {
        const SH = window.__smallhands;
        SH.startCustomLevel(SH.generateVerifiedLevel({ seed, difficulty: 2 }), {});
      },
    })),
  ];
  for (const boot of boots) {
    try {
      boot.run();
    } catch {
      continue; // an index past the campaign — the generated cases still follow
    }
    // the debug hook replaces the whole __smallhands object on every start
    const SH = window.__smallhands;
    if (!SH.game) continue;
    const fit = window.__fitCaption();
    const bar = document.querySelector('.toolbar');
    // the dock's ink, not its box — the same rule __fitCaption measures by
    let dockTop = window.innerHeight;
    let chips = 0;
    if (bar) {
      for (const el of [bar, ...bar.querySelectorAll('*')]) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) dockTop = Math.min(dockTop, r.top);
      }
      chips = bar.querySelectorAll('.tool-btn').length;
    }
    const veil = getComputedStyle(document.querySelector('#tov .veil')).backgroundImage;
    // A block element has ONE client rect however many lines it renders, so count
    // line boxes off a Range over its text instead (one rect per line).
    const lines = (sel) => {
      const el = document.querySelector(sel);
      if (!el.textContent) return 0;
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    };
    for (const key of keys) {
      window.__applyState({ h: deck[key].h, sub: deck[key].sub, textO: 1 });
      const txt = document.querySelector('#tov .txt').getBoundingClientRect();
      out.push({
        level: `${boot.generated ? 'seed' : 'level'} ${SH.game.level.id}`,
        generated: boot.generated,
        key,
        chips,
        band: fit.bottom,
        dock: fit.dock,
        guard: fit.guard,
        gap: Math.round(dockTop - txt.bottom),
        hLines: lines('#tov .h'),
        subLines: lines('#tov .sub'),
        top: Math.round(txt.top),
        veil,
      });
    }
  }
  return out;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  args: ['--no-sandbox', '--mute-audio', '--force-device-scale-factor=1'],
});

try {
  for (const lang of ['en', 'de']) {
    console.log(`\n${lang.toUpperCase()} — every level × every caption`);
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', (e) => check('no page errors', false, e.message));
    // the chip labels are what wrap, so the game has to be in the language under test
    await page.addInitScript((l) => {
      localStorage.setItem(
        'smallhands-save-v1',
        JSON.stringify({ completed: [], completedCustom: [], records: {}, muted: true, lang: l, effects: 'full' })
      );
    }, lang);
    await page.goto(BASE_URL, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('.fd-play').click());
    await page.evaluate(() => document.querySelector('.map-node:not(:disabled)').click());
    await page.evaluate(() => document.querySelector('.map-popover .pop-play').click());
    await page.waitForFunction(() => !!window.__smallhands);
    await page.evaluate(pageLib);
    // a fallback font measures differently, and it is the label widths that decide
    // whether a chip wraps — so wait for the real ones before measuring anything
    await page.evaluate(() => document.fonts.ready);

    const rows = await page.evaluate(probe, { deck: COPY[lang], seeds: SEEDS });
    const authored = new Set(rows.filter((r) => !r.generated).map((r) => r.level));
    const generated = new Set(rows.filter((r) => r.generated).map((r) => r.level));
    check(
      'walked every level the deck can stage',
      authored.size >= 20 && generated.size === SEEDS.length,
      `${authored.size} authored + ${generated.size} generated × ${rows.length / (authored.size + generated.size)} captions`
    );

    const worst = rows.reduce((a, b) => (b.gap < a.gap ? b : a));
    check(
      'every caption clears the tool dock',
      worst.gap >= MIN_GAP,
      `tightest: ${worst.level} "${worst.key}" (${worst.chips} chips) — ${worst.gap}px of air`
    );

    // The band is derived from the dock, so it must actually track it rather than
    // having landed on the old tuned percentage by luck.
    const measured = rows.filter((r) => r.dock > 0);
    check(
      'the band is the measured dock plus the guard',
      measured.length === rows.length && measured.every((r) => r.band === r.dock + r.guard),
      `${measured.length}/${rows.length} measured; band ${measured[0]?.band}px = dock ${measured[0]?.dock}px + ${measured[0]?.guard}px`
    );
    // And it must be ONE band for the whole deck: a lower third that shifts from
    // cut to cut reads as a mistake, and no single still can show it.
    const bands = [...new Set(rows.map((r) => r.band))];
    check('one band for every level', bands.length === 1, `bands: ${bands.join(', ')}px`);

    // Trap the card names first: the veil is the only contrast the caption has over
    // bright ground, and it is bottom-anchored — so moving the text without moving
    // the gradient silently strands the text above its own darkening.
    const band = rows[0].band;
    check(
      'the veil follows the text',
      rows.every((r) => r.veil.includes(`${band}px`)),
      rows[0].veil.replace(/rgba?\([^)]*\)/g, 'c').slice(0, 90)
    );

    // A wrapped line is legal — the block is bottom-anchored, so it grows UPWARD,
    // away from the dock, which is why German's extra width can never push the
    // caption back into the chips. Report which ones wrap: it changes how the
    // frame reads, and a third line would start eating the shot.
    const wrapped = rows.filter((r) => r.hLines > 1 || r.subLines > 1);
    check(
      'no caption line wraps past two',
      rows.every((r) => r.hLines <= 2 && r.subLines <= 2),
      wrapped.length
        ? `wraps: ${wrapped.map((r) => `${r.key}(${r.hLines}h/${r.subLines}s)`).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`
        : 'all single-line'
    );

    // The other end: the block must not climb into the top HUD panels either.
    const highest = rows.reduce((a, b) => (b.top < a.top ? b : a));
    check(
      'the block stays clear of the top HUD',
      highest.top > 260,
      `highest: ${highest.level} "${highest.key}" at y=${highest.top}`
    );

    // The overlay carries no CSS fallback for --tov-bottom, so that a lost fit call
    // cannot quietly restore the tuned percentage this card exists to delete. That is
    // a claim about failure, so check the failure: unset the var and the caption must
    // LEAVE the lower third and lose its veil outright, which the first storyboard
    // still would show. (Restore it afterwards — the next language reloads anyway.)
    const broken = await page.evaluate(() => {
      const tov = document.getElementById('tov');
      tov.style.removeProperty('--tov-bottom');
      const txt = document.querySelector('#tov .txt');
      const r = txt.getBoundingClientRect();
      const out = {
        bottom: getComputedStyle(txt).bottom,
        veil: getComputedStyle(document.querySelector('#tov .veil')).backgroundImage,
        inLowerThird: r.top > window.innerHeight * 0.6,
      };
      window.__fitCaption();
      return out;
    });
    check(
      'an unfitted caption fails loudly, not back onto the chips',
      !broken.inLowerThird && broken.veil === 'none',
      `bottom: ${broken.bottom}, veil: ${broken.veil}`
    );

    await context.close();
  }

  // Everything above measures the overlay. None of it can see the DIRECTOR, and the
  // overlay is inert until something calls the fit — so a lost call would leave this
  // whole suite green while the render went back to printing captions on the chips.
  // (The CSS has no fallback for exactly that reason, but the belt is worth the
  // braces: a red line naming the call beats a caption mysteriously at the top.)
  const director = readFileSync(new URL('../tools/trailer/render-teaser.mjs', import.meta.url), 'utf8');
  const sceneLoop = director.indexOf('for (const scene of scenes)');
  const fit = director.indexOf('__fitCaption()');
  const frameLoop = director.indexOf('for (let f = 0; f < scene.frames', sceneLoop);
  check(
    'the renderer fits the caption once per scene, before the frames',
    sceneLoop > 0 && frameLoop > 0 && fit > sceneLoop && fit < frameLoop,
    `scene loop @${sceneLoop} → __fitCaption @${fit} → frame loop @${frameLoop}`
  );
} finally {
  await browser.close();
}

console.log(fails ? `\nTEASER CAPTION FAIL (${fails})` : '\nTEASER CAPTION PASS');
process.exit(fails ? 1 : 0);
