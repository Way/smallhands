import {
  BUILD_TIME,
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

const ITEM_ICON: Record<ItemType, string> = {
  log: 'item_log',
  plank: 'item_plank',
  stone: 'item_stone',
  iron: 'item_iron',
  spear: 'item_spear',
};

export const TOOL_ICON: Partial<Record<Tool, string>> = {
  select: 'icon_select',
  harvest: 'icon_harvest',
  ladder: 'tile_ladder',
  platform: 'tile_platform',
  ramp: 'tile_ramp',
  sawmill: 'sawmill',
  forge: 'forge',
  lift: 'lift_car',
  rope: 'rope_anchor',
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

export interface HudCallbacks {
  onTool: (t: Tool) => void;
  onSpeed: (s: number) => void;
  onZoom: (dir: number) => void;
  onRole: (r: Role, delta: number) => void;
  onUpgrade: () => void;
  onMenu: () => void;
  onRestart: () => void;
  onOptions: () => void;
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
  private workerPop!: HTMLElement;
  private upgradeBtn!: HTMLButtonElement;
  private toolBtns = new Map<Tool, HTMLButtonElement>();
  private speedBtns = new Map<number, HTMLButtonElement>();
  private speedTrigger!: HTMLElement;
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
  activeTool: Tool = 'select';

  constructor(root: HTMLElement, game: Game, cbs: HudCallbacks) {
    this.root = root;
    this.game = game;
    this.cbs = cbs;
    root.innerHTML = '';
    this.buildTopBar();
    this.buildToolbar();
    this.buildControlBar();
    this.buildMenuBar();
    this.toastWrap = el('div', 'toast-wrap', root);
    this.update();
  }

  private buildTopBar(): void {
    const bar = el('div', 'topbar', this.root);

    // resources
    const res = el('div', 'panel res-bar', bar);
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

    el('div', 'spacer', bar);

    // objectives
    const obj = el('div', 'panel objectives', bar);
    const h = el('h3', undefined, obj);
    h.innerHTML = `<span>${t('hud.deliver')}</span><span class="lvlname">${t(this.game.level.name)}</span>`;
    for (const o of this.game.objectives) {
      const row = el('div', 'obj-row', obj);
      icon(ITEM_ICON[o.item], 18, row);
      const name = el('span', 'obj-name', row);
      name.textContent = t(`item.${o.item}`);
      const cnt = el('span', 'obj-cnt', row);
      this.objRows.set(o.item, { row, cnt });
    }

    // weather forecast — deterministic, so showing it IS the strategy layer
    if (this.game.weatherSchedule) {
      const wx = el('div', 'panel weather', bar);
      const wh = el('h3', undefined, wx);
      wh.innerHTML =
        `<span>${t('hud.weather')}</span>` +
        (this.game.level.flood
          ? `<span class="wx-flood" title="${t('wx.floodTitle')}">${t('wx.flood')}</span>`
          : '');
      const row = el('div', 'wx-row', wx);
      this.wxNow = el('div', 'wx-now', row);
      this.wxNext = el('div', 'wx-next', row);
    }

    // crew panel
    const crew = el('div', 'panel crew', bar);
    const ch = el('h3', undefined, crew);
    ch.innerHTML = `<span>${t('hud.crew')}</span><span class="pop"></span>`;
    this.workerPop = ch.querySelector('.pop')!;
    for (const r of ROLES) {
      const row = el('div', 'role-row', crew);
      const dot = el('span', 'role-dot', row);
      dot.style.background = ROLE_COLORS[r];
      const name = el('span', 'role-name', row);
      name.textContent = t(`role.${r}`);
      const minus = el('button', 'role-btn', row);
      minus.textContent = '−';
      minus.onclick = () => this.cbs.onRole(r, -1);
      const cnt = el('span', 'role-cnt', row);
      this.roleCnts.set(r, cnt);
      const plus = el('button', 'role-btn', row);
      plus.textContent = '+';
      plus.onclick = () => this.cbs.onRole(r, +1);
    }
    this.upgradeBtn = el('button', 'th-upgrade', crew);
    this.upgradeBtn.onclick = () => this.cbs.onUpgrade();
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
      btn.onmouseenter = (e) => this.showTooltip(def.id, e.currentTarget as HTMLElement);
      btn.onmouseleave = () => this.hideTooltip();
      this.toolBtns.set(def.id, btn);
    }
  }

  // Speed + zoom, merged into one bottom-right flyout. Collapsed on desktop to a
  // single pill showing the current speed; hovering expands the full panel. On
  // touch (no hover) the pill is hidden and the panel stays open — see the
  // `@media (hover: hover)` block in style.css.
  private buildControlBar(): void {
    const bar = el('div', 'ctrlbar flyout', this.root);
    this.speedTrigger = el('div', 'flyout-trigger panel', bar);
    this.speedTrigger.textContent = '1×';
    this.speedTrigger.setAttribute('aria-hidden', 'true');
    const body = el('div', 'flyout-body panel', bar);

    const speedRow = el('div', 'ctrl-row speed-row', body);
    for (const [label, s] of [
      ['⏸', 0],
      ['1×', 1],
      ['2×', 2],
      ['4×', 4],
    ] as const) {
      const btn = el('button', 'speed-btn', speedRow);
      btn.textContent = label;
      btn.onclick = () => this.cbs.onSpeed(s);
      this.speedBtns.set(s, btn);
    }

    el('div', 'ctrl-divider', body);

    const zoomRow = el('div', 'ctrl-row zoom-row', body);
    el('span', 'ctrl-label', zoomRow).textContent = t('hud.zoom');
    for (const [label, dir] of [
      ['−', -1],
      ['+', 1],
    ] as const) {
      const btn = el('button', 'speed-btn', zoomRow);
      btn.textContent = label;
      btn.title = dir > 0 ? 'Zoom in (+)' : 'Zoom out (−)';
      btn.onclick = () => this.cbs.onZoom(dir);
    }
  }

  private buildMenuBar(): void {
    const bar = el('div', 'menubar flyout', this.root);
    const trigger = el('div', 'flyout-trigger panel', bar);
    trigger.textContent = '☰';
    trigger.setAttribute('aria-hidden', 'true');
    const body = el('div', 'flyout-body panel', bar);
    const menu = el('button', 'speed-btn', body);
    menu.textContent = t('menu.levels');
    menu.onclick = () => this.cbs.onMenu();
    const restart = el('button', 'speed-btn', body);
    restart.textContent = t('menu.restart');
    restart.onclick = () => this.cbs.onRestart();
    const opts = el('button', 'speed-btn', body);
    opts.textContent = '⚙';
    opts.title = t('opt.title');
    opts.onclick = () => this.cbs.onOptions();
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
    el('div', 'res-pop-note', pop).textContent = t('hud.keepNote');
    const step = (delta: number): void => {
      g.setKeep(item, g.keep[item] + delta);
      val.textContent = String(g.keep[item]);
      this.refreshKeepBadge(item);
    };
    minus.onclick = () => step(-1);
    plus.onclick = () => step(1);
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

  // Interactive town-hall panel shown when the building is tapped with Select.
  showTownhall(): void {
    const g = this.game;
    const lvl = TH_LEVELS[g.thLevel - 1];
    while (this.toastWrap.children.length >= 2) this.toastWrap.firstChild?.remove();
    const box = el('div', 'toast th-toast', this.toastWrap);
    const build = (): void => {
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
      d.onclick = () => box.remove();
    };
    build();
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
        up ? Math.floor((up.progress / up.time) * 20) : 'x',
        lvl.upgradeCost ? ITEM_TYPES.map((i) => g.stock[i]).join(',') : 'max',
      ].join('|');
    }
    if (b.state === 'blueprint') {
      const need = BUILD_TIME[b.kind] ?? 5;
      return ['bp', b.id, b.kind, Math.floor((b.progress / need) * 20)].join('|');
    }
    const parts: (string | number)[] = ['b', b.id, b.kind];
    const recipe = RECIPES[b.kind];
    if (recipe) {
      parts.push(b.processing ? Math.floor((b.processT / recipe.time) * 20) : 'idle');
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
    for (const [sp, btn] of this.speedBtns) btn.classList.toggle('active', sp === s);
    // keep the collapsed pill in sync — it doubles as a live speed readout
    this.speedTrigger.textContent = s === 0 ? '⏸' : `${s}×`;
    this.speedTrigger.classList.toggle('non-default', s !== 1);
    document.querySelector('.pause-note')?.remove();
    if (s === 0) {
      const note = el('div', 'pause-note', this.root);
      note.textContent = t('hud.paused');
    }
  }

  update(): void {
    const g = this.game;
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
    // weather strip: current phase + countdown, then the next two phases
    if (this.wxNow && g.weatherSchedule) {
      const rem = Math.max(0, Math.ceil(g.weatherRemaining));
      const sig = `${g.weatherIdx}:${rem}`;
      if (sig !== this.wxSig) {
        this.wxSig = sig;
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
      this.roleCnts.get(r)!.textContent = String(g.desiredRoles[r]);
    }
    // upgrade button — only rebuild when the relevant state changes
    const lvl = TH_LEVELS[g.thLevel - 1];
    const sig = g.thUpgrade
      ? `up:${Math.floor((g.thUpgrade.progress / g.thUpgrade.time) * 20)}`
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
  }

  private upgradeSig = '';
}
