// Audio graph smoke test.
//
// Whether a cue *sounds* good is not testable and this suite does not pretend to
// judge it. What it does catch is the failure mode that silently reaches players:
// WebAudio throws at call time on a bad param — an `exponentialRampToValueAtTime`
// towards zero, a ramp scheduled before the `setValueAtTime` it ramps from, an
// oscillator stopped before it starts — and a cue that throws is just silence with
// a console entry nobody reads. So every cue is fired, every click draft is fired,
// and the music bed is run long enough to cross a chord turn and a section change
// (where the pad re-voices and the pulse enters), with any pageerror failing.
//
// Requires the production build served at http://localhost:4173/ (npm run preview).
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import { beginRun } from './enter.mjs';

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

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const CUES = [
  'click', 'place', 'placeBuilding', 'invalid', 'chop', 'dig', 'deposit', 'goalDeposit',
  'built', 'hoistCycle', 'upgraded', 'spawn', 'demolish', 'win', 'hint', 'splash',
];
// Clicks and harvests share one material vocabulary, so one list covers both.
const MATERIALS = ['wood', 'stone', 'metal'];

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  // the graph must actually start, or every cue trivially no-ops and the suite
  // passes while testing nothing
  args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

// The hook is installed by `startGame`, so the test has to reach a live level:
// Play opens the world map, a node opens its popover, and the popover starts it.
await page.goto(BASE_URL);
await page.waitForTimeout(400);
await page.locator('.fd-play').first().click();
await page.waitForTimeout(600);
await page.locator('.map-node').first().click();
await page.waitForTimeout(400);
await page.locator('.pop-play').first().click();
await beginRun(page);
await page.waitForTimeout(900);

const hooked = await page.evaluate(() => {
  const s = window.__smallhands;
  return !!(s && s.audio && s.music);
});
check('audio and music are on the debug hook', hooked);
if (!hooked) {
  await browser.close();
  console.log('\ncannot audition without the hook');
  process.exit(1);
}

// Every cue, including each click draft. A throw inside a cue surfaces as a
// pageerror rather than a rejected evaluate, hence the error list.
const fired = await page.evaluate(
  async ([cues, materials]) => {
    const { audio } = window.__smallhands;
    audio.muted = false;
    const thrown = [];
    // every click material, plus the no-argument call the ~20 neutral UI callers make
    for (const m of [undefined, ...materials]) {
      try {
        audio.click(m);
      } catch (e) {
        thrown.push(`click:${m ?? 'default'} ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 60));
    }
    for (const c of cues) {
      try {
        audio[c]();
      } catch (e) {
        thrown.push(`${c} ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    return thrown;
  },
  [CUES, MATERIALS],
);
check('no cue throws', fired.length === 0, fired.join('; '));

// Each harvest material, plus the guard that actually matters: every node kind
// must map to a material. A missing entry would fall back to wood and be a silent
// regression — three resources that sound identical is exactly the bug this
// feature exists to prevent, and it would never throw.
const harvest = await page.evaluate(async (materials) => {
  const { audio, game } = window.__smallhands;
  const thrown = [];
  for (const m of materials) {
    try {
      audio.harvest(m);
    } catch (e) {
      thrown.push(`harvest:${m} ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  // NodeKind lives in the sim's own data, so read the kinds the game actually has
  // rather than restating the list here.
  const kinds = [...new Set((game.nodes ?? []).map((n) => n.kind))];
  return { thrown, kinds };
}, MATERIALS);
check('no harvest material throws', harvest.thrown.length === 0, harvest.thrown.join('; '));
check(
  'every node kind on this level is a known material',
  harvest.kinds.every((k) => ['tree', 'boulder', 'vein'].includes(k)),
  `kinds: ${harvest.kinds.join(', ') || 'none'}`,
);

// The click drafts must be distinguishable, or there is nothing to choose
// between: each is a different pair of primitives, so a variant that silently
// fell through to the default is a real bug in the switch.
// `click` must actually take a material, and an unrecognised one must fall through
// to the neutral voice rather than throwing — the mapping tables are exhaustive at
// compile time, but a hand-written call from the console should not be able to
// break the sound of the whole UI.
const clickApi = await page.evaluate((materials) => {
  const { audio } = window.__smallhands;
  const thrown = [];
  for (const m of [...materials, 'granite', null]) {
    try {
      audio.click(m);
    } catch (e) {
      thrown.push(`${m} ${e.message}`);
    }
  }
  return { thrown };
}, MATERIALS);
check('an unknown material falls back instead of throwing', clickApi.thrown.length === 0, clickApi.thrown.join('; '));

// The wiring that actually delivers the feature: flagging a resource must emit a
// placement carrying that resource, or the cue has nothing to pick a material from
// and silently falls back to the neutral click. Nothing throws when this breaks —
// the flag still works, it just stops sounding like the thing it landed on.
const flagged = await page.evaluate(() => {
  const { game } = window.__smallhands;
  const node = (game.nodes ?? []).find((n) => n.yieldLeft > 0);
  if (!node) return { reached: false };
  let seen = null;
  const prev = game.onEvent;
  game.onEvent = (e) => {
    if (e.type === 'place') seen = { what: e.what, kind: e.node && e.node.kind };
    prev(e);
  };
  const toggled = game.toggleMark(node.x, node.y);
  game.onEvent = prev;
  return { reached: true, toggled, seen, kind: node.kind };
});
check('a harvestable node exists to flag', flagged.reached && flagged.toggled);
check(
  'flagging a resource reports it as an order',
  flagged.seen?.what === 'order',
  `what=${flagged.seen?.what}`,
);
check(
  'flagging a resource carries its kind for the cue',
  flagged.seen?.kind === flagged.kind,
  `carried ${flagged.seen?.kind} for a ${flagged.kind}`,
);

// The bed: run past a chord turn (2 bars) and far enough for the pad to re-voice.
// At 112bpm a bar is ~2.14s, so ~5s crosses two chord turns.
const bed = await page.evaluate(async () => {
  const { music } = window.__smallhands;
  music.setVolume(0.19);
  music.setEnabled(true);
  music.setPlaying(true);
  await new Promise((r) => setTimeout(r, 5200));
  const v = music.volume;
  music.setVolume(0.06); // exercise the live ramp on a running master
  await new Promise((r) => setTimeout(r, 400));
  const lowered = music.volume;
  await new Promise((r) => setTimeout(r, 2400)); // keep scheduling past a section edge
  music.setPlaying(false);
  return { v, lowered, enabled: music.isEnabled };
});
check('bed reports the volume it was set to', Math.abs(bed.v - 0.19) < 1e-6, `${bed.v}`);
check('live volume change applies', Math.abs(bed.lowered - 0.06) < 1e-6, `${bed.lowered}`);
check('volume is clamped to a sane ceiling', await page.evaluate(() => {
  const { music } = window.__smallhands;
  music.setVolume(9);
  const v = music.volume;
  music.setVolume(0.19);
  return v <= 0.5;
}));
check('no errors across the whole run', errors.length === 0, errors.slice(0, 4).join(' | '));

await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nAUDIO SMOKE PASS');
process.exit(failures ? 1 : 0);
