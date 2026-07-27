// The level select as a hand-drawn world map: campaigns are territories that
// unfog as they unlock, levels are nodes along a dotted journey line, the
// daily challenge is a lighthouse landmark, and the creation tools live in a
// legend bar at the bottom. Geometry comes from maplayout.ts; all game/save
// state arrives through WorldMapDeps — this module only renders and routes
// clicks back to main.ts.

import { t } from '../engine/i18n';
import { drawIconTo } from '../engine/sprites';
import { ITEM_ICON } from './types';
import type { LevelDef } from './levels';
import { medalTimesFor } from './leveldata';
import type { CustomLevelData } from './leveldata';
import type { DailyLogEntry, DailyStats, DailyStripDay } from './dailylog';
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
  // the daily logbook, derived from the save by game/dailylog.ts
  dailyLog: DailyLogEntry[]; // solved dailies, newest first
  dailyStats: DailyStats;
  dailyStrip: DailyStripDay[]; // recent days, oldest first
  customLevels: CustomLevelData[];
  shelf: HTMLElement | null; // trophy cartouche, prebuilt by main.ts
  resumeLabel: string | null; // "Resume — <level>" when a run is in progress
  bestMedal: (key: string) => 'gold' | 'silver' | 'bronze' | null;
  addMedalBits: (card: HTMLElement, key: string, goldTime: number | null) => void;
  // A picture of the level's starting map, or null if this device could not
  // draw one. Owned by main.ts: building it needs a Game and a Renderer, which
  // this module deliberately does not know about. Called only when a popover
  // opens, so an unvisited level never costs a draw.
  levelPreview: (def: LevelDef) => HTMLCanvasElement | null;
  customDone: (id: string) => boolean;
  click: () => void; // UI click sound
  onPlayLevel: (index: number) => void;
  onPlayDaily: () => void;
  onPlayPastDaily: (entry: DailyLogEntry) => void;
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

// A compact chip list of what makes a level worth playing: its delivery order,
// its special conditions (night / weather / rising tide) and its scale — so the
// map pills read as a briefing, not just a name and a blurb.
function levelFactsEl(def: LevelDef): HTMLElement {
  const facts = document.createElement('div');
  facts.className = 'lv-facts';

  if (def.objectives.length) {
    const row = document.createElement('div');
    row.className = 'lv-obj-row';
    const lbl = document.createElement('span');
    lbl.className = 'lv-obj-lbl';
    lbl.textContent = t('hud.deliver');
    row.appendChild(lbl);
    for (const o of def.objectives) {
      const chip = document.createElement('span');
      chip.className = 'lv-obj';
      // the resource sprite, so players learn what the delivery item looks like
      const ic = document.createElement('canvas');
      ic.className = 'lv-obj-icon';
      drawIconTo(ic, ITEM_ICON[o.item], 18);
      const b = document.createElement('b');
      b.textContent = String(o.amount);
      chip.append(ic, b, ` ${t(`item.${o.item}`)}`);
      row.appendChild(chip);
    }
    facts.appendChild(row);
  }

  const tags: string[] = [];
  if (def.night) tags.push(`🌙 ${t('map.tag.night')}`);
  if (def.weather?.some((w) => w.kind === 'rain')) tags.push(`🌧 ${t('map.tag.rain')}`);
  if (def.weather?.some((w) => w.kind === 'storm')) tags.push(`⚡ ${t('map.tag.storm')}`);
  if (def.flood) tags.push(`🌊 ${t('map.tag.tide')}`);
  if (tags.length) {
    const tagRow = document.createElement('div');
    tagRow.className = 'lv-tags';
    for (const txt of tags) {
      const tag = document.createElement('span');
      tag.className = 'lv-tag';
      tag.textContent = txt;
      tagRow.appendChild(tag);
    }
    facts.appendChild(tagRow);
  }

  const meta = document.createElement('div');
  meta.className = 'lv-meta';
  const toolCount = def.allowedTools?.length ?? 0;
  meta.textContent =
    `${def.width} × ${def.height}` + (toolCount ? ` · ${t('map.facts.tools', { n: toolCount })}` : '');
  facts.appendChild(meta);

  return facts;
}

// The daily is generated on demand, so we can't cheaply preview its order — but
// we can still sell the challenge: how hard today's is, and that it's one shared
// procedural mountain everyone races on the same day.
function diffStars(difficulty: number): string {
  const d = Math.max(1, Math.min(5, difficulty));
  return '★'.repeat(d) + '☆'.repeat(5 - d);
}

function diffLabel(difficulty: number): string {
  return difficulty <= 2 ? t('daily.diff.easy') : difficulty >= 4 ? t('daily.diff.hard') : t('daily.diff.med');
}

function dailyFactsEl(daily: MapDailyState, stats: DailyStats): HTMLElement {
  const facts = document.createElement('div');
  facts.className = 'lv-facts';

  const diff = document.createElement('div');
  diff.className = 'lv-diff';
  const stars = document.createElement('span');
  stars.className = 'diff-stars';
  stars.textContent = diffStars(daily.difficulty);
  const lbl = document.createElement('span');
  lbl.className = 'diff-lbl';
  lbl.textContent = diffLabel(daily.difficulty);
  diff.append(stars, lbl);
  facts.appendChild(diff);

  const tagRow = document.createElement('div');
  tagRow.className = 'lv-tags';
  const tags = [`🎲 ${t('daily.tag.proc')}`, `🌍 ${t('daily.tag.shared')}`];
  // a live streak is the reason to come back tomorrow — say it where the player
  // decides whether to play today's daily at all
  if (stats.current > 0) tags.push(`🔥 ${t('daily.log.streak', { n: stats.current })}`);
  for (const txt of tags) {
    const tag = document.createElement('span');
    tag.className = 'lv-tag';
    tag.textContent = txt;
    tagRow.appendChild(tag);
  }
  facts.appendChild(tagRow);

  return facts;
}

export function buildWorldMap(deps: WorldMapDeps): HTMLElement {
  const ov = document.createElement('div');
  ov.className = 'overlay worldmap';

  // ---- full-bleed sea: the gradient + wave hatching span the ENTIRE screen,
  // behind everything, so the ocean reaches every edge instead of stopping at
  // the aspect-locked island wrap. No viewBox → the wave pattern tiles at its
  // natural CSS-pixel size no matter how wide the screen is. ----
  const seaBg = svgEl('svg', { class: 'map-sea-bg' });
  seaBg.setAttribute('aria-hidden', 'true');
  const seaDefs = svgEl('defs');
  const seaWaves = svgEl('pattern', {
    id: 'map-waves',
    width: '90',
    height: '36',
    patternUnits: 'userSpaceOnUse',
  });
  seaWaves.appendChild(
    svgEl('path', {
      d: 'M0 18 q 11 -7 22 0 t 22 0 t 22 0 t 22 0',
      fill: 'none',
      'stroke-width': '2',
      class: 'wave-line',
    })
  );
  seaDefs.appendChild(seaWaves);
  const seaGrad = svgEl('linearGradient', { id: 'map-sea-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
  seaGrad.appendChild(svgEl('stop', { offset: '0', 'stop-color': '#1b2a3a' }));
  seaGrad.appendChild(svgEl('stop', { offset: '0.55', 'stop-color': '#122031' }));
  seaGrad.appendChild(svgEl('stop', { offset: '1', 'stop-color': '#0c1420' }));
  seaDefs.appendChild(seaGrad);
  seaBg.appendChild(seaDefs);
  seaBg.appendChild(svgEl('rect', { width: '100%', height: '100%', class: 'map-sea' }));
  seaBg.appendChild(svgEl('rect', { width: '100%', height: '100%', fill: 'url(#map-waves)' }));
  ov.appendChild(seaBg);

  // ---- progression state: shared by the journey trail, the region rim-light
  // and the progress counter. `frontier` is the index of the current objective
  // along the ordered journey; the trail is lit up to it and dotted beyond. ----
  const orderedLevels: MapLevelState[] = [];
  for (const terr of MAP_LAYOUT) {
    const c = deps.campaigns.find((cc) => cc.campaign === terr.campaign);
    if (c) orderedLevels.push(...c.levels);
  }
  const totalLevels = orderedLevels.length;
  const doneLevels = orderedLevels.filter((l) => l.done).length;
  let frontier = orderedLevels.findIndex((l) => l.unlocked && !l.done);
  if (frontier < 0) frontier = totalLevels - 1; // everything cleared → trail lit end to end
  const currentCampaign =
    deps.campaigns.find((c) => c.levels.some((l) => l.unlocked && !l.done))?.campaign ?? null;

  // ---- top bar: title, trophy cartouche, session buttons ----
  const top = document.createElement('div');
  top.className = 'map-topbar';
  const left = document.createElement('div');
  left.className = 'map-topleft';
  const title = document.createElement('div');
  title.className = 'title-logo map-title';
  title.textContent = t('select.title');
  left.appendChild(title);
  // progress counter — how much of the journey is cleared (drives the grind)
  const prog = document.createElement('div');
  prog.className = 'map-progress';
  prog.setAttribute('aria-label', t('map.progress', { done: doneLevels, total: totalLevels }));
  const flag = document.createElement('span');
  flag.className = 'mp-flag';
  flag.textContent = '⚑';
  const done = document.createElement('span');
  done.textContent = String(doneLevels);
  const total = document.createElement('span');
  total.className = 'mp-total';
  total.textContent = ` / ${totalLevels}`;
  prog.append(flag, done, total);
  left.appendChild(prog);
  top.appendChild(left);
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
  // Below a minimum rendered width the wrap stops shrinking and the viewport
  // pans instead (nodes stay tappable). Touch keeps a larger minimum for two
  // reasons: 44px thumb medallions need spacing between slots, AND the islands
  // must render big enough that those fixed-size medallions don't dwarf the
  // island art (the discs never shrink below thumb size, so proportion comes
  // from growing the map instead).
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  // same breakpoints as the compact-layout CSS block: on these screens the
  // level popover opens as a bottom drawer instead of a node-anchored bubble
  const compactMq =
    typeof matchMedia !== 'undefined'
      ? matchMedia('(max-width: 820px), ((pointer: coarse) and (max-height: 520px))')
      : null;
  const minMapW = coarse ? 1280 : 900;
  const fit = () => {
    const r = viewport.getBoundingClientRect();
    if (!r.width || !r.height) return;
    let s = Math.min(r.width / VIEW_W, r.height / VIEW_H);
    s = Math.max(s, minMapW / VIEW_W);
    wrap.style.width = `${VIEW_W * s}px`;
    wrap.style.height = `${VIEW_H * s}px`;
    // the map's render scale, for CSS: medallion digits (and, on fine
    // pointers, the discs themselves) shrink with the map so the numbers
    // keep their proportion to the islands instead of dominating them
    wrap.style.setProperty('--map-s', s.toFixed(4));
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

  // defs: fog hatching for locked territories (the sea + waves live in the
  // full-bleed background layer above, drawn once across the whole screen)
  const defs = svgEl('defs');
  const fog = svgEl('pattern', {
    id: 'map-fog',
    width: '12',
    height: '12',
    patternUnits: 'userSpaceOnUse',
  });
  fog.appendChild(svgEl('path', { d: 'M0 12 L 12 0', class: 'fog-line', 'stroke-width': '2' }));
  defs.appendChild(fog);
  svg.appendChild(defs);

  // territories: shore contours (same outline stroked wide and faint), land,
  // fog hatch when locked, name label
  for (const c of deps.campaigns) {
    const terr = MAP_LAYOUT.find((tr) => tr.campaign === c.campaign);
    if (!terr) continue;
    const g = svgEl('g');
    g.classList.add('territory');
    if (!c.unlocked) g.classList.add('locked');
    if (c.complete) g.classList.add('complete');
    if (c.campaign === currentCampaign) g.classList.add('current');
    g.appendChild(
      svgEl('path', { d: terr.outline, class: 'shore-far', fill: 'none', 'stroke-width': '26' })
    );
    g.appendChild(
      svgEl('path', { d: terr.outline, class: 'shore-near', fill: 'none', 'stroke-width': '12' })
    );
    g.appendChild(svgEl('path', { d: terr.outline, class: 'land' }));
    if (!c.unlocked) g.appendChild(svgEl('path', { d: terr.outline, fill: 'url(#map-fog)' }));
    const name = t(terr.nameKey);
    const label = svgEl('text', {
      x: String(terr.label.x),
      y: String(terr.label.y),
      class: 'terr-name',
      'text-anchor': 'middle',
    });
    label.textContent = name;
    g.appendChild(label);
    // gold dash under the region name — echoes the landing page's section rule
    const uw = Math.min(180, Math.max(80, name.length * 12));
    g.appendChild(
      svgEl('line', {
        x1: String(terr.label.x - uw / 2),
        y1: String(terr.label.y + 15),
        x2: String(terr.label.x + uw / 2),
        y2: String(terr.label.y + 15),
        class: 'terr-underline',
      })
    );
    svg.appendChild(g);
  }

  // the journey line under the nodes, in two coats: a faint dotted trail for the
  // whole route, then a lit gold trail over the stretch already walked.
  const counts = new Map(deps.campaigns.map((c) => [c.campaign, c.levels.length]));
  const pts = journeyPoints(counts);
  const toPath = (ps: Pt[]) => ps.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
  svg.appendChild(svgEl('path', { d: toPath(pts), class: 'journey', fill: 'none' }));
  const walked = pts.slice(0, Math.min(frontier + 1, pts.length));
  if (walked.length >= 2) {
    svg.appendChild(svgEl('path', { d: toPath(walked), class: 'journey-walked', fill: 'none' }));
  }

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

  // decorative compass rose resting on the open water below the meadows
  {
    const cx = 250;
    const cy = 798;
    const r = 50;
    const arm = 40;
    const w = 9;
    const rose = svgEl('g');
    rose.classList.add('map-compass');
    rose.appendChild(svgEl('circle', { cx: String(cx), cy: String(cy), r: String(r), class: 'compass-ring' }));
    rose.appendChild(svgEl('circle', { cx: String(cx), cy: String(cy), r: String(r - 9), class: 'compass-ring' }));
    rose.appendChild(
      svgEl('polygon', {
        points: `${cx},${cy - arm} ${cx + w},${cy} ${cx},${cy + arm} ${cx - w},${cy}`,
        class: 'compass-star',
      })
    );
    rose.appendChild(
      svgEl('polygon', {
        points: `${cx - arm},${cy} ${cx},${cy - w} ${cx + arm},${cy} ${cx},${cy + w}`,
        class: 'compass-star',
      })
    );
    const nlabel = svgEl('text', {
      x: String(cx),
      y: String(cy - r - 6),
      class: 'compass-n',
      'text-anchor': 'middle',
    });
    nlabel.textContent = 'N';
    rose.appendChild(nlabel);
    svg.appendChild(rose);
  }

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
    closeDrawer(); // popover, drawer and logbook are mutually exclusive
    closeLogbook();
    deps.click();
    if (pop) {
      pop.remove();
      pop = null;
    }
    popAnchor = anchor;
    pop = document.createElement('div');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-modal', 'true');
    if (compactMq?.matches) {
      // phones: the map pans, so a node-anchored bubble can sit half outside
      // the viewport. A bottom drawer above the legend bar is always fully
      // visible. Lives on the overlay (not the panning wrap) so it stays put.
      pop.className = 'level-card map-popover sheet';
      fill(pop);
      const x = document.createElement('button');
      x.className = 'lv-action-btn pop-close';
      x.textContent = '✕';
      x.onclick = () => {
        deps.click();
        closePopover();
      };
      pop.appendChild(x);
      ov.appendChild(pop);
    } else {
      // flip below for any node in the upper half — the enriched pills are tall,
      // so a node near the top would otherwise overflow above the map. Clamp x so
      // the pill never leaves the map horizontally.
      pop.className = 'level-card map-popover' + (at.y < 470 ? ' below' : '');
      place(pop, { x: Math.min(Math.max(at.x, 170), VIEW_W - 170), y: at.y });
      fill(pop);
      wrap.appendChild(pop);
    }
    (pop.querySelector('.pop-play') as HTMLElement | null)?.focus();
  };
  ov.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pop) {
      e.stopImmediatePropagation();
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
    onPlay: () => void,
    facts: HTMLElement | null = null,
    preview: HTMLCanvasElement | null = null
  ) => {
    card.innerHTML = `
      <div class="lv-name"></div>
      <div class="lv-desc"></div>
      <div class="lv-foot"><div class="lv-status ${done ? 'done' : ''}">${done ? t('status.done') : t('status.ready')}</div></div>
    `;
    // The map itself, above the name: the shape of the mountain is what a player
    // is actually choosing between, and it reads faster than any blurb.
    if (preview) {
      const shot = document.createElement('div');
      shot.className = 'lv-shot';
      shot.setAttribute('role', 'img');
      shot.setAttribute('aria-label', t('map.preview.aria', { name }));
      preview.className = 'lv-shot-img';
      shot.appendChild(preview);
      card.insertBefore(shot, card.firstChild);
    }
    (card.querySelector('.lv-name') as HTMLElement).textContent = name;
    (card.querySelector('.lv-name') as HTMLElement).id = 'map-pop-title';
    card.setAttribute('aria-labelledby', 'map-pop-title');
    (card.querySelector('.lv-desc') as HTMLElement).textContent = desc;
    if (facts) card.insertBefore(facts, card.querySelector('.lv-foot'));
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
    if (!MAP_LAYOUT.some((tr) => tr.campaign === c.campaign)) {
      console.warn(`map layout: no territory for campaign ${c.campaign} — its levels are not shown`);
      continue;
    }
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
            lv.def.medals?.gold ?? null, () => deps.onPlayLevel(lv.index), levelFactsEl(lv.def),
            deps.levelPreview(lv.def))
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
    // a tear-off calendar showing TODAY's day, parsed from the daily seed's
    // date label (YYYY-MM-DD) — the plain 📅 emoji always drew a frozen "17"
    const dnum = Number(deps.daily.label.slice(-2));
    const calTop = document.createElement('span');
    calTop.className = 'cal-top';
    const calDay = document.createElement('span');
    calDay.className = 'cal-day';
    calDay.textContent = Number.isFinite(dnum) && dnum > 0 ? String(dnum) : deps.daily.label.slice(-2);
    btn.append(calTop, calDay);
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
          deps.onPlayDaily,
          dailyFactsEl(deps.daily, deps.dailyStats)
        );
        // the lighthouse keeps the log: every past daily, its time and its
        // medals. Secondary to Play — today's mountain stays the headline.
        const log = document.createElement('button');
        log.className = 'big-btn secondary pop-log';
        log.textContent = `📖 ${t('daily.log.open')}`;
        log.onclick = () => {
          deps.click();
          openLogbook();
        };
        card.appendChild(log);
      });
    wrap.appendChild(btn);
  }

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
    closePopover(); // drawer, popover and logbook are mutually exclusive
    closeLogbook();
    if (drawer) {
      closeDrawer();
      return;
    }
    drawer = document.createElement('div');
    drawer.className = 'panel custom-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-label', t('legend.mine'));
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
    x.focus();
  };
  ov.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawer && !pop) closeDrawer();
  });

  // ---- daily logbook ----
  // One row per solved daily — the only place a past day's time, medal and feat
  // pins are readable (the lighthouse itself only ever knows today's seed).
  const logRow = (entry: DailyLogEntry): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'level-card daily-row';
    row.innerHTML = `
      <div class="lv-num cal-mini"></div>
      <div class="lv-name"></div>
      <div class="lv-desc"></div>
      <div class="lv-foot"><div class="lv-status done">${t('status.done')}</div></div>
    `;
    // a tear-off calendar showing THAT day, like the lighthouse pin — a plain 📅
    // emoji always draws a frozen "17", which reads as wrong data on a dated row
    const cal = row.querySelector('.lv-num') as HTMLElement;
    const calTop = document.createElement('span');
    calTop.className = 'cal-top';
    const calDay = document.createElement('span');
    calDay.className = 'cal-day';
    calDay.textContent = entry.label.slice(-2);
    cal.append(calTop, calDay);
    (row.querySelector('.lv-name') as HTMLElement).textContent = entry.label;
    (row.querySelector('.lv-desc') as HTMLElement).textContent =
      `${diffStars(entry.difficulty)} ${diffLabel(entry.difficulty)}`;
    // same best-time line + medal/feat slots the level cards use, so a logged day
    // reads exactly like a level card
    deps.addMedalBits(row, entry.seed, null);
    const actions = document.createElement('div');
    actions.className = 'lv-actions';
    const replay = document.createElement('button');
    replay.className = 'lv-action-btn';
    replay.textContent = '▶';
    replay.title = t('daily.log.replay');
    replay.setAttribute('aria-label', t('daily.log.replay'));
    // the seed is the day, so an old daily regenerates identically — beating the
    // old time updates the same record. The logbook is NOT closed here: booting a
    // level clears the whole overlay anyway, and cancelling the abandon confirm
    // must leave the player where they were (same as the my-levels drawer).
    replay.onclick = () => {
      deps.click();
      deps.onPlayPastDaily(entry);
    };
    actions.appendChild(replay);
    row.appendChild(actions);
    return row;
  };

  let logbook: HTMLElement | null = null;
  const closeLogbook = () => {
    logbook?.remove();
    logbook = null;
  };
  const openLogbook = () => {
    closePopover();
    closeDrawer();
    if (logbook) {
      closeLogbook();
      return;
    }
    logbook = document.createElement('div');
    logbook.className = 'panel custom-drawer daily-drawer';
    logbook.setAttribute('role', 'dialog');
    logbook.setAttribute('aria-label', t('daily.log.title'));

    const head = document.createElement('div');
    head.className = 'drawer-head';
    const h = document.createElement('span');
    h.textContent = `📖 ${t('daily.log.title')}`;
    head.appendChild(h);
    const x = document.createElement('button');
    x.className = 'lv-action-btn drawer-close';
    x.textContent = '✕';
    x.onclick = () => {
      deps.click();
      closeLogbook();
    };
    head.appendChild(x);
    logbook.appendChild(head);

    const stats = document.createElement('div');
    stats.className = 'log-stats';
    const stat = (icon: string, txt: string) => {
      const s = document.createElement('span');
      s.className = 'log-stat';
      s.textContent = `${icon} ${txt}`;
      stats.appendChild(s);
    };
    stat('📅', t('daily.log.solved', { n: deps.dailyStats.solved }));
    stat('🔥', t('daily.log.streak', { n: deps.dailyStats.current }));
    stat('🏆', t('daily.log.longest', { n: deps.dailyStats.longest }));
    logbook.appendChild(stats);

    // the recent-days strip: a gap is a day that was never cleared, which is
    // what makes a broken streak legible (a missed day leaves no record at all)
    const strip = document.createElement('div');
    strip.className = 'log-strip';
    // role=list/listitem: without a role, an aria-label on a plain div is not
    // reliably exposed, and a `title` on a non-interactive span is not announced
    // at all — so each day carries its own label
    strip.setAttribute('role', 'list');
    strip.setAttribute('aria-label', t('daily.log.stripAria', { n: deps.dailyStrip.length }));
    for (const day of deps.dailyStrip) {
      const dot = document.createElement('span');
      dot.className =
        'log-dot' + (day.solved ? ` solved ${day.medal ?? 'none'}` : '') + (day.today ? ' today' : '');
      const label = t(day.today ? 'daily.log.dayToday' : day.solved ? 'daily.log.dayDone' : 'daily.log.dayMissed', {
        label: day.label,
      });
      dot.title = label;
      dot.setAttribute('role', 'listitem');
      dot.setAttribute('aria-label', label);
      dot.textContent = day.label.slice(-2);
      strip.appendChild(dot);
    }
    logbook.appendChild(strip);

    if (!deps.dailyLog.length) {
      const empty = document.createElement('div');
      empty.className = 'drawer-empty';
      empty.textContent = t('daily.log.empty');
      logbook.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'level-grid drawer-grid log-list';
      for (const entry of deps.dailyLog) list.appendChild(logRow(entry));
      logbook.appendChild(list);
    }

    ov.appendChild(logbook);
    x.focus();
  };
  ov.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && logbook && !pop) closeLogbook();
  });

  // ---- legend bar ----
  const legend = document.createElement('div');
  legend.className = 'legend-bar';
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

  // When the map is larger than the viewport (phones pan it), open on the
  // current objective — the pulsing next level, or the fresh daily as a
  // fallback — centred, instead of the map's top-left corner.
  requestAnimationFrame(() => {
    if (!viewport.isConnected) return;
    fit();
    const target =
      (wrap.querySelector('.map-node.next') as HTMLElement | null) ??
      (wrap.querySelector('.map-daily.fresh') as HTMLElement | null);
    if (!target) return;
    const vr = viewport.getBoundingClientRect();
    if (viewport.scrollWidth <= vr.width + 1 && viewport.scrollHeight <= vr.height + 1) return;
    const tr = target.getBoundingClientRect();
    viewport.scrollLeft += tr.left + tr.width / 2 - (vr.left + vr.width / 2);
    viewport.scrollTop += tr.top + tr.height / 2 - (vr.top + vr.height / 2);
  });

  return ov;
}
