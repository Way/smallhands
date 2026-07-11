import {
  ITEM_NAMES,
  ITEM_TYPES,
  RECIPES,
  ROLE_COLORS,
  ROLE_NAMES,
  ROLES,
  TH_LEVELS,
  TOOL_DEFS,
} from './types';
import type { BuildingKind, ItemType, Role, Tool } from './types';
import { drawIconTo } from '../engine/sprites';
import type { Game } from './sim';

// DOM-based HUD. Rebuilt per level; light incremental updates each frame.

const ITEM_ICON: Record<ItemType, string> = {
  log: 'item_log',
  plank: 'item_plank',
  stone: 'item_stone',
  iron: 'item_iron',
  spear: 'item_spear',
};

const TOOL_ICON: Partial<Record<Tool, string>> = {
  select: 'icon_select',
  harvest: 'icon_harvest',
  ladder: 'tile_ladder',
  platform: 'tile_platform',
  sawmill: 'sawmill',
  forge: 'forge',
  lift: 'lift_car',
  rope: 'rope_anchor',
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

export interface HudCallbacks {
  onTool: (t: Tool) => void;
  onSpeed: (s: number) => void;
  onRole: (r: Role, delta: number) => void;
  onUpgrade: () => void;
  onMenu: () => void;
  onRestart: () => void;
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
  private toastWrap!: HTMLElement;
  private tooltip: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private hintSig = '';
  private keepBadges = new Map<ItemType, HTMLElement>();
  private lastKeep: Record<string, number> = {};
  private reservePop: { item: ItemType; el: HTMLElement; refresh: () => void } | null = null;
  activeTool: Tool = 'select';

  constructor(root: HTMLElement, game: Game, cbs: HudCallbacks) {
    this.root = root;
    this.game = game;
    this.cbs = cbs;
    root.innerHTML = '';
    this.buildTopBar();
    this.buildToolbar();
    this.buildSpeedBar();
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
      chip.title = `${ITEM_NAMES[it]} — click to keep some in store`;
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
    h.innerHTML = `<span>Deliver</span><span class="lvlname">${this.game.level.name}</span>`;
    for (const o of this.game.objectives) {
      const row = el('div', 'obj-row', obj);
      icon(ITEM_ICON[o.item], 18, row);
      const name = el('span', 'obj-name', row);
      name.textContent = ITEM_NAMES[o.item];
      const cnt = el('span', 'obj-cnt', row);
      this.objRows.set(o.item, { row, cnt });
    }

    // crew panel
    const crew = el('div', 'panel crew', bar);
    const ch = el('h3', undefined, crew);
    ch.innerHTML = `<span>Crew</span><span class="pop"></span>`;
    this.workerPop = ch.querySelector('.pop')!;
    for (const r of ROLES) {
      const row = el('div', 'role-row', crew);
      const dot = el('span', 'role-dot', row);
      dot.style.background = ROLE_COLORS[r];
      const name = el('span', 'role-name', row);
      name.textContent = ROLE_NAMES[r];
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
      label.textContent = def.label;
      btn.onclick = () => this.cbs.onTool(def.id);
      btn.onmouseenter = (e) => this.showTooltip(def.id, e.currentTarget as HTMLElement);
      btn.onmouseleave = () => this.hideTooltip();
      this.toolBtns.set(def.id, btn);
    }
  }

  private buildSpeedBar(): void {
    const bar = el('div', 'panel speedbar', this.root);
    for (const [label, s] of [
      ['⏸', 0],
      ['1×', 1],
      ['2×', 2],
      ['4×', 4],
    ] as const) {
      const btn = el('button', 'speed-btn', bar);
      btn.textContent = label;
      btn.onclick = () => this.cbs.onSpeed(s);
      this.speedBtns.set(s, btn);
    }
  }

  private buildMenuBar(): void {
    const bar = el('div', 'panel menubar', this.root);
    const menu = el('button', 'speed-btn', bar);
    menu.textContent = '☰ Levels';
    menu.onclick = () => this.cbs.onMenu();
    const restart = el('button', 'speed-btn', bar);
    restart.textContent = '↺ Restart';
    restart.onclick = () => this.cbs.onRestart();
  }

  private showTooltip(tool: Tool, anchor: HTMLElement): void {
    this.hideTooltip();
    const def = TOOL_DEFS.find((t) => t.id === tool)!;
    const tip = el('div', 'tooltip', this.root);
    const title = el('div', undefined, tip);
    title.innerHTML = `<b>${def.label}</b>`;
    const desc = el('div', 'tt-desc', tip);
    desc.textContent = def.desc;
    const recipe = RECIPES[def.id as BuildingKind];
    if (recipe) {
      const rec = el('div', 'tt-recipe', tip);
      const side = (label: string, items: Partial<Record<ItemType, number>>) => {
        const col = el('div', 'tt-side', rec);
        el('div', 'tt-side-label', col).textContent = label;
        const row = el('div', 'tt-side-items', col);
        for (const [k, v] of Object.entries(items)) {
          const s = el('span', undefined, row);
          icon(ITEM_ICON[k as ItemType], 14, s);
          el('b', undefined, s).textContent = String(v);
        }
      };
      side('Uses', recipe.inputs);
      el('div', 'tt-arrow', rec).textContent = '→';
      side('Makes', recipe.outputs);
      const time = el('div', 'tt-time', tip);
      time.textContent = `⏱ ${recipe.time}s per batch`;
    }
    if (def.thLevel && this.game.thLevel < def.thLevel) {
      const req = el('div', undefined, tip);
      req.innerHTML = `<span class="insufficient">Requires Town Hall level ${def.thLevel}</span>`;
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
    el('span', undefined, row).textContent = 'Keep';
    const minus = el('button', 'res-step', row);
    minus.textContent = '−';
    const val = el('b', 'res-keep-val', row);
    const plus = el('button', 'res-step', row);
    plus.textContent = '+';
    el('div', 'res-pop-note', pop).textContent = 'Haulers ship only the surplus to the caravan.';
    const step = (delta: number): void => {
      g.setKeep(item, g.keep[item] + delta);
      val.textContent = String(g.keep[item]);
      this.refreshKeepBadge(item);
    };
    minus.onclick = () => step(-1);
    plus.onclick = () => step(1);
    const refresh = (): void => {
      nameEl.textContent = `${ITEM_NAMES[item]} · ${g.stock[item]} in store`;
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
    const t = el('div', warn ? 'toast warn' : 'toast', this.toastWrap);
    const span = el('span', undefined, t);
    span.innerHTML = html;
    const d = el('span', 'dismiss', t);
    d.textContent = 'dismiss';
    d.onclick = () => t.remove();
    if (autoDismiss > 0) setTimeout(() => t.remove(), autoDismiss * 1000);
  }

  // Interactive town-hall panel shown when the building is tapped with Select.
  showTownhall(): void {
    const g = this.game;
    const lvl = TH_LEVELS[g.thLevel - 1];
    while (this.toastWrap.children.length >= 2) this.toastWrap.firstChild?.remove();
    const t = el('div', 'toast th-toast', this.toastWrap);
    const build = (): void => {
      t.innerHTML = '';
      const head = el('div', undefined, t);
      head.innerHTML = `<b>Town Hall</b> · Level ${g.thLevel} · ${g.workers.length}/${g.maxWorkers} crew`;
      if (g.thUpgrade) {
        el('div', 'th-toast-body', t).textContent =
          `Upgrading… ${Math.floor((g.thUpgrade.progress / g.thUpgrade.time) * 100)}% — a builder is on the way.`;
      } else if (!lvl.upgradeCost) {
        el('div', 'th-toast-body', t).textContent = 'Fully upgraded — max crew reached.';
      } else {
        el('div', 'th-toast-body', t).textContent =
          `Upgrade → Level ${g.thLevel + 1} (${TH_LEVELS[g.thLevel].maxWorkers} crew)`;
        const cost = el('div', 'th-toast-cost', t);
        for (const [k, v] of Object.entries(lvl.upgradeCost)) {
          const s = el('span', 'cost-item', cost);
          icon(ITEM_ICON[k as ItemType], 16, s);
          const n = el('b', g.stock[k as ItemType] < (v as number) ? 'insufficient' : '', s);
          n.textContent = String(v);
        }
        const btn = el('button', 'th-mini', t);
        btn.textContent = 'Upgrade';
        btn.disabled = !g.canAfford(lvl.upgradeCost);
        btn.onclick = () => {
          this.cbs.onUpgrade();
          build(); // re-render to reflect the in-progress state
        };
      }
      const d = el('span', 'dismiss', t);
      d.textContent = 'dismiss';
      d.onclick = () => t.remove();
    };
    build();
  }

  // Hover hint for the town hall on the canvas (desktop discoverability).
  showBuildingHint(clientX: number, clientY: number): void {
    const g = this.game;
    const lvl = TH_LEVELS[g.thLevel - 1];
    const up = g.thUpgrade;
    const sig = [
      g.thLevel,
      g.workers.length,
      g.maxWorkers,
      up ? Math.floor((up.progress / up.time) * 20) : 'x',
      lvl.upgradeCost ? ITEM_TYPES.map((i) => g.stock[i]).join(',') : 'max',
    ].join('|');
    if (!this.hint) {
      this.hint = el('div', 'tooltip', this.root);
      this.hintSig = '';
    }
    const tip = this.hint;
    if (sig !== this.hintSig) {
      this.hintSig = sig;
      tip.innerHTML = '';
      el('div', undefined, tip).innerHTML = `<b>Town Hall</b> · Lv ${g.thLevel}`;
      el('div', 'tt-desc', tip).textContent = `Crew ${g.workers.length}/${g.maxWorkers}`;
      if (up) {
        el('div', 'tt-desc', tip).textContent =
          `Upgrading… ${Math.floor((up.progress / up.time) * 100)}%`;
      } else if (lvl.upgradeCost) {
        el('div', undefined, tip).textContent =
          `Click: upgrade → Lv ${g.thLevel + 1} (${TH_LEVELS[g.thLevel].maxWorkers} crew)`;
        const cost = el('div', 'tt-cost', tip);
        for (const [k, v] of Object.entries(lvl.upgradeCost)) {
          const s = el('span', undefined, cost);
          icon(ITEM_ICON[k as ItemType], 14, s);
          const n = el('b', g.stock[k as ItemType] < (v as number) ? 'insufficient' : '', s);
          n.textContent = String(v);
        }
      } else {
        el('div', 'tt-desc', tip).textContent = 'Max level';
      }
    }
    // follow the cursor, clamped to stay on screen
    tip.style.left = `${Math.min(window.innerWidth - 240, clientX + 14)}px`;
    tip.style.top = `${clientY + 16}px`;
    tip.style.bottom = 'auto';
  }

  hideBuildingHint(): void {
    this.hint?.remove();
    this.hint = null;
    this.hintSig = '';
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
  }

  setSpeed(s: number): void {
    for (const [sp, btn] of this.speedBtns) btn.classList.toggle('active', sp === s);
    document.querySelector('.pause-note')?.remove();
    if (s === 0) {
      const note = el('div', 'pause-note', this.root);
      note.textContent = 'Paused';
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
        this.upgradeBtn.textContent = `Upgrading… ${Math.floor((g.thUpgrade.progress / g.thUpgrade.time) * 100)}%`;
      } else if (!lvl.upgradeCost) {
        this.upgradeBtn.disabled = true;
        this.upgradeBtn.textContent = `Town Hall ${g.thLevel} (max)`;
      } else {
        this.upgradeBtn.innerHTML = '';
        const label = el('span', undefined, this.upgradeBtn);
        label.textContent = `Upgrade Town Hall → ${g.thLevel + 1}`;
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
