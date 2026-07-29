// Teaser-trailer renderer: captures ~45 s of real Smallhands gameplay as a
// deterministic frame-by-frame video (1280×720 @ 30 fps) and encodes it to MP4.
//
// Instead of screen-recording in real time (stutter, JPEG screencast quality),
// the page's clock is faked: requestAnimationFrame and performance.now are
// replaced before the game boots, and the director advances virtual time by
// exactly 1/30 s per captured frame. The game's fixed-timestep loop then runs
// the simulation deterministically, every frame is a crisp PNG screenshot, and
// the whole take is reproducible. Scenes are staged through the game's own
// window.__smallhands debug hook with the proven scripted solutions from
// tests/e2e.mjs, tests/campaign2.mjs and tests/campaign3.mjs.
//
// This file is the director: the scene deck, the camera paths and the encode. The
// in-page half — caption overlay, per-frame state applier, sim helpers — is
// page-lib.mjs, and the caption strings are copy.mjs; both are separate so
// tests/teaser-caption.mjs can measure the real overlay against the real copy.
//
// Usage (production build served on :4173 — `npx vite build && npx vite preview`):
//   node tools/trailer/render-teaser.mjs                 # both languages, MP4
//   node tools/trailer/render-teaser.mjs --lang=de       # one language
//   node tools/trailer/render-teaser.mjs --storyboard    # 3 stills per scene, no video
//   node tools/trailer/render-teaser.mjs --only=dig,drown # stage a subset (iteration)
//   BASE_URL=http://localhost:5173/ ... to point elsewhere
//
// Encoding uses @ffmpeg-installer/ffmpeg when available (H.264 + AAC music),
// falling back to Playwright's bundled ffmpeg (VP8 WebM, silent).
import { chromium } from 'playwright-core';
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMusicWav } from './music.mjs';
import { pageLib } from './page-lib.mjs';
import { COPY } from './copy.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';
const FPS = 30;
const W = 1280;
const H = 720;
const TILE = 16; // world px per tile before camera zoom (src/game/types.ts)

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const a = args.find((s) => s.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : dflt;
};
const STORYBOARD = args.includes('--storyboard');
// Iteration helper: `--only=dig,drown` stages just those scene ids. Every scene
// boots its own level in its setup, so any subset is a valid run — this exists so
// one new scene can be judged without paying for the whole deck (and it makes a
// deliberately partial video, so never ship a `--only` render).
const ONLY = opt('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const LANGS = opt('lang', 'all') === 'all' ? ['de', 'en'] : [opt('lang', 'de')];
const OUT_DIR = resolve(opt('out', join(__dir, 'out')));
mkdirSync(OUT_DIR, { recursive: true });

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const found = execSync('ls /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1')
      .toString()
      .trim();
    if (found) return found;
  } catch {
    /* fall through to playwright default resolution */
  }
  return undefined;
}

function findFfmpeg() {
  const candidates = [];
  const installer = join(process.cwd(), 'node_modules/@ffmpeg-installer/linux-x64/ffmpeg');
  if (existsSync(installer)) candidates.push({ path: installer, full: true });
  try {
    const sys = execSync('which ffmpeg 2>/dev/null').toString().trim();
    if (sys) candidates.push({ path: sys, full: true });
  } catch {
    /* ignore */
  }
  try {
    const pw = execSync('ls /opt/pw-browsers/ffmpeg-*/ffmpeg-linux 2>/dev/null | head -1').toString().trim();
    if (pw) candidates.push({ path: pw, full: false });
  } catch {
    /* ignore */
  }
  return candidates[0] ?? null;
}

// ---- fake clock ------------------------------------------------------------------

// rAF + performance.now under script control, so one captured frame
// == exactly 1/30 s of game time no matter how long the screenshot takes.
const initScript = ({ lang }) => {
  const t0 = 1750000000000;
  let vt = 0;
  let cbs = [];
  let nextId = 1;
  window.__vt = {
    now: () => vt,
    advance(ms) {
      vt += ms;
      const list = cbs;
      cbs = [];
      for (const [, cb] of list) {
        try {
          cb(vt);
        } catch (e) {
          console.error('rAF cb threw', e);
        }
      }
    },
  };
  performance.now = () => vt;
  Date.now = () => t0 + vt;
  window.requestAnimationFrame = (cb) => {
    cbs.push([nextId, cb]);
    return nextId++;
  };
  window.cancelAnimationFrame = (id) => {
    cbs = cbs.filter(([i]) => i !== id);
  };
  // Preset the save slot: chosen language, muted, fresh progress.
  try {
    localStorage.setItem(
      'smallhands-save-v1',
      JSON.stringify({ completed: [], completedCustom: [], records: {}, muted: true, lang, effects: 'full' })
    );
  } catch {
    /* storage unavailable — the game copes */
  }
};

// ---- director ---------------------------------------------------------------------

const smooth = (t) => t * t * (3 - 2 * t); // smoothstep ease for camera pans
const camAt = (tx, ty, zoom) => ({ x: tx * TILE * zoom - W / 2, y: ty * TILE * zoom - H / 2, zoom });
const lerpCam = (a, b, t) => {
  const e = smooth(Math.min(1, Math.max(0, t)));
  // pans keep a constant zoom; a zoom change mid-pan would shimmer the pixel art
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, zoom: b.zoom };
};

// envelope: 0→1 over `up` frames, hold, 1→0 over the last `down` frames
const env = (f, total, up, down) => Math.min(1, f / Math.max(1, up), (total - 1 - f) / Math.max(1, down));

// Each scene: frames, a copy key, an async setup (page fn staging the sim), a
// camera path in tile coords, optional per-frame in-page actions, HUD toggle.
function buildScenes(copy) {
  return [
    {
      id: 'hook',
      frames: 140,
      text: copy.hook,
      textEnv: [14, 20],
      fade: { in: 10, out: 0 },
      cam: { from: [10, 19, 3], to: [30, 17.5, 3] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(0);
        window.__H.markAll();
        window.__H.runSteps(
          [{ when: (g) => g.stock.log >= 3, do: (g) => g.placeBuilding('sawmill', 33, 17) }],
          90
        );
        window.__H.ff(45);
      },
    },
    {
      id: 'build',
      frames: 130,
      text: copy.build,
      textEnv: [12, 16],
      fade: { in: 0, out: 0 },
      cam: { from: [14, 18.5, 3], to: [24, 16.5, 3] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(1);
        window.__H.markAll();
        window.__H.runSteps(
          [
            { do: (g) => g.placeLift(23, 20) },
            { when: (g) => g.stock.log >= 3, do: (g) => g.placeBuilding('sawmill', 9, 20) },
          ],
          80
        );
        window.__H.ff(20);
      },
      // ladders appear one by one while the camera pushes toward the cliff
      actions: {
        25: () => window.__smallhands.game.placeLadderRun(23, 19, 23, 19),
        45: () => window.__smallhands.game.placeLadderRun(23, 18, 23, 18),
        65: () => window.__smallhands.game.placeLadderRun(23, 17, 23, 17),
        85: () => window.__smallhands.game.placeLadderRun(23, 16, 23, 16),
        100: () => window.__smallhands.game.placeLadderRun(23, 15, 23, 15),
        115: () => window.__smallhands.game.placeLadderRun(23, 14, 23, 14),
      },
    },
    {
      id: 'dig',
      frames: 120,
      text: copy.dig,
      textEnv: [12, 16],
      textTop: true, // the shaft and the drift sit in the bottom rows
      fade: { in: 6, out: 0 },
      // closer than the surface scenes on purpose: a shaft is a small subject, and
      // at zoom 3 a 22-row map spends half the frame on empty sky
      cam: { from: [22, 15.5, 3.5], to: [29, 15.5, 3.5] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(12); // The Buried Seam — iron and the caravan sealed under the meadow
        window.__H.markAll();
        // A shovel first: the workshop turns a plank and an iron into one, and a
        // Digger claims it only once a reachable order is standing.
        window.__H.runSteps([{ do: (g) => g.placeBuilding('workshop', 20, 14) }], 20);
        window.__H.ffUntil((g) => g.stock.shovel >= 1, 150);
        // sink the shaft off camera, so the scene opens on a mine mouth that is
        // already there rather than on a smallie walking towards nothing
        window.__H.runSteps([{ do: (g) => g.paintDigRun(24, 16, 24, 19) > 0 }], 10);
        // Throw rather than shoot dead footage: if the shaft never lands, the drift
        // orders below paint into solid rock and the scene quietly becomes a smallie
        // standing in a hole. A render that reds is cheap; one that lies is not.
        if (!window.__H.ffUntil((g) => g.world.get(24, 19) === 0, 240))
          throw new Error('dig scene: the shaft never reached the gallery row');
        // then drive the drift east toward the buried seam and land the capture a
        // beat before a tile gives way, so rock visibly falls on camera (rock is
        // DIG_TIME 2.8 s, so a 4 s scene otherwise shows a smallie standing still)
        window.__H.runSteps([{ do: (g) => g.paintDigRun(25, 19, 33, 19) > 0 }], 10);
        window.__H.ffUntil(
          (g) => g.workers.some((w) => w.task && w.task.kind === 'dig' && w.workT > 2.2),
          240
        );
      },
    },
    {
      id: 'hoist',
      frames: 130,
      text: copy.hoist,
      textEnv: [12, 16],
      fade: { in: 6, out: 0 },
      cam: { from: [25, 17, 3], to: [31, 17.5, 3] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(9); // The Turning Wheel — ballast cycles both ways
        window.__H.markAll();
        window.__H.countEvents();
        window.__H.runSteps(
          [
            { do: (g) => g.placeHoist(27, 16) },
            { when: (g) => g.stock.log >= 3, do: (g) => g.placeBuilding('sawmill', 22, 15) },
            {
              when: (g) => g.hoists.some((b) => b.state === 'ready'),
              do: (g) => {
                const b = g.hoists[0];
                g.toggleHoistRoute(b.id, 'upper', 'plank');
                g.toggleHoistRoute(b.id, 'upper', 'stone');
              },
            },
          ],
          240
        );
        // land just before a cycle so the wheel visibly turns on camera
        window.__H.ffUntil(() => (window.__evc.hoistCycle || 0) >= 1, 240);
      },
    },
    {
      id: 'convoy',
      frames: 105,
      text: copy.convoy,
      textEnv: [12, 16],
      fade: { in: 6, out: 0 },
      // the wagon rolls EAST off its dock (caravanRoll's shift is positive), so
      // the pan travels with it and leaves the dock in frame behind it
      cam: { from: [38, 12.5, 2.6], to: [43, 12.5, 2.6] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(10); // Ballast Ridge — the caravan docks 40 s, then is away 20 s
        window.__H.markAll();
        window.__H.countEvents();
        // The ridge's own boulders need no machine, so stone reaches the bed without
        // staging the wheel: the load IS the order sheet (caravan-look.ts). Wait for
        // the deposits to PLATEAU rather than for a count — an order amount pinned
        // here is a tuning knob this file does not own (docs/architecture.md), and
        // six happens to be exactly level 11's stone objective, so the day that is
        // retuned down the predicate can never trip and the wagon rolls off empty.
        // A shut dock stalls dispatch without meaning "done", so it resets the wait.
        let seen = -1;
        let still = 0;
        window.__H.ffUntil((g) => {
          const n = window.__evc.goalDeposit || 0;
          if (n !== seen) {
            seen = n;
            still = 0;
            return false;
          }
          if (!g.convoyOpen) {
            still = 0;
            return false;
          }
          return n > 0 && ++still >= 30; // ffUntil polls every 10 ticks — ~5 s quiet
        }, 300);
        // land ~1.3 s before the window shuts, so the scene opens on a parked, loaded
        // wagon (the crates read only while it is opaque), then rolls it out over
        // CARAVAN_ROLL_TIME and leaves the dock standing
        window.__H.ffUntil((g) => g.convoyOpen && g.convoyRemaining < 1.4, 120);
      },
    },
    {
      id: 'storm',
      frames: 105,
      text: copy.storm,
      textEnv: [12, 16],
      fade: { in: 6, out: 0 },
      cam: { from: [28, 13, 2.4], to: [42, 13, 2.4] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(11); // The High Forge — clear 60 s -> storm 20 s; gusts seize the lifts
        window.__H.markAll();
        window.__H.runSteps(
          [{ when: (g) => g.stock.log >= 3, do: (g) => g.placeBuilding('sawmill', 8, 22) }],
          40
        );
        // fast-forward to the storm phase, then a beat past the crossfade so the
        // darkened sky, slanted streaks and thrashing treetops are settled in
        // frame. Wait for the phase itself (poll is every 10 ticks) not a window.
        window.__H.ffUntil((g) => g.weather === 'storm', 120);
        window.__H.ff(1.5);
      },
    },
    {
      id: 'tide',
      frames: 105,
      text: copy.tide,
      textEnv: [12, 16],
      fade: { in: 6, out: 0 },
      cam: { from: [27, 22, 2.4], to: [40, 21, 2.4] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(7); // The Rising Tide — each downpour lifts the water one row
        window.__H.markAll();
        window.__H.runSteps(
          [{ when: (g) => g.stock.log >= 3, do: (g) => g.placeBuilding('sawmill', 6, 19) }],
          40
        );
        // ride just after the first downpour floods the basin, so the new lake
        // and the rain that raised it are both on screen.
        window.__H.ffUntil((g) => g.waterRow !== null, 150);
        window.__H.ff(2.0);
      },
    },
    {
      id: 'drown',
      frames: 115,
      text: copy.drown,
      textEnv: [12, 16],
      textTop: true, // the drowning drift is row 23 of 26 — the caption cannot sit on it
      fade: { in: 6, out: 0 },
      // wide enough to hold the rain and the drowned drift in one frame — the
      // whole point of the shot is that they are the same event
      // The pan stops at 42.5: past ~42.7 a zoom-3 frame hits the east clamp on a
      // 56-tile map and the travel would silently stall. y sits at the bottom clamp,
      // because the subject is row 23 of 26 and no camera move can lift the floor.
      cam: { from: [38, 18.5, 3], to: [42.5, 18.5, 3] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(17); // The Seeping Floor — redrock, and a rich drift below the water table
        window.__H.markAll();
        // Sink a shaft to the deep drift (row 23) and ladder it down to row 22, so
        // miners can reach the ore at all: nobody drops six rows for free (MAX_FALL
        // is 1). The rungs stop one row short of the drift on purpose — a rung IN the
        // flooding row is swept (sweepTile), and losing it mid-shot reads as a glitch
        // rather than as the rule it is.
        window.__H.runSteps([{ do: (g) => g.paintDigRun(39, 18, 39, 23) > 0 }], 10);
        if (!window.__H.ffUntil((g) => g.world.get(39, 23) === 0, 300))
          throw new Error('drown scene: the shaft never reached the drift floor');
        // (every run placer returns a COUNT, and runSteps only retries on a literal
        // false — so a step that placed nothing must report it as false itself)
        window.__H.runSteps([{ do: (g) => g.placeLadderRun(39, 19, 39, 22) > 0 }], 20);
        // Then drive the drift east through all three veins — and it has to be open
        // BEFORE the first rain, not merely eventually: past that point `openCell`
        // fills every cell cut at row >= 23 with water instead of air, so the orders
        // silently stop producing gallery and the scene would open on a static lake.
        window.__H.runSteps([{ do: (g) => g.paintDigRun(40, 23, 47, 23) > 0 }], 10);
        const dug = window.__H.ffUntil((g) => g.world.get(44, 23) === 0, 400);
        if (!dug || window.__smallhands.game.waterRow !== null)
          throw new Error('drown scene: the drift was not open and dry before the first rain');
        // Stop a beat BEFORE the downpour. The rise fires on the phase boundary into
        // rain (tickWeather) and floods instantly, so landing after it would open on
        // a lake that was always there; opening on dry rock makes the water ARRIVE on
        // camera, taking the drift and the ore standing in it.
        window.__H.ffUntil((g) => g.weather === 'clear' && g.weatherRemaining < 1.2, 200);
      },
    },
    {
      id: 'daynight',
      frames: 110,
      text: copy.daynight,
      textEnv: [12, 16],
      fade: { in: 6, out: 0 },
      cam: { from: [14, 16, 2.3], to: [40, 15, 2.3] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(16); // The Waning Light — noon slides to dusk; lanterns hold the light
        window.__H.markAll();
        // Each level's ground sits at a different row, so find the surface at
        // runtime: the first air cell with solid ground directly beneath it.
        const surf = (g, x) => {
          for (let y = 4; y < g.level.height - 1; y++) {
            if (g.world.get(x, y) === 0 && g.world.isSolid(x, y + 1)) return y;
          }
          return -1;
        };
        const afford = (g) => g.stock.log >= 1 && g.stock.stone >= 1;
        const lantern = (x) => ({
          when: afford,
          do: (g) => {
            const y = surf(g, x);
            return y > 0 && g.placeBuilding('lantern', x, y);
          },
        });
        // string lanterns out along the route while daylight is still free, so
        // they are lit and holding pools of light when dusk arrives.
        window.__H.runSteps(
          [lantern(14), lantern(22), lantern(30), lantern(38), lantern(46)],
          150
        );
        // roll the clock on into deep dusk: the sky dims, the veil closes in and
        // the lantern pools stand out against the darkening far ground.
        window.__H.ffUntil((g) => g.nightAmount() >= 0.6, 200);
      },
    },
    // three quick biome cuts — wide establishing pans, HUD hidden
    ...[0, 1, 2].map((i) => ({
      id: `biome${i}`,
      frames: 36,
      text: copy.biomes,
      textEnv: [10, 10],
      textAcross: { group: 'biomes', index: i, of: 3 }, // one caption riding across all three cuts
      fade: { in: i === 0 ? 6 : 0, out: 0 },
      hud: false,
      // generated terrain varies per seed — frame relative to the town hall,
      // staggering the start so the three cuts don't all open on the same house
      camFromTownhall: { from: [3 + i * 5, -1.5, 2], to: [17 + i * 5, -2.5, 2] },
      setupArgs: { index: i },
      setup: ({ index }) => {
        const SH = window.__smallhands;
        const data = window.__biomeLevels[index];
        SH.startCustomLevel(data, {});
        window.__H.markAll();
        window.__H.ff(25);
      },
    })),
    {
      id: 'deliver',
      frames: 95, // the longest caption of the deck — give it time to read
      text: copy.deliver,
      textEnv: [10, 12],
      fade: { in: 0, out: 8 },
      // Ends on the wagon (level 1's caravan stands at x46) with the crate stack
      // readable — that pile IS the order sheet. The pan stops at 42.5 on purpose:
      // at zoom 3 a centre past ~42.7 hits cam.clamp on a 56-tile map and the last
      // second of travel would silently freeze.
      cam: { from: [38, 15, 3], to: [42.5, 15, 3] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(0);
        window.__H.markAll();
        window.__H.countEvents();
        window.__H.runSteps(
          [{ when: (g) => g.stock.log >= 3, do: (g) => g.placeBuilding('sawmill', 33, 17) }],
          90
        );
        // Ride the moment a plank lands at the caravan (burst + counter tick) — the
        // third one, so the bed carries a stack rather than a single crate. Not the
        // sixth: that fills the sheet and the win ceremony takes the screen.
        window.__H.ffUntil(() => (window.__evc.goalDeposit || 0) >= 3, 240);
      },
    },
    {
      id: 'end',
      frames: 105,
      text: copy.end,
      textEnv: [16, 0],
      fade: { in: 12, out: 10 },
      endCard: true, // front door hero: logo, tagline, Play button over the live backdrop
    },
  ];
}

// ---- capture ---------------------------------------------------------------------

async function boot(page, lang) {
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.evaluate(pageLib);
  // pump a few virtual frames so the front door settles
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) window.__vt.advance(1000 / 30);
  });
  // the trailer overlay uses the front door's bundled pixel font — make sure it
  // has arrived before the first caption frame samples a fallback
  await page.evaluate(() => document.fonts.load("700 52px 'Pixelify Sans'").then(() => document.fonts.ready));
  // enter the game with direct DOM clicks — Playwright's actionability checks
  // rely on real rAF timing, which we've replaced. The level select is the
  // world map: pick the first open node, then its popover's Play button.
  await page.evaluate(() => document.querySelector('.fd-play').click());
  await page.evaluate(() => document.querySelector('.map-node:not(:disabled)').click());
  await page.evaluate(() => document.querySelector('.map-popover .pop-play').click());
  const ok = await page.evaluate(() => !!window.__smallhands);
  if (!ok) throw new Error('debug hook missing after level boot');
  void lang;
}

// Pick three generated levels with distinct non-meadow biomes (seeded, so the
// same seeds always yield the same worlds — the trailer stays reproducible).
async function prepareBiomeLevels(page) {
  return page.evaluate(() => {
    const SH = window.__smallhands;
    const byBiome = {};
    for (let i = 0; i < 60 && Object.keys(byBiome).length < 4; i++) {
      const data = SH.generateVerifiedLevel({ seed: `teaser-${i}`, difficulty: 2 + (i % 2) });
      const biome = data.biome ?? 'meadow';
      if (biome !== 'meadow' && !byBiome[biome]) byBiome[biome] = data;
    }
    // most distinctive palettes first — autumn's orange canopy reads instantly
    const order = ['autumn', 'redrock', 'slate', 'chalk'];
    window.__biomeLevels = order.filter((b) => byBiome[b]).slice(0, 3).map((b) => byBiome[b]);
    return window.__biomeLevels.map((p) => p.biome);
  });
}

async function renderLang(lang, browser, ffmpeg) {
  const copy = COPY[lang];
  const all = buildScenes(copy);
  const scenes = ONLY.length ? all.filter((s) => ONLY.includes(s.id)) : all;
  if (ONLY.length) {
    const missing = ONLY.filter((id) => !all.some((s) => s.id === id));
    if (missing.length) throw new Error(`--only names no such scene: ${missing.join(', ')}`);
    console.log(`[${lang}] --only: ${scenes.map((s) => s.id).join(', ')} (partial render)`);
  }
  const total = scenes.reduce((a, s) => a + s.frames, 0);
  console.log(`[${lang}] ${scenes.length} scenes, ${total} frames (${(total / FPS).toFixed(1)} s)`);

  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${lang}][pageerror]`, e.message));
  await page.addInitScript(initScript, { lang });
  await boot(page, lang);
  const biomes = await prepareBiomeLevels(page);
  console.log(`[${lang}] biome cuts:`, biomes.join(', '));

  // encoder sink (skipped in storyboard mode)
  let ff = null;
  let outFile = null;
  if (!STORYBOARD) {
    // Keyed by length: the soundtrack's closing chord and fadeout are derived from
    // the video's duration, so a cache hit on a deck of a different length would
    // mux music that ends in the wrong place — silently, and only audibly.
    const musicWav = join(OUT_DIR, `teaser-music-${total}f.wav`);
    if (!existsSync(musicWav)) {
      console.log('composing soundtrack...');
      // exactly video length: the WAV's internal fadeout then lands on the last frame
      writeFileSync(musicWav, renderMusicWav(total / FPS));
    }
    const vArgs = ffmpeg.full
      ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
      : ['-c:v', 'libvpx', '-b:v', '4M', '-deadline', 'good', '-cpu-used', '2', '-pix_fmt', 'yuv420p'];
    outFile = join(OUT_DIR, `smallhands-teaser-${lang}.${ffmpeg.full ? 'mp4' : 'webm'}`);
    const aArgs = ffmpeg.full ? ['-i', musicWav, '-c:a', 'aac', '-b:a', '160k', '-shortest'] : [];
    ff = spawn(ffmpeg.path, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
      ...aArgs, ...vArgs, outFile,
    ]);
    ff.stderr.on('data', (d) => process.stderr.write(d));
  }

  let globalFrame = 0;
  let capBand = null; // last measured caption band, so a change gets reported
  for (const scene of scenes) {
    const t0 = Date.now();
    if (scene.endCard) {
      // fresh load shows the front door hero over the live idle backdrop
      await page.reload({ waitUntil: 'load' });
      await page.evaluate(pageLib);
      // The hero's entrance animations start at opacity 0 (fd-rise … forwards);
      // the global freeze would pin them there. Snap every CSS animation to its
      // end state instead, so the hero stands fully revealed and static.
      await page.evaluate(() => {
        const s = document.createElement('style');
        s.textContent = `*, *::before, *::after {
          animation-duration: 0.001s !important; animation-delay: 0s !important;
          animation-iteration-count: 1 !important; animation-fill-mode: forwards !important;
          animation-play-state: running !important; }`;
        document.head.appendChild(s);
      });
      await page.waitForTimeout(150); // real time: let the 1 ms animations finish
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        for (let i = 0; i < 3; i++) window.__vt.advance(1000 / 30);
      });
    } else if (scene.setup) {
      if (scene.setupArgs) await page.evaluate(scene.setup, scene.setupArgs);
      else await page.evaluate(scene.setup);
    }

    // Lift the lower third clear of the tool dock, measured in the page rather
    // than tuned here (card #79). Per scene, because the level decides how many
    // chips stand and whether one of their labels wraps to a second line — and
    // logged, because a caption band that MOVES between cuts is a bug that no
    // still can show you.
    const cap = await page.evaluate(() => window.__fitCaption());
    if (cap.bottom !== capBand) {
      const how = cap.dock ? `dock ${cap.dock}px + ${cap.guard}px` : 'no dock — cinematic lower third';
      // Only a scene that actually prints a caption can move the band visibly, so
      // only that one is worth flagging: the end card is the front door, which has
      // no dock and no caption, and it would otherwise cry wolf on every run.
      const moved = capBand !== null && (scene.text?.h || scene.text?.sub) ? ` — MOVED at scene ${scene.id}` : '';
      console.log(`[${lang}] caption band: ${cap.bottom}px (${how})${moved}`);
      capBand = cap.bottom;
    }

    let camA = scene.cam ? camAt(...scene.cam.from) : null;
    let camB = scene.cam ? camAt(...scene.cam.to) : null;
    if (scene.camFromTownhall) {
      const th = await page.evaluate(() => {
        const t = window.__smallhands.game.townhall;
        return { x: t.x, y: t.y };
      });
      const rel = scene.camFromTownhall;
      camA = camAt(th.x + rel.from[0], th.y + rel.from[1], rel.from[2]);
      camB = camAt(th.x + rel.to[0], th.y + rel.to[1], rel.to[2]);
      scene.cam = rel; // mark the scene as camera-driven for the state below
    }

    for (let f = 0; f < scene.frames; f++) {
      // caption timing: normally per scene; the biome caption spans its 3 cuts
      let textO;
      if (scene.textAcross) {
        const g = scene.textAcross;
        const gf = g.index * scene.frames + f;
        const gTotal = g.of * scene.frames;
        textO = env(gf, gTotal, scene.textEnv[0], scene.textEnv[1]);
      } else {
        textO = env(f, scene.frames, scene.textEnv[0], scene.textEnv[1]);
      }
      const fadeIn = scene.fade?.in ?? 0;
      const fadeOut = scene.fade?.out ?? 0;
      let fadeO = 0;
      if (fadeIn && f < fadeIn) fadeO = 1 - f / fadeIn;
      if (fadeOut && f >= scene.frames - fadeOut) fadeO = Math.max(fadeO, 1 - (scene.frames - 1 - f) / fadeOut);

      const state = {
        h: scene.text?.h ?? '',
        sub: scene.text?.sub ?? '',
        textO,
        textTop: !!scene.textTop,
        fadeO,
        hud: scene.hud !== false,
        cam: scene.cam ? lerpCam(camA, camB, f / (scene.frames - 1)) : undefined,
      };

      if (scene.actions?.[f]) await page.evaluate(scene.actions[f]);
      await page.evaluate(
        ([s, ms]) => {
          window.__applyState(s);
          window.__vt.advance(ms);
        },
        [state, 1000 / FPS]
      );

      if (STORYBOARD) {
        // 3 stills per scene are enough to judge framing and staging
        const marks = [0, Math.floor(scene.frames / 2), scene.frames - 1];
        if (marks.includes(f)) {
          const p = join(OUT_DIR, 'storyboard', `${lang}-${scene.id}-f${String(f).padStart(3, '0')}.png`);
          mkdirSync(dirname(p), { recursive: true });
          await page.screenshot({ path: p });
        }
      } else {
        const buf = await page.screenshot({ type: 'png' });
        await new Promise((res, rej) => ff.stdin.write(buf, (e) => (e ? rej(e) : res())));
      }
      globalFrame++;
    }
    console.log(`[${lang}] scene ${scene.id}: ${scene.frames}f in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  if (ff) {
    ff.stdin.end();
    await new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exit ${c}`)))));
    console.log(`[${lang}] wrote ${outFile}`);
  }
  await context.close();
  return outFile;
}

// ---- main ------------------------------------------------------------------------

const ffmpeg = findFfmpeg();
if (!ffmpeg && !STORYBOARD) {
  console.error('No ffmpeg found (npm i --no-save @ffmpeg-installer/ffmpeg, or install Playwright browsers).');
  process.exit(1);
}
if (ffmpeg && !ffmpeg.full && !STORYBOARD) {
  console.log('note: only Playwright ffmpeg available — encoding silent VP8 WebM instead of MP4+music.');
}

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio', '--force-device-scale-factor=1'],
});

try {
  for (const lang of LANGS) {
    await renderLang(lang, browser, ffmpeg);
  }
} finally {
  await browser.close();
}
console.log(STORYBOARD ? `storyboard stills in ${join(OUT_DIR, 'storyboard')}` : 'done.');
