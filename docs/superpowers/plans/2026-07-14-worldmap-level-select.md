# World-Map Level Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stacked card-grid level select with a hand-drawn SVG world map: campaigns are fogged territories, levels are nodes with popovers, the daily challenge is a lighthouse landmark, creation tools live in a bottom legend bar.

**Architecture:** Two new modules: `src/game/maplayout.ts` (pure geometry data + helpers, headless-testable) and `src/game/worldmap.ts` (DOM/SVG builder taking a `WorldMapDeps` callback object). `main.ts`'s `showLevelSelect()` computes campaign/unlock state and delegates rendering; all confirm/start flows stay in `main.ts`. Spec: `docs/superpowers/specs/2026-07-14-worldmap-level-select-design.md`.

**Tech Stack:** TypeScript, Vite, hand-built DOM (no framework), inline SVG, existing i18n (`t()` from `src/engine/i18n.ts`), Playwright-core browser tests, esbuild headless-bundle tests.

## Global Constraints

- Map viewBox is exactly `0 0 1600 900`; HTML overlays (nodes, badges, popover) are positioned in percent of viewBox coordinates.
- Unlock semantics unchanged: campaign N opens when every level of all campaigns < N is done; within a campaign levels unlock in sequence (global previous level completed).
- Save format, `startLevel`/`startCustomLevel`, all confirm dialogs unchanged.
- Every user-facing string goes through `t()` with EN+DE entries in `src/engine/i18n.ts` (`D` table, `[en, de]`).
- Animations (node pulse, daily glow, drawer slide) must be disabled under `@media (prefers-reduced-motion: reduce)`.
- Node buttons min hit area 40px; below 900px rendered map width the viewport pans horizontally instead of shrinking further.
- Existing `.level-card` CSS stays (popover and drawer cards reuse it).
- The dev build command is `npm run build` (runs `tsc --noEmit` first). Browser tests need `npm run preview` (port 4173) and `CHROME_PATH` pointing at the Playwright headless shell: `export CHROME_PATH=$(ls ~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell | head -1)`.
- Harmony (AGENTS.md): before starting Task 1, `harmony_search_cards` for a level-select/map card; if found, `harmony_start_agent_session` (agentIdentifier: "claude-code", moveToColumn: "In Progress", addLabels: ["agent"]), update progress at task boundaries, end with status "completed" → Review.
- Work on branch `claude/worldmap-level-select` (already exists, spec committed).

**Sequencing note:** Tasks 2–4 build `worldmap.ts` without wiring it in; their gate is `npx tsc --noEmit` only. The screen goes live in Task 5; the old selectors die there, so the pre-existing browser suites are red between Task 5 and Task 7 — do Tasks 5–7 in one sitting.

---

### Task 1: Map layout data module + headless test

**Files:**
- Create: `src/game/maplayout.ts`
- Test: `tests/maplayout.mjs`
- Modify: `package.json` (add `test:maplayout` script)

**Interfaces:**
- Consumes: `LEVELS` from `src/game/levels.ts` (test only, for slot-count sanity).
- Produces: `VIEW_W`, `VIEW_H` (1600/900), `interface Pt {x,y}`, `interface TerritoryLayout {campaign, nameKey, outline, label: Pt, badge: Pt, nodes: Pt[]}`, `MAP_LAYOUT: TerritoryLayout[]`, `DAILY_ISLE: string`, `DAILY_SPOT: Pt`, `nodePositions(campaign: number, count: number): Pt[]`, `journeyPoints(countByCampaign: Map<number, number>): Pt[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/maplayout.mjs`:

```js
// Headless checks for the world-map layout data: every campaign in LEVELS has
// a territory with slot headroom, and the pure helpers behave. Bundles the TS
// sources with esbuild (same trick as tests/unit.mjs — if these build options
// diverge from that file's, copy its options verbatim).
import { build } from 'esbuild';

const entry = `
  export { MAP_LAYOUT, VIEW_W, VIEW_H, nodePositions, journeyPoints } from './src/game/maplayout';
  export { LEVELS } from './src/game/levels';
`;
const res = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true,
  write: false,
  format: 'esm',
});
const mod = await import(
  'data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64')
);
const { MAP_LAYOUT, VIEW_W, VIEW_H, nodePositions, journeyPoints, LEVELS } = mod;

let failures = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
};

// one territory per campaign present in LEVELS, with slot headroom
const counts = new Map();
for (const l of LEVELS) {
  const c = l.campaign ?? 1;
  counts.set(c, (counts.get(c) ?? 0) + 1);
}
for (const [c, n] of counts) {
  const terr = MAP_LAYOUT.find((t) => t.campaign === c);
  check(`campaign ${c} has a territory`, !!terr);
  check(`campaign ${c}: slots (${terr?.nodes.length}) >= levels (${n})`, (terr?.nodes.length ?? 0) >= n);
}

// every authored point stays inside the viewBox
const inBox = (p) => p.x >= 0 && p.x <= VIEW_W && p.y >= 0 && p.y <= VIEW_H;
check('all node slots inside viewBox', MAP_LAYOUT.every((t) => t.nodes.every(inBox)));

// slot lookup returns the authored points…
const four = nodePositions(1, 4);
check(
  'nodePositions(1, 4) returns the 4 authored slots',
  four.length === 4 && four[3].x === MAP_LAYOUT[0].nodes[3].x && four[3].y === MAP_LAYOUT[0].nodes[3].y
);

// …and extends past the end instead of crashing (with a console.warn)
let warned = false;
const origWarn = console.warn;
console.warn = () => { warned = true; };
const many = nodePositions(1, MAP_LAYOUT[0].nodes.length + 2);
console.warn = origWarn;
check('overflow extends along the last segment', many.length === MAP_LAYOUT[0].nodes.length + 2);
check('overflow warns', warned);

// the journey line threads every level once, in campaign order
const journey = journeyPoints(counts);
check('journey visits every level once', journey.length === LEVELS.length);

process.exit(failures ? 1 : 0);
```

Add to `package.json` scripts (after `"test:unit"`):

```json
"test:maplayout": "node tests/maplayout.mjs",
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/maplayout.mjs`
Expected: esbuild error — `Could not resolve "./src/game/maplayout"` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/game/maplayout.ts`:

```ts
// Hand-authored geometry for the world-map level select, in viewBox units.
// Pure data + pure helpers, no DOM — headless tests can bundle this alone.
// Adding a campaign = one more TerritoryLayout entry (outline drawn by hand,
// node slots with headroom beyond the campaign's current level count).

export const VIEW_W = 1600;
export const VIEW_H = 900;

export interface Pt {
  x: number;
  y: number;
}

export interface TerritoryLayout {
  campaign: number; // matches LevelDef.campaign (1-based)
  nameKey: string; // i18n key of the territory label
  outline: string; // closed SVG path in viewBox coords
  label: Pt; // territory name anchor
  badge: Pt; // lock badge / completion flag anchor
  nodes: Pt[]; // level slots in play order
}

export const MAP_LAYOUT: TerritoryLayout[] = [
  {
    campaign: 1,
    nameKey: 'map.terr1',
    outline:
      'M 250 560 C 260 480 340 440 430 450 C 530 460 590 500 585 570 C 580 650 500 690 400 685 C 310 680 240 640 250 560 Z',
    label: { x: 420, y: 430 },
    badge: { x: 420, y: 570 },
    nodes: [
      { x: 305, y: 615 },
      { x: 390, y: 555 },
      { x: 470, y: 610 },
      { x: 540, y: 530 },
      { x: 505, y: 470 },
      { x: 425, y: 500 },
    ],
  },
  {
    campaign: 2,
    nameKey: 'map.terr2',
    outline:
      'M 640 340 C 660 250 760 210 870 220 C 980 230 1050 290 1035 370 C 1020 450 920 490 810 480 C 700 470 620 430 640 340 Z',
    label: { x: 840, y: 200 },
    badge: { x: 840, y: 350 },
    nodes: [
      { x: 690, y: 400 },
      { x: 760, y: 330 },
      { x: 850, y: 390 },
      { x: 930, y: 300 },
      { x: 990, y: 370 },
      { x: 930, y: 430 },
      { x: 850, y: 280 },
    ],
  },
  {
    campaign: 3,
    nameKey: 'map.terr3',
    outline:
      'M 1090 660 C 1090 550 1170 470 1280 455 C 1390 440 1500 470 1600 460 L 1600 900 L 1060 900 C 1045 800 1090 740 1090 660 Z',
    label: { x: 1300, y: 430 },
    badge: { x: 1300, y: 600 },
    nodes: [
      { x: 1160, y: 620 },
      { x: 1260, y: 550 },
      { x: 1350, y: 620 },
      { x: 1440, y: 560 },
      { x: 1470, y: 660 },
      { x: 1380, y: 720 },
    ],
  },
];

// The daily-challenge lighthouse island: a fixed landmark, not a campaign.
export const DAILY_ISLE =
  'M 145 175 C 150 130 195 110 235 122 C 272 133 285 170 265 200 C 245 230 190 235 160 215 C 145 205 142 192 145 175 Z';
export const DAILY_SPOT: Pt = { x: 205, y: 172 };

// Slot lookup with a dev safety net: a campaign may gain more levels than
// authored slots; extras extend along the last authored segment (and warn)
// instead of crashing the select screen.
export function nodePositions(campaign: number, count: number): Pt[] {
  const terr = MAP_LAYOUT.find((tr) => tr.campaign === campaign);
  if (!terr) throw new Error(`map layout: no territory for campaign ${campaign}`);
  const pts = terr.nodes.slice(0, count);
  if (count > terr.nodes.length) {
    console.warn(
      `map layout: campaign ${campaign} has ${count} levels but only ${terr.nodes.length} slots`
    );
    const n = terr.nodes;
    const a = n[n.length - 2];
    const b = n[n.length - 1];
    for (let i = n.length; i < count; i++) {
      const k = i - n.length + 1;
      pts.push({ x: b.x + (b.x - a.x) * k, y: b.y + (b.y - a.y) * k });
    }
  }
  return pts;
}

// The dotted journey line threads every level slot in campaign order.
export function journeyPoints(countByCampaign: Map<number, number>): Pt[] {
  const out: Pt[] = [];
  for (const terr of MAP_LAYOUT) {
    out.push(...nodePositions(terr.campaign, countByCampaign.get(terr.campaign) ?? 0));
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/maplayout.mjs`
Expected: all `ok` lines, exit 0. (Today's counts: campaign 1 = 4 levels/6 slots, campaign 2 = 5/7, campaign 3 = 3/6, journey = 12 points.)

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: clean.

```bash
git add src/game/maplayout.ts tests/maplayout.mjs package.json
git commit -m "feat: world-map layout data + headless test"
```

---

### Task 2: i18n keys + worldmap skeleton (top bar, SVG territories, fog, journey, daily isle)

**Files:**
- Modify: `src/engine/i18n.ts` (add keys near the `camp2.*` block, ~line 394)
- Create: `src/game/worldmap.ts`
- Modify: `src/style.css` (append new section at end)

**Interfaces:**
- Consumes: everything from `maplayout.ts` (Task 1); `t` from `../engine/i18n`; `medalTimesFor` + `CustomLevelData` from `./leveldata`; `LevelDef` from `./levels`.
- Produces (used by Tasks 3–5): `interface MapLevelState {index, def, unlocked, done}`, `interface MapCampaignState {campaign, unlocked, complete, levels: MapLevelState[]}`, `interface MapDailyState {seed, label, difficulty, done}`, `interface WorldMapDeps` (full shape below), `buildWorldMap(deps: WorldMapDeps): HTMLElement`.

- [ ] **Step 1: Add i18n keys**

In `src/engine/i18n.ts`, insert directly above the `'camp3.unlocked'` entry:

```ts
  // world map (level select)
  'map.terr1': ['Home Meadows', 'Heimatwiesen'],
  'map.terr2': ['Storm & Tide', 'Sturm & Flut'],
  'map.terr3': ['Weight & Wheel', 'Gewicht & Rad'],
  'map.lockedHint': ['Finish {name} to unlock', 'Schließe {name} ab zum Freischalten'],
  'map.nodeAria': ['Level {n}: {name} — {status}', 'Level {n}: {name} — {status}'],
  'map.daily.aria': ['Daily Challenge — {status}', 'Tages-Challenge — {status}'],
  'legend.title': ['Legend', 'Legende'],
  'legend.mine': ['My levels', 'Meine Level'],
  'drawer.empty': [
    'No levels yet — build one in the editor or import a share code.',
    'Noch keine Level — baue eins im Editor oder importiere einen Code.',
  ],
```

(Reused existing keys — do not re-add: `select.title`, `btn.play`, `btn.title`, `menu.options`, `btn.resume`, `gen.cardName`, `editor.cardName`, `import.cardName`, `daily.name`, `daily.desc`, `status.done`, `status.ready`, `status.locked`, `custom.defaultDesc`, `action.edit/copy/delete`.)

- [ ] **Step 2: Create `src/game/worldmap.ts` with types, helpers and the screen skeleton**

```ts
// The level select as a hand-drawn world map: campaigns are territories that
// unfog as they unlock, levels are nodes along a dotted journey line, the
// daily challenge is a lighthouse landmark, and the creation tools live in a
// legend bar at the bottom. Geometry comes from maplayout.ts; all game/save
// state arrives through WorldMapDeps — this module only renders and routes
// clicks back to main.ts.

import { t } from '../engine/i18n';
import type { LevelDef } from './levels';
import { medalTimesFor } from './leveldata';
import type { CustomLevelData } from './leveldata';
import {
  DAILY_ISLE,
  DAILY_SPOT,
  MAP_LAYOUT,
  VIEW_H,
  VIEW_W,
  journeyPoints,
  nodePositions,
} from './maplayout';
import type { Pt } from './maplayout';

export interface MapLevelState {
  index: number; // index into LEVELS — what startLevel() takes
  def: LevelDef;
  unlocked: boolean;
  done: boolean;
}

export interface MapCampaignState {
  campaign: number;
  unlocked: boolean; // campaign gate passed
  complete: boolean; // every level done
  levels: MapLevelState[];
}

export interface MapDailyState {
  seed: string;
  label: string;
  difficulty: number;
  done: boolean;
}

export interface WorldMapDeps {
  campaigns: MapCampaignState[];
  daily: MapDailyState;
  customLevels: CustomLevelData[];
  shelf: HTMLElement | null; // trophy cartouche, prebuilt by main.ts
  resumeLabel: string | null; // "Resume — <level>" when a run is in progress
  bestMedal: (key: string) => 'gold' | 'silver' | 'bronze' | null;
  addMedalBits: (card: HTMLElement, key: string, goldTime: number | null) => void;
  customDone: (id: string) => boolean;
  click: () => void; // UI click sound
  onPlayLevel: (index: number) => void;
  onPlayDaily: () => void;
  onPlayCustom: (lvl: CustomLevelData) => void;
  onEditCustom: (lvl: CustomLevelData) => void;
  onCopyCustom: (lvl: CustomLevelData) => void;
  onDeleteCustom: (lvl: CustomLevelData) => void;
  onGenerate: () => void;
  onEditor: () => void;
  onImport: () => void;
  onResume: () => void;
  onTitle: () => void;
  onOptions: () => void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {}
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// pin an HTML element onto the map wrap at a viewBox coordinate
function place(el: HTMLElement, p: Pt): void {
  el.style.left = `${(p.x / VIEW_W) * 100}%`;
  el.style.top = `${(p.y / VIEW_H) * 100}%`;
}

export function buildWorldMap(deps: WorldMapDeps): HTMLElement {
  const ov = document.createElement('div');
  ov.className = 'overlay worldmap';

  // ---- top bar: title, trophy cartouche, session buttons ----
  const top = document.createElement('div');
  top.className = 'map-topbar';
  const title = document.createElement('div');
  title.className = 'title-logo map-title';
  title.textContent = t('select.title');
  top.appendChild(title);
  if (deps.shelf) {
    deps.shelf.classList.add('cartouche');
    top.appendChild(deps.shelf);
  }
  const btns = document.createElement('div');
  btns.className = 'map-topbtns';
  const topBtn = (label: string, cls: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = `big-btn secondary map-topbtn ${cls}`;
    b.textContent = label;
    b.onclick = () => {
      deps.click();
      fn();
    };
    btns.appendChild(b);
  };
  if (deps.resumeLabel) topBtn(deps.resumeLabel, 'resume', deps.onResume);
  topBtn(t('btn.title'), 'to-title', deps.onTitle);
  topBtn(t('menu.options'), 'options', deps.onOptions);
  top.appendChild(btns);
  ov.appendChild(top);

  // ---- the map: SVG art in a wrap that keeps viewBox aspect exactly ----
  const viewport = document.createElement('div');
  viewport.className = 'map-viewport';
  const wrap = document.createElement('div');
  wrap.className = 'map-wrap';
  viewport.appendChild(wrap);
  ov.appendChild(viewport);

  // JS contain-fit: the wrap must have EXACTLY the viewBox aspect so that
  // percent-positioned HTML (nodes, badges, popover) lines up with SVG paths.
  // Below 900px of rendered width the wrap stops shrinking and the viewport
  // pans horizontally instead (nodes stay tappable).
  const fit = () => {
    const r = viewport.getBoundingClientRect();
    if (!r.width || !r.height) return;
    let s = Math.min(r.width / VIEW_W, r.height / VIEW_H);
    const minS = Math.min(900 / VIEW_W, r.height / VIEW_H);
    if (s < minS) s = minS;
    wrap.style.width = `${VIEW_W * s}px`;
    wrap.style.height = `${VIEW_H * s}px`;
  };
  new ResizeObserver(fit).observe(viewport);
  fit();

  const svg = svgEl('svg', {
    viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
    preserveAspectRatio: 'xMidYMid meet',
  });
  svg.classList.add('map-svg');
  wrap.appendChild(svg);

  // defs: wave + fog hatching
  const defs = svgEl('defs');
  const waves = svgEl('pattern', {
    id: 'map-waves',
    width: '90',
    height: '36',
    patternUnits: 'userSpaceOnUse',
  });
  waves.appendChild(
    svgEl('path', {
      d: 'M0 18 q 11 -7 22 0 t 22 0 t 22 0 t 22 0',
      fill: 'none',
      'stroke-width': '2',
      class: 'wave-line',
    })
  );
  defs.appendChild(waves);
  const fog = svgEl('pattern', {
    id: 'map-fog',
    width: '12',
    height: '12',
    patternUnits: 'userSpaceOnUse',
  });
  fog.appendChild(svgEl('path', { d: 'M0 12 L 12 0', class: 'fog-line', 'stroke-width': '2' }));
  defs.appendChild(fog);
  svg.appendChild(defs);

  // sea + wave hatching
  svg.appendChild(
    svgEl('rect', { width: String(VIEW_W), height: String(VIEW_H), class: 'map-sea' })
  );
  svg.appendChild(
    svgEl('rect', { width: String(VIEW_W), height: String(VIEW_H), fill: 'url(#map-waves)' })
  );

  // territories: shore contours (same outline stroked wide and faint), land,
  // fog hatch when locked, name label
  for (const c of deps.campaigns) {
    const terr = MAP_LAYOUT.find((tr) => tr.campaign === c.campaign);
    if (!terr) continue;
    const g = svgEl('g');
    g.classList.add('territory');
    if (!c.unlocked) g.classList.add('locked');
    if (c.complete) g.classList.add('complete');
    g.appendChild(
      svgEl('path', { d: terr.outline, class: 'shore-far', fill: 'none', 'stroke-width': '26' })
    );
    g.appendChild(
      svgEl('path', { d: terr.outline, class: 'shore-near', fill: 'none', 'stroke-width': '12' })
    );
    g.appendChild(svgEl('path', { d: terr.outline, class: 'land' }));
    if (!c.unlocked) g.appendChild(svgEl('path', { d: terr.outline, fill: 'url(#map-fog)' }));
    const label = svgEl('text', {
      x: String(terr.label.x),
      y: String(terr.label.y),
      class: 'terr-name',
      'text-anchor': 'middle',
    });
    label.textContent = t(terr.nameKey);
    g.appendChild(label);
    svg.appendChild(g);
  }

  // dotted journey line under the nodes
  const counts = new Map(deps.campaigns.map((c) => [c.campaign, c.levels.length]));
  const pts = journeyPoints(counts);
  svg.appendChild(
    svgEl('path', {
      d: pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '),
      class: 'journey',
      fill: 'none',
    })
  );

  // daily lighthouse island (art only; the interactive button lands in Task 3)
  const isle = svgEl('g');
  isle.classList.add('daily-isle');
  isle.appendChild(svgEl('path', { d: DAILY_ISLE, class: 'land' }));
  isle.appendChild(
    svgEl('path', {
      d: `M ${DAILY_SPOT.x - 9} ${DAILY_SPOT.y + 12} L ${DAILY_SPOT.x - 4} ${DAILY_SPOT.y - 22} L ${DAILY_SPOT.x + 4} ${DAILY_SPOT.y - 22} L ${DAILY_SPOT.x + 9} ${DAILY_SPOT.y + 12} Z`,
      class: 'lh-tower',
    })
  );
  isle.appendChild(
    svgEl('circle', {
      cx: String(DAILY_SPOT.x),
      cy: String(DAILY_SPOT.y - 26),
      r: '6',
      class: 'lh-light',
    })
  );
  svg.appendChild(isle);

  return ov;
}
```

(`medalTimesFor`, `nodePositions`, `place` and several deps fields are consumed in Tasks 3–4; `tsc` flags them as unused until then — that is expected, see Step 4.)

- [ ] **Step 3: Append CSS to `src/style.css`**

```css
/* ---- world map level select ---- */
.overlay.worldmap {
  justify-content: flex-start;
  padding: 0;
  gap: 0;
  overflow: hidden;
}
.map-topbar {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 10px 18px;
  flex-wrap: wrap;
}
.map-title { font-size: 26px; }
.map-topbtns { margin-left: auto; display: flex; gap: 10px; flex-wrap: wrap; }
.map-topbtn { padding: 8px 18px; font-size: 14px; }

.map-viewport {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
}
.map-wrap { position: relative; margin: auto; }
.map-svg { display: block; width: 100%; height: 100%; }

.map-svg .map-sea { fill: #274b56; }
.map-svg .wave-line { stroke: rgba(255, 255, 255, 0.07); }
.map-svg .fog-line { stroke: rgba(16, 22, 30, 0.4); }
.map-svg .land { fill: #cfc39a; stroke: #4c5c55; stroke-width: 3; }
.map-svg .shore-near { stroke: rgba(207, 195, 154, 0.28); }
.map-svg .shore-far { stroke: rgba(207, 195, 154, 0.12); }
.map-svg .terr-name {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 30px;
  font-style: italic;
  fill: #e8dfc0;
  paint-order: stroke;
  stroke: rgba(20, 28, 34, 0.55);
  stroke-width: 4px;
}
.map-svg .territory { transition: opacity 0.3s; }
.map-svg .territory.locked { opacity: 0.45; filter: grayscale(0.7); }
.map-svg .journey {
  stroke: rgba(232, 223, 192, 0.55);
  stroke-width: 3;
  stroke-dasharray: 2 12;
  stroke-linecap: round;
}
.map-svg .lh-tower { fill: #e8dfc0; stroke: #4c5c55; stroke-width: 2; }
.map-svg .lh-light { fill: var(--accent); }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: only TS6133 "declared but never read" style errors for the not-yet-consumed imports/deps (`medalTimesFor`, `nodePositions`, `place`). If the config uses `noUnusedLocals`, silence temporarily by referencing them in a `void` statement at the end of `buildWorldMap` and remove that line in Task 3:

```ts
  void medalTimesFor; void nodePositions; void place; // consumed in Tasks 3–4
```

No other error classes are acceptable.

- [ ] **Step 5: Commit**

```bash
git add src/engine/i18n.ts src/game/worldmap.ts src/style.css
git commit -m "feat: worldmap screen skeleton — SVG territories, fog, journey line"
```

---

### Task 3: Level nodes, popover, lock badges, daily button

**Files:**
- Modify: `src/game/worldmap.ts` (insert before `return ov;`; delete the `void …` line from Task 2 if added)
- Modify: `src/style.css` (append)

**Interfaces:**
- Consumes: `deps.bestMedal`, `deps.addMedalBits`, `deps.onPlayLevel`, `deps.onPlayDaily`, `nodePositions`, `place`, `DAILY_SPOT`.
- Produces (selectors Tasks 6–7 rely on): `.map-node` buttons (`disabled` when locked, classes `done gold|silver|bronze`, `next`, `locked`), `.map-popover` (a `.level-card` with `role="dialog"`), `.pop-play` play button, `.terr-lock` hint badges, `.terr-flag`, `.map-daily` button.

- [ ] **Step 1: Insert popover machinery + nodes + badges + daily button**

Insert into `buildWorldMap` directly before `return ov;`:

```ts
  // ---- popover: one at a time, anchored at a node ----
  let pop: HTMLElement | null = null;
  let popAnchor: HTMLElement | null = null;
  const closePopover = () => {
    if (!pop) return;
    pop.remove();
    pop = null;
    popAnchor?.focus();
    popAnchor = null;
  };
  const openPopover = (anchor: HTMLElement, at: Pt, fill: (card: HTMLElement) => void) => {
    deps.click();
    if (pop) {
      pop.remove();
      pop = null;
    }
    popAnchor = anchor;
    pop = document.createElement('div');
    // flip below the node near the top edge; clamp x so it never leaves the map
    pop.className = 'level-card map-popover' + (at.y < 300 ? ' below' : '');
    pop.setAttribute('role', 'dialog');
    place(pop, { x: Math.min(Math.max(at.x, 170), VIEW_W - 170), y: at.y });
    fill(pop);
    wrap.appendChild(pop);
    (pop.querySelector('.pop-play') as HTMLElement | null)?.focus();
  };
  ov.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pop) {
      e.stopPropagation();
      closePopover();
    }
  });
  ov.addEventListener('pointerdown', (e) => {
    const tgt = e.target as Node;
    if (pop && !pop.contains(tgt) && popAnchor !== tgt && !popAnchor?.contains(tgt)) closePopover();
  });

  // shared popover body: name/desc/status + medal bits + play button
  const popBody = (
    card: HTMLElement,
    name: string,
    desc: string,
    done: boolean,
    recordKey: string,
    goldTime: number | null,
    onPlay: () => void
  ) => {
    card.innerHTML = `
      <div class="lv-name"></div>
      <div class="lv-desc"></div>
      <div class="lv-foot"><div class="lv-status ${done ? 'done' : ''}">${done ? t('status.done') : t('status.ready')}</div></div>
    `;
    (card.querySelector('.lv-name') as HTMLElement).textContent = name;
    (card.querySelector('.lv-desc') as HTMLElement).textContent = desc;
    deps.addMedalBits(card, recordKey, goldTime);
    const play = document.createElement('button');
    play.className = 'big-btn pop-play';
    play.textContent = t('btn.play');
    play.onclick = () => {
      deps.click();
      closePopover();
      onPlay();
    };
    card.appendChild(play);
  };

  // ---- level nodes ----
  for (const c of deps.campaigns) {
    const positions = nodePositions(c.campaign, c.levels.length);
    c.levels.forEach((lv, i) => {
      const p = positions[i];
      const node = document.createElement('button');
      node.className = 'map-node';
      node.textContent = String(lv.def.id);
      if (lv.done) node.classList.add('done', deps.bestMedal(`c${lv.def.id}`) ?? 'none');
      if (lv.unlocked && !lv.done) node.classList.add('next');
      if (!lv.unlocked) {
        node.classList.add('locked');
        node.disabled = true;
      }
      const status = lv.done ? t('status.done') : lv.unlocked ? t('status.ready') : t('status.locked');
      node.setAttribute(
        'aria-label',
        t('map.nodeAria', { n: lv.def.id, name: t(lv.def.name), status })
      );
      place(node, p);
      node.onclick = () =>
        openPopover(node, p, (card) =>
          popBody(card, t(lv.def.name), t(lv.def.desc), lv.done, `c${lv.def.id}`,
            lv.def.medals?.gold ?? null, () => deps.onPlayLevel(lv.index))
        );
      wrap.appendChild(node);
    });
  }

  // ---- territory lock badges / completion flags ----
  deps.campaigns.forEach((c, ci) => {
    const terr = MAP_LAYOUT.find((tr) => tr.campaign === c.campaign);
    if (!terr) return;
    if (!c.unlocked) {
      const prev = MAP_LAYOUT.find((tr) => tr.campaign === deps.campaigns[ci - 1]?.campaign);
      const badge = document.createElement('div');
      badge.className = 'terr-lock';
      badge.textContent = `🔒 ${t('map.lockedHint', { name: prev ? t(prev.nameKey) : '…' })}`;
      place(badge, terr.badge);
      wrap.appendChild(badge);
    } else if (c.complete) {
      const flag = document.createElement('div');
      flag.className = 'terr-flag';
      flag.textContent = '🚩';
      place(flag, terr.badge);
      wrap.appendChild(flag);
    }
  });

  // ---- daily challenge button on the lighthouse ----
  {
    const btn = document.createElement('button');
    btn.className = 'map-daily' + (deps.daily.done ? ' done' : ' fresh');
    btn.textContent = '📅';
    btn.setAttribute(
      'aria-label',
      t('map.daily.aria', { status: deps.daily.done ? t('status.done') : t('status.ready') })
    );
    place(btn, DAILY_SPOT);
    btn.onclick = () =>
      openPopover(btn, DAILY_SPOT, (card) => {
        card.classList.add('daily');
        popBody(
          card,
          t('daily.name'),
          t('daily.desc', { label: deps.daily.label, d: deps.daily.difficulty }),
          deps.daily.done,
          deps.daily.seed,
          null,
          deps.onPlayDaily
        );
      });
    wrap.appendChild(btn);
  }
```

- [ ] **Step 2: Append CSS**

```css
.map-node {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 3px solid #4c5c55;
  background: #f3ecd2;
  color: #3c4740;
  font: inherit;
  font-size: 16px;
  font-weight: 900;
  cursor: pointer;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35);
  transition: transform 0.12s, box-shadow 0.12s;
  z-index: 2;
}
.map-node:hover:not(:disabled),
.map-node:focus-visible {
  transform: translate(-50%, -50%) scale(1.15);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.45);
}
.map-node.done.gold { border-color: #f0c419; }
.map-node.done.silver { border-color: #c8ccd4; }
.map-node.done.bronze { border-color: #c98a4b; }
.map-node.next {
  border-color: var(--accent);
  animation: node-pulse 1.6s ease-in-out infinite;
}
@keyframes node-pulse {
  0%, 100% { box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35), 0 0 0 0 rgba(255, 201, 77, 0.55); }
  50% { box-shadow: 0 3px 8px rgba(0, 0, 0, 0.35), 0 0 0 12px rgba(255, 201, 77, 0); }
}
.map-node.locked {
  background: #9aa39c;
  color: #5d665f;
  cursor: default;
  opacity: 0.7;
}
.map-daily {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: none;
  background: transparent;
  font-size: 24px;
  cursor: pointer;
  z-index: 2;
}
.map-daily.fresh { animation: node-pulse 1.6s ease-in-out infinite; }
.terr-lock {
  position: absolute;
  transform: translate(-50%, -50%);
  background: rgba(20, 28, 34, 0.75);
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
  padding: 6px 12px;
  border-radius: 999px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 3;
}
.terr-flag {
  position: absolute;
  transform: translate(-50%, -140%);
  font-size: 22px;
  pointer-events: none;
}
.level-card.map-popover {
  position: absolute;
  transform: translate(-50%, calc(-100% - 30px));
  width: 230px;
  cursor: default;
  z-index: 5;
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.55);
}
.level-card.map-popover.below { transform: translate(-50%, 30px); }
.map-popover .pop-play {
  margin-top: 12px;
  padding: 9px 0;
  width: 100%;
  font-size: 15px;
}
@media (prefers-reduced-motion: reduce) {
  .map-node.next,
  .map-daily.fresh { animation: none; }
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: clean, except possibly unused `medalTimesFor` (consumed in Task 4; keep the `void medalTimesFor;` shim if needed).

```bash
git add src/game/worldmap.ts src/style.css
git commit -m "feat: worldmap level nodes, popover, lock badges, daily lighthouse"
```

---

### Task 4: Legend bar + my-levels drawer

**Files:**
- Modify: `src/game/worldmap.ts` (insert before `return ov;`; remove any remaining `void …` shim)
- Modify: `src/style.css` (append)

**Interfaces:**
- Consumes: `deps.customLevels`, `deps.customDone`, `deps.onPlayCustom/onEditCustom/onCopyCustom/onDeleteCustom/onGenerate/onEditor/onImport`, `medalTimesFor`.
- Produces (selectors Tasks 6–7 rely on): `.legend-bar`, `.legend-btn.generate/.editor/.import/.mine`, `.lg-count`, `.custom-drawer`, `.drawer-empty`, `.drawer-grid` (containing standard `.level-card.custom` cards with `.lv-actions`).

- [ ] **Step 1: Insert legend + drawer before `return ov;`**

```ts
  // ---- custom-level card (same markup the old workshop grid used) ----
  function customCard(lvl: CustomLevelData): HTMLElement {
    const done = deps.customDone(lvl.id);
    const card = document.createElement('div');
    card.className = 'level-card custom';
    card.innerHTML = `
      <div class="lv-num">★</div>
      <div class="lv-name"></div>
      <div class="lv-desc"></div>
      <div class="lv-foot"><div class="lv-status ${done ? 'done' : ''}">${done ? t('status.done') : t('status.ready')}</div></div>
    `;
    (card.querySelector('.lv-name') as HTMLElement).textContent = lvl.name;
    (card.querySelector('.lv-desc') as HTMLElement).textContent =
      lvl.desc || t('custom.defaultDesc');
    deps.addMedalBits(card, lvl.id, medalTimesFor(lvl).gold);
    card.onclick = () => {
      deps.click();
      deps.onPlayCustom(lvl);
    };
    const actions = document.createElement('div');
    actions.className = 'lv-actions';
    const mkBtn = (label: string, titleTxt: string, fn: () => void) => {
      const b = document.createElement('button');
      b.className = 'lv-action-btn';
      b.textContent = label;
      b.title = titleTxt;
      b.onclick = (e) => {
        e.stopPropagation();
        deps.click();
        fn();
      };
      actions.appendChild(b);
    };
    mkBtn('✎', t('action.edit'), () => deps.onEditCustom(lvl));
    mkBtn('⧉', t('action.copy'), () => deps.onCopyCustom(lvl));
    mkBtn('✕', t('action.delete'), () => deps.onDeleteCustom(lvl));
    card.appendChild(actions);
    return card;
  }

  // ---- my-levels drawer ----
  let drawer: HTMLElement | null = null;
  const closeDrawer = () => {
    drawer?.remove();
    drawer = null;
  };
  const openDrawer = () => {
    if (drawer) {
      closeDrawer();
      return;
    }
    drawer = document.createElement('div');
    drawer.className = 'panel custom-drawer';
    const head = document.createElement('div');
    head.className = 'drawer-head';
    const h = document.createElement('span');
    h.textContent = `★ ${t('legend.mine')}`;
    head.appendChild(h);
    const x = document.createElement('button');
    x.className = 'lv-action-btn drawer-close';
    x.textContent = '✕';
    x.onclick = () => {
      deps.click();
      closeDrawer();
    };
    head.appendChild(x);
    drawer.appendChild(head);
    if (!deps.customLevels.length) {
      const empty = document.createElement('div');
      empty.className = 'drawer-empty';
      empty.textContent = t('drawer.empty');
      drawer.appendChild(empty);
    } else {
      const grid = document.createElement('div');
      grid.className = 'level-grid drawer-grid';
      for (const lvl of deps.customLevels) grid.appendChild(customCard(lvl));
      drawer.appendChild(grid);
    }
    ov.appendChild(drawer);
  };
  ov.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer && !pop) closeDrawer();
  });

  // ---- legend bar ----
  const legend = document.createElement('div');
  legend.className = 'legend-bar';
  const cap = document.createElement('span');
  cap.className = 'legend-cap';
  cap.textContent = t('legend.title');
  legend.appendChild(cap);
  const legendBtn = (icon: string, label: string, cls: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = `legend-btn ${cls}`;
    b.innerHTML = `<span class="lg-icon">${icon}</span><span class="lg-label"></span>`;
    (b.querySelector('.lg-label') as HTMLElement).textContent = label;
    b.onclick = () => {
      deps.click();
      fn();
    };
    legend.appendChild(b);
    return b;
  };
  legendBtn('🎲', t('gen.cardName'), 'generate', deps.onGenerate);
  legendBtn('✎', t('editor.cardName'), 'editor', deps.onEditor);
  legendBtn('⇩', t('import.cardName'), 'import', deps.onImport);
  const mine = legendBtn('★', t('legend.mine'), 'mine', openDrawer);
  if (deps.customLevels.length) {
    const n = document.createElement('span');
    n.className = 'lg-count';
    n.textContent = String(deps.customLevels.length);
    mine.appendChild(n);
  }
  ov.appendChild(legend);
```

Note: `openDrawer` is referenced by `legendBtn('★', …)` after its definition — keep the drawer block above the legend block as shown (`const` TDZ).

- [ ] **Step 2: Append CSS**

```css
.legend-bar {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 16px 14px;
}
.legend-cap {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--text-dim);
  margin-right: 6px;
}
.legend-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border-radius: 10px;
  border: 1px solid var(--panel-border);
  background: var(--panel-bg);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.14s, transform 0.14s;
}
.legend-btn:hover { border-color: var(--accent); transform: translateY(-2px); }
.legend-btn .lg-icon { color: var(--accent); font-size: 16px; }
.legend-btn .lg-count {
  background: var(--accent);
  color: #1c2333;
  border-radius: 999px;
  font-size: 11px;
  padding: 1px 7px;
  margin-left: 2px;
}
.custom-drawer {
  position: absolute;
  left: 50%;
  bottom: 64px;
  transform: translateX(-50%);
  width: min(940px, calc(100% - 24px));
  max-height: 55%;
  overflow-y: auto;
  padding: 14px 16px;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: drawer-up 0.18s ease-out;
}
@keyframes drawer-up {
  from { transform: translateX(-50%) translateY(14px); opacity: 0; }
}
.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 800;
}
.drawer-empty { color: var(--text-dim); font-size: 13px; padding: 8px 0 14px; }
.drawer-grid { max-width: none; }
@media (prefers-reduced-motion: reduce) {
  .custom-drawer { animation: none; }
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: fully clean now (all imports consumed; any `void …` shim removed).

```bash
git add src/game/worldmap.ts src/style.css
git commit -m "feat: worldmap legend bar + my-levels drawer"
```

---

### Task 5: Rewire `main.ts`, delete the old grid, drop dead i18n keys, amend spec

**Files:**
- Modify: `src/main.ts` (replace `showLevelSelect()` body, currently ~lines 410–703; add imports; extract `buildShelf()`)
- Modify: `src/engine/i18n.ts` (remove dead keys)
- Modify: `docs/superpowers/specs/2026-07-14-worldmap-level-select-design.md` (one-line amendment)

**Interfaces:**
- Consumes: `buildWorldMap`, `MapCampaignState` from `./game/worldmap` (Task 2–4).
- Produces: live world-map screen at `showLevelSelect()`; everything else in `main.ts` untouched.

- [ ] **Step 1: Add import**

In `src/main.ts` after the `generator` import (line 27):

```ts
import { buildWorldMap } from './game/worldmap';
import type { MapCampaignState } from './game/worldmap';
```

- [ ] **Step 2: Extract `buildShelf()` and replace `showLevelSelect()`**

Delete the entire current `showLevelSelect()` (from `function showLevelSelect(): void {` through the closing `}` right before `function showGenerateDialog(): void {`). The trophy-shelf block inside it (the `if (Object.keys(save.records).length > 0) { … ov.appendChild(shelf); }` section) moves verbatim into `buildShelf()` — same element construction, but `return shelf` / `return null` instead of appending. Replace with:

```ts
// trophy cartouche: the collection at a glance (world-map top bar)
function buildShelf(): HTMLElement | null {
  if (Object.keys(save.records).length === 0) return null;
  const shelf = document.createElement('div');
  shelf.className = 'shelf';
  const counts = { gold: 0, silver: 0, bronze: 0, feats: 0 };
  for (const r of Object.values(save.records)) {
    if (r.medal) counts[r.medal]++;
    counts.feats += r.feats.length;
  }
  for (const tier of ['gold', 'silver', 'bronze'] as const) {
    const c = document.createElement('span');
    c.className = 'count';
    c.appendChild(mkIcon(`medal_${tier}`, 30));
    c.appendChild(document.createTextNode(`× ${counts[tier]}`));
    shelf.appendChild(c);
  }
  const sep = document.createElement('span');
  sep.className = 'sep';
  shelf.appendChild(sep);
  const pins = document.createElement('span');
  pins.className = 'count';
  pins.appendChild(mkIcon('pin_feat', 24));
  pins.appendChild(document.createTextNode(`× ${counts.feats}`));
  shelf.appendChild(pins);
  const sep2 = document.createElement('span');
  sep2.className = 'sep';
  shelf.appendChild(sep2);
  const campaignGold = LEVELS.filter((l) => save.records[`c${l.id}`]?.medal === 'gold').length;
  const pct = document.createElement('span');
  pct.className = 'pct';
  pct.innerHTML = t('shelf.gold', { a: campaignGold, b: LEVELS.length });
  shelf.appendChild(pct);
  return shelf;
}

function showLevelSelect(): void {
  clearOverlay();
  running = false;

  // Campaign/unlock state — same rules as the old grid: a campaign opens once
  // every level of all previous campaigns is done; within a campaign levels
  // unlock in sequence (the globally previous level must be completed).
  const ids = [...new Set(LEVELS.map((l) => l.campaign ?? 1))].sort((a, b) => a - b);
  const doneByCampaign = new Map(
    ids.map((c) => [
      c,
      LEVELS.filter((l) => (l.campaign ?? 1) === c).every((l) => save.completed.includes(l.id)),
    ])
  );
  const gate = (c: number) => ids.filter((x) => x < c).every((x) => doneByCampaign.get(x));
  const campaigns: MapCampaignState[] = ids.map((c) => ({
    campaign: c,
    unlocked: gate(c),
    complete: doneByCampaign.get(c)!,
    levels: LEVELS.map((def, index) => ({ def, index }))
      .filter(({ def }) => (def.campaign ?? 1) === c)
      .map(({ def, index }) => ({
        index,
        def,
        unlocked: gate(c) && (index === 0 || save.completed.includes(LEVELS[index - 1].id)),
        done: save.completed.includes(def.id),
      })),
  }));

  const daily = dailySeed();
  const ov = buildWorldMap({
    campaigns,
    daily: { ...daily, done: save.completedCustom.includes(daily.seed) },
    customLevels,
    shelf: buildShelf(),
    resumeLabel: gameInProgress() ? t('btn.resume', { name: t(game!.level.name) }) : null,
    bestMedal: (key) => save.records[key]?.medal ?? null,
    addMedalBits,
    customDone: (id) => save.completedCustom.includes(id),
    click: () => audio.click(),
    onPlayLevel: (i) =>
      confirmIfInProgress(
        t('confirm.abandonNamed', { name: t(game?.level.name ?? '') }),
        t('btn.abandon'),
        () => startLevel(i)
      ),
    onPlayDaily: () =>
      confirmIfInProgress(t('confirm.abandon'), t('btn.abandon'), () => {
        const data = generateVerifiedLevel({ seed: daily.seed, difficulty: daily.difficulty });
        data.id = daily.seed; // stable id so completion sticks
        data.name = t('daily.title', { label: daily.label });
        startCustomLevel(data, {});
      }),
    onPlayCustom: (lvl) =>
      confirmIfInProgress(t('confirm.abandon'), t('btn.abandon'), () => startCustomLevel(lvl, {})),
    onEditCustom: (lvl) =>
      confirmIfInProgress(t('confirm.abandon'), t('btn.abandon'), () => openEditor(lvl)),
    onCopyCustom: (lvl) => {
      const code = encodeShareCode(lvl);
      navigator.clipboard?.writeText(code).catch(() => window.prompt(t('ed.copyPrompt'), code));
    },
    onDeleteCustom: (lvl) =>
      showConfirm(t('confirm.delete', { name: lvl.name }), t('btn.delete'), () => {
        customLevels = deleteCustomLevel(customLevels, lvl.id);
        showLevelSelect();
      }),
    onGenerate: showGenerateDialog,
    onEditor: () => confirmIfInProgress(t('confirm.abandon'), t('btn.abandon'), () => openEditor()),
    onImport: () => {
      const code = window.prompt(t('import.prompt'));
      if (!code) return;
      const data = decodeShareCode(code);
      if (!data) {
        window.alert(t('import.error'));
        return;
      }
      customLevels = upsertCustomLevel(customLevels, data);
      showLevelSelect();
    },
    onResume: resumeGame,
    onTitle: showTitle,
    onOptions: () => showOptions(showLevelSelect),
  });
  uiRoot.appendChild(ov);
}
```

- [ ] **Step 3: Remove dead i18n keys**

First verify each is now unreferenced: `grep -rn "camp2\.unlocked\|camp2\.locked\|camp3\.unlocked\|camp3\.locked\|workshop\.title" src tests` — only the `i18n.ts` definitions may remain. Then delete these entries from `src/engine/i18n.ts`: `camp2.unlocked`, `camp2.locked`, `camp3.unlocked`, `camp3.locked`, `workshop.title`. (`win.campaign2`, `win.campaign3`, `daily.*`, `gen.*`, `import.*`, `editor.cardName` stay — still used.)

- [ ] **Step 4: Amend spec**

In `docs/superpowers/specs/2026-07-14-worldmap-level-select-design.md`, "Screen structure" section, extend item 1:

```
1. **Top bar** — small game title, trophy cartouche (…), and the session
   buttons on the right: Resume (only while a run is in progress), Back to
   title, Options — these lived under the old grid's bottom button row.
```

- [ ] **Step 5: Build and eyeball**

Run: `npm run build`
Expected: clean tsc + vite build.

Run: `npm run dev`, open the printed URL, click Play. Expected: map with 3 territories (2 fogged on a fresh profile), 12 nodes, daily lighthouse, legend bar; node 1 opens a popover; Play boots level 1. This is a smoke-look only — automated coverage lands in Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/main.ts src/engine/i18n.ts docs/superpowers/specs/2026-07-14-worldmap-level-select-design.md
git commit -m "feat: level select renders the world map; retire the card grids"
```

---

### Task 6: Browser test suite for the world map

**Files:**
- Test: `tests/worldmap.mjs`
- Modify: `package.json` (add `"test:worldmap": "node tests/worldmap.mjs",` after `test:maplayout`)

**Interfaces:**
- Consumes: selectors from Tasks 3–4 (`.map-node`, `.map-popover`, `.pop-play`, `.territory`, `.terr-lock`, `.map-daily`, `.legend-btn.*`, `.custom-drawer`, `.drawer-empty`); `window.__smallhands` debug hook.

- [ ] **Step 1: Write the test**

Create `tests/worldmap.mjs`:

```js
// Browser test for the world-map level select: territories/fog, node popover,
// play flow, daily landmark, legend bar and the my-levels drawer.
// Needs `npm run build && npm run preview` and CHROME_PATH (see e2e.mjs).
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

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

let failures = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
};

await page.goto(BASE_URL);
await page.waitForTimeout(800);
await page.click('.fd-play');
await page.waitForTimeout(400);

// ---- structure on a fresh profile ----
check('worldmap overlay shown', !!(await page.$('.overlay.worldmap')));
check('3 territories', (await page.$$('.territory')).length === 3);
check('2 territories fogged', (await page.$$('.territory.locked')).length === 2);
check('2 lock hints', (await page.$$('.terr-lock')).length === 2);
const nodes = await page.$$('.map-node');
check('12 level nodes', nodes.length === 12);
check('exactly 1 unlocked node', (await page.$$('.map-node:not(:disabled)')).length === 1);
check('daily lighthouse present', !!(await page.$('.map-daily')));
check('legend has 4 buttons', (await page.$$('.legend-btn')).length === 4);

// ---- popover open/close ----
await page.click('.map-node:not(:disabled)');
await page.waitForTimeout(150);
check('popover opens', !!(await page.$('.map-popover')));
check('popover has a name', ((await page.textContent('.map-popover .lv-name')) ?? '').length > 0);
check('popover has medal slots', !!(await page.$('.map-popover .medal-row')));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Escape closes popover', !(await page.$('.map-popover')));

// ---- drawer (empty on a fresh profile) ----
await page.click('.legend-btn.mine');
await page.waitForTimeout(150);
check('drawer opens', !!(await page.$('.custom-drawer')));
check('drawer shows empty hint', !!(await page.$('.drawer-empty')));
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Escape closes drawer', !(await page.$('.custom-drawer')));

// ---- generator dialog reachable from the legend ----
await page.click('.legend-btn.generate');
await page.waitForTimeout(150);
check('generator dialog opens', !!(await page.$('.gen-box')));
await page.click('.gen-box .big-btn.secondary:has-text("Cancel"), .gen-box .btn-row .big-btn.secondary:last-child');
await page.waitForTimeout(150);

// ---- play flow: node -> popover -> Play boots the level ----
await page.click('.map-node:not(:disabled)');
await page.waitForTimeout(150);
await page.click('.map-popover .pop-play');
await page.waitForFunction(() => window.__smallhands, { timeout: 8000 });
const booted = await page.evaluate(() => ({
  hasGame: !!window.__smallhands.game,
  won: window.__smallhands.game.won,
}));
check('play boots a fresh level', booted.hasGame && booted.won === false);

// ---- editor reachable from the legend (back on the select first) ----
await page.hover('.menubar');
await page.click('.menubar .speed-btn:has-text("Levels")');
await page.waitForTimeout(400);
check('back on the worldmap', !!(await page.$('.overlay.worldmap')));
await page.click('.legend-btn.editor');
await page.waitForTimeout(300);
// abandoning the just-started level pops a confirm first
const confirmBtn = await page.$('.confirm-overlay .big-btn.danger');
if (confirmBtn) {
  await confirmBtn.click();
  await page.waitForTimeout(300);
}
check('editor opens from legend', !!(await page.$('.editor-panel')));

await browser.close();
if (failures) {
  console.error(`WORLDMAP FAIL: ${failures} checks failed`);
  process.exit(1);
}
console.log('WORLDMAP PASS');
```

Note on the "Levels" menu button: the in-game corner menu auto-hides behind a hover pill — `page.hover('.menubar')` first is mandatory (headless shell reports `hover: hover`). The exact label/selector is the one `tests/editor-generator.mjs:79` already uses.

- [ ] **Step 2: Run it**

```bash
npm run build && (npm run preview &) && sleep 2
export CHROME_PATH=$(ls ~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell | head -1)
node tests/worldmap.mjs
```

Expected: `WORLDMAP PASS`, exit 0. Fix any failing check by adjusting `worldmap.ts` (not by weakening the test), re-run until green. If the generator-cancel selector proves brittle, use `page.$$('.gen-box .btn-row .big-btn')` and click the last one.

- [ ] **Step 3: Commit**

```bash
git add tests/worldmap.mjs package.json
git commit -m "test: browser suite for the world-map level select"
```

---

### Task 7: Migrate the existing browser suites off `.level-card`

**Files:**
- Modify: `tests/e2e.mjs:38`
- Modify: `tests/drag-tooltip.mjs:41`
- Modify: `tests/weather-visual.mjs:30`
- Modify: `tests/i18n.mjs:35-42`
- Modify: `tests/editor-generator.mjs:51,92,95,243-249`

**Interfaces:**
- Consumes: `.map-node`, `.map-popover .pop-play`, `.legend-btn.editor`, `.overlay.worldmap` from Tasks 3–5.

- [ ] **Step 1: The three simple "start first level" call sites**

In `tests/e2e.mjs` (line 38), `tests/drag-tooltip.mjs` (line 41), `tests/weather-visual.mjs` (line 30), replace:

```js
await page.click('.level-card:not(.locked)');
```

with:

```js
await page.click('.map-node:not(:disabled)');
await page.click('.map-popover .pop-play');
```

(Keep each file's surrounding `waitForTimeout`/`waitForFunction` lines unchanged.)

- [ ] **Step 2: `tests/i18n.mjs`**

Replace lines 35–42 (header + name checks + level start):

```js
const header = await page.textContent('.worldmap .map-title');
check('level select header is German', header === 'Wähle ein Level');
await page.click('.map-node:not(:disabled)');
await page.waitForTimeout(200);
const firstName = await page.textContent('.map-popover .lv-name');
check('level 1 name is German', firstName === 'Erste Schritte');

// start level 1: HUD in German
await page.click('.map-popover .pop-play');
await page.waitForTimeout(600);
```

- [ ] **Step 3: `tests/editor-generator.mjs`**

Line 51: `await page.click('.level-card:has-text("Level editor")');` → `await page.click('.legend-btn.editor');`

Line 92: `if (!(await page.$('.level-grid'))) await fail('exiting the editor should land on the level select');` → `if (!(await page.$('.overlay.worldmap'))) await fail('exiting the editor should land on the level select');`

Line 95 (start campaign level 1 for the debug hook):

```js
await page.click('.map-node:not(:disabled)');
await page.click('.map-popover .pop-play');
```

Lines 243–249 (trophy shelf + medal slots after a win; the shelf now sits in the map top bar, medal slots in the popover):

```js
await page.click('.overlay .big-btn.secondary'); // "Levels"
await page.waitForTimeout(400);
if (!(await page.$('.shelf'))) await fail('trophy shelf missing from level select after earning a record');
await page.click('.map-node:not(:disabled)');
await page.waitForTimeout(200);
if (!(await page.$('.map-popover .medal-row'))) await fail('medal slots missing from the level popover');
// head back into a level so the soak section has its debug hook
await page.click('.map-popover .pop-play');
await page.waitForTimeout(400);
```

- [ ] **Step 4: Run the fast browser suites**

With preview + CHROME_PATH still up (Task 6 Step 2):

```bash
node tests/i18n.mjs && node tests/drag-tooltip.mjs && node tests/editor-generator.mjs && node tests/weather-visual.mjs
```

Expected: each suite's existing PASS line. (These take ~1–3 min each; run in the foreground one by one if output interleaves.)

- [ ] **Step 5: Commit**

```bash
git add tests/e2e.mjs tests/drag-tooltip.mjs tests/weather-visual.mjs tests/i18n.mjs tests/editor-generator.mjs
git commit -m "test: migrate browser suites to the world-map selectors"
```

---

### Task 8: Full verification

**Files:** none (verification only; fixes go where the failure is).

- [ ] **Step 1: Static + headless**

```bash
npm run build && npm run test:maplayout && npm run test:unit
```

Expected: all green.

- [ ] **Step 2: Long e2e (backgrounded — runs several minutes)**

```bash
(npm run preview &)
export CHROME_PATH=$(ls ~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell | head -1)
node tests/e2e.mjs
```

Expected final line: `E2E PASS: levels 1 and 2 completed`.

- [ ] **Step 3: Re-run the worldmap suite once more after all migrations**

Run: `node tests/worldmap.mjs`
Expected: `WORLDMAP PASS`.

- [ ] **Step 4: Wrap up**

- Update the stale memory note (`testing-smallhands.md` says the game lives at `/play/`; `tests/e2e.mjs` now serves it at `/` — correct the memory).
- Harmony: `harmony_update_agent_progress` final milestone, `harmony_end_agent_session` (status "completed", moveToColumn: "Review") if a session was started.
- Do not merge/push — present the branch per superpowers:finishing-a-development-branch.
