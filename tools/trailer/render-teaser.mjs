// Teaser-trailer renderer: captures ~32 s of real Smallhands gameplay as a
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
// Usage (production build served on :4173 — `npx vite build && npx vite preview`):
//   node tools/trailer/render-teaser.mjs                 # both languages, MP4
//   node tools/trailer/render-teaser.mjs --lang=de       # one language
//   node tools/trailer/render-teaser.mjs --storyboard    # 3 stills per scene, no video
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

// ---- copy deck -----------------------------------------------------------------

const COPY = {
  de: {
    hook: { h: 'Kleine Hände. Große Pläne.', sub: 'Ein Logistik-Puzzle für den Browser' },
    build: { h: 'Keine Befehle — bau ihnen den Weg.', sub: 'Leitern, Brücken, Lastenaufzüge' },
    hoist: { h: 'Schwerkraft ist dein Werkzeug.', sub: 'Die schwerere Seite sinkt' },
    weather: { h: 'Wetter mit Ansage.', sub: 'Regen bremst, Sturm blockiert die Winde' },
    night: { h: 'Nachts zählt nur dein Licht.', sub: 'Laternen schieben die Grenze hinaus' },
    biomes: { h: 'Fünf Biome, endlose Level.', sub: 'Generator · Daily Challenge · Editor' },
    deliver: { h: 'Liefere den Auftrag.', sub: 'Gold, Silber, Bronze' },
    end: { h: '', sub: '' }, // the front-door hero carries its own tagline + CTA
  },
  en: {
    hook: { h: 'Tiny hands. Big plans.', sub: 'A logistics puzzle for the browser' },
    build: { h: 'No orders — build them a way.', sub: 'Ladders, bridges, cargo lifts' },
    hoist: { h: 'Gravity is a tool.', sub: 'The heavier side sinks' },
    weather: { h: 'Weather on a forecast.', sub: 'Rain slows work, storms lock the winch' },
    night: { h: 'At night, light is everything.', sub: 'Lanterns push the frontier' },
    biomes: { h: 'Five biomes, endless levels.', sub: 'Generator · Daily challenge · Editor' },
    deliver: { h: 'Deliver the order.', sub: 'Gold, silver, bronze' },
    end: { h: '', sub: '' },
  },
};

// ---- in-page bootstrap -----------------------------------------------------------

// Fake clock: rAF + performance.now under script control, so one captured frame
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

// Injected once per page load: overlay DOM + per-frame state applier + sim helpers.
const pageLib = () => {
  // CSS animations/transitions run on the real compositor clock, not our fake
  // one — freeze them all so screenshots don't sample them at random phases.
  const freeze = document.createElement('style');
  freeze.id = 'tov-freeze';
  freeze.textContent = `
    *, *::before, *::after { animation-play-state: paused !important; transition: none !important; }
    html { scrollbar-width: none; }
    ::-webkit-scrollbar { display: none; }
  `;
  document.head.appendChild(freeze);

  // Trailer overlay: headline + sub in the game's front-door style, a bottom
  // veil for readability, and a full-screen fader for scene transitions.
  const tov = document.createElement('div');
  tov.id = 'tov';
  tov.innerHTML = '<div class="veil"></div><div class="txt"><div class="h"></div><div class="sub"></div></div><div class="fade"></div>';
  const style = document.createElement('style');
  style.textContent = `
    #tov { position: fixed; inset: 0; pointer-events: none; z-index: 99999; }
    #tov .veil { position: absolute; inset: 0; opacity: 0;
      background: linear-gradient(180deg, rgba(10,13,20,0) 52%, rgba(10,13,20,0.72) 100%); }
    #tov .txt { position: absolute; left: 6%; right: 6%; bottom: 8.5%; text-align: center; opacity: 0; }
    #tov .h { font-family: Georgia, 'Times New Roman', serif; font-size: 47px; font-weight: 700;
      color: #e8eef7; letter-spacing: 0.5px; line-height: 1.15;
      text-shadow: 0 2px 10px rgba(0,0,0,0.9), 0 0 36px rgba(0,0,0,0.65); }
    #tov .sub { margin-top: 10px; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 21px;
      font-weight: 600; color: #ffc94d; letter-spacing: 1.6px;
      text-shadow: 0 2px 8px rgba(0,0,0,0.95); }
    #tov .fade { position: absolute; inset: 0; background: #0b0e15; opacity: 1; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(tov);

  // Per-frame state, set by the director right before advancing virtual time.
  window.__applyState = (s) => {
    const SH = window.__smallhands;
    if (s.cam && SH && SH.game) {
      const c = SH.cam;
      const cv = document.querySelector('canvas');
      c.zoom = s.cam.zoom;
      c.x = Math.round(s.cam.x);
      c.y = Math.round(s.cam.y);
      c.clamp(SH.game, cv.width, cv.height);
    }
    const h = tov.querySelector('.h');
    const sub = tov.querySelector('.sub');
    const txt = tov.querySelector('.txt');
    if (h.textContent !== (s.h ?? '')) h.textContent = s.h ?? '';
    if (sub.textContent !== (s.sub ?? '')) sub.textContent = s.sub ?? '';
    const o = s.textO ?? 0;
    txt.style.opacity = String(o);
    txt.style.transform = `translateY(${((1 - o) * 14).toFixed(2)}px)`;
    tov.querySelector('.veil').style.opacity = String(o * 0.95);
    tov.querySelector('.fade').style.opacity = String(s.fadeO ?? 0);
    const ui = document.getElementById('ui-root');
    if (ui) ui.style.opacity = s.hud === false ? '0' : '1';
  };

  // Sim helpers: direct fixed ticks are far faster than pumping the rAF loop.
  const game = () => window.__smallhands.game;
  window.__H = {
    ff(seconds) {
      const g = game();
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) g.tick(1 / 60);
    },
    // Ordered scripted steps, campaign-test style, but retried until each
    // placement succeeds (stock arrives over time). Runs at most maxSec.
    runSteps(steps, maxSec) {
      const g = game();
      let i = 0;
      const max = Math.round(maxSec * 60);
      for (let t = 0; t < max && i < steps.length; t++) {
        g.tick(1 / 60);
        if (t % 30 === 0) {
          const s = steps[i];
          try {
            if ((!s.when || s.when(g)) && s.do(g) !== false) i++;
          } catch {
            /* placement not possible yet — retry */
          }
        }
      }
      return i;
    },
    ffUntil(pred, maxSec) {
      const g = game();
      const max = Math.round(maxSec * 60);
      for (let t = 0; t < max; t++) {
        g.tick(1 / 60);
        if (t % 10 === 0 && pred(g)) return true;
      }
      return false;
    },
    markAll() {
      for (const n of game().nodes) n.marked = true;
    },
    // Count game events (goal deposits, hoist cycles, …) without detaching the
    // real handler.
    countEvents() {
      const g = game();
      const prev = g.onEvent;
      window.__evc = {};
      g.onEvent = (e) => {
        window.__evc[e.type] = (window.__evc[e.type] || 0) + 1;
        if (e.type === 'deposit' && e.sink === 'goal') window.__evc.goalDeposit = (window.__evc.goalDeposit || 0) + 1;
        prev(e);
      };
    },
  };
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
      frames: 150,
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
      frames: 135,
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
      id: 'hoist',
      frames: 135,
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
      id: 'weather',
      frames: 135,
      text: copy.weather,
      textEnv: [12, 16],
      fade: { in: 6, out: 0 },
      cam: { from: [12, 17.5, 2], to: [26, 17.5, 2] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(5); // Monsoon Hollow — clear 45 s -> rain 30 s on a visible forecast
        window.__H.markAll();
        window.__H.runSteps(
          [
            { when: (g) => g.stock.log >= 3, do: (g) => g.placeBuilding('sawmill', 0, 19) },
            { when: (g) => g.stock.plank >= 3, do: (g) => g.placeBridgeRun(27, 23, 29, 23) !== 0 },
          ],
          40
        );
        // stop ~1.2 s before the clear->rain flip: the take shows the full crossfade
        window.__H.ffUntil((g) => g.weatherRemaining < 1.2, 120);
      },
    },
    {
      id: 'night',
      frames: 135,
      text: copy.night,
      textEnv: [12, 16],
      fade: { in: 6, out: 0 },
      cam: { from: [8, 18.5, 3], to: [30, 17.5, 3] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(6); // night level — lantern chain pushes the light frontier
        window.__H.markAll();
        const afford = (g) => g.stock.log >= 1 && g.stock.stone >= 1;
        window.__H.runSteps(
          [
            { when: afford, do: (g) => g.placeBuilding('lantern', 14, 20) },
            { when: afford, do: (g) => g.placeBuilding('lantern', 20, 19) },
            { when: (g) => g.stock.log >= 3, do: (g) => g.placeBuilding('sawmill', 0, 19) },
            { when: afford, do: (g) => g.placeBuilding('lantern', 27, 19) },
            { when: afford, do: (g) => g.placeBuilding('lantern', 33, 18) },
          ],
          200
        );
        window.__H.ff(30);
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
      frames: 66,
      text: copy.deliver,
      textEnv: [10, 12],
      fade: { in: 0, out: 8 },
      cam: { from: [36, 16.5, 3], to: [40, 16, 3] },
      setup: () => {
        const SH = window.__smallhands;
        SH.startLevel(0);
        window.__H.markAll();
        window.__H.countEvents();
        window.__H.runSteps(
          [{ when: (g) => g.stock.log >= 3, do: (g) => g.placeBuilding('sawmill', 33, 17) }],
          90
        );
        // ride the moment a plank lands at the caravan (burst + counter tick)
        window.__H.ffUntil(() => (window.__evc.goalDeposit || 0) >= 1, 240);
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
  // enter the game with direct DOM clicks — Playwright's actionability checks
  // rely on real rAF timing, which we've replaced
  await page.evaluate(() => document.querySelector('.fd-play').click());
  await page.evaluate(() => document.querySelector('.level-card:not(.locked)').click());
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
  const scenes = buildScenes(copy);
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
    const musicWav = join(OUT_DIR, 'teaser-music.wav');
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
  for (const scene of scenes) {
    const t0 = Date.now();
    if (scene.endCard) {
      // fresh load shows the front door hero over the live idle backdrop
      await page.reload({ waitUntil: 'load' });
      await page.evaluate(pageLib);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        for (let i = 0; i < 3; i++) window.__vt.advance(1000 / 30);
      });
    } else if (scene.setup) {
      if (scene.setupArgs) await page.evaluate(scene.setup, scene.setupArgs);
      else await page.evaluate(scene.setup);
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
