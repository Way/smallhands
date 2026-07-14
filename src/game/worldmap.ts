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
  const ro = new ResizeObserver(() => {
    // self-disconnect once the overlay is torn down (screen is rebuilt per visit)
    if (!viewport.isConnected) {
      ro.disconnect();
      return;
    }
    fit();
  });
  ro.observe(viewport);
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

  void medalTimesFor; // consumed in Task 4

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

  return ov;
}
