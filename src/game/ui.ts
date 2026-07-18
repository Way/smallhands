import {
  BUILD_TIME,
  carCount,
  carWeight,
  fmtTime,
  ITEM_ICON,
  ITEM_TYPES,
  RECIPES,
  ROLE_COLORS,
  ROLES,
  TH_LEVELS,
  TOOL_DEFS,
} from './types';
import type {
  Building,
  BuildingKind,
  HoistCar,
  ItemType,
  Recipe,
  ResourceNode,
  Role,
  ShortfallRow,
  Tool,
  WeatherKind,
} from './types';
import { drawIconTo } from '../engine/sprites';
import { t } from '../engine/i18n';
import type { Game } from './sim';

// DOM-based HUD. Rebuilt per level; light incremental updates each frame.

export const TOOL_ICON: Partial<Record<Tool, string>> = {
  select: 'icon_select',
  harvest: 'icon_harvest',
  ladder: 'tile_ladder',
  platform: 'tile_platform',
  ramp: 'tile_ramp',
  sawmill: 'sawmill',
  forge: 'forge',
  workshop: 'workshop',
  dig: 'icon_dig',
  lift: 'lift_car',
  rope: 'rope_anchor',
  hoist: 'hoist_post',
  lantern: 'lantern',
  demolish: 'icon_demolish',
};

const WX_ICON: Record<WeatherKind, string> = {
  clear: '☀️',
  rain: '🌧️',
  storm: '🌩️',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  parent?: HTMLElement
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

function icon(name: string, size = 20, parent?: HTMLElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  drawIconTo(c, name, size);
  parent?.appendChild(c);
  return c;
}

// Island popover dismissal — anywhere outside, or Escape. Both are DOM-driven
// and deliberately stateless: the Hud is rebuilt per level (and per language
// change), so an instance-bound document listener would pile up one dead
// closure per level. Wired once for the page instead.
function closeIslandPopovers(): void {
  document.querySelectorAll<HTMLElement>('.island-pop:not([hidden])').forEach((p) => (p.hidden = true));
  document.querySelectorAll('.island-btn.active').forEach((b) => {
    b.classList.remove('active');
    b.setAttribute('aria-expanded', 'false');
  });
  document.querySelector('.island')?.classList.remove('pop-open');
}

let islandDismissWired = false;
function wireIslandDismiss(): void {
  if (islandDismissWired) return;
  islandDismissWired = true;
  document.addEventListener('click', () => closeIslandPopovers());
  // capture, so Escape closes an open popover instead of falling through to
  // main.ts's "Escape = back to the select tool"
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !document.querySelector('.island.pop-open')) return;
      e.stopPropagation();
      closeIslandPopovers();
    },
    true,
  );
}

export interface HudCallbacks {
  onTool: (t: Tool) => void;
  onSpeed: (s: number) => void;
  onTogglePause: () => void;
  onZoom: (dir: number) => void;
  onRole: (r: Role, delta: number) => void;
  onUpgrade: () => void;
  onMenu: () => void;
  onRestart: () => void;
  onOptions: () => void;
}

// The touch confirm bar: one glance says what will be placed, what it costs,
// and one big ✓ commits it (see the touch-placement block in main.ts).
export interface ConfirmBarOpts {
  tool: Tool;
  cta: string | null; // ✓ label; null = hint-only mode (no ✓ yet)
  hint: string | null; // "tap to aim" / "tap to extend"
  rows: ShortfallRow[];
  count: { a: number; b: number } | null; // run tools: affordable/total tiles
  confirmDisabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export class Hud {
  root: HTMLElement;
  private game: Game;
  private cbs: HudCallbacks;
  private resCounts = new Map<ItemType, HTMLElement>();
  private resChips = new Map<ItemType, HTMLElement>();
  private lastStock: Record<string, number> = {};
  private objRows = new Map<ItemType, { row: HTMLElement; cnt: HTMLElement }>();
  private roleCnts = new Map<Role, HTMLElement>();
  private roleIdles = new Map<Role, HTMLElement>();
  private roleRows = new Map<Role, HTMLElement>();
  private crewWarn!: HTMLElement;
  private crewWarnText = '';
  private workerPop!: HTMLElement;
  private upgradeBtn!: HTMLButtonElement;
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private speedBtns = new Map<number, HTMLButtonElement>();
  private lastRate = 1; // rate ▶ resumes at; mirrors main.ts's own lastRate
  private speedTrigger!: HTMLElement;
  private island!: HTMLElement;
  private playBtn!: HTMLButtonElement;
  private popovers: { pop: HTMLElement; trigger: HTMLElement }[] = [];
  private toastWrap!: HTMLElement;
  private tooltip: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private hintSig = '';
  private needs: HTMLElement | null = null;
  private needsSig = '';
  private runCost: HTMLElement | null = null;
  private runCostSig = '';
  private keepBadges = new Map<ItemType, HTMLElement>();
  private lastKeep: Record<string, number> = {};
  private reservePop: { item: ItemType; el: HTMLElement; refresh: () => void } | null = null;
  private wxNow: HTMLElement | null = null;
  private wxNext: HTMLElement | null = null;
  private wxSig = '';
  private objSum: HTMLElement | null = null;
  private wxSum: HTMLElement | null = null;
  private clockEl!: HTMLElement;
  private clockSig = '';
  private topbar!: HTMLElement;
  private topbarRight!: HTMLElement;
  private confirmBar: HTMLElement | null = null;
  private confirmSig = '';
  // A tapped-open panel (town hall / hoist) that must track live state. Mobile
  // has no hover hint, so the panel itself is the only readout for the upgrade
  // cost (missing resources) and progress (build time) — update() re-renders it
  // when its signature changes, the same dedup the tooltips use so its buttons
  // don't churn under a thumb. Cleared when the panel is dismissed or evicted.
  private livePanel: { box: HTMLElement; sig: () => string; render: () => void; last: string } | null = null;
  // hover-driven niceties (the toolbar's tooltips) only make sense where a
  // hover pointer exists; touch gets tap-driven equivalents instead
  private readonly hoverOk =
    typeof matchMedia !== 'undefined' && matchMedia('(hover: hover)').matches;
  activeTool: Tool = 'select';

  constructor(root: HTMLElement, game: Game, cbs: HudCallbacks) {
    this.root = root;
    this.game = game;
    this.cbs = cbs;
    root.innerHTML = '';
    this.buildTopBar();
    this.buildToolbar();
    this.buildIsland();
    this.buildZoomBar();
    this.toastWrap = el('div', 'toast-wrap', root);
    this.update();
  }

  private buildTopBar(): void {
    const bar = el('div', 'topbar', this.root);
    this.topbar = bar;

    // The topbar is a three-track grid — [resources] [island] [info panels] —
    // so each cluster owns a column and none can slide under another. The
    // island (buildIsland) drops into the centre track; the info panels go in
    // a right-hand wrapper that wraps its children rather than growing left.

    // left column (left track): resources on top, the delivery objectives right
    // beneath — the "what I have / what I owe" stack, grouped top-left where the
    // eye lands first. The Deliver panel is appended further down.
    const left = el('div', 'topbar-left', bar);
    const res = el('div', 'panel res-bar', left);
    for (const it of ITEM_TYPES) {
      const chip = el('button', 'res-chip', res);
      chip.title = t('hud.chipTitle', { name: t(`item.${it}`) });
      icon(ITEM_ICON[it], 20, chip);
      const cnt = el('span', 'cnt', chip);
      cnt.textContent = '0';
      const badge = el('span', 'keep-badge', chip);
      badge.hidden = true;
      chip.onclick = (e) => {
        e.stopPropagation();
        this.toggleReservePopover(it, chip);
      };
      this.resCounts.set(it, cnt);
      this.resChips.set(it, chip);
      this.keepBadges.set(it, badge);
    }

    // objectives (Deliver) — lives in the LEFT column, directly under the
    // resources, so the stock counts and the goal they feed read as one stack.
    // Weather no longer has its own panel — it lives in the island as an icon
    // beside the clock, its forecast in a hover/tap popover (buildIsland).
    const obj = el('div', 'panel objectives', left);
    const h = el('h3', undefined, obj);
    h.innerHTML = `<span>${t('hud.deliver')}</span><span class="hsum"></span><span class="lvlname">${t(this.game.level.name)}</span>`;
    this.objSum = h.querySelector('.hsum')!;
    for (const o of this.game.objectives) {
      const row = el('div', 'obj-row', obj);
      icon(ITEM_ICON[o.item], 18, row);
      const name = el('span', 'obj-name', row);
      name.textContent = t(`item.${o.item}`);
      const cnt = el('span', 'obj-cnt', row);
      this.objRows.set(o.item, { row, cnt });
    }
    this.collapsible(obj, h);

    // right column (right track): the crew panel — staff roles + Town-Hall
    // upgrade, pinned to the right edge so this control cluster never reflows
    // the resources + objectives stack in the left column.
    const right = el('div', 'topbar-right', bar);
    this.topbarRight = right;

    // crew panel
    const crew = el('div', 'panel crew', right);
    const ch = el('h3', undefined, crew);
    ch.innerHTML = `<span>${t('hud.crew')}</span><span class="pop"></span>`;
    this.workerPop = ch.querySelector('.pop')!;
    this.collapsible(crew, ch);
    for (const r of ROLES) {
      const row = el('div', 'role-row', crew);
      this.roleRows.set(r, row);
      const dot = el('span', 'role-dot', row);
      dot.style.background = ROLE_COLORS[r];
      const name = el('span', 'role-name', row);
      name.textContent = t(`role.${r}`);
      // muted "n idle" readout so the player sees spare hands at a glance
      const idle = el('span', 'role-idle', row);
      this.roleIdles.set(r, idle);
      const minus = el('button', 'role-btn', row);
      minus.textContent = '−';
      minus.onclick = () => this.cbs.onRole(r, -1);
      // actual / desired (e.g. 2/3), not just the target
      const cnt = el('span', 'role-cnt', row);
      this.roleCnts.set(r, cnt);
      const plus = el('button', 'role-btn', row);
      plus.textContent = '+';
      plus.onclick = () => this.cbs.onRole(r, +1);
    }
    // staffing warning: no digger for a painted plan, or no shovel for a digger
    this.crewWarn = el('div', 'crew-warn', crew);
    this.upgradeBtn = el('button', 'th-upgrade', crew);
    this.upgradeBtn.onclick = () => this.cbs.onUpgrade();
  }

  // On narrow/coarse screens the three info panels collapse to their header
  // pill; tapping a header opens that panel (accordion — one at a time). On
  // desktop widths the CSS never collapses them, so the handler is inert.
  private collapsible(panel: HTMLElement, header: HTMLElement): void {
    panel.classList.add('collapsible');
    header.onclick = () => {
      const open = panel.classList.contains('open');
      this.root.querySelectorAll('.topbar .collapsible.open').forEach((p) => p.classList.remove('open'));
      if (!open) panel.classList.add('open');
    };
  }

  private buildToolbar(): void {
    const bar = el('div', 'panel toolbar', this.root);
    for (const def of TOOL_DEFS) {
      if (this.game.level.allowedTools && !this.game.level.allowedTools.includes(def.id)) continue;
      const btn = el('button', 'tool-btn', bar);
      icon(TOOL_ICON[def.id] ?? 'icon_select', 26, btn);
      const key = el('span', 'tool-key', btn);
      key.textContent = def.key;
      const label = el('span', 'tool-label', btn);
      label.textContent = t(`tool.${def.id}.label`);
      btn.onclick = () => this.cbs.onTool(def.id);
      // hover tooltips only where hover exists; on touch the confirm bar
      // carries the tool's name and costs instead
      if (this.hoverOk) {
        btn.onmouseenter = (e) => this.showTooltip(def.id, e.currentTarget as HTMLElement);
        btn.onmouseleave = () => this.hideTooltip();
      }
      this.toolBtns.set(def.id, btn);
    }
  }

  // ---- the island: one pill at top centre, [speed] · [clock] · [☰] ----------
  // Three zones share a single surface (Dynamic-Island style) rather than
  // floating as three separate widgets. Each end zone is a trigger that drops
  // its own popover; the clock in the middle is a passive readout.
  //
  // Popovers are TAP/CLICK toggled on every pointer type — no hover reveal.
  // Hover-to-open made the island twitchy to cross with the mouse (the panels
  // sit right under the resource strip) and left touch on a separate code path,
  // which is exactly where the flyouts used to get stuck open.
  private popover(
    trigger: HTMLButtonElement,
    cls: string,
    closeOnAction: boolean,
  ): HTMLElement {
    const pop = el('div', `island-pop ${cls}`, this.island);
    pop.hidden = true;
    // id and aria-controls are set together — aria-controls is an IDREF, so a
    // class name alone would leave it pointing at nothing. Unique per page:
    // the Hud owns the only island and rebuilds it wholesale.
    pop.id = cls;
    trigger.setAttribute('aria-controls', cls);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.onclick = (e) => {
      e.stopPropagation(); // else the document closer swallows the open
      this.openPopover(pop.hidden ? pop : null);
    };
    // the popover's own clicks must not reach the outside-click closer
    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      // menu actions navigate away — fold the popover behind them. Speed taps
      // repeat, so that popover stays put.
      if (closeOnAction && (e.target as HTMLElement).closest('button')) {
        this.openPopover(null);
      }
    });
    this.popovers.push({ pop, trigger });
    return pop;
  }

  // Single open popover at a time; `null` closes everything.
  private openPopover(open: HTMLElement | null): void {
    closeIslandPopovers();
    this.closeReservePopover(); // one popover on screen at a time
    if (!open) return;
    const pair = this.popovers.find((p) => p.pop === open)!;
    open.hidden = false;
    pair.trigger.classList.add('active');
    pair.trigger.setAttribute('aria-expanded', 'true');
    this.island.classList.add('pop-open');
  }

  private buildIsland(): void {
    // Centre track of the topbar grid, between resources and the info panels.
    // In-flow (not fixed) so its column is reserved and nothing can overlap it;
    // the compact layout floats it back out on its own row.
    const island = el('div', 'panel island');
    this.topbar.insertBefore(island, this.topbarRight);
    this.island = island;

    // left zone: pause + speed
    const speedTrigger = el('button', 'island-btn speed-trigger', island);
    speedTrigger.setAttribute('aria-label', t('hud.speedMenu'));
    this.speedTrigger = speedTrigger;

    // weather zone: current-conditions icon sitting beside the clock. The full
    // forecast (deterministic, so it IS the strategy layer) drops in a popover —
    // hover on desktop, tap on touch. Only levels with a schedule get the zone.
    let weatherTrigger: HTMLButtonElement | null = null;
    if (this.game.weatherSchedule) {
      weatherTrigger = el('button', 'island-btn weather-trigger', island);
      weatherTrigger.title = t('hud.weather');
      weatherTrigger.setAttribute('aria-label', t('hud.weather'));
      this.wxSum = el('span', 'wx-ic', weatherTrigger); // updated with the live icon
    }

    // centre zone: the level clock — reads game time, so it stretches with
    // 2×/4× and holds at ⏸ (and at the win, which freezes the sim clock)
    const clock = el('div', 'clock', island);
    clock.title = t('hud.clockTitle');
    el('span', 'clock-ic', clock).textContent = '⏱';
    this.clockEl = el('span', 'clock-time', clock);
    this.clockEl.textContent = fmtTime(0);

    // right zone: the burger
    const menuTrigger = el('button', 'island-btn menu-trigger', island);
    menuTrigger.textContent = '☰';
    menuTrigger.setAttribute('aria-label', t('menu.levels'));

    // ---- speed popover: play/pause, then the rate ----
    const speedPop = this.popover(speedTrigger, 'speed-pop', false);
    const playRow = el('div', 'ctrl-row', speedPop);
    this.playBtn = el('button', 'play-btn', playRow);
    this.playBtn.onclick = () => this.cbs.onTogglePause();
    el('div', 'ctrl-divider', speedPop);
    const speedRow = el('div', 'ctrl-row speed-row', speedPop);
    el('span', 'ctrl-label', speedRow).textContent = t('hud.speed');
    for (const s of [1, 2, 4] as const) {
      const btn = el('button', 'speed-btn', speedRow);
      btn.textContent = `${s}×`;
      btn.onclick = () => this.cbs.onSpeed(s);
      this.speedBtns.set(s, btn);
    }

    // ---- menu popover: levels / restart / options ----
    const menuPop = this.popover(menuTrigger, 'menu-pop', true);
    const menu = el('button', 'speed-btn', menuPop);
    menu.textContent = t('menu.levels');
    menu.onclick = () => this.cbs.onMenu();
    const restart = el('button', 'speed-btn', menuPop);
    restart.textContent = t('menu.restart');
    restart.onclick = () => this.cbs.onRestart();
    const opts = el('button', 'speed-btn', menuPop);
    opts.textContent = `⚙ ${t('opt.title')}`;
    opts.title = t('opt.title');
    opts.onclick = () => this.cbs.onOptions();

    // ---- weather popover: current phase + countdown, then the next two ----
    // No actions inside (closeOnAction=false); it is purely a readout. The
    // update() loop fills wxNow/wxNext, same as the old right-column panel did.
    if (weatherTrigger) {
      const wxPop = this.popover(weatherTrigger, 'weather-pop', false);
      const row = el('div', 'wx-row', wxPop);
      this.wxNow = el('div', 'wx-now', row);
      this.wxNext = el('div', 'wx-next', row);
      if (this.game.level.flood) {
        const flood = el('div', 'wx-flood', wxPop);
        flood.title = t('wx.floodTitle');
        flood.textContent = t('wx.flood');
      }
      // hover devices get a tooltip feel: open on enter, close on leave. Touch
      // falls back to the tap-toggle popover() already wired.
      if (this.hoverOk) {
        weatherTrigger.onmouseenter = () => this.openPopover(wxPop);
        weatherTrigger.onmouseleave = () => this.openPopover(null);
      }
    }

    wireIslandDismiss();
  }

  // Zoom keeps the bottom-right corner it already had — the Google-Maps spot,
  // and far from the island so a zoom tap never grazes a menu.
  private buildZoomBar(): void {
    const bar = el('div', 'panel zoombar', this.root);
    for (const [label, dir] of [
      ['+', 1],
      ['−', -1],
    ] as const) {
      const btn = el('button', 'zoom-btn', bar);
      btn.textContent = label;
      // the glyph carries no meaning to a screen reader — the label does
      btn.title = t(dir > 0 ? 'hud.zoomIn' : 'hud.zoomOut');
      btn.setAttribute('aria-label', btn.title);
      btn.onclick = () => this.cbs.onZoom(dir);
    }
  }

  private showTooltip(tool: Tool, anchor: HTMLElement): void {
    this.hideTooltip();
    const def = TOOL_DEFS.find((t) => t.id === tool)!;
    const tip = el('div', 'tooltip', this.root);
    const title = el('div', undefined, tip);
    title.innerHTML = `<b>${t(`tool.${def.id}.label`)}</b>`;
    const desc = el('div', 'tt-desc', tip);
    desc.textContent = t(`tool.${def.id}.desc`);
    const recipe = RECIPES[def.id as BuildingKind];
    if (recipe) this.renderRecipe(tip, recipe);
    if (def.thLevel && this.game.thLevel < def.thLevel) {
      const req = el('div', undefined, tip);
      req.innerHTML = `<span class="insufficient">${t('tt.requiresTh', { n: def.thLevel })}</span>`;
    }
    if (def.cost) {
      const cost = el('div', 'tt-cost', tip);
      for (const [k, v] of Object.entries(def.cost)) {
        const s = el('span', undefined, cost);
        icon(ITEM_ICON[k as ItemType], 14, s);
        const n = el('b', this.game.stock[k as ItemType] < (v as number) ? 'insufficient' : '', s);
        n.textContent = String(v);
      }
    }
    const r = anchor.getBoundingClientRect();
    tip.style.left = `${Math.max(8, r.left + r.width / 2 - 100)}px`;
    tip.style.bottom = `${window.innerHeight - r.top + 8}px`;
    this.tooltip = tip;
  }

  private hideTooltip(): void {
    this.tooltip?.remove();
    this.tooltip = null;
  }

  private refreshKeepBadge(item: ItemType): void {
    const n = this.game.keep[item];
    const badge = this.keepBadges.get(item)!;
    badge.hidden = n <= 0;
    if (n > 0) badge.textContent = String(n);
    this.resChips.get(item)!.classList.toggle('has-keep', n > 0);
  }

  private closeReserveOnOutside = (): void => this.closeReservePopover();

  private closeReservePopover(): void {
    if (!this.reservePop) return;
    this.reservePop.el.remove();
    this.reservePop = null;
    document.removeEventListener('click', this.closeReserveOnOutside);
  }

  private toggleReservePopover(item: ItemType, anchor: HTMLElement): void {
    closeIslandPopovers(); // one popover on screen at a time
    if (this.reservePop?.item === item) {
      this.closeReservePopover();
      return;
    }
    this.closeReservePopover();
    const g = this.game;
    const pop = el('div', 'res-pop', this.root);
    pop.onclick = (e) => e.stopPropagation();
    // Build the controls ONCE; refresh() only mutates text in place, so the
    // stepper buttons under the cursor are never torn down mid-click (which
    // would make the browser silently drop the click).
    const nameEl = el('div', 'res-pop-name', pop);
    const row = el('div', 'res-pop-row', pop);
    el('span', undefined, row).textContent = t('hud.keep');
    const minus = el('button', 'res-step', row);
    minus.textContent = '−';
    const val = el('b', 'res-keep-val', row);
    const plus = el('button', 'res-step', row);
    plus.textContent = '+';
    const acts = el('div', 'res-pop-acts', pop);
    const allBtn = el('button', 'res-act', acts);
    allBtn.textContent = t('hud.keepAll');
    const resetBtn = el('button', 'res-act', acts);
    resetBtn.textContent = t('hud.keepReset');
    el('div', 'res-pop-note', pop).textContent = t('hud.keepNote');
    // "All" pins keep at the cap so every unit stays in store (haulers ship
    // nothing); setKeep clamps, so a large value resolves to the max.
    const setKeepTo = (n: number): void => {
      g.setKeep(item, n);
      val.textContent = String(g.keep[item]);
      this.refreshKeepBadge(item);
    };
    minus.onclick = () => setKeepTo(g.keep[item] - 1);
    plus.onclick = () => setKeepTo(g.keep[item] + 1);
    allBtn.onclick = () => setKeepTo(Infinity);
    resetBtn.onclick = () => setKeepTo(0);
    const refresh = (): void => {
      nameEl.textContent = t('hud.inStore', { name: t(`item.${item}`), n: g.stock[item] });
      val.textContent = String(g.keep[item]);
    };
    refresh();
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, r.left)}px`;
    pop.style.top = `${r.bottom + 6}px`;
    this.reservePop = { item, el: pop, refresh };
    setTimeout(() => document.addEventListener('click', this.closeReserveOnOutside), 0);
  }

  toast(html: string, warn = false, autoDismiss = 0): void {
    // keep at most 2 stacked hints
    while (this.toastWrap.children.length >= 2) this.toastWrap.firstChild?.remove();
    const box = el('div', warn ? 'toast warn' : 'toast', this.toastWrap);
    const span = el('span', undefined, box);
    span.innerHTML = html;
    const d = el('span', 'dismiss', box);
    d.textContent = t('ui.dismiss');
    d.onclick = () => box.remove();
    if (autoDismiss > 0) setTimeout(() => box.remove(), autoDismiss * 1000);
  }

  // Drop every stacked toast/panel at once — used when the game screen hands
  // over to a full-screen overlay (world map) that the toasts would float over.
  clearToasts(): void {
    this.toastWrap.innerHTML = '';
    this.livePanel = null;
  }

  // Interactive hoist panel shown when a hoist is tapped with Select: live car
  // weights plus per-item routing toggles (send down / send up — exclusive).
  showHoist(id: number): void {
    const g = this.game;
    while (this.toastWrap.children.length >= 2) this.toastWrap.firstChild?.remove();
    const box = el('div', 'toast th-toast', this.toastWrap);
    const build = (): void => {
      const b = g.buildings.find((bd) => bd.id === id && bd.kind === 'hoist');
      if (!b) {
        box.remove();
        return;
      }
      box.innerHTML = '';
      const head = el('div', undefined, box);
      head.innerHTML = `<b>${t('tool.hoist.label')}</b>`;
      const cars = el('div', 'th-toast-body', box);
      cars.textContent =
        `${t('hoist.top')}: ${t('hoist.weight', { n: carWeight(b.hoistUpper) })} · ` +
        `${t('hoist.bottom')}: ${t('hoist.weight', { n: carWeight(b.hoistLower) })}`;
      const routeRow = (label: string, car: HoistCar, routes: Partial<Record<ItemType, boolean>>): void => {
        const row = el('div', 'hoist-route-row', box);
        el('span', 'hoist-route-label', row).textContent = label;
        for (const item of ITEM_TYPES) {
          const chip = el('button', routes[item] ? 'hoist-chip on' : 'hoist-chip', row);
          chip.title = t(`item.${item}`);
          icon(ITEM_ICON[item], 16, chip);
          chip.onclick = () => {
            g.toggleHoistRoute(id, car, item);
            build(); // re-render both rows (directions are exclusive per item)
          };
        }
      };
      routeRow(t('hoist.sendDown'), 'upper', b.hoistSendDown);
      routeRow(t('hoist.sendUp'), 'lower', b.hoistSendUp);
      const d = el('span', 'dismiss', box);
      d.textContent = t('ui.dismiss');
      d.onclick = () => {
        this.livePanel = null;
        box.remove();
      };
    };
    build();
    this.livePanel = { box, render: build, sig: () => this.hoistSig(id), last: this.hoistSig(id) };
  }

  // Signature for the tapped-open hoist panel: car weights and per-item routing.
  // Cargo shifting between cars must keep the readout live; 'gone' lets update()
  // notice a demolished hoist and let build() tear the panel down.
  private hoistSig(id: number): string {
    const b = this.game.buildings.find((bd) => bd.id === id && bd.kind === 'hoist');
    if (!b) return 'gone';
    return [
      'h',
      carWeight(b.hoistUpper),
      carWeight(b.hoistLower),
      ITEM_TYPES.map((i) => (b.hoistSendDown[i] ? 'd' : '') + (b.hoistSendUp[i] ? 'u' : '')).join(','),
    ].join('|');
  }

  // Interactive town-hall panel shown when the building is tapped with Select.
  showTownhall(): void {
    const g = this.game;
    while (this.toastWrap.children.length >= 2) this.toastWrap.firstChild?.remove();
    const box = el('div', 'toast th-toast', this.toastWrap);
    const build = (): void => {
      // recomputed each render: an upgrade completing while the panel is open
      // bumps thLevel, and the cost/crew must follow it, not the opening snapshot
      const lvl = TH_LEVELS[g.thLevel - 1];
      box.innerHTML = '';
      const head = el('div', undefined, box);
      head.innerHTML = t('th.status', { n: g.thLevel, a: g.workers.length, b: g.maxWorkers });
      if (g.thUpgrade) {
        el('div', 'th-toast-body', box).textContent = t('th.upgradingBody', {
          p: Math.floor((g.thUpgrade.progress / g.thUpgrade.time) * 100),
        });
      } else if (!lvl.upgradeCost) {
        el('div', 'th-toast-body', box).textContent = t('th.maxBody');
      } else {
        el('div', 'th-toast-body', box).textContent = t('th.upgradeTo', {
          n: g.thLevel + 1,
          m: TH_LEVELS[g.thLevel].maxWorkers,
        });
        const cost = el('div', 'th-toast-cost', box);
        for (const [k, v] of Object.entries(lvl.upgradeCost)) {
          const s = el('span', 'cost-item', cost);
          icon(ITEM_ICON[k as ItemType], 16, s);
          const n = el('b', g.stock[k as ItemType] < (v as number) ? 'insufficient' : '', s);
          n.textContent = String(v);
        }
        const btn = el('button', 'th-mini', box);
        btn.textContent = t('th.upgradeShort');
        btn.disabled = !g.canAfford(lvl.upgradeCost);
        btn.onclick = () => {
          this.cbs.onUpgrade();
          build(); // re-render to reflect the in-progress state
        };
      }
      const d = el('span', 'dismiss', box);
      d.textContent = t('ui.dismiss');
      d.onclick = () => {
        this.livePanel = null;
        box.remove();
      };
    };
    build();
    this.livePanel = { box, render: build, sig: () => this.townhallSig(), last: this.townhallSig() };
  }

  // Signature for the tapped-open town-hall panel — everything it renders, so
  // update() rebuilds only when it actually changes: level/crew, upgrade
  // progress (1% steps for a smooth "build time"), and stock (missing resources).
  private townhallSig(): string {
    const g = this.game;
    const lvl = TH_LEVELS[g.thLevel - 1];
    return [
      g.thLevel,
      g.workers.length,
      g.maxWorkers,
      g.thUpgrade ? Math.floor((g.thUpgrade.progress / g.thUpgrade.time) * 100) : 'x',
      lvl.upgradeCost ? ITEM_TYPES.map((i) => g.stock[i]).join(',') : 'max',
    ].join('|');
  }

  // Hover-to-inspect: a tiny live tooltip for whatever building sits under the
  // cursor in Inspect mode. The town hall keeps its richer, actionable hint
  // (crew + click-to-upgrade); the rest report what they make, move, or need.
  showBuildingHint(b: Building, clientX: number, clientY: number): void {
    const g = this.game;
    const sig = this.buildingHintSig(b);
    const tip = this.ensureHint();
    if (sig !== this.hintSig) {
      this.hintSig = sig;
      tip.innerHTML = '';
      el('div', undefined, tip).innerHTML =
        b.kind === 'townhall' ? t('th.hover', { n: g.thLevel }) : `<b>${t(`building.${b.kind}`)}</b>`;
      if (b.kind === 'townhall') this.fillTownhallHint(tip);
      else if (b.state === 'blueprint') {
        const need = BUILD_TIME[b.kind] ?? 5;
        el('div', 'tt-desc', tip).textContent = t('inspect.buildingPct', { p: Math.floor((b.progress / need) * 100) });
      } else this.fillBuildingHint(tip, b);
    }
    this.positionHint(tip, clientX, clientY);
  }

  // Hover-to-inspect for resource nodes — the same info the tap used to give.
  showNodeHint(n: ResourceNode, clientX: number, clientY: number): void {
    const sig = ['n', n.id, n.yieldLeft, n.marked ? 1 : 0].join('|');
    const tip = this.ensureHint();
    if (sig !== this.hintSig) {
      this.hintSig = sig;
      tip.innerHTML = '';
      el('div', undefined, tip).innerHTML = `<b>${t(`node.${n.kind}`)}</b>`;
      el('div', 'tt-desc', tip).textContent = t('inspect.yieldLeft', { n: n.yieldLeft });
      el('div', 'tt-desc', tip).textContent = n.marked ? t('inspect.marked') : t('inspect.unmarked');
    }
    this.positionHint(tip, clientX, clientY);
  }

  private ensureHint(): HTMLElement {
    if (!this.hint) {
      this.hint = el('div', 'tooltip', this.root);
      this.hintSig = '';
    }
    return this.hint;
  }

  // Cursor-following, clamped to stay on screen. Shared by the inspect hints.
  private positionHint(tip: HTMLElement, clientX: number, clientY: number): void {
    tip.style.left = `${Math.min(window.innerWidth - 240, clientX + 14)}px`;
    tip.style.top = `${clientY + 16}px`;
    tip.style.bottom = 'auto';
  }

  private buildingHintSig(b: Building): string {
    const g = this.game;
    if (b.kind === 'townhall') {
      const lvl = TH_LEVELS[g.thLevel - 1];
      const up = g.thUpgrade;
      return [
        'th',
        g.thLevel,
        g.workers.length,
        g.maxWorkers,
        // quantize to whole percent — the tooltip renders %, so match it or the
        // number visibly ticks in coarse 5% jumps (× 20) instead of counting up
        up ? Math.floor((up.progress / up.time) * 100) : 'x',
        lvl.upgradeCost ? ITEM_TYPES.map((i) => g.stock[i]).join(',') : 'max',
      ].join('|');
    }
    if (b.state === 'blueprint') {
      const need = BUILD_TIME[b.kind] ?? 5;
      return ['bp', b.id, b.kind, Math.floor((b.progress / need) * 100)].join('|');
    }
    const parts: (string | number)[] = ['b', b.id, b.kind];
    const recipe = RECIPES[b.kind];
    if (recipe) {
      parts.push(b.processing ? Math.floor((b.processT / recipe.time) * 100) : 'idle');
      for (const it of Object.keys(recipe.inputs) as ItemType[]) parts.push(b.inputs[it] ?? 0);
    }
    if (b.kind === 'lift') parts.push(b.liftBusy ? 'busy' : 'idle', b.y - b.liftTopY);
    if (b.kind === 'rope') parts.push(b.ropeBottomY - b.y);
    if (b.kind === 'goal') for (const o of g.objectives) parts.push(o.delivered, o.amount);
    return parts.join('|');
  }

  private fillTownhallHint(tip: HTMLElement): void {
    const g = this.game;
    const lvl = TH_LEVELS[g.thLevel - 1];
    const up = g.thUpgrade;
    el('div', 'tt-desc', tip).textContent = t('th.hoverCrew', { a: g.workers.length, b: g.maxWorkers });
    if (up) {
      el('div', 'tt-desc', tip).textContent = t('hud.upgrading', { p: Math.floor((up.progress / up.time) * 100) });
    } else if (lvl.upgradeCost) {
      el('div', undefined, tip).textContent = t('th.hoverClick', {
        n: g.thLevel + 1,
        m: TH_LEVELS[g.thLevel].maxWorkers,
      });
      const cost = el('div', 'tt-cost', tip);
      for (const [k, v] of Object.entries(lvl.upgradeCost)) {
        const s = el('span', undefined, cost);
        icon(ITEM_ICON[k as ItemType], 14, s);
        const n = el('b', g.stock[k as ItemType] < (v as number) ? 'insufficient' : '', s);
        n.textContent = String(v);
      }
    } else {
      el('div', 'tt-desc', tip).textContent = t('th.hoverMax');
    }
  }

  private fillBuildingHint(tip: HTMLElement, b: Building): void {
    const g = this.game;
    const recipe = RECIPES[b.kind];
    if (recipe) {
      this.renderRecipe(tip, recipe);
      // live status
      let status: string;
      if (b.processing) status = t('inspect.working', { p: Math.floor((b.processT / recipe.time) * 100) });
      else {
        const missing = (Object.keys(recipe.inputs) as ItemType[]).find(
          (it) => (b.inputs[it] ?? 0) < (recipe.inputs[it] as number)
        );
        status = missing ? t('inspect.idleNeeds', { name: t(`item.${missing}`) }) : t('inspect.idleReady');
      }
      el('div', 'tt-desc', tip).textContent = status;
    } else if (b.kind === 'lift') {
      el('div', 'tt-desc', tip).textContent = t('inspect.lift', { n: b.y - b.liftTopY });
      el('div', 'tt-desc', tip).textContent = b.liftBusy ? t('inspect.carrying') : t('inspect.idle');
    } else if (b.kind === 'rope') {
      el('div', 'tt-desc', tip).textContent = t('inspect.rope', { n: b.ropeBottomY - b.y });
    } else if (b.kind === 'hoist') {
      el('div', 'tt-desc', tip).textContent = t('inspect.hoist', { n: b.ropeBottomY - b.y });
      const carRow = (label: string, contents: Partial<Record<ItemType, number>>): void => {
        const row = el('div', 'tt-cost', tip);
        el('span', undefined, row).textContent = `${label} ·`;
        let any = false;
        for (const [k, v] of Object.entries(contents)) {
          if (!v) continue;
          any = true;
          const s = el('span', undefined, row);
          icon(ITEM_ICON[k as ItemType], 14, s);
          el('b', undefined, s).textContent = String(v);
        }
        el('span', undefined, row).textContent = `(${t('hoist.weight', { n: carWeight(contents) })})`;
        if (!any) row.classList.add('hoist-empty');
      };
      carRow(t('hoist.top'), b.hoistUpper);
      carRow(t('hoist.bottom'), b.hoistLower);
      let status: string;
      if (b.hoistBusy) status = t('hoist.cycling');
      else if (this.game.weather === 'storm') status = t('hoist.stormLocked');
      else if (carCount(b.hoistLower) > 0 && carWeight(b.hoistUpper) <= carWeight(b.hoistLower))
        status = t('hoist.needsBallast');
      else status = t('inspect.idle');
      el('div', 'tt-desc', tip).textContent = status;
      el('div', 'tt-desc', tip).textContent = t('hoist.hint');
    } else if (b.kind === 'goal') {
      const row = el('div', 'tt-cost', tip);
      for (const o of g.objectives) {
        const s = el('span', o.delivered >= o.amount ? 'delivered' : undefined, row);
        icon(ITEM_ICON[o.item], 14, s);
        el('b', undefined, s).textContent = `${o.delivered}/${o.amount}`;
      }
    }
  }

  // Shared "Uses → Makes · ⏱ Ns per batch" recipe block, used by both the
  // toolbar tooltip and the inspect hint so producers read the same everywhere.
  private renderRecipe(tip: HTMLElement, recipe: Recipe): void {
    const rec = el('div', 'tt-recipe', tip);
    const side = (label: string, items: Partial<Record<ItemType, number>>): void => {
      const col = el('div', 'tt-side', rec);
      el('div', 'tt-side-label', col).textContent = label;
      const row = el('div', 'tt-side-items', col);
      for (const [k, v] of Object.entries(items)) {
        const s = el('span', undefined, row);
        icon(ITEM_ICON[k as ItemType], 14, s);
        el('b', undefined, s).textContent = String(v);
      }
    };
    side(t('tt.uses'), recipe.inputs);
    el('div', 'tt-arrow', rec).textContent = '→';
    side(t('tt.makes'), recipe.outputs);
    el('div', 'tt-time', tip).textContent = t('tt.perBatch', { n: recipe.time });
  }

  hideBuildingHint(): void {
    this.hint?.remove();
    this.hint = null;
    this.hintSig = '';
  }

  // While a cost-bearing tool is held and you hover the map, show WHY the ghost
  // is red: the tool's required resources, with the missing ones in red. Nothing
  // to show when you can afford it — the green outline already says "go".
  showPlacementNeeds(clientX: number, clientY: number, tool: Tool): void {
    const rows = this.game.placementShortfall(tool);
    if (rows.length === 0) {
      this.hidePlacementNeeds();
      return;
    }
    const label = t(`tool.${tool}.label`);
    const sig = tool + rows.map((r) => `|${r.item}:${r.have}/${r.need}:${r.short ? 1 : 0}`).join('');
    if (!this.needs) {
      this.needs = el('div', 'tooltip', this.root);
      this.needsSig = '';
    }
    const tip = this.needs;
    if (sig !== this.needsSig) {
      this.needsSig = sig;
      tip.innerHTML = '';
      el('div', undefined, tip).innerHTML = t('hud.needs', { label });
      const cost = el('div', 'tt-cost', tip);
      for (const r of rows) {
        const s = el('span', undefined, cost);
        icon(ITEM_ICON[r.item], 14, s);
        el('b', r.short ? 'insufficient' : '', s).textContent = `${r.have}/${r.need}`;
      }
    }
    this.positionHint(tip, clientX, clientY);
  }

  hidePlacementNeeds(): void {
    this.needs?.remove();
    this.needs = null;
    this.needsSig = '';
  }

  // While dragging a build-run (Ladder/Ramp/Bridge), show the run's running
  // total cost at the cursor. Unlike the shortfall badge this ALWAYS shows during
  // a drag (the point is the total); a resource the full run can't afford flips
  // to a red have/need. `rows` come straight from Game.runPlan.
  showRunCost(clientX: number, clientY: number, rows: ShortfallRow[], tool: Tool): void {
    if (rows.length === 0) {
      this.hideRunCost();
      return;
    }
    const label = t(`tool.${tool}.label`);
    const sig = tool + rows.map((r) => `|${r.item}:${r.have}/${r.need}:${r.short ? 1 : 0}`).join('');
    if (!this.runCost) {
      this.runCost = el('div', 'tooltip', this.root);
      this.runCostSig = '';
    }
    const tip = this.runCost;
    if (sig !== this.runCostSig) {
      this.runCostSig = sig;
      tip.innerHTML = '';
      el('div', undefined, tip).innerHTML = `<b>${label}</b>`;
      const cost = el('div', 'tt-cost', tip);
      for (const r of rows) {
        const s = el('span', undefined, cost);
        icon(ITEM_ICON[r.item], 14, s);
        // affordable: just the total; short: red have/need (same as the badge)
        el('b', r.short ? 'insufficient' : '', s).textContent = r.short ? `${r.have}/${r.need}` : `${r.need}`;
      }
    }
    // follow the cursor, clamped to stay on screen (same as showPlacementNeeds)
    tip.style.left = `${Math.min(window.innerWidth - 240, clientX + 14)}px`;
    tip.style.top = `${clientY + 16}px`;
    tip.style.bottom = 'auto';
  }

  hideRunCost(): void {
    this.runCost?.remove();
    this.runCost = null;
    this.runCostSig = '';
  }

  // The touch confirm bar: tool + costs on the left, ✕ and a big ✓ CTA on the
  // right. Callers refresh it every frame; the DOM rebuilds only when the
  // signature changes, so the buttons under a hovering thumb never churn.
  showConfirmBar(opts: ConfirmBarOpts): void {
    const sig = [
      opts.tool,
      opts.cta ?? '',
      opts.hint ?? '',
      opts.confirmDisabled ? 1 : 0,
      opts.count ? `${opts.count.a}/${opts.count.b}` : '',
      ...opts.rows.map((r) => `${r.item}:${r.have}/${r.need}:${r.short ? 1 : 0}`),
    ].join('|');
    if (!this.confirmBar) {
      this.confirmBar = el('div', 'confirm-bar panel', this.root);
      this.confirmSig = '';
    }
    if (sig === this.confirmSig) return;
    this.confirmSig = sig;
    const bar = this.confirmBar;
    bar.innerHTML = '';

    const info = el('div', 'cb-info', bar);
    const head = el('div', 'cb-tool', info);
    icon(TOOL_ICON[opts.tool] ?? 'icon_select', 22, head);
    el('span', 'cb-name', head).textContent = t(`tool.${opts.tool}.label`);
    if (opts.count) {
      const cnt = el('span', 'cb-count' + (opts.count.a < opts.count.b ? ' short' : ''), head);
      cnt.textContent = t('hud.tiles', { a: opts.count.a, b: opts.count.b });
    }
    if (opts.rows.length) {
      const cost = el('div', 'cb-cost', head);
      for (const r of opts.rows) {
        const s = el('span', undefined, cost);
        icon(ITEM_ICON[r.item], 16, s);
        el('b', r.short ? 'insufficient' : '', s).textContent = r.short ? `${r.have}/${r.need}` : `${r.need}`;
      }
    }
    if (opts.hint) el('div', 'cb-hint', info).textContent = opts.hint;

    const cancel = el('button', 'cb-btn cb-cancel', bar);
    cancel.textContent = '✕';
    cancel.setAttribute('aria-label', t('btn.cancel'));
    cancel.onclick = opts.onCancel;
    if (opts.cta) {
      const ok = el('button', 'cb-btn cb-confirm', bar);
      ok.textContent = `✓ ${opts.cta}`;
      ok.disabled = opts.confirmDisabled;
      ok.onclick = opts.onConfirm;
    }
  }

  hideConfirmBar(): void {
    this.confirmBar?.remove();
    this.confirmBar = null;
    this.confirmSig = '';
  }

  flashResource(item: ItemType): void {
    const chip = this.resChips.get(item);
    if (!chip) return;
    chip.classList.remove('flash');
    void (chip as HTMLElement).offsetWidth; // restart animation
    chip.classList.add('flash');
  }

  setActiveTool(t: Tool): void {
    this.activeTool = t;
    for (const [id, btn] of this.toolBtns) btn.classList.toggle('active', id === t);
    this.hidePlacementNeeds(); // stale badge from the previous tool; re-shows on next hover
  }

  setSpeed(s: number): void {
    // the rate stays lit while paused: ⏸ then ▶ resumes at that rate, so the
    // buttons show what you'd get back, not a rate nothing is running at
    for (const [sp, btn] of this.speedBtns) btn.classList.toggle('active', sp === s || (s === 0 && sp === this.lastRate));
    if (s > 0) this.lastRate = s;
    // the island's left zone doubles as the live speed readout
    this.speedTrigger.textContent = s === 0 ? '⏸' : `${s}×`;
    this.speedTrigger.classList.toggle('paused', s === 0);
    this.speedTrigger.classList.toggle('non-default', s !== 1);
    this.playBtn.textContent = s === 0 ? `▶ ${t('hud.resume')}` : `⏸ ${t('hud.pause')}`;
    document.querySelector('.pause-note')?.remove();
    if (s === 0) {
      const note = el('div', 'pause-note', this.root);
      note.textContent = t('hud.paused');
    }
  }

  update(): void {
    const g = this.game;
    // runs every frame, but the rendered M:SS only turns over once a second
    const clock = fmtTime(g.time);
    if (clock !== this.clockSig) {
      this.clockSig = clock;
      this.clockEl.textContent = clock;
    }
    for (const it of ITEM_TYPES) {
      const n = g.stock[it];
      const elc = this.resCounts.get(it)!;
      if (this.lastStock[it] !== n) {
        elc.textContent = String(n);
        this.lastStock[it] = n;
      }
    }
    for (const it of ITEM_TYPES) {
      if (this.lastKeep[it] !== g.keep[it]) {
        this.lastKeep[it] = g.keep[it];
        this.refreshKeepBadge(it);
      }
    }
    this.reservePop?.refresh();
    for (const o of g.objectives) {
      const r = this.objRows.get(o.item);
      if (!r) continue;
      r.cnt.textContent = `${o.delivered}/${o.amount}`;
      r.row.classList.toggle('done', o.delivered >= o.amount);
    }
    // collapsed-pill summary: total delivered / total ordered at a glance
    if (this.objSum) {
      const tot = g.objectives.reduce(
        (a, o) => ({ d: a.d + Math.min(o.delivered, o.amount), n: a.n + o.amount }),
        { d: 0, n: 0 }
      );
      const s = `${tot.d}/${tot.n}`;
      if (this.objSum.textContent !== s) this.objSum.textContent = s;
    }
    // weather strip: current phase + countdown, then the next two phases
    if (this.wxNow && g.weatherSchedule) {
      const rem = Math.max(0, Math.ceil(g.weatherRemaining));
      const sig = `${g.weatherIdx}:${rem}`;
      if (sig !== this.wxSig) {
        this.wxSig = sig;
        if (this.wxSum) this.wxSum.textContent = WX_ICON[g.weather]; // island icon
        this.wxNow.innerHTML = `<span class="wx-ic">${WX_ICON[g.weather]}</span><span class="wx-name">${t(`weather.${g.weather}`)}</span><b>${rem}s</b>`;
        const sched = g.weatherSchedule;
        let html = `<span class="wx-then">${t('hud.then')}</span>`;
        for (let i = 1; i <= Math.min(2, sched.length - 1); i++) {
          const p = sched[(g.weatherIdx + i) % sched.length];
          html += `<span class="wx-chip" title="${t(`weather.${p.kind}`)} · ${p.duration}s">${WX_ICON[p.kind]}<small>${p.duration}s</small></span>`;
        }
        if (this.wxNext) this.wxNext.innerHTML = html;
      }
    }
    this.workerPop.textContent = `${g.workers.length}/${g.maxWorkers}`;
    for (const r of ROLES) {
      const actual = g.roleCount(r);
      this.roleCnts.get(r)!.textContent = `${actual}/${g.desiredRoles[r]}`;
      const idle = g.roleIdle(r);
      this.roleIdles.get(r)!.textContent = idle > 0 ? t('crew.idle', { n: idle }) : '';
      // the Digger row only exists once the Workshop does — Town Hall level 2
      if (r === 'digger') this.roleRows.get(r)!.classList.toggle('gated', g.thLevel < 2);
    }
    // one staffing warning, most urgent first: a dig plan with nobody to dig it,
    // then diggers wanted but no shovel in the store to equip them
    let warn = '';
    if (g.digOrders.size > 0 && g.roleCount('digger') === 0) warn = t('crew.needDigger');
    else if (g.desiredRoles.digger > g.equippedDiggers() && g.stock.shovel <= 0) warn = t('crew.needShovel');
    if (warn !== this.crewWarnText) {
      this.crewWarnText = warn;
      this.crewWarn.textContent = warn;
    }
    // upgrade button — only rebuild when the relevant state changes
    const lvl = TH_LEVELS[g.thLevel - 1];
    const sig = g.thUpgrade
      ? `up:${Math.floor((g.thUpgrade.progress / g.thUpgrade.time) * 100)}` // whole percent — the label counts in 1% steps
      : `lv:${g.thLevel}:${ITEM_TYPES.map((i) => g.stock[i]).join(',')}`;
    if (sig !== this.upgradeSig) {
      this.upgradeSig = sig;
      if (g.thUpgrade) {
        this.upgradeBtn.disabled = true;
        this.upgradeBtn.textContent = t('hud.upgrading', { p: Math.floor((g.thUpgrade.progress / g.thUpgrade.time) * 100) });
      } else if (!lvl.upgradeCost) {
        this.upgradeBtn.disabled = true;
        this.upgradeBtn.textContent = t('hud.thMax', { n: g.thLevel });
      } else {
        this.upgradeBtn.innerHTML = '';
        const label = el('span', undefined, this.upgradeBtn);
        label.textContent = t('hud.upgradeBtn', { n: g.thLevel + 1 });
        for (const [k, v] of Object.entries(lvl.upgradeCost)) {
          const s = el('span', 'cost-item', this.upgradeBtn);
          icon(ITEM_ICON[k as ItemType], 16, s);
          const n = el('b', g.stock[k as ItemType] < (v as number) ? 'insufficient' : '', s);
          n.textContent = String(v);
        }
        this.upgradeBtn.disabled = !g.canAfford(lvl.upgradeCost);
      }
    }
    // lock indicators on tool buttons
    for (const [id, btn] of this.toolBtns) {
      btn.classList.toggle('locked', !g.toolUnlocked(id));
    }
    // a tapped-open panel (town hall / hoist) tracks live state here — it's
    // mobile's only readout, with no hover hint behind it. Drop the reference
    // once the panel leaves the DOM (dismissed, evicted, or level torn down).
    if (this.livePanel) {
      if (!this.livePanel.box.isConnected) {
        this.livePanel = null;
      } else {
        const sig = this.livePanel.sig();
        if (sig !== this.livePanel.last) {
          this.livePanel.last = sig;
          this.livePanel.render();
        }
      }
    }
  }

  private upgradeSig = '';
}
