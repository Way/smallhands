# Unify Landing + Game Start Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate marketing landing page and game start page with one scroll-reveal front door served at `/`, whose hero sits over the game's existing live animated backdrop.

**Architecture:** The game canvas becomes a fixed backdrop in both a `front-door` mode (document scrolls; a hero over the canvas, marketing sections below) and an `in-game` mode (current behaviour; scroll locked, canvas interactive). A new `FrontDoor` controller renders the marketing DOM (ported verbatim from the old landing) into a `#frontdoor` scroll layer and calls back into the game to start play. `/play/` becomes a redirect to `/`.

**Tech Stack:** TypeScript + HTML Canvas, Vite, zero runtime dependencies. Tests use `playwright-core` against `vite preview`.

## Global Constraints

- Zero runtime dependencies — do NOT add npm packages. (`package.json` devDependencies only: playwright-core, typescript, vite.)
- `npm run build` = `tsc --noEmit && vite build`; it must pass after every task.
- Keep `base: './'` in `vite.config.ts` (GitHub Pages / itch / any subpath).
- Bilingual EN/DE. Single source of truth for language is the `lang` field of the `smallhands-save-v1` save blob, accessed only through `src/engine/i18n.ts` (`getLang`/`setLang`) and `applyLanguage()` in `main.ts`.
- Marketing copy is ported verbatim (both languages) — no rewording.
- Icons are drawn from the game's sprite atlas via `drawIconTo` (atlas is already built once in `main.ts` at boot).
- Respect `prefers-reduced-motion`.
- All front-door CSS selectors are scoped under `#frontdoor` so they never collide with the game's own `.topbar`, `.seg`, `.big-btn`, `.card`, `.panel` rules in `src/style.css`.

## File Structure

- `src/game/frontdoor.ts` — **new.** The `FrontDoor` controller: marketing copy table, DOM template, icon painting, event wiring, `show`/`hide`/`render`. One responsibility: the front-door surface.
- `src/frontdoor.css` — **new.** Marketing section styles (ported from `landing.css`, scoped under `#frontdoor`) plus the hero-over-canvas overrides.
- `index.html` — **restructured.** Shell for the unified page: fixed `#game-canvas`, scrolling `#frontdoor`, fixed `#ui-root`; loads `/src/main.ts`; merged rich `<meta>`.
- `src/style.css` — **modified.** Base shell rules become mode-driven (`body.front-door` / `body.in-game`); canvas + ui-root become `position: fixed`.
- `src/main.ts` — **modified.** Instantiate `FrontDoor`; add `enterFrontDoor()` / `enterGame()`; boot into the front door; route "back to title" and language changes.
- `public/play/index.html` — **new.** Static redirect stub `/play/` → `../`.
- `vite.config.ts` — **modified.** Single root input `index.html`; drop the `play` input.
- `tests/landing.mjs` — **reworked.** Unified front-door smoke test.
- `src/landing.ts`, `src/landing.css`, `play/index.html` — **deleted** (in Task 4, after the front door replaces them).

---

### Task 1: FrontDoor module (marketing surface, no wiring yet)

Create the self-contained front-door surface. It renders into a container, paints icons, and exposes callbacks — but does not yet touch the game's modes. The old `src/landing.ts` still exists during this task; the full code below makes it unnecessary to read it.

**Files:**
- Create: `src/game/frontdoor.ts`
- Create: `src/frontdoor.css`
- Create: `tests/frontdoor-data.mjs`

**Interfaces:**
- Consumes: `drawIconTo` from `src/engine/sprites.ts`; `getLang` and type `Lang` from `src/engine/i18n.ts`.
- Produces:
  - `export interface FrontDoorHooks { onPlay: () => void; onOptions: () => void; onLang: (l: Lang) => void; continueLabel: () => string; }`
  - `export class FrontDoor { constructor(root: HTMLElement, hooks: FrontDoorHooks); show(): void; hide(): void; render(): void; }`
  - `export const FRONTDOOR_COPY_KEYS: string[]` — the marketing copy keys (used by the data test).

- [ ] **Step 1: Write the failing data-parity test**

This test guards that every marketing string has both an English and a German entry (the one part of the module that is pure data and testable in Node).

Create `tests/frontdoor-data.mjs`:

```js
// Verifies the front-door marketing copy table has an [en, de] pair for every
// key — a cheap guard against a half-translated string sneaking in.
import { S, FRONTDOOR_COPY_KEYS } from '../src/game/frontdoor.ts';

let failures = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
};

check('has copy keys', FRONTDOOR_COPY_KEYS.length >= 20);
for (const k of FRONTDOOR_COPY_KEYS) {
  const pair = S[k];
  check(`${k} has [en, de]`, Array.isArray(pair) && pair.length === 2 && pair[0] && pair[1]);
}

if (failures) {
  console.log(`\nFRONTDOOR DATA FAIL: ${failures}`);
  process.exit(1);
}
console.log('\nFRONTDOOR DATA PASS');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types tests/frontdoor-data.mjs`
Expected: FAIL — `Cannot find module '../src/game/frontdoor.ts'` (module not created yet).

> Note: Node ≥ 22.6 runs `.ts` via `--experimental-strip-types`. If unavailable, the same assertions run after Task 3 through the browser smoke test; this data test is a fast-feedback convenience.

- [ ] **Step 3: Create `src/frontdoor.css`**

Ported from the old `landing.css`, every selector scoped under `#frontdoor`, plus the hero-over-canvas overrides (transparent hero + a readability scrim). Full file:

```css
/* Front door — the game's animated title screen doubles as the marketing page.
   Ported from the old standalone landing page and scoped under #frontdoor so it
   never collides with the game's in-game UI rules in src/style.css.
   Palette + type mirror the game (see src/style.css). */

#frontdoor {
  --fd-bg: #10141d;
  --fd-bg2: #141a26;
  --fd-panel: #181e2a;
  --fd-panel-soft: rgba(24, 30, 42, 0.6);
  --fd-border: #3b4a63;
  --fd-text: #e8eef7;
  --fd-dim: #9db0c9;
  --fd-gold: #ffc94d;
  --fd-font: 'Segoe UI', system-ui, -apple-system, sans-serif;
  --fd-display: Georgia, 'Times New Roman', serif;
  color: var(--fd-text);
  font-family: var(--fd-font);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

#frontdoor canvas.px { image-rendering: pixelated; display: block; }
#frontdoor .wrap { max-width: 1060px; margin: 0 auto; padding: 0 22px; }
#frontdoor a { color: inherit; }

/* ---- top bar ---- */
#frontdoor .fd-topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  background: rgba(16, 20, 29, 0.86);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--fd-border);
}
#frontdoor .fd-topbar-in {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 0;
}
#frontdoor .fd-brand {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  text-decoration: none;
  font-family: var(--fd-display);
  font-weight: 900;
  font-size: 19px;
  letter-spacing: 0.5px;
  color: var(--fd-text);
}
#frontdoor .fd-brand-mark { width: 26px; height: 26px; }
#frontdoor .fd-topbar-actions { display: inline-flex; align-items: center; gap: 12px; }
#frontdoor .fd-options {
  background: none;
  border: none;
  color: var(--fd-dim);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
#frontdoor .fd-options:hover { color: var(--fd-text); }

#frontdoor .seg {
  display: inline-flex;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.15);
}
#frontdoor .seg-btn {
  background: rgba(255, 255, 255, 0.05);
  color: var(--fd-dim);
  border: none;
  padding: 6px 15px;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
  cursor: pointer;
}
#frontdoor .seg-btn + .seg-btn { border-left: 1px solid rgba(255, 255, 255, 0.12); }
#frontdoor .seg-btn:hover { color: var(--fd-text); }
#frontdoor .seg-btn[aria-pressed='true'] { background: var(--fd-gold); color: #1c2333; }

/* ---- hero: transparent so the live canvas shows through, with a scrim ---- */
#frontdoor .hero {
  position: relative;
  min-height: calc(100vh - 49px); /* viewport minus the sticky topbar */
  display: flex;
  align-items: center;
  padding: 40px 0 64px;
  background:
    radial-gradient(120% 90% at 50% 40%, rgba(8, 11, 17, 0.72), rgba(8, 11, 17, 0.32) 55%, transparent 78%);
}
#frontdoor .hero-in { text-align: center; margin: 0 auto; }
#frontdoor .eyebrow {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2.6px;
  text-transform: uppercase;
  color: var(--fd-dim);
}
#frontdoor .logo {
  font-family: var(--fd-display);
  font-size: clamp(52px, 11vw, 104px);
  font-weight: 900;
  letter-spacing: 1px;
  color: var(--fd-gold);
  line-height: 1.02;
  margin: 8px 0 6px;
  text-shadow: 0 4px 0 #7a5a10, 0 9px 26px rgba(0, 0, 0, 0.7);
}
#frontdoor .tagline {
  font-size: 14px;
  color: var(--fd-dim);
  letter-spacing: 3px;
  text-transform: uppercase;
  margin-bottom: 26px;
}
#frontdoor .lede {
  max-width: 30ch;
  margin: 0 auto 16px;
  font-size: clamp(19px, 2.6vw, 25px);
  line-height: 1.4;
  color: var(--fd-text);
  text-wrap: balance;
}
#frontdoor .lede b { color: var(--fd-gold); font-weight: 700; }
#frontdoor .sub-lede {
  max-width: 62ch;
  margin: 0 auto 30px;
  color: var(--fd-dim);
  font-size: 15.5px;
}
#frontdoor .cta-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin-bottom: 40px;
}
#frontdoor .big-btn {
  display: inline-block;
  padding: 15px 46px;
  font-size: 19px;
  font-weight: 800;
  border: none;
  border-radius: 12px;
  text-decoration: none;
  cursor: pointer;
  background: linear-gradient(#ffd76e, #f0a929);
  color: #4a3405;
  box-shadow: 0 5px 0 #a06f14, 0 8px 18px rgba(0, 0, 0, 0.45);
  transition: transform 0.08s, box-shadow 0.08s;
}
#frontdoor .big-btn:hover { transform: translateY(-2px); box-shadow: 0 7px 0 #a06f14, 0 11px 22px rgba(0, 0, 0, 0.45); }
#frontdoor .big-btn:active { transform: translateY(3px); box-shadow: 0 2px 0 #a06f14; }
#frontdoor .big-btn:focus-visible { outline: 3px solid var(--fd-gold); outline-offset: 3px; }
#frontdoor .cta-note { font-size: 12.5px; color: var(--fd-dim); letter-spacing: 0.4px; }

#frontdoor .chain {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 16px 18px;
  border: 1px solid var(--fd-border);
  border-radius: 14px;
  background: rgba(16, 20, 29, 0.72);
  max-width: 560px;
  margin: 0 auto 12px;
}
#frontdoor .chain canvas { width: 42px; height: 42px; }
#frontdoor .chain .arrow { color: var(--fd-gold); font-size: 22px; font-weight: 700; }
#frontdoor .chain-cap { font-size: 12.5px; color: var(--fd-dim); }

/* ---- content bands: opaque, so they cover the canvas as they scroll up ---- */
#frontdoor .band { padding: 58px 0; border-top: 1px solid var(--fd-border); background: var(--fd-bg); }
#frontdoor .band.alt { background: var(--fd-bg2); }
#frontdoor .band h2 {
  font-family: var(--fd-display);
  font-size: clamp(25px, 3.6vw, 36px);
  letter-spacing: 0.5px;
  text-align: center;
  text-wrap: balance;
  margin-bottom: 8px;
}
#frontdoor .band-intro {
  max-width: 66ch;
  margin: 0 auto 34px;
  text-align: center;
  color: var(--fd-dim);
  font-size: 15.5px;
}
#frontdoor .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 30px; }
#frontdoor .card {
  padding: 24px 24px 26px;
  border: 1px solid var(--fd-border);
  border-radius: 16px;
  background: var(--fd-panel);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 4px 14px rgba(0, 0, 0, 0.3);
}
#frontdoor .card-icons { display: flex; gap: 8px; margin-bottom: 14px; }
#frontdoor .card-icons canvas { width: 40px; height: 40px; }
#frontdoor .card h3 { font-size: 19px; margin-bottom: 8px; color: var(--fd-gold); }
#frontdoor .card p { color: var(--fd-dim); font-size: 15px; }
#frontdoor .mech-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
#frontdoor .mech {
  display: flex;
  gap: 15px;
  align-items: flex-start;
  padding: 18px;
  border: 1px solid var(--fd-border);
  border-radius: 14px;
  background: var(--fd-panel-soft);
}
#frontdoor .mech-ic {
  flex: 0 0 auto;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  border: 1px solid var(--fd-border);
  background: rgba(0, 0, 0, 0.25);
}
#frontdoor .mech-ic canvas { width: 34px; height: 34px; }
#frontdoor .mech h3 { font-size: 16px; margin-bottom: 3px; }
#frontdoor .mech p { color: var(--fd-dim); font-size: 14px; }
#frontdoor .feats {
  list-style: none;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 22px;
  max-width: 760px;
  margin: 30px auto 26px;
}
#frontdoor .feats li { display: flex; align-items: center; gap: 12px; font-size: 15px; }
#frontdoor .feats li canvas { width: 26px; height: 26px; flex: 0 0 auto; }
#frontdoor .tech-note {
  max-width: 68ch;
  margin: 0 auto;
  text-align: center;
  color: var(--fd-dim);
  font-size: 13.5px;
  border-top: 1px solid var(--fd-border);
  padding-top: 22px;
}
#frontdoor .cta-band { text-align: center; }
#frontdoor .cta-band p { color: var(--fd-dim); margin: 4px 0 26px; font-size: 15.5px; }
#frontdoor .foot {
  padding: 26px 0 40px;
  color: var(--fd-dim);
  font-size: 12.5px;
  text-align: center;
  background: var(--fd-bg);
  border-top: 1px solid var(--fd-border);
}

@media (max-width: 720px) {
  #frontdoor .two-col, #frontdoor .mech-grid, #frontdoor .feats { grid-template-columns: 1fr; }
  #frontdoor .chain canvas { width: 34px; height: 34px; }
  #frontdoor .chain .arrow { font-size: 18px; }
}
@media (prefers-reduced-motion: reduce) {
  #frontdoor .big-btn { transition: none; }
}
```

- [ ] **Step 4: Create `src/game/frontdoor.ts`**

Full file. The `S` table is ported verbatim from the old landing (both languages). `view()` renders the same sections, but the Play buttons are `<button class="fd-play">` (they call back into the game rather than navigating), the language toggle carries `data-lang`, and an Options button is added to the topbar.

```ts
// The unified front door. The game's animated title screen doubles as the
// marketing page: the hero (logo + Play) sits over the live idle backdrop
// drawn on #game-canvas, and the marketing sections scroll up over it.
//
// Ported from the old standalone landing page (src/landing.ts), but wired into
// the game (onPlay/onOptions callbacks) instead of navigating to /play/. The
// shared language lives in the game save; this surface reads it via getLang()
// and reports changes through the onLang hook (see applyLanguage in main.ts).

import '../frontdoor.css';
import { drawIconTo } from '../engine/sprites';
import { getLang } from '../engine/i18n';
import type { Lang } from '../engine/i18n';

export interface FrontDoorHooks {
  onPlay: () => void; // enter the game
  onOptions: () => void; // open the options overlay
  onLang: (l: Lang) => void; // apply + persist a language change
  continueLabel: () => string; // "Play" vs "Continue", from game state
}

// copy: [english, german] — ported verbatim from the old landing page.
type Str = [string, string];

export const S: Record<string, Str> = {
  eyebrow: ['Browser puzzle-strategy', 'Puzzle-Strategie fürs Web'],
  tagline: ['Tiny workers · Big plans', 'Kleine Hände · Große Pläne'],
  lede: [
    'The sweet spot between <b>Lemmings</b> and <b>The Settlers</b> — the two favourite games of your childhood, rolled into one.',
    'Der Sweet Spot zwischen <b>Lemmings</b> und <b>Die Siedler</b> — die zwei Lieblingsspiele deiner Kindheit, in einem.',
  ],
  subLede: [
    'You never control the smallhands directly. You shape the world — ladders, lifts, workshops — and your tiny autonomous crew gathers, hauls, builds and crafts on its own. Every level is a delivery puzzle.',
    'Du steuerst die Smallhands nie direkt. Du formst die Welt — Leitern, Aufzüge, Werkstätten — und dein kleiner, eigenständiger Trupp sammelt, schleppt, baut und werkelt von allein. Jedes Level ist ein Lieferrätsel.',
  ],
  playNote: ['Free · in your browser · no download', 'Kostenlos · im Browser · kein Download'],
  chainCaption: [
    'Trees → logs → sawmill → planks → the caravan. Your crew runs the line.',
    'Bäume → Stämme → Sägewerk → Bretter → zur Karawane. Dein Trupp hält die Linie am Laufen.',
  ],
  sweetHead: ['Two classics, one sweet spot', 'Zwei Klassiker, ein Sweet Spot'],
  sweetLemmingsTitle: ['The Lemmings side', 'Die Lemmings-Seite'],
  sweetLemmingsBody: [
    'Indirect control. You never command a worker — you build the world that guides them. Autonomous little creatures, classic 90s problem-solving.',
    'Indirekte Steuerung. Du befiehlst keinem Arbeiter — du baust die Welt, die sie lenkt. Eigenständige kleine Wesen, klassisches 90er-Tüfteln.',
  ],
  sweetSettlersTitle: ['The Settlers side', 'Die Siedler-Seite'],
  sweetSettlersBody: [
    'Visible logistics. Trees become planks, boulders become stone, iron becomes spears — production chains you can watch flow, and a Town Hall to grow your crew.',
    'Sichtbare Logistik. Aus Bäumen werden Bretter, aus Felsblöcken Stein, aus Eisen Speere — Produktionsketten, die du fließen siehst, und ein Rathaus, das deinen Trupp wachsen lässt.',
  ],
  mechHead: ['The puzzle: down is free, up is expensive', 'Das Rätsel: hinab ist gratis, hinauf kostet'],
  mechIntro: [
    'A smallhand with empty hands can climb and hop almost anywhere. Cargo is the hard part — every mechanic is a new answer to “how do the goods get back up?”',
    'Ein Smallhand mit leeren Händen klettert und springt fast überallhin. Fracht ist das Schwere — jede Mechanik ist eine neue Antwort auf „Wie kommen die Waren wieder hinauf?“',
  ],
  mechLadderTitle: ['The ladder rule', 'Die Leiter-Regel'],
  mechLadderBody: [
    'A smallhand carrying goods refuses ladders. Empty hands climb anywhere; cargo needs another way up.',
    'Ein beladener Smallhand verweigert Leitern. Leere Hände klettern überall; Fracht braucht einen anderen Weg nach oben.',
  ],
  mechLiftTitle: ['Cargo lifts', 'Lastenaufzüge'],
  mechLiftBody: [
    'Hoist a loaded worker straight up a cliff face. Up only — place it at the foot of the wall.',
    'Hieven einen beladenen Arbeiter die Klippe hinauf. Nur aufwärts — an den Fuß der Wand bauen.',
  ],
  mechRopeTitle: ['Rope anchors', 'Seilanker'],
  mechRopeBody: [
    'The mirror image of the lift: anchor a rope at a cliff edge and slide cargo down. Down only.',
    'Das Spiegelbild des Aufzugs: ein Seil an der Klippenkante verankern und Fracht hinabrutschen lassen. Nur abwärts.',
  ],
  mechChainTitle: ['Production chains', 'Produktionsketten'],
  mechChainBody: [
    'Route the right raw goods through the right workshops and deliver the finished order to the caravan.',
    'Leite die richtigen Rohstoffe durch die richtigen Werkstätten und liefere den fertigen Auftrag zur Karawane.',
  ],
  contentHead: ['Plenty to build', 'Viel zu bauen'],
  feat1: ['2 hand-crafted campaigns · 9 levels', '2 handgemachte Kampagnen · 9 Level'],
  feat2: ['Storm & Tide: water, weather, rising floods, night & lanterns', 'Sturm & Flut: Wasser, Wetter, steigende Fluten, Nacht & Laternen'],
  feat3: ['Level editor + procedural generator', 'Level-Editor + prozeduraler Generator'],
  feat4: ['Daily challenge & shareable seed codes', 'Tages-Challenge & teilbare Seed-Codes'],
  feat5: ['Medals, best times & feats', 'Medaillen, Bestzeiten & Meisterstücke'],
  feat6: ['English & German, switchable in-game', 'Englisch & Deutsch, im Spiel umschaltbar'],
  techNote: [
    '100% hand-built for the web — TypeScript + Canvas, zero runtime dependencies, procedurally generated pixel art. No installs, no accounts. Runs anywhere a browser does.',
    '100 % von Hand fürs Web gebaut — TypeScript + Canvas, keine Laufzeit-Abhängigkeiten, prozedural erzeugte Pixel-Art. Keine Installation, kein Konto. Läuft in jedem Browser.',
  ],
  ctaHead: ['Ready, overseer?', 'Bereit, Vorsteher?'],
  ctaBody: [
    'Mark a tree, place a sawmill, and watch the little plan come together.',
    'Markiere einen Baum, setze ein Sägewerk und sieh zu, wie der kleine Plan aufgeht.',
  ],
  footer: [
    'An original homage to the genre. All code, pixel art and audio are original to this project.',
    'Eine originale Hommage ans Genre. Code, Pixel-Art und Audio sind allesamt original.',
  ],
  brandOptions: ['Options', 'Optionen'],
};

export const FRONTDOOR_COPY_KEYS: string[] = Object.keys(S);

export class FrontDoor {
  private root: HTMLElement;
  private hooks: FrontDoorHooks;

  constructor(root: HTMLElement, hooks: FrontDoorHooks) {
    this.root = root;
    this.hooks = hooks;
  }

  private tr(key: string): string {
    return S[key][getLang() === 'de' ? 1 : 0];
  }

  private icon(name: string, cls = ''): string {
    return `<canvas class="px${cls ? ' ' + cls : ''}" data-sprite="${name}" aria-hidden="true"></canvas>`;
  }

  show(): void {
    this.root.style.display = '';
    this.render();
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  render(): void {
    const lang = getLang();
    this.root.innerHTML = this.view();
    this.paintIcons();
    this.root.querySelectorAll<HTMLButtonElement>('.seg-btn[data-lang]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
      btn.addEventListener('click', () => {
        const next: Lang = btn.dataset.lang === 'de' ? 'de' : 'en';
        if (next === getLang()) return;
        this.hooks.onLang(next);
        this.render();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>('.fd-play').forEach((b) =>
      b.addEventListener('click', () => this.hooks.onPlay()),
    );
    this.root.querySelector<HTMLButtonElement>('.fd-options')?.addEventListener('click', () =>
      this.hooks.onOptions(),
    );
  }

  private paintIcons(): void {
    this.root.querySelectorAll<HTMLCanvasElement>('canvas[data-sprite]').forEach((c) => {
      const name = c.dataset.sprite;
      if (name) drawIconTo(c, name, 64); // 2× the CSS box for crisp HiDPI edges
    });
  }

  private view(): string {
    const lang = getLang();
    const play = `<button class="big-btn fd-play">▶ ${this.hooks.continueLabel()}</button>`;
    return `
    <header class="fd-topbar">
      <div class="wrap fd-topbar-in">
        <a class="fd-brand" href="#top">
          ${this.icon('ling_work', 'fd-brand-mark')}
          <span>Smallhands</span>
        </a>
        <div class="fd-topbar-actions">
          <button class="fd-options">${this.tr('brandOptions')}</button>
          <div class="seg" role="group" aria-label="Language">
            <button class="seg-btn" data-lang="en" aria-pressed="${lang === 'en'}">EN</button>
            <button class="seg-btn" data-lang="de" aria-pressed="${lang === 'de'}">DE</button>
          </div>
        </div>
      </div>
    </header>

    <main id="top">
      <section class="hero">
        <div class="wrap hero-in">
          <p class="eyebrow">${this.tr('eyebrow')}</p>
          <h1 class="logo">Smallhands</h1>
          <p class="tagline">${this.tr('tagline')}</p>
          <p class="lede">${this.tr('lede')}</p>
          <p class="sub-lede">${this.tr('subLede')}</p>
          <div class="cta-row">
            ${play}
            <span class="cta-note">${this.tr('playNote')}</span>
          </div>
          <div class="chain" aria-hidden="true">
            ${this.icon('tree')}<span class="arrow">→</span>${this.icon('item_log')}<span class="arrow">→</span>${this.icon('sawmill')}<span class="arrow">→</span>${this.icon('item_plank')}<span class="arrow">→</span>${this.icon('ling_walk_a')}<span class="arrow">→</span>${this.icon('goal')}
          </div>
          <p class="chain-cap">${this.tr('chainCaption')}</p>
        </div>
      </section>

      <section class="band">
        <div class="wrap">
          <h2>${this.tr('sweetHead')}</h2>
          <div class="two-col">
            <article class="card">
              <div class="card-icons">${this.icon('ling_walk_a')}${this.icon('ling_work')}${this.icon('ling_climb_a')}</div>
              <h3>${this.tr('sweetLemmingsTitle')}</h3>
              <p>${this.tr('sweetLemmingsBody')}</p>
            </article>
            <article class="card">
              <div class="card-icons">${this.icon('townhall')}${this.icon('sawmill')}${this.icon('forge')}</div>
              <h3>${this.tr('sweetSettlersTitle')}</h3>
              <p>${this.tr('sweetSettlersBody')}</p>
            </article>
          </div>
        </div>
      </section>

      <section class="band alt">
        <div class="wrap">
          <h2>${this.tr('mechHead')}</h2>
          <p class="band-intro">${this.tr('mechIntro')}</p>
          <div class="mech-grid">
            <article class="mech">
              <div class="mech-ic">${this.icon('tile_ladder')}</div>
              <div><h3>${this.tr('mechLadderTitle')}</h3><p>${this.tr('mechLadderBody')}</p></div>
            </article>
            <article class="mech">
              <div class="mech-ic">${this.icon('lift_mast')}</div>
              <div><h3>${this.tr('mechLiftTitle')}</h3><p>${this.tr('mechLiftBody')}</p></div>
            </article>
            <article class="mech">
              <div class="mech-ic">${this.icon('rope_anchor')}</div>
              <div><h3>${this.tr('mechRopeTitle')}</h3><p>${this.tr('mechRopeBody')}</p></div>
            </article>
            <article class="mech">
              <div class="mech-ic">${this.icon('item_spear')}</div>
              <div><h3>${this.tr('mechChainTitle')}</h3><p>${this.tr('mechChainBody')}</p></div>
            </article>
          </div>
        </div>
      </section>

      <section class="band">
        <div class="wrap">
          <h2>${this.tr('contentHead')}</h2>
          <ul class="feats">
            <li>${this.icon('goal')}<span>${this.tr('feat1')}</span></li>
            <li>${this.icon('lantern')}<span>${this.tr('feat2')}</span></li>
            <li>${this.icon('icon_harvest')}<span>${this.tr('feat3')}</span></li>
            <li>${this.icon('crate')}<span>${this.tr('feat4')}</span></li>
            <li>${this.icon('medal_gold')}<span>${this.tr('feat5')}</span></li>
            <li>${this.icon('item_iron')}<span>${this.tr('feat6')}</span></li>
          </ul>
          <p class="tech-note">${this.tr('techNote')}</p>
        </div>
      </section>

      <section class="band cta-band">
        <div class="wrap">
          <h2>${this.tr('ctaHead')}</h2>
          <p>${this.tr('ctaBody')}</p>
          ${play}
        </div>
      </section>
    </main>

    <footer class="foot">
      <div class="wrap">${this.tr('footer')}</div>
    </footer>
    `;
  }
}
```

- [ ] **Step 5: Run the data test to verify it passes**

Run: `node --experimental-strip-types tests/frontdoor-data.mjs`
Expected: PASS — `FRONTDOOR DATA PASS`.

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors. (`frontdoor.ts` is unreferenced by the app so far but must type-check.)

- [ ] **Step 7: Commit**

```bash
git add src/game/frontdoor.ts src/frontdoor.css tests/frontdoor-data.mjs
git commit -m "#4 add FrontDoor module (marketing surface, ported from landing)"
```

---

### Task 2: Serve the game at `/`, shell modes, and the `/play/` redirect

Restructure the page shell so the game boots at `/`, the canvas is a fixed backdrop, and there is a scrolling `#frontdoor` layer. Add the redirect. The `FrontDoor` is not wired yet — after this task the game shows its existing title overlay over the backdrop at `/`, which is the checkpoint.

**Files:**
- Modify: `index.html`
- Modify: `src/style.css:15-37` (base shell rules → mode-driven)
- Modify: `vite.config.ts`
- Create: `public/play/index.html`

**Interfaces:**
- Consumes: nothing new.
- Produces: DOM ids `#game-canvas`, `#frontdoor`, `#ui-root` at the document root; `<body class="front-door">` initial state.

- [ ] **Step 1: Rewrite `index.html`**

Merge the richer landing metadata (`description`, `theme-color`) into the game shell. New full file:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no" />
    <meta name="description" content="Smallhands — a browser puzzle-strategy game: the sweet spot between Lemmings and The Settlers. Shape the world with ladders, lifts and workshops; your tiny autonomous crew does the rest." />
    <meta name="theme-color" content="#10141d" />
    <title>Smallhands — Tiny Workers, Big Plans</title>
    <link rel="icon" id="favicon" href="data:," />
  </head>
  <body class="front-door">
    <canvas id="game-canvas"></canvas>
    <div id="frontdoor"></div>
    <div id="ui-root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Update the shell rules in `src/style.css`**

Replace the current base block (lines 15–37, from `html, body {` through the `#ui-root > *` rule) with mode-driven rules. The old block is:

```css
html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #10141d;
  font-family: var(--font);
  color: var(--text);
  -webkit-user-select: none;
  user-select: none;
}

#app { position: fixed; inset: 0; }

#game-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  touch-action: none;
}

#ui-root { position: absolute; inset: 0; pointer-events: none; }
#ui-root > * { pointer-events: auto; }
```

Replace it with:

```css
html, body {
  width: 100%;
  background: #10141d;
  font-family: var(--font);
  color: var(--text);
  -webkit-user-select: none;
  user-select: none;
}

/* The game canvas is a fixed backdrop in both modes. Front-door mode lets the
   document scroll (marketing sections scroll up over the canvas); in-game mode
   locks scroll and makes the canvas the interactive play surface. */
body.front-door { overflow-x: hidden; overflow-y: auto; }
body.in-game { overflow: hidden; height: 100%; }

#game-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  touch-action: none;
  z-index: 0;
}
body.front-door #game-canvas { pointer-events: none; } /* let the page scroll */
body.in-game #game-canvas { pointer-events: auto; }

#frontdoor { position: relative; z-index: 1; }
body.in-game #frontdoor { display: none; }

/* #ui-root hosts the HUD in-game and modal overlays (options/confirm) in BOTH
   modes. It is empty and click-through (pointer-events:none) in front-door mode,
   so it needs no hiding — and an options overlay opened from the front door must
   stay visible, so it must NOT be display:none here. */
#ui-root { position: fixed; inset: 0; pointer-events: none; z-index: 2; }
#ui-root > * { pointer-events: auto; }
```

- [ ] **Step 3: Update `vite.config.ts` to a single root input**

Replace the `rollupOptions` input block. The current file's `build` section is:

```ts
  build: {
    target: 'es2022',
    assetsInlineLimit: 8192,
    rollupOptions: {
      input: {
        // The marketing landing page is the site's front door…
        main: resolve(root, 'index.html'),
        // …and the game itself lives one level down at /play/.
        play: resolve(root, 'play/index.html'),
      },
    },
  },
```

Replace with:

```ts
  build: {
    target: 'es2022',
    assetsInlineLimit: 8192,
    // One front door: the game and its marketing scroll both live at index.html.
    // /play/ is a static redirect stub (public/play/index.html), not a build input.
  },
```

- [ ] **Step 4: Create the `/play/` redirect stub `public/play/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="robots" content="noindex" />
    <meta http-equiv="refresh" content="0; url=../" />
    <link rel="canonical" href="../" />
    <title>Smallhands</title>
    <script>
      location.replace('../' + location.search + location.hash);
    </script>
  </head>
  <body>
    <a href="../">Smallhands has moved — continue to the game.</a>
  </body>
</html>
```

- [ ] **Step 5: Build and verify it compiles + bundles**

Run: `npm run build`
Expected: PASS (tsc + vite). `dist/index.html` and `dist/play/index.html` both emitted.

- [ ] **Step 6: Verify the running site manually**

Run: `npm run preview` then open `http://localhost:4173/`.
Expected: the game boots at `/` — the title overlay (`SMALLHANDS` logo + Play) renders over the animated idle backdrop. Visiting `http://localhost:4173/play/` redirects to `http://localhost:4173/`.

> `tests/landing.mjs` is expected to FAIL from here until Task 4 reworks it — it still asserts the old landing DOM. That is intentional; do not run it as a gate for Tasks 2–3.

- [ ] **Step 7: Commit**

```bash
git add index.html src/style.css vite.config.ts public/play/index.html
git commit -m "#4 serve game at /, add shell modes and /play redirect"
```

---

### Task 3: Wire the FrontDoor into the game's modes

Replace the game's title overlay with the front door, and route Play / back-to-title / language through it.

**Files:**
- Modify: `src/main.ts` (imports; instantiate `FrontDoor`; add `enterFrontDoor`/`enterGame`; rewrite `showTitle`; boot call)

**Interfaces:**
- Consumes: `FrontDoor`, `FrontDoorHooks` from `src/game/frontdoor.ts`.
- Produces: `enterFrontDoor(): void`, `enterGame(): void`; `showTitle()` now delegates to `enterFrontDoor()`.

- [ ] **Step 1: Add the import**

In `src/main.ts`, after the existing `import { Hud, TOOL_ICON } from './game/ui';` (line 22), add:

```ts
import { FrontDoor } from './game/frontdoor';
```

- [ ] **Step 2: Grab the `#frontdoor` element**

In `src/main.ts`, after `const uiRoot = document.getElementById('ui-root') as HTMLDivElement;` (line 29), add:

```ts
const frontDoorRoot = document.getElementById('frontdoor') as HTMLDivElement;
```

- [ ] **Step 3: Instantiate the FrontDoor and add the mode functions**

In `src/main.ts`, replace the entire `showTitle()` function (currently lines 176–207) with the FrontDoor instance plus the two mode functions and a thin `showTitle` alias. The current function to replace is:

```ts
function showTitle(): void {
  clearOverlay();
  running = false;
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `
    <div class="title-logo">SMALLHANDS</div>
    <div class="title-sub">${t('title.sub')}</div>
  `;
  const play = document.createElement('button');
  play.className = 'big-btn';
  play.textContent = save.completed.length ? t('btn.continue') : t('btn.play');
  play.onclick = () => {
    audio.click();
    showLevelSelect();
  };
  ov.appendChild(play);
  const blurb = document.createElement('div');
  blurb.className = 'win-stats';
  blurb.innerHTML = t('title.blurb');
  ov.appendChild(blurb);
  const opts = document.createElement('button');
  opts.className = 'big-btn secondary title-options';
  opts.textContent = t('menu.options');
  opts.onclick = () => {
    audio.click();
    showOptions(showTitle);
  };
  ov.appendChild(opts);
  uiRoot.appendChild(ov);
  drawIdleBackdrop();
}
```

Replace it with:

```ts
// The front door: the game's animated title screen doubles as the marketing
// page. It renders into #frontdoor over the live idle backdrop; Play enters the
// game in place (no navigation).
const frontDoor = new FrontDoor(frontDoorRoot, {
  onPlay: () => {
    audio.click();
    enterGame();
  },
  onOptions: () => {
    audio.click();
    showOptions(enterFrontDoor);
  },
  onLang: (l) => applyLanguage(l),
  continueLabel: () => (save.completed.length ? t('btn.continue') : t('btn.play')),
});

// Show the scroll-reveal front door over the idle backdrop.
function enterFrontDoor(): void {
  document.body.classList.add('front-door');
  document.body.classList.remove('in-game');
  clearOverlay();
  running = false;
  drawIdleBackdrop(); // ensure the idle scene exists behind the hero
  frontDoor.show();
  window.scrollTo(0, 0);
}

// Leave the front door and start play (level select).
function enterGame(): void {
  document.body.classList.remove('front-door');
  document.body.classList.add('in-game');
  frontDoor.hide();
  window.scrollTo(0, 0);
  showLevelSelect();
}

// Legacy entry point: "back to title" and options-return now land on the front
// door. Kept as an alias so existing call sites don't need to change.
function showTitle(): void {
  enterFrontDoor();
}
```

> Note on ordering: `enterFrontDoor`/`enterGame`/`showTitle` are function declarations (hoisted); `frontDoor` is a `const` initialised at this point in module evaluation. The boot call (Step 5) runs at the bottom of the file, after `frontDoor` is initialised, so calling `showTitle()`/`enterFrontDoor()` at boot is safe. `applyLanguage` (line 267) skips `attachHud()` when `game` is null, so a language toggle from the front door only re-persists + lets `FrontDoor.render()` redraw.

- [ ] **Step 4: Verify the boot call still targets the front door**

The bootstrap at the bottom of `src/main.ts` currently reads:

```ts
window.addEventListener('resize', onResize);
onResize();
showTitle();
requestAnimationFrame(frame);
```

`showTitle()` now delegates to `enterFrontDoor()`, so no change is required. Confirm this block is intact (do not duplicate it).

- [ ] **Step 5: Build and type-check**

Run: `npm run build`
Expected: PASS. If tsc reports `showLevelSelect`/`showOptions`/`applyLanguage`/`drawIdleBackdrop` used before defined — they are function declarations defined elsewhere in the module and are hoisted; a "used before declaration" is only a lint concern, not a tsc error. Fix only if tsc errors.

- [ ] **Step 6: Manual verification**

Run: `npm run preview`, open `http://localhost:4173/`.
Verify:
1. The hero (Smallhands logo + `▶ Play`/`▶ Continue`) renders over the live animated backdrop.
2. Scrolling down reveals the marketing sections; the backdrop stays fixed behind the hero and is covered by the opaque bands.
3. Clicking `▶ Play` enters the game (level select appears; page no longer scrolls; URL unchanged).
4. From the game, returning to the title (menu → Title) shows the front door again at the top.
5. The EN/DE toggle switches all hero + marketing copy; entering the game afterwards shows the game in that language.

- [ ] **Step 7: Commit**

```bash
git add src/main.ts
git commit -m "#4 wire FrontDoor into game modes (Play, back-to-title, language)"
```

---

### Task 4: Rework the smoke test; delete the old landing

Make the unified front door the tested contract, then remove the now-dead landing files.

**Files:**
- Modify: `tests/landing.mjs`
- Delete: `src/landing.ts`, `src/landing.css`, `play/index.html`

**Interfaces:**
- Consumes: the DOM contract produced by Tasks 1–3 (`h1.logo`, `.lede`, `.seg-btn[data-lang]`, `canvas[data-sprite]`, `.fd-play`, `body.in-game`).
- Produces: nothing (test-only).

- [ ] **Step 1: Rewrite `tests/landing.mjs` for the unified front door**

Full file:

```js
// Front-door smoke test: the unified site lives at `/`. This drives a real
// browser to check the front door renders, the bilingual toggle switches copy
// and persists to the shared save slot, its pixel-art icons actually draw,
// Play starts the game in place, and the old /play/ URL redirects home.
// Requires the production build served at http://localhost:4173/ (npm run preview).
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

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

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});

// A German browser should land in German automatically.
const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => {
  console.log('[pageerror]', e.message);
  failures++;
});
await page.goto(BASE_URL);
await page.waitForTimeout(500);

check('logo reads Smallhands', (await page.textContent('h1.logo'))?.trim() === 'Smallhands');
check('auto-detects German (lede mentions Siedler)', /Siedler/.test(await page.textContent('.lede')));
check('DE toggle is pressed on a de-DE browser', (await page.getAttribute('.seg-btn[data-lang="de"]', 'aria-pressed')) === 'true');

const iconCount = await page.$$eval('canvas[data-sprite]', (cs) => cs.length);
check('pixel-art icons present', iconCount >= 10, `${iconCount} canvases`);
const painted = await page.$$eval('canvas[data-sprite]', (cs) =>
  cs.filter((c) => {
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
    return false;
  }).length,
);
check('every icon actually drew (non-blank)', painted === iconCount, `${painted}/${iconCount} painted`);
check('Play CTA present', (await page.$('.fd-play')) !== null);

// Toggling to English switches the copy and persists to the game's save slot.
await page.click('.seg-btn[data-lang="en"]');
await page.waitForTimeout(200);
check('EN toggle switches lede to Settlers', /Settlers/.test(await page.textContent('.lede')));
const savedLang = await page.evaluate(() => JSON.parse(localStorage.getItem('smallhands-save-v1') || '{}').lang);
check('language persisted to smallhands-save-v1', savedLang === 'en', `lang=${savedLang}`);

// The choice survives a reload.
await page.reload();
await page.waitForTimeout(400);
check('reload restores English', (await page.getAttribute('.seg-btn[data-lang="en"]', 'aria-pressed')) === 'true');

// Play starts the game in place (no navigation) and enters in-game mode.
await page.click('.fd-play');
await page.waitForTimeout(1000);
check('URL unchanged after Play', page.url().replace(/#.*$/, '') === BASE_URL, page.url());
check('body switched to in-game mode', (await page.getAttribute('body', 'class'))?.includes('in-game'));
check('game canvas present', (await page.$('#game-canvas')) !== null);
check('a game overlay is showing', (await page.$('.overlay')) !== null);

// The old /play/ URL redirects to the unified front door.
await page.goto(BASE_URL + 'play/');
await page.waitForTimeout(500);
check('/play/ redirects home', page.url().replace(/#.*$/, '').replace(/\/$/, '/') === BASE_URL, page.url());

await browser.close();
if (failures) {
  console.log(`\nFRONT-DOOR SMOKE FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nFRONT-DOOR SMOKE PASS');
```

- [ ] **Step 2: Delete the dead landing files**

```bash
git rm src/landing.ts src/landing.css play/index.html
```

- [ ] **Step 3: Build (confirms nothing still imports the deleted files)**

Run: `npm run build`
Expected: PASS. If tsc errors that `landing.ts` is missing, some import still references it — search with `grep -rn "landing" src/ index.html vite.config.ts` and remove the stray reference.

- [ ] **Step 4: Run the smoke test to verify it passes**

Run (one line): `npm run preview & sleep 2 && node tests/landing.mjs; kill %1`
Expected: `FRONT-DOOR SMOKE PASS`.

> On this machine, set `CHROME_PATH` first if playwright's bundled Chromium isn't present (see the project testing memory: `CHROME_PATH` → headless-shell).

- [ ] **Step 5: Confirm no stale references remain**

Run: `grep -rn "/play/\|landing" src/ index.html vite.config.ts tests/ | grep -v "public/play"`
Expected: no matches referencing the old landing page or a `/play/` game link (the redirect stub under `public/play/` is fine).

- [ ] **Step 6: Commit**

```bash
git add tests/landing.mjs src/landing.ts src/landing.css play/index.html
git commit -m "#4 rework smoke test for unified front door; delete old landing"
```

---

### Task 5: Performance guards for the idle backdrop

The idle sim now runs on the home page. Pause it when it can't be seen, and honour reduced-motion.

**Files:**
- Modify: `src/main.ts` (`frame()` at line ~1546; add a reduced-motion helper)

**Interfaces:**
- Consumes: `enterFrontDoor`/`enterGame` mode classes on `<body>`.
- Produces: no new exported symbols.

- [ ] **Step 1: Add a reduced-motion helper**

In `src/main.ts`, just above `function frame(now: number): void` (line 1546), add:

```ts
// Honour the OS "reduce motion" preference for the decorative idle backdrop.
const reduceMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
```

- [ ] **Step 2: Guard the idle branch in `frame()`**

The current idle-driving block in `frame()` is:

```ts
  const active = running && game ? game : idleGame;
  if (active) {
    acc += dtReal * (active === game ? speed : 1);
    let iter = 0;
    while (acc >= FIXED && iter < 8) {
      active.tick(FIXED);
      acc -= FIXED;
      iter++;
    }
    if (acc >= FIXED) acc = 0; // drop time if we can't keep up

    if (active === idleGame) {
      // slow auto-pan across the idle scene
      cam.zoom = 2;
      const maxX = idleGame!.world.w * TILE * 2 - renderer.viewW;
      cam.x = (Math.sin(now / 9000) * 0.5 + 0.5) * Math.max(0, maxX);
      cam.y = idleGame!.world.h * TILE * 2 - renderer.viewH + 20;
    }

    renderer.draw(active, cam, running ? hover : { ...hover, visible: false }, now / 1000, runOverlay);
  }
```

Replace it with:

```ts
  const active = running && game ? game : idleGame;
  if (active) {
    // The idle backdrop is decorative: skip it entirely when it can't be seen
    // (front-door scrolled past the hero, or the tab is hidden) and freeze it
    // to a static frame under prefers-reduced-motion.
    const isIdle = active === idleGame;
    const idleHidden =
      isIdle &&
      (document.hidden ||
        (document.body.classList.contains('front-door') && window.scrollY >= window.innerHeight));
    const idleStatic = isIdle && reduceMotion();

    if (!idleHidden) {
      if (!idleStatic) {
        acc += dtReal * (active === game ? speed : 1);
        let iter = 0;
        while (acc >= FIXED && iter < 8) {
          active.tick(FIXED);
          acc -= FIXED;
          iter++;
        }
        if (acc >= FIXED) acc = 0; // drop time if we can't keep up
      }

      if (isIdle) {
        // slow auto-pan across the idle scene (fixed camera under reduced motion)
        cam.zoom = 2;
        const maxX = idleGame!.world.w * TILE * 2 - renderer.viewW;
        cam.x = idleStatic ? 0 : (Math.sin(now / 9000) * 0.5 + 0.5) * Math.max(0, maxX);
        cam.y = idleGame!.world.h * TILE * 2 - renderer.viewH + 20;
      }

      renderer.draw(active, cam, running ? hover : { ...hover, visible: false }, now / 1000, runOverlay);
    }
  }
```

- [ ] **Step 3: Build and type-check**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Smoke test still green**

Run: `npm run preview & sleep 2 && node tests/landing.mjs; kill %1`
Expected: `FRONT-DOOR SMOKE PASS` (the guards must not break rendering or Play).

- [ ] **Step 5: Manual reduced-motion + scroll check**

- In the browser devtools, emulate `prefers-reduced-motion: reduce`, reload `/`: the backdrop shows a static frame (no camera pan), and Play still works.
- Scroll to the marketing sections and confirm the backdrop is no longer redrawing (e.g. observe reduced CPU / no motion at the top when you scroll back up briefly).

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "#4 pause idle backdrop when unseen; static under reduced-motion"
```

---

### Task 6: Documentation & final sweep

Update any docs that describe the old split and confirm the whole suite is green.

**Files:**
- Modify: any doc referencing the old landing/`/play/` split (search first).

**Interfaces:** none.

- [ ] **Step 1: Find stale references**

Run: `grep -rn "landing page\|/play/\|play/index" docs/ README* AGENTS.md 2>/dev/null`
Expected: a list to review. Update prose that describes two separate pages to describe the single front door at `/` with a `/play/` redirect. Do not invent new docs; only correct existing statements.

- [ ] **Step 2: Apply doc edits**

For each hit from Step 1 that describes the architecture, edit it to reflect: "The site is a single front door at `/` — the game's animated title screen with marketing content beneath it. `/play/` redirects to `/`." Leave unrelated content untouched.

- [ ] **Step 3: Apply the deferred cleanups from the task reviews**

These four Minor findings were logged during Tasks 2/3/4/7 and deferred to here. Apply each exactly:

1. **`vite.config.ts` — remove now-dead code.** After the single-input change (Task 2), the `rollupOptions.input` block is gone, so its only consumers are unused. Delete the imports and const that are no longer referenced (`import { resolve } from 'node:path';`, `import { fileURLToPath } from 'node:url';`, and `const root = fileURLToPath(new URL('.', import.meta.url));`). Keep `import { defineConfig } from 'vite';` and the whole `export default defineConfig({...})`. Verify by reading the file that nothing else references `resolve`/`root`/`fileURLToPath` before deleting.

2. **`src/style.css` — add the regression-guard comment.** Immediately above the `#ui-root { position: fixed; inset: 0; pointer-events: none; z-index: 2; }` rule, insert:

```css
/* #ui-root hosts the HUD in-game and modal overlays (options/confirm) in BOTH
   modes. It is empty and click-through (pointer-events:none) in front-door mode,
   so it needs no hiding — and an options overlay opened from the front door must
   stay visible, so it must NOT be display:none here. */
```

3. **`tests/e2e.mjs` — fix the stale header comment.** The top-of-file comment still says the game lives at `/play/`. Update that sentence to say the game is served at `/` (the front door), consistent with the `BASE_URL` default the file now uses. Comment only — no code change.

4. **`src/engine/i18n.ts` — drop orphaned keys IF unused.** The `title.sub` and `title.blurb` dictionary entries were only used by the old title overlay (gutted in Task 3). Run `grep -rn "title\.sub\|title\.blurb" src/ tests/`. If there are ZERO references, delete those two entries from the `D` dictionary. If any reference remains, leave them untouched and note it in the report.

- [ ] **Step 4: Full test sweep**

Build, then run the whole suite (node sim tests + browser tests) and confirm every one passes:

```bash
npm run build
node tests/frontdoor-data.mjs
for t in unit terrain motion campaign2 weather; do echo "=== $t ==="; node tests/$t.mjs || echo "FAILED: $t"; done
npm run preview & PREVIEW=$!; sleep 2
for t in landing i18n e2e drag-tooltip weather-visual editor-generator; do echo "=== $t ==="; node tests/$t.mjs || echo "FAILED: $t"; done
kill $PREVIEW
```

Expected: build PASS, `FRONTDOOR DATA PASS`, every node sim test PASS, and every browser test prints its PASS line with no `FAILED:` lines. If a test fails for a reason clearly pre-existing and unrelated to this branch's changes, report it as a concern with the exact failure rather than forcing a pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "#4 docs + deferred cleanups; full suite green"
```

---

### Task 7: Update the remaining browser tests for the front-door entry

The game moved from `/play/` to `/` behind the front door, so every browser test that entered at `/play/` and clicked the old title-screen Play button (`button.big-btn`) is broken. Point them at `/` and enter through the front door (`.fd-play`). Also apply two small cleanups the Task 4 review flagged in `tests/landing.mjs`.

**Files:**
- Modify: `tests/e2e.mjs`, `tests/drag-tooltip.mjs`, `tests/weather-visual.mjs`, `tests/editor-generator.mjs`
- Modify: `tests/i18n.mjs`
- Modify: `tests/landing.mjs`

**Interfaces:**
- Consumes: the front-door DOM contract — `.fd-play` (Play button), `.seg-btn[data-lang="en"|"de"]` (language toggle, with `aria-pressed`), `.tagline` (hero subtitle carrying `S.tagline`: `Tiny workers · Big plans` / `Kleine Hände · Große Pläne`).
- Produces: nothing (test-only).

- [ ] **Step 1: The four game tests — URL + entry click only**

For each of `tests/e2e.mjs`, `tests/drag-tooltip.mjs`, `tests/weather-visual.mjs`, `tests/editor-generator.mjs`:

1. Change the default base URL from `'http://localhost:4173/play/'` to `'http://localhost:4173/'`. The variable is `BASE_URL` in e2e/drag-tooltip/editor-generator and `BASE` in weather-visual — change whichever that file uses.
2. Change ONLY the single entry click that immediately follows the initial `page.goto(...)` — the one that opened the old title screen — from `page.click('button.big-btn')` to `page.click('.fd-play')`. Do NOT change any other `.big-btn` selector later in the file (win screen, confirm dialogs, `.overlay .big-btn.secondary`, `.confirm-overlay .big-btn.danger`, etc.) — those are in-game elements and are unchanged.

Everything downstream of the entry click (`.level-card`, `window.__smallhands.startLevel(...)`, HUD selectors) is unchanged, because `.fd-play` → `enterGame()` → `showLevelSelect()` reaches the same level-select the old Play button did.

- [ ] **Step 2: `tests/i18n.mjs` — rework the entry to the front-door toggle**

Replace lines 21–40 (from the `page.goto(...)` through the `page.click('button.big-btn')` Play click) — the old title-screen language flow. The old block is:

```js
await page.goto('http://localhost:4173/play/');
await page.waitForTimeout(600);

// English title by default (headless is en-US)
check('title subtitle is English', (await page.textContent('.title-sub')) === 'Tiny workers · Big plans');

// open options from the title, switch to German
await page.click('.title-options');
await page.waitForTimeout(200);
check('options menu opens', (await page.$$('.options-box')).length === 1);
await page.click('.seg-btn:has-text("Deutsch")');
await page.waitForTimeout(300);
check('options re-render in German', (await page.textContent('.opt-title')) === 'Optionen');

await page.click('.options-box .big-btn'); // back -> title
await page.waitForTimeout(200);
check('title re-renders in German', (await page.textContent('.title-sub')) === 'Kleine Hände · Große Pläne');

// level select in German
await page.click('button.big-btn'); // Spielen
```

Replace it with (the front door carries a direct language toggle in its hero topbar, so there is no options round-trip on the way in):

```js
await page.goto('http://localhost:4173/');
await page.waitForTimeout(600);

// English front door by default (headless is en-US)
check('front-door tagline is English', (await page.textContent('.tagline')) === 'Tiny workers · Big plans');

// switch to German via the hero language toggle; the front door re-renders
await page.click('.seg-btn[data-lang="de"]');
await page.waitForTimeout(300);
check('front-door re-renders in German', (await page.textContent('.tagline')) === 'Kleine Hände · Große Pläne');

// enter the game in German
await page.click('.fd-play'); // Spielen
```

Lines 42 onward (level-select header, level name, HUD checks, the in-game options gear flow, persistence) are unchanged — those exercise in-game surfaces this task does not touch.

- [ ] **Step 3: `tests/landing.mjs` — apply the two Task-4 review cleanups**

1. Delete the now-vacuous check (the `#game-canvas` element exists on the unified page from first load, so it no longer signals that Play worked; the adjacent `body.in-game` and `.overlay` checks carry the real signal):

```js
check('game canvas present', (await page.$('#game-canvas')) !== null);
```

2. Simplify the redirect assertion — remove the no-op `.replace(/\/$/, '/')`. Change:

```js
check('/play/ redirects home', page.url().replace(/#.*$/, '').replace(/\/$/, '/') === BASE_URL, page.url());
```
to:
```js
check('/play/ redirects home', page.url().replace(/#.*$/, '') === BASE_URL, page.url());
```

- [ ] **Step 4: Run every changed test against the build**

Build once, serve, and run each changed test; all must pass.

```bash
npm run build
npm run preview & PREVIEW=$!; sleep 2
for t in landing i18n e2e drag-tooltip weather-visual editor-generator; do
  echo "=== $t ==="; node tests/$t.mjs || echo "FAILED: $t";
done
kill $PREVIEW
```

Expected: each prints its own PASS line (`FRONT-DOOR SMOKE PASS`, `I18N SMOKE PASS`, and the e2e/drag-tooltip/weather-visual/editor-generator success messages) with no `FAILED:` lines. If a test fails for a reason unrelated to the entry change (pre-existing environment need), report it as a concern with the exact failing check rather than forcing a pass.

- [ ] **Step 5: Commit**

```bash
git add tests/
git commit -m "#4 point remaining browser tests at the front-door entry (/, .fd-play)"
```

---

## Self-Review

**1. Spec coverage:**
- Unify to one page → Tasks 1–4. ✓
- Scroll-reveal hero, fixed backdrop behind hero → Task 2 (CSS modes) + Task 1 (transparent hero, opaque bands). ✓
- Live at `/`, drop `/play/`, redirect stub → Task 2. ✓
- Two modes (`front-door`/`in-game`) → Task 2 CSS + Task 3 wiring. ✓
- Marketing content + i18n (shared `lang`, toggle in hero topbar) → Task 1 (copy) + Task 3 (`onLang` → `applyLanguage`). ✓
- Performance (scroll pause, reduced-motion, tab hidden) → Task 5. ✓
- SEO/meta (rich meta at root, semantic headings, single canonical) → Task 2 (index.html meta) + Task 1 (h1/h2/h3) + redirect `canonical`. ✓
- Testing (rework `landing.mjs`, e2e Play↔title, keep suites green) → Task 4 + Task 6. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has full content; test code is complete. ✓

**3. Type consistency:** `FrontDoor`/`FrontDoorHooks` signatures match between Task 1 (definition) and Task 3 (construction). `onLang: (l: Lang) => void` is fed `applyLanguage` (`(l: Lang) => void`). `continueLabel` returns `string`. `S`/`FRONTDOOR_COPY_KEYS` exports match the data test. Mode class names `front-door`/`in-game` are identical across index.html, style.css, main.ts and the smoke test. ✓

## Execution Handoff

Deferred to the parent workflow (see the summary after this plan is saved).
