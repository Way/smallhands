import {
  BUILD_TIME,
  carCount,
  carWeight,
  dayNightIcon,
  fmtClock,
  fmtTime,
  ITEM_ICON,
  ITEM_TYPES,
  PRODUCER_OUTPUT_CAP,
  RECIPES,
  ROLE_COLORS,
  ROLES,
  TH_LEVELS,
  TOOL_DEFS,
  weatherEffects,
  WX_ICON,
} from './types';
import type {
  Building,
  BuildingKind,
  GroundItem,
  HoistCar,
  ItemType,
  Recipe,
  ResourceNode,
  Role,
  ShortfallRow,
  Tool,
} from './types';
import { drawIconTo } from '../engine/sprites';
import { t, tOr } from '../engine/i18n';
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
  // every trigger in the pill, not just the .island-btn zones: the clock's sky
  // glyph opens the forecast too and is NOT a zone button (card #62). Keying off
  // aria-expanded — which popover() sets on whatever it is handed, in lockstep
  // with .active — is what keeps this honest for the next trigger that isn't an
  // .island-btn either. It must stay this narrow: a blanket `.island .active`
  // would also wipe the speed popover's current-rate highlight.
  document.querySelectorAll('.island [aria-expanded="true"]').forEach((b) => {
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
  onLocate: (item: ItemType) => void;
  onRole: (r: Role, delta: number) => void;
  onUpgrade: () => void;
  onMenu: () => void;
  onRestart: () => void;
  onOptions: () => void;
  onReport: () => void;
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
  private wxEff: HTMLElement | null = null;
  private wxSig = '';
  private objSum: HTMLElement | null = null;
  // the caravan's dock window (LevelDef.convoy) — one live row under the order
  private convoyRow: HTMLElement | null = null;
  private convoySig = '';
  // remaining-count badges for budgeted tools (LevelDef.toolLimit)
  private toolLimits = new Map<Tool, HTMLElement>();
  private toolLimitSig = '';
  private clockEl!: HTMLElement;
  private clockIcEl!: HTMLElement;
  private clockBoxEl!: HTMLElement;
  private clockSig = '';
  private clockIcSig = '';
  private clockTitleSig = '';
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
      row.title = t('hud.findOnMap');
      row.onclick = () => this.cbs.onLocate(o.item);
      this.objRows.set(o.item, { row, cnt });
    }
    // The caravan's dock window, right under the order it feeds — because it
    // gates that order and nothing else (card #70). update() fills it.
    if (this.game.level.convoy) {
      this.convoyRow = el('div', 'convoy-row', obj);
      this.convoyRow.title = t('convoy.title');
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
      // Prefer a short chip label where one is defined (e.g. hoist) — the full
      // name is too wide for the 52px button. The tooltip/confirm bar below
      // still carry the full `tool.<id>.label`.
      label.textContent = tOr(`tool.${def.id}.short`, `tool.${def.id}.label`);
      // A budgeted tool (LevelDef.toolLimit) wears what it has left. The badge is
      // the only place the cap is stated, so it exists from the first frame —
      // a player must never discover a limit by having a drag come up short.
      if (this.game.toolRemaining(def.id) !== null) {
        this.toolLimits.set(def.id, el('span', 'tool-limit', btn));
      }
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
  // its own popover; the clock in the middle is a readout whose sky glyph also
  // triggers the forecast, but only where there is a forecast (card #62).
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

    // centre zone: the diegetic time-of-day clock. It reads the world's hour
    // (game.timeOfDay), NOT the run's score timer — a sky glyph plus the
    // wall-clock hour. Static on most maps (noon by day, night on night maps);
    // the cycle levels advance it live (LevelDef.dayNight).
    const clock = el('div', 'clock', island);
    this.clockBoxEl = clock;
    clock.title = this.clockTitleText();
    this.clockTitleSig = clock.title;

    // ONE sky glyph, never two. The forecast used to own its own island zone
    // with its own ☀️, which duplicated the clock's day glyph pixel-for-pixel
    // whenever the weather was clear — two suns, 10px apart (card #62). So the
    // clock's own icon IS the forecast trigger: a real button on a level with a
    // weather schedule (hover on desktop, tap on touch), a passive span
    // everywhere else, where there is no forecast to open. Its own title
    // shadows the clock box's time-of-day tooltip, so hovering the glyph talks
    // about the sky and hovering the digits about the clock.
    let wxTrigger: HTMLButtonElement | null = null;
    if (this.game.weatherSchedule) {
      wxTrigger = el('button', 'clock-ic wx-trigger', clock);
      wxTrigger.title = t('hud.weather');
      wxTrigger.setAttribute('aria-label', t('hud.weather'));
      this.clockIcEl = wxTrigger;
    } else {
      this.clockIcEl = el('span', 'clock-ic', clock);
    }
    this.clockIcEl.textContent = this.skyIcon();
    this.clockEl = el('span', 'clock-time', clock);
    this.clockEl.textContent = fmtClock(this.game.timeOfDay);

    // right zone: the burger
    const menuTrigger = el('button', 'island-btn menu-trigger', island);
    menuTrigger.textContent = '☰';
    menuTrigger.setAttribute('aria-label', t('hud.menu'));

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
    // Menu ROWS, not the generic .speed-btn chips — a bordered box per entry
    // read as three stacked outlines with no hierarchy. The glyph lives in its
    // own fixed-width slot (never in the label string) so the three labels line
    // up on one edge whatever width the emoji font gives the icon.
    const menuPop = this.popover(menuTrigger, 'menu-pop', true);
    const menuItem = (glyph: string, label: string, cls = ''): HTMLButtonElement => {
      const b = el('button', `menu-item${cls ? ` ${cls}` : ''}`, menuPop);
      const ic = el('span', 'menu-ic', b);
      ic.textContent = glyph;
      ic.setAttribute('aria-hidden', 'true'); // decorative — the label names the action
      el('span', 'menu-label', b).textContent = label;
      return b;
    };
    menuItem('☰', t('menu.levels')).onclick = () => this.cbs.onMenu();
    // restart discards the run in progress: the one row that warns on hover
    menuItem('↺', t('menu.restart'), 'danger').onclick = () => this.cbs.onRestart();
    el('div', 'ctrl-divider', menuPop); // level actions above · settings below
    menuItem('⚙', t('opt.title')).onclick = () => this.cbs.onOptions();
    // In-level only, and deliberately so: the report carries a snapshot of the
    // live map, which means nothing on the front door or the world map.
    menuItem('🐞', t('menu.report'), 'report-open').onclick = () => this.cbs.onReport();

    // ---- weather popover: current phase + countdown, then the next two ----
    // No actions inside (closeOnAction=false); it is purely a readout. The
    // update() loop fills wxNow/wxNext, same as the old right-column panel did.
    if (wxTrigger) {
      const wxPop = this.popover(wxTrigger, 'weather-pop', false);
      const row = el('div', 'wx-row', wxPop);
      this.wxNow = el('div', 'wx-now', row);
      this.wxNext = el('div', 'wx-next', row);
      // What the sky is DOING, spelled out under the countdown (card #70): the
      // forecast used to name the phase and never its consequence, so the rain
      // read as decoration. Generated from WEATHER_RULES via weatherEffects, so
      // the text can never drift from the numbers the sim actually applies.
      this.wxEff = el('div', 'wx-eff', wxPop);
      if (this.game.level.flood) {
        const flood = el('div', 'wx-flood', wxPop);
        flood.title = t('wx.floodTitle');
        flood.textContent = t('wx.flood');
      }
      // hover devices get a tooltip feel: open on enter, close on leave. Touch
      // falls back to the tap-toggle popover() already wired.
      if (this.hoverOk) {
        wxTrigger.onmouseenter = () => this.openPopover(wxPop);
        wxTrigger.onmouseleave = () => this.openPopover(null);
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
    // a budgeted tool states its remaining count in words, next to the badge's
    // bare number — "3 of 8 left", so the number is never ambiguous
    const left = this.game.toolRemaining(def.id);
    if (left !== null) {
      const cap = this.game.level.toolLimit?.[def.id] ?? 0;
      const row = el('div', undefined, tip);
      row.innerHTML = t(left === 0 ? 'tt.limitSpent' : 'tt.limitLeft', { n: left, cap });
      if (left === 0) row.classList.add('insufficient');
    }
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
    el('span', 'res-pop-lbl', row).textContent = t('hud.keep');
    // The whole keep control is ONE row: jump-to-zero · step down · value · step
    // up · jump-to-max. "All"/"Reset" used to sit below as two full-width buttons,
    // which read as the popover's primary actions when they are really just the
    // stepper's end stops (card #68).
    const resetBtn = el('button', 'res-step res-step-end', row);
    resetBtn.textContent = t('hud.keepResetShort');
    resetBtn.title = t('hud.keepReset');
    resetBtn.setAttribute('aria-label', resetBtn.title);
    const minus = el('button', 'res-step', row);
    minus.textContent = '−';
    const val = el('b', 'res-keep-val', row);
    const plus = el('button', 'res-step', row);
    plus.textContent = '+';
    const allBtn = el('button', 'res-step res-step-end', row);
    allBtn.textContent = t('hud.keepAllShort');
    allBtn.title = t('hud.keepAll');
    allBtn.ariaLabel = allBtn.title;
    el('div', 'res-pop-note', pop).textContent = t('hud.keepNote');
    const locateBtn = el('button', 'res-act res-locate', pop);
    icon('icon_pin', 14, locateBtn);
    el('span', undefined, locateBtn).textContent = t('hud.findOnMap');
    locateBtn.onclick = () => {
      this.closeReservePopover();
      this.cbs.onLocate(item);
    };
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
    // The box is width-capped, so its measured width is all it takes to keep the
    // popover of a right-edge chip on screen instead of running off the viewport.
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8))}px`;
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
    this.unpinInspector();
  }

  // Tear down the currently-open interactive tap-panel (producer/hoist/townhall)
  // before opening another. Without this, a second tap/click just appends a new
  // panel box while the old one lingers — the toast cap of 2 alone let two
  // identical panels (e.g. two Sawmill readouts) coexist. Opening now *replaces*
  // rather than *stacks*, so at most one interactive panel is ever visible.
  private closeLivePanel(): void {
    this.livePanel?.box.remove();
    this.livePanel = null;
  }

  // ---- building inspector ---------------------------------------------------
  // One readout, two presentations. HOVER (a desktop pointer over a building in
  // Inspect) floats a cursor-following, non-interactive tooltip. An Inspect
  // CLICK/TAP PINS that same readout open as an interactive panel carrying the
  // controls (pause / upgrade / hoist routing) — this replaces the old docked
  // toast. Both draw from renderBuildingBody() so a building reads identically
  // floated or pinned; the pin re-renders live via update()'s livePanel slot.

  // The building the pinned inspector is open for (null = none) — used to toggle
  // the pin off on a repeat click and to suppress a duplicate hover tooltip over
  // the pinned building.
  private pinnedId: number | null = null;

  // Pin the interactive inspector to a building. Clicking the same building again
  // toggles it closed. Positioned once at the click point (it does not trail the
  // cursor) and kept live by update() through the livePanel slot.
  pinInspector(b: Building, clientX: number, clientY: number): void {
    if (this.pinnedId === b.id) {
      this.unpinInspector();
      return;
    }
    this.closeLivePanel();
    this.hideBuildingHint(); // no floating hover copy behind the pin
    const id = b.id;
    const box = el('div', 'tooltip pinned', this.root);
    const build = (): void => {
      const bd = this.game.buildings.find((x) => x.id === id);
      if (!bd) {
        this.unpinInspector(); // demolished out from under us — tear the pin down
        return;
      }
      box.innerHTML = '';
      this.renderBuildingBody(box, bd, true);
      const close = el('button', 'tt-close', box);
      close.textContent = '✕';
      close.title = t('ui.dismiss');
      close.onclick = () => this.unpinInspector();
    };
    build();
    this.pinnedId = id;
    this.positionPin(box, clientX, clientY);
    this.livePanel = { box, render: build, sig: () => this.inspectSig(id), last: this.inspectSig(id) };
  }

  // Dismiss the pinned inspector, if any.
  unpinInspector(): void {
    this.pinnedId = null;
    this.closeLivePanel();
  }

  // livePanel signature for the pin: 'gone' once the building is demolished (so
  // update() re-runs build(), which tears the pin down), else the same content
  // signature the hover tooltip dedups on — every rendered field.
  private inspectSig(id: number): string {
    const b = this.game.buildings.find((x) => x.id === id);
    return b ? this.buildingHintSig(b) : 'gone';
  }

  // Park the pinned panel at the click point, clamped fully on-screen (it carries
  // buttons, so unlike the hover tip it must not spill off the bottom edge).
  private positionPin(box: HTMLElement, clientX: number, clientY: number): void {
    const w = 260;
    const h = box.offsetHeight || 180;
    box.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, clientX + 14))}px`;
    box.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, clientY + 16))}px`;
    box.style.bottom = 'auto';
  }

  // Hover-to-inspect: a tiny live tooltip for whatever building sits under the
  // cursor in Inspect mode. The town hall keeps its richer, actionable hint
  // (crew + click-to-upgrade); the rest report what they make, move, or need.
  showBuildingHint(b: Building, clientX: number, clientY: number): void {
    // the pinned inspector already shows this building — don't float a copy too
    if (this.pinnedId === b.id) {
      this.hideBuildingHint();
      return;
    }
    const sig = this.buildingHintSig(b);
    const tip = this.ensureHint();
    if (sig !== this.hintSig) {
      this.hintSig = sig;
      tip.innerHTML = '';
      this.renderBuildingBody(tip, b, false);
    }
    this.positionHint(tip, clientX, clientY);
  }

  // Hover/tap-to-inspect for a stranded ground item — explains the warning glyph.
  showStrandedHint(gi: GroundItem, clientX: number, clientY: number): void {
    const sig = ['stranded', gi.id].join('|');
    const tip = this.ensureHint();
    if (sig !== this.hintSig) {
      this.hintSig = sig;
      tip.innerHTML = '';
      el('div', undefined, tip).innerHTML = `<b>${t(`item.${gi.item}`)}</b>`;
      el('div', 'tt-desc', tip).textContent = t('inspect.stranded');
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
      // paused flips both the status text and the pause/resume control label, so
      // the tooltip/pinned panel must re-render on it even when nothing else changes
      parts.push(b.paused ? 'P' : '-');
      // inputs + inbound (needs↔delivering) and outputs (ready↔output-full) all
      // change the status text — include every driver or the open tooltip goes stale
      for (const it of Object.keys(recipe.inputs) as ItemType[]) parts.push(b.inputs[it] ?? 0, b.inbound[it] ?? 0);
      for (const it of Object.keys(recipe.outputs) as ItemType[]) parts.push(b.outputs[it] ?? 0);
    }
    // the storm brake flips the lift's and the rope's status lines too — fold the
    // lock into their signatures or an open readout freezes on the calm text
    if (b.kind === 'lift') parts.push(b.liftBusy ? 'busy' : 'idle', b.y - b.liftTopY, g.wheelsLocked ? 'storm' : '-');
    if (b.kind === 'rope') parts.push(b.ropeBottomY - b.y, g.wheelsLocked ? 'storm' : '-');
    // hoist: car weights, cycle/storm lock, and routing all drive the rendered
    // contents + status + chips — include them or the pinned/hover readout freezes
    if (b.kind === 'hoist')
      parts.push(
        carWeight(b.hoistUpper),
        carWeight(b.hoistLower),
        b.hoistBusy ? 'busy' : '-',
        g.wheelsLocked ? 'storm' : '-',
        ITEM_TYPES.map((i) => (b.hoistSendDown[i] ? 'd' : '') + (b.hoistSendUp[i] ? 'u' : '')).join(',')
      );
    if (b.kind === 'goal') {
      for (const o of g.objectives) parts.push(o.delivered, o.amount);
      // the caravan's dock line counts down inside the readout — per second
      if (g.level.convoy) parts.push(g.convoyOpen ? 'in' : 'out', Math.ceil(g.convoyRemaining));
    }
    return parts.join('|');
  }

  // Shared inspector body — the header plus whatever the building has to show.
  // `interactive` picks the presentation: a pinned panel gets real control
  // buttons (pause / upgrade / hoist routing); the hover tooltip gets a "▸ Click…"
  // hint pointing at them. Everything else (recipe, storage, status) is common.
  private renderBuildingBody(tip: HTMLElement, b: Building, interactive: boolean): void {
    const g = this.game;
    el('div', undefined, tip).innerHTML =
      b.kind === 'townhall' ? t('th.hover', { n: g.thLevel }) : `<b>${t(`building.${b.kind}`)}</b>`;
    if (b.kind === 'townhall') {
      this.renderTownhallBody(tip, interactive);
      return;
    }
    if (b.state === 'blueprint') {
      const need = BUILD_TIME[b.kind] ?? 5;
      el('div', 'tt-desc', tip).textContent = t('inspect.buildingPct', { p: Math.floor((b.progress / need) * 100) });
      return;
    }
    const recipe = RECIPES[b.kind];
    if (recipe) {
      this.renderProducerBody(tip, b, recipe, interactive);
      return;
    }
    if (b.kind === 'hoist') {
      this.renderHoistBody(tip, b, interactive);
      return;
    }
    this.renderMiscBody(tip, b);
  }

  // Producer (sawmill/forge/workshop): recipe, what it is holding right now, live
  // status, and — pinned — the pause/resume toggle.
  private renderProducerBody(tip: HTMLElement, b: Building, recipe: Recipe, interactive: boolean): void {
    const g = this.game;
    this.renderRecipe(tip, recipe);
    this.renderStorage(tip, b, recipe);
    // live status — shares one policy with placement (Game.producerStatus)
    const ps = g.producerStatus(b);
    let status: string;
    switch (ps.kind) {
      case 'paused':
        status = t('inspect.paused');
        break;
      case 'working':
        status = t('inspect.working', { p: Math.floor(ps.progress * 100) });
        break;
      case 'output-full':
        status = t('inspect.idleOutputFull');
        break;
      case 'needs':
        status = t(ps.delivering ? 'inspect.idleDelivering' : 'inspect.idleNeeds', {
          name: t(`item.${ps.item}`),
        });
        break;
      default:
        status = t('inspect.idleReady');
    }
    el('div', 'tt-desc', tip).textContent = status;
    if (b.state !== 'ready') return;
    if (interactive) {
      // the real control — hold the conversion so raw inputs stockpile
      const btn = el('button', 'tt-btn', tip);
      btn.textContent = b.paused ? t('producer.resume') : t('producer.pause');
      btn.onclick = () => {
        g.toggleProducerPause(b.id);
        this.livePanel?.render(); // reflect the flip immediately (label + status)
      };
    } else {
      // hover copy: point at the control, which lives on the pinned panel. Reads
      // "Click…" on desktop / "Tap…" on touch, and flips pause↔resume with state.
      const verb = t(this.hoverOk ? 'producer.verbClick' : 'producer.verbTap');
      const key = b.paused ? 'producer.hintResume' : 'producer.hintPause';
      el('div', 'tt-desc tt-action', tip).textContent = `▸ ${t(key, { verb })}`;
    }
  }

  // The producer's live buffers: raw inputs it is holding (with any inbound haul
  // shown as +n), and the output buffer against its cap — so the player can see
  // how much a Sawmill/Forge is sitting on and how close it is to jamming on a
  // full output. buildingHintSig already tracks inputs/inbound/outputs, so this
  // stays live in both the hover tooltip and the pinned panel.
  private renderStorage(tip: HTMLElement, b: Building, recipe: Recipe): void {
    const wrap = el('div', 'tt-store', tip);
    const inRow = el('div', 'tt-store-row', wrap);
    el('span', 'tt-store-label', inRow).textContent = t('inspect.stored');
    for (const it of Object.keys(recipe.inputs) as ItemType[]) {
      const s = el('span', 'tt-store-item', inRow);
      icon(ITEM_ICON[it], 14, s);
      el('b', undefined, s).textContent = String(b.inputs[it] ?? 0);
      const inb = b.inbound[it] ?? 0;
      if (inb > 0) el('small', 'tt-inbound', s).textContent = `+${inb}`;
    }
    const outRow = el('div', 'tt-store-row', wrap);
    el('span', 'tt-store-label', outRow).textContent = t('inspect.output');
    let outTotal = 0;
    for (const it of Object.keys(recipe.outputs) as ItemType[]) {
      const held = b.outputs[it] ?? 0;
      outTotal += held;
      const s = el('span', 'tt-store-item', outRow);
      icon(ITEM_ICON[it], 14, s);
      el('b', undefined, s).textContent = String(held);
    }
    el('small', 'tt-cap', outRow).textContent = `${outTotal}/${PRODUCER_OUTPUT_CAP}`;
  }

  // Counterweight hoist: the drop it spans, each car's contents + weight, live
  // status, and — pinned — the per-item send-down / send-up routing chips.
  private renderHoistBody(tip: HTMLElement, b: Building, interactive: boolean): void {
    const g = this.game;
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
    else if (g.wheelsLocked) status = t('hoist.stormLocked');
    else if (carCount(b.hoistLower) > 0 && carWeight(b.hoistUpper) <= carWeight(b.hoistLower))
      status = t('hoist.needsBallast');
    else status = t('inspect.idle');
    el('div', 'tt-desc', tip).textContent = status;
    if (interactive) {
      // per-item routing — directions are exclusive per item (toggling one clears
      // the other), so re-render both rows on every change.
      const routeRow = (label: string, car: HoistCar, routes: Partial<Record<ItemType, boolean>>): void => {
        const row = el('div', 'hoist-route-row', tip);
        el('span', 'hoist-route-label', row).textContent = label;
        for (const item of ITEM_TYPES) {
          const chip = el('button', routes[item] ? 'hoist-chip on' : 'hoist-chip', row);
          chip.title = t(`item.${item}`);
          icon(ITEM_ICON[item], 16, chip);
          chip.onclick = () => {
            g.toggleHoistRoute(b.id, car, item);
            this.livePanel?.render();
          };
        }
      };
      routeRow(t('hoist.sendDown'), 'upper', b.hoistSendDown);
      routeRow(t('hoist.sendUp'), 'lower', b.hoistSendUp);
    } else {
      el('div', 'tt-desc', tip).textContent = t('hoist.hint');
    }
  }

  // Town hall: crew, and the upgrade — pinned gets the Upgrade button, hover gets
  // the "Click: upgrade →" hint that points at it.
  private renderTownhallBody(tip: HTMLElement, interactive: boolean): void {
    const g = this.game;
    const lvl = TH_LEVELS[g.thLevel - 1];
    const up = g.thUpgrade;
    el('div', 'tt-desc', tip).textContent = t('th.hoverCrew', { a: g.workers.length, b: g.maxWorkers });
    if (up) {
      el('div', 'tt-desc', tip).textContent = t('hud.upgrading', { p: Math.floor((up.progress / up.time) * 100) });
      return;
    }
    if (!lvl.upgradeCost) {
      el('div', 'tt-desc', tip).textContent = t('th.hoverMax');
      return;
    }
    const nextCrew = TH_LEVELS[g.thLevel].maxWorkers;
    el('div', undefined, tip).textContent = interactive
      ? t('th.upgradeTo', { n: g.thLevel + 1, m: nextCrew })
      : t('th.hoverClick', { n: g.thLevel + 1, m: nextCrew });
    const cost = el('div', 'tt-cost', tip);
    for (const [k, v] of Object.entries(lvl.upgradeCost)) {
      const s = el('span', undefined, cost);
      icon(ITEM_ICON[k as ItemType], 14, s);
      const n = el('b', g.stock[k as ItemType] < (v as number) ? 'insufficient' : '', s);
      n.textContent = String(v);
    }
    if (interactive) {
      const btn = el('button', 'tt-btn', tip);
      btn.textContent = t('th.upgradeShort');
      btn.disabled = !g.canAfford(lvl.upgradeCost);
      btn.onclick = () => {
        this.cbs.onUpgrade();
        this.livePanel?.render();
      };
    }
  }

  // Lift / rope / goal — live readouts, no controls (same in hover and pinned).
  private renderMiscBody(tip: HTMLElement, b: Building): void {
    const g = this.game;
    if (b.kind === 'lift') {
      el('div', 'tt-desc', tip).textContent = t('inspect.lift', { n: b.y - b.liftTopY });
      // the storm brake is the loudest thing that can be true of a lift — say it
      // here too, not only on the hoist, or an idle car in a gale reads as a bug
      el('div', 'tt-desc', tip).textContent = g.wheelsLocked
        ? t('lift.stormLocked')
        : b.liftBusy
          ? t('inspect.carrying')
          : t('inspect.idle');
    } else if (b.kind === 'rope') {
      el('div', 'tt-desc', tip).textContent = t('inspect.rope', { n: b.ropeBottomY - b.y });
      // ropes are gravity, not machinery: the one route a storm cannot stop
      if (g.wheelsLocked) el('div', 'tt-desc', tip).textContent = t('rope.stormFree');
    } else if (b.kind === 'goal') {
      const row = el('div', 'tt-cost', tip);
      for (const o of g.objectives) {
        const s = el('span', o.delivered >= o.amount ? 'delivered' : undefined, row);
        icon(ITEM_ICON[o.item], 14, s);
        el('b', undefined, s).textContent = `${o.delivered}/${o.amount}`;
      }
      if (g.level.convoy) {
        el('div', 'tt-desc', tip).innerHTML = t(g.convoyOpen ? 'convoy.docked' : 'convoy.away', {
          n: Math.max(0, Math.ceil(g.convoyRemaining)),
        });
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

  // The ghost is red because the target is too dark to build (night, no lantern
  // in reach). Reuses the placement-needs tooltip slot, so hidePlacementNeeds
  // clears it just the same.
  showDarkNeed(clientX: number, clientY: number): void {
    if (!this.needs) {
      this.needs = el('div', 'tooltip', this.root);
      this.needsSig = '';
    }
    if (this.needsSig !== 'dark') {
      this.needsSig = 'dark';
      this.needs.innerHTML = '';
      el('div', undefined, this.needs).textContent = t('hud.tooDark');
    }
    this.positionHint(this.needs, clientX, clientY);
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

  // Tooltip for the diegetic clock: the time-of-day help line, plus how long
  // the current level has been running so the player can check elapsed time on
  // demand without a permanent stopwatch cluttering the HUD.
  private clockTitleText(): string {
    return `${t('hud.clockTitle')}\n${t('hud.clockElapsed', { t: fmtTime(this.game.time) })}`;
  }

  // The island's one sky glyph (card #62). An active weather phase wins — the
  // pill should show what the sky is DOING while it rains — but a clear sky, and
  // every level without a schedule, falls back to the day/night glyph, so dusk
  // and night are never traded away for a second sun. The two features are on
  // disjoint levels today; this keeps a future rain-at-dusk level honest.
  private skyIcon(): string {
    const g = this.game;
    if (g.weatherSchedule && g.weather !== 'clear') return WX_ICON[g.weather];
    return dayNightIcon(g.timeOfDay);
  }

  update(): void {
    const g = this.game;
    // runs every frame; the diegetic clock turns over only when the HH:MM (or
    // the sky glyph — day/night, or the live weather phase) actually changes:
    // held constant on a fixed-sky level, live once a day→night cycle advances
    // g.timeOfDay or a weather schedule flips the phase
    const clock = fmtClock(g.timeOfDay);
    if (clock !== this.clockSig) {
      this.clockSig = clock;
      this.clockEl.textContent = clock;
    }
    const clockIc = this.skyIcon();
    if (clockIc !== this.clockIcSig) {
      this.clockIcSig = clockIc;
      this.clockIcEl.textContent = clockIc;
    }
    // the clock's hover tooltip also carries how long this level has been
    // running (g.time, the run's score timer — otherwise off-screen until the
    // win ceremony). fmtTime ticks per second, so redo the attribute only when
    // the whole-second reading changes, not every frame.
    const clockTitle = this.clockTitleText();
    if (clockTitle !== this.clockTitleSig) {
      this.clockTitleSig = clockTitle;
      this.clockBoxEl.title = clockTitle;
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
    // weather strip: current phase + countdown, its effects, then the next two
    if (this.wxNow && g.weatherSchedule) {
      const rem = Math.max(0, Math.ceil(g.weatherRemaining));
      const sig = `${g.weatherIdx}:${rem}`;
      if (sig !== this.wxSig) {
        this.wxSig = sig;
        this.wxNow.innerHTML = `<span class="wx-ic">${WX_ICON[g.weather]}</span><span class="wx-name">${t(`weather.${g.weather}`)}</span><b>${rem}s</b>`;
        const flood = !!g.level.flood;
        const effs = weatherEffects(g.weather, flood);
        if (this.wxEff) {
          this.wxEff.innerHTML = effs
            .map((e) => `<div class="wx-eff-row">${t(`wx.eff.${e.id}`, { p: e.pct ?? 0 })}</div>`)
            .join('');
        }
        // The sky glyph's own tooltip says it too — the forecast is a popover, and
        // a hover over the pill should already answer "why is the crew crawling?".
        // NOTE this is a `.title` DOM property: nothing here is parsed as HTML, so
        // the wx.eff.* strings must be plain text — no tags, no entities. That is
        // not a convention to remember, it is pinned by tests/terminology.mjs.
        this.clockIcEl.title = `${t(`weather.${g.weather}`)} · ${rem}s\n${effs
          .map((e) => t(`wx.eff.${e.id}`, { p: e.pct ?? 0 }))
          .join('\n')}`;
        const sched = g.weatherSchedule;
        let html = `<span class="wx-then">${t('hud.then')}</span>`;
        for (let i = 1; i <= Math.min(2, sched.length - 1); i++) {
          const p = sched[(g.weatherIdx + i) % sched.length];
          // the chip's tooltip carries the same effect list, so a player can read
          // what is COMING and plan the calm window rather than react to it
          const eff = weatherEffects(p.kind, flood)
            .map((e) => t(`wx.eff.${e.id}`, { p: e.pct ?? 0 }))
            .join(' · ');
          html += `<span class="wx-chip" title="${t(`weather.${p.kind}`)} · ${p.duration}s — ${eff}">${WX_ICON[p.kind]}<small>${p.duration}s</small></span>`;
        }
        if (this.wxNext) this.wxNext.innerHTML = html;
      }
    }
    // the caravan's dock window: docked (with the seconds left to load) or away
    if (this.convoyRow) {
      const rem = Math.max(0, Math.ceil(g.convoyRemaining));
      const sig = `${g.convoyOpen ? 'o' : 'c'}:${rem}`;
      if (sig !== this.convoySig) {
        this.convoySig = sig;
        this.convoyRow.classList.toggle('away', !g.convoyOpen);
        this.convoyRow.innerHTML = t(g.convoyOpen ? 'convoy.docked' : 'convoy.away', { n: rem });
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
    // remaining budget on the limited tools — one signature over all of them, so
    // laying a 6-tile bridge repaints the badges once, not six times
    if (this.toolLimits.size > 0) {
      const sig = [...this.toolLimits.keys()].map((id) => g.toolRemaining(id)).join(',');
      if (sig !== this.toolLimitSig) {
        this.toolLimitSig = sig;
        for (const [id, badge] of this.toolLimits) {
          const left = g.toolRemaining(id) ?? 0;
          badge.textContent = String(left);
          this.toolBtns.get(id)?.classList.toggle('spent', left === 0);
        }
      }
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
