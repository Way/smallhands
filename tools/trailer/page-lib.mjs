// The teaser's in-page half: the caption overlay, the per-frame state applier,
// and the sim helpers the scenes stage through. Serialized into the page by
// Playwright (`page.evaluate(pageLib)`), so it must stay self-contained — no
// imports, no references to module scope.
//
// It lives in its own file because the caption geometry is a *rule*, not a
// constant: the block has to clear the in-game tool dock, and the only honest
// way to know where that dock ends is to measure it. `tests/teaser-caption.mjs`
// imports this same function and measures the result, so the renderer and its
// guard can never drift apart.

// Injected once per page load: overlay DOM + per-frame state applier + sim helpers.
export const pageLib = () => {
  // Air between the tool dock and the caption's last line. Wide enough to read
  // as a deliberate gap rather than as text that almost missed.
  const CAPTION_GUARD = 14;

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
    /* The veil's ramp ENDS where the caption's last line does and holds from
       there to the bottom edge, so lifting the text lifts its contrast with it
       (and dims the dock the text was lifted off — the chrome that means
       nothing in a video reads as a vignette instead of as buttons). Both read
       --tov-bottom: one number, set by measurement, moves the pair.

       Deliberately NO fallback value. --tov-bottom is set by __fitCaption below,
       which the director calls once per scene; a fallback here would be the
       hand-tuned percentage that printed the caption across the chip row in the
       first place, so a lost call would quietly ship the original bug. Unset, the
       var invalidates both declarations instead — text jumps to the top of the
       frame and the veil disappears, which the first storyboard still shows. */
    #tov .veil { position: absolute; inset: 0; opacity: 0;
      background: linear-gradient(180deg, rgba(10,13,20,0) 52%,
        rgba(10,13,20,0.72) calc(100% - var(--tov-bottom)), rgba(10,13,20,0.72) 100%); }
    #tov .txt { position: absolute; left: 6%; right: 6%; bottom: var(--tov-bottom);
      text-align: center; opacity: 0; }
    /* Underground scenes put their subject in the bottom rows — the map's own floor
       is the clamp, so no camera move can lift it. Those scenes flip the caption
       (and its veil) to the top, where the sky is empty between the two HUD panels. */
    #tov .txt.top { top: 15%; bottom: auto; }
    #tov .veil.top { background: linear-gradient(0deg, rgba(10,13,20,0) 58%, rgba(10,13,20,0.72) 100%); }
    /* display type matches the redesigned front door: bundled Pixelify Sans */
    #tov .h { font-family: 'Pixelify Sans', 'Segoe UI', system-ui, sans-serif; font-size: 48px;
      font-weight: 700; color: #e8eef7; letter-spacing: 0.5px; line-height: 1.14;
      text-shadow: 0 3px 0 rgba(0,0,0,0.55), 0 2px 14px rgba(0,0,0,0.9); }
    #tov .sub { margin-top: 10px; font-family: 'Segoe UI', system-ui, sans-serif; font-size: 21px;
      font-weight: 600; color: #ffc94d; letter-spacing: 1.2px;
      text-shadow: 0 2px 8px rgba(0,0,0,0.95); }
    #tov .fade { position: absolute; inset: 0; background: #0b0e15; opacity: 1; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(tov);

  // Lift the lower third clear of the in-game tool dock, and report where it
  // landed. Called once per scene by the director, because a level's
  // `allowedTools` decides how many chips stand and therefore whether one of
  // their labels wraps.
  //
  // What it deliberately does NOT do is hand-tune a percentage: 8.5% was one,
  // and it put the yellow sub-line across the chip row in eight of fourteen
  // scenes and in the poster the front door shows before anyone presses play
  // (card #79).
  //
  // It takes the dock's ink — the topmost edge of the bar OR anything inside it —
  // rather than the bar's box alone. Today those are the same 80px (12px offset +
  // 1px panel border + 7px padding + a 52px chip + 7px + 1px), because a chip's
  // content is 46px and fits. They stop being the same if a label ever needs a
  // third line: `.tool-label` has no `overflow: hidden` on purpose (style.css —
  // an over-long word must show rather than read as a typo), so the content
  // column can break out of the chip, and past 8px it clears the bar's own edge
  // too. Cheap insurance in exactly the place where the tuned number went wrong.
  window.__fitCaption = () => {
    const vh = window.innerHeight;
    const base = vh * 0.085; // the cinematic lower third, when nothing is in the way
    const bar = document.querySelector('.toolbar');
    let inkTop = vh;
    if (bar) {
      for (const el of [bar, ...bar.querySelectorAll('*')]) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) inkTop = Math.min(inkTop, r.top);
      }
    }
    // The dock is measured even when `hud: false` hides it, so the caption sits
    // at ONE height for the whole deck. A lower third that shifts between cuts
    // reads as a mistake; an unused strip of veil under a hidden HUD does not.
    const dock = Math.max(0, vh - inkTop);
    const bottom = Math.round(Math.max(base, dock + CAPTION_GUARD));
    tov.style.setProperty('--tov-bottom', `${bottom}px`);
    return { bottom, dock: Math.round(dock), guard: CAPTION_GUARD };
  };

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
    const veil = tov.querySelector('.veil');
    txt.classList.toggle('top', !!s.textTop);
    veil.classList.toggle('top', !!s.textTop);
    txt.style.opacity = String(o);
    // rises into place from below, or settles down from above when it sits on top
    txt.style.transform = `translateY(${((1 - o) * (s.textTop ? -14 : 14)).toFixed(2)}px)`;
    veil.style.opacity = String(o * 0.95);
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
    // The teaser stages levels straight through startLevel/startCustomLevel, which
    // open HELD. A teaser is a recording of the game running, so every scene begins
    // at once and ships from the first frame.
    start(idx) {
      window.__smallhands.startLevel(idx);
      window.__smallhands.begin();
      window.__smallhands.setShipping(true);
    },
    startCustom(data, opts) {
      window.__smallhands.startCustomLevel(data, opts ?? {});
      window.__smallhands.begin();
      window.__smallhands.setShipping(true);
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
