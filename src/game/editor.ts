// In-game level editor. Renders through the normal game renderer by keeping a
// sandbox Game instance (no workers, always paused) that the editing tools
// mutate directly. Levels round-trip through the CustomLevelData format.

import { FOOTPRINTS, ITEM_TYPES, ROLES, T, TILE } from './types';
import { t } from '../engine/i18n';
import type { Building, NodeKind } from './types';
import { Game } from './sim';
import { canPlaceBuilding } from './world';
import { drawIconTo } from '../engine/sprites';
import { audio } from '../engine/audio';
import {
  MAX_H,
  MAX_W,
  MIN_H,
  MIN_W,
  blankLevelData,
  encodeShareCode,
  encodeTiles,
  levelDefFromData,
  verifyLevel,
} from './leveldata';
import type { CustomLevelData } from './leveldata';
import { generateVerifiedLevel, randomSeed } from './generator';

export type EditorTool =
  | 'ground'
  | 'rock'
  | 'erase'
  | 'tree'
  | 'boulder'
  | 'vein'
  | 'townhall'
  | 'goal'
  | 'eraseNode';

// Labels/descriptions live in the i18n table: t(`ed.tool.${id}.label`) / .desc
interface EditorToolDef {
  id: EditorTool;
  icon: string;
  key: string;
  drag: boolean; // apply continuously while dragging
}

const EDITOR_TOOLS: EditorToolDef[] = [
  { id: 'ground', icon: 'tile_grass', key: '1', drag: true },
  { id: 'rock', icon: 'tile_rock', key: '2', drag: true },
  { id: 'erase', icon: 'icon_demolish', key: '3', drag: true },
  { id: 'tree', icon: 'tree', key: '4', drag: false },
  { id: 'boulder', icon: 'boulder', key: '5', drag: false },
  { id: 'vein', icon: 'vein', key: '6', drag: false },
  { id: 'townhall', icon: 'townhall', key: '7', drag: false },
  { id: 'goal', icon: 'goal', key: '8', drag: false },
  { id: 'eraseNode', icon: 'icon_harvest', key: '9', drag: false },
];

export interface EditorCallbacks {
  onExit: () => void;
  onPlaytest: (data: CustomLevelData) => void;
  onSave: (data: CustomLevelData) => void;
}

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

export class Editor {
  game!: Game;
  active = false;
  tool: EditorTool = 'ground';
  dirty = false;

  private root: HTMLElement;
  private cbs: EditorCallbacks;
  private meta!: Pick<
    CustomLevelData,
    'id' | 'name' | 'desc' | 'objectives' | 'startStock' | 'startRoles' | 'startWorkers' | 'startThLevel' | 'seed'
  >;
  private panel: HTMLElement | null = null;
  private toolbar: HTMLElement | null = null;
  private toolBtns = new Map<EditorTool, HTMLButtonElement>();
  private msgBox: HTMLElement | null = null;
  private reportBox: HTMLElement | null = null;
  private hover = { tx: 0, ty: 0, visible: false };
  private lastPaint = -1;

  constructor(root: HTMLElement, cbs: EditorCallbacks) {
    this.root = root;
    this.cbs = cbs;
  }

  // ---- lifecycle -------------------------------------------------------------

  open(data?: CustomLevelData): void {
    const d = data ?? blankLevelData();
    this.meta = {
      id: d.id,
      name: d.name,
      desc: d.desc,
      objectives: ITEM_TYPES.map((item) => ({
        item,
        amount: d.objectives.find((o) => o.item === item)?.amount ?? 0,
      })),
      startStock: { ...d.startStock },
      startRoles: { ...d.startRoles },
      startWorkers: d.startWorkers,
      startThLevel: d.startThLevel,
      seed: d.seed,
    };
    this.buildSandbox(d);
    this.active = true;
    this.dirty = false;
    this.buildUi();
  }

  close(): void {
    this.active = false;
    this.panel?.remove();
    this.toolbar?.remove();
    this.panel = null;
    this.toolbar = null;
    this.toolBtns.clear();
  }

  private buildSandbox(d: CustomLevelData): void {
    const def = levelDefFromData(d);
    def.startWorkers = 0;
    def.startRoles = {};
    this.game = new Game(def);
    this.game.paused = true;
  }

  serialize(): CustomLevelData {
    const { world } = this.game;
    // the bottom row is always bedrock so nothing can fall out of the world
    for (let x = 0; x < world.w; x++) world.set(x, world.h - 1, T.BEDROCK);
    const th = this.townhall();
    const goal = this.goalBuilding();
    return {
      v: 1,
      id: this.meta.id,
      name: this.meta.name,
      desc: this.meta.desc,
      width: world.w,
      height: world.h,
      tiles: encodeTiles(world.tiles),
      nodes: this.game.nodes.filter((n) => n.yieldLeft > 0).map((n) => ({ kind: n.kind, x: n.x, y: n.y })),
      townhall: { x: th.x, y: th.y },
      goal: { x: goal.x, y: goal.y },
      objectives: this.meta.objectives.filter((o) => o.amount > 0),
      startStock: { ...this.meta.startStock },
      startRoles: { ...this.meta.startRoles },
      startWorkers: this.meta.startWorkers,
      startThLevel: this.meta.startThLevel,
      seed: this.meta.seed,
    };
  }

  // ---- editing ----------------------------------------------------------------

  private townhall(): Building {
    return this.game.buildings.find((b) => b.kind === 'townhall')!;
  }

  private goalBuilding(): Building {
    return this.game.buildings.find((b) => b.kind === 'goal')!;
  }

  setHover(tx: number, ty: number, visible: boolean): void {
    this.hover = { tx, ty, visible };
  }

  toolDef(): EditorToolDef {
    return EDITOR_TOOLS.find((t) => t.id === this.tool)!;
  }

  // CSS px to reserve on the right so the settings panel never sits over map
  // details: the panel's span from the viewport edge plus a breathing gap.
  panelRightInset(): number {
    if (!this.panel) return 0;
    const r = this.panel.getBoundingClientRect();
    return Math.max(0, window.innerWidth - r.left) + 16;
  }

  setTool(t: EditorTool): void {
    this.tool = t;
    for (const [id, btn] of this.toolBtns) btn.classList.toggle('active', id === t);
    audio.click();
  }

  setToolByKey(key: string): boolean {
    const def = EDITOR_TOOLS.find((t) => t.key === key);
    if (def) this.setTool(def.id);
    return !!def;
  }

  // Rebuild the editor chrome in the current language (map state untouched).
  rebuildUi(): void {
    if (this.active) this.buildUi();
  }

  // Topmost standable row of a column (the cell a creature stands in).
  private standRow(x: number): number | null {
    const { world } = this.game;
    for (let y = 0; y < world.h; y++) {
      if (world.isSolid(x, y)) return y > 0 ? y - 1 : null;
    }
    return null;
  }

  private regrass(x: number): void {
    const { world } = this.game;
    for (let y = 0; y < world.h; y++) {
      const t = world.get(x, y);
      if (t === T.DIRT || t === T.GRASS) {
        world.set(x, y, world.isSolid(x, y - 1) ? T.DIRT : T.GRASS);
      }
    }
  }

  private inAnyBuilding(x: number, y: number): boolean {
    return this.game.buildings.some((b) => {
      const fp = FOOTPRINTS[b.kind];
      return x >= b.x && x < b.x + fp.w && y >= b.y && y < b.y + fp.h;
    });
  }

  private dropInvalidNodes(): void {
    const { world } = this.game;
    this.game.nodes = this.game.nodes.filter((n) => world.isPassable(n.x, n.y) && world.isSolid(n.x, n.y + 1));
  }

  applyAt(tx: number, ty: number, dragging: boolean): void {
    const { world } = this.game;
    if (!world.inBounds(tx, ty)) return;
    if (dragging && !this.toolDef().drag) return;
    const paintKey = ty * world.w + tx;
    if (dragging && paintKey === this.lastPaint) return;
    this.lastPaint = paintKey;

    switch (this.tool) {
      case 'ground':
      case 'rock': {
        if (ty >= world.h - 1) return; // bedrock row stays
        if (this.inAnyBuilding(tx, ty)) return this.flash(t('ed.flash.building'));
        world.set(tx, ty, this.tool === 'rock' ? T.ROCK : T.DIRT);
        this.regrass(tx);
        this.game.nodes = this.game.nodes.filter((n) => !(n.x === tx && n.y >= ty - 2 && n.y <= ty));
        this.dropInvalidNodes();
        this.markDirty();
        if (!dragging) audio.place();
        break;
      }
      case 'erase': {
        if (ty >= world.h - 1) return this.flash(t('ed.flash.bedrock'));
        if (world.get(tx, ty) === T.AIR) return;
        world.set(tx, ty, T.AIR);
        this.regrass(tx);
        this.dropInvalidNodes();
        this.markDirty();
        if (!dragging) audio.demolish();
        break;
      }
      case 'tree':
      case 'boulder':
      case 'vein': {
        const y = this.standRow(tx);
        if (y === null) return this.flash(t('ed.flash.noGround'));
        if (this.inAnyBuilding(tx, y) || this.inAnyBuilding(tx, y - 1)) return this.flash(t('ed.flash.tooClose'));
        this.game.nodes = this.game.nodes.filter((n) => n.x !== tx);
        this.game.addNode(this.tool as NodeKind, tx, y);
        this.markDirty();
        audio.place();
        break;
      }
      case 'townhall':
      case 'goal': {
        const b = this.tool === 'townhall' ? this.townhall() : this.goalBuilding();
        const fp = FOOTPRINTS[b.kind];
        const y = this.standRow(tx);
        if (y === null) return this.flash(t('ed.flash.noGroundHere'));
        const ny = y - (fp.h - 1);
        const others = this.game.buildings.filter((o) => o.id !== b.id);
        if (!canPlaceBuilding(world, others, this.game.nodes, tx, ny, fp.w, fp.h)) {
          return this.flash(t('ed.flash.needsClear'));
        }
        b.x = tx;
        b.y = ny;
        this.markDirty();
        audio.place();
        break;
      }
      case 'eraseNode': {
        const n = this.game.nodeAt(tx, ty);
        if (!n) return;
        this.game.nodes = this.game.nodes.filter((o) => o.id !== n.id);
        this.markDirty();
        audio.demolish();
        break;
      }
    }
  }

  endStroke(): void {
    this.lastPaint = -1;
  }

  private resize(newW: number, newH: number): void {
    const data = this.serialize();
    const old = this.game.world;
    const dy = newH - old.h;
    const world = new Uint8Array(newW * newH);
    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const ox = Math.min(x, old.w - 1); // new columns clone the last column
        const oy = y - dy;
        world[y * newW + x] = oy >= 0 && oy < old.h ? old.tiles[oy * old.w + ox] : T.AIR;
      }
    }
    for (let x = 0; x < newW; x++) world[(newH - 1) * newW + x] = T.BEDROCK;
    data.width = newW;
    data.height = newH;
    data.tiles = encodeTiles(world);
    const shift = (p: { x: number; y: number }) => {
      p.x = Math.min(p.x, newW - 6);
      p.y = Math.max(0, Math.min(p.y + dy, newH - 4));
    };
    shift(data.townhall);
    shift(data.goal);
    data.nodes = data.nodes
      .map((n) => ({ ...n, y: n.y + dy }))
      .filter((n) => n.x < newW && n.y >= 0 && n.y < newH);
    this.buildSandbox(data);
    this.dropInvalidNodes();
    this.markDirty();
  }

  private markDirty(): void {
    this.dirty = true;
  }

  // ---- rendering overlay ---------------------------------------------------------

  drawOverlay(ctx: CanvasRenderingContext2D): void {
    const { world } = this.game;
    // world border
    ctx.strokeStyle = 'rgba(232,238,247,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, world.w * TILE - 1, world.h * TILE - 1);
    if (!this.hover.visible) return;
    const { tx, ty } = this.hover;
    if (!world.inBounds(tx, ty)) return;

    let x = tx;
    let y = ty;
    let w = 1;
    let h = 1;
    if (this.tool === 'townhall' || this.tool === 'goal') {
      const fp = FOOTPRINTS[this.tool];
      const sy = this.standRow(tx);
      if (sy !== null) y = sy - (fp.h - 1);
      w = fp.w;
      h = fp.h;
    } else if (this.tool === 'tree' || this.tool === 'boulder' || this.tool === 'vein') {
      const sy = this.standRow(tx);
      if (sy !== null) y = sy;
    }
    ctx.strokeStyle = 'rgba(255,201,77,0.9)';
    ctx.strokeRect(x * TILE + 0.5, y * TILE + 0.5, w * TILE - 1, h * TILE - 1);
    ctx.fillStyle = 'rgba(255,201,77,0.15)';
    ctx.fillRect(x * TILE, y * TILE, w * TILE, h * TILE);
  }

  // ---- UI -------------------------------------------------------------------------

  private flash(msg: string, good = false): void {
    if (!this.msgBox) return;
    this.msgBox.textContent = msg;
    this.msgBox.className = good ? 'ed-msg good' : 'ed-msg';
    this.msgBox.classList.remove('show');
    void this.msgBox.offsetWidth;
    this.msgBox.classList.add('show');
  }

  private buildUi(): void {
    this.panel?.remove();
    this.toolbar?.remove();
    this.toolBtns.clear();

    // --- bottom toolbar with the shaping tools ---
    const bar = el('div', 'panel toolbar editor-toolbar', this.root);
    for (const def of EDITOR_TOOLS) {
      const btn = el('button', 'tool-btn', bar);
      icon(def.icon, 26, btn);
      el('span', 'tool-key', btn).textContent = def.key;
      el('span', 'tool-label', btn).textContent = t(`ed.tool.${def.id}.label`);
      btn.title = t(`ed.tool.${def.id}.desc`);
      btn.onclick = () => this.setTool(def.id);
      this.toolBtns.set(def.id, btn);
    }
    this.toolbar = bar;
    this.setTool(this.tool);

    // --- right-hand settings panel ---
    const panel = el('div', 'panel editor-panel', this.root);
    this.panel = panel;

    const head = el('div', 'ed-head', panel);
    el('h3', undefined, head).textContent = t('ed.title');
    this.msgBox = el('div', 'ed-msg', panel);

    const nameRow = el('div', 'ed-row', panel);
    el('label', undefined, nameRow).textContent = t('ed.name');
    const nameIn = el('input', 'ed-input', nameRow);
    nameIn.maxLength = 40;
    nameIn.value = this.meta.name;
    nameIn.oninput = () => {
      this.meta.name = nameIn.value || t('ed.defaultName');
      this.markDirty();
    };

    const descRow = el('div', 'ed-row', panel);
    el('label', undefined, descRow).textContent = t('ed.blurb');
    const descIn = el('input', 'ed-input', descRow);
    descIn.maxLength = 140;
    descIn.value = this.meta.desc;
    descIn.oninput = () => {
      this.meta.desc = descIn.value;
      this.markDirty();
    };

    // size
    const sizeRow = el('div', 'ed-row', panel);
    el('label', undefined, sizeRow).textContent = t('ed.size');
    const wIn = this.numInput(sizeRow, this.game.world.w, MIN_W, MAX_W);
    el('span', 'ed-x', sizeRow).textContent = '×';
    const hIn = this.numInput(sizeRow, this.game.world.h, MIN_H, MAX_H);
    const applySize = el('button', 'ed-btn', sizeRow);
    applySize.textContent = t('ed.resize');
    applySize.onclick = () => {
      const w = Math.max(MIN_W, Math.min(MAX_W, Number(wIn.value) || this.game.world.w));
      const h = Math.max(MIN_H, Math.min(MAX_H, Number(hIn.value) || this.game.world.h));
      wIn.value = String(w);
      hIn.value = String(h);
      this.resize(w, h);
      this.flash(t('ed.resized', { w, h }), true);
      audio.place();
    };

    // objectives
    el('div', 'ed-section', panel).textContent = t('ed.order');
    for (const o of this.meta.objectives) {
      const row = el('div', 'ed-row', panel);
      icon(`item_${o.item}`, 16, row);
      el('label', 'ed-grow', row).textContent = t(`item.${o.item}`);
      const inp = this.numInput(row, o.amount, 0, 99);
      inp.oninput = () => {
        o.amount = Math.max(0, Math.min(99, Number(inp.value) || 0));
        this.markDirty();
      };
    }

    // start conditions
    el('div', 'ed-section', panel).textContent = t('ed.start');
    {
      const row = el('div', 'ed-row', panel);
      el('label', 'ed-grow', row).textContent = t('ed.workers');
      const inp = this.numInput(row, this.meta.startWorkers, 1, 12);
      inp.oninput = () => {
        this.meta.startWorkers = Math.max(1, Math.min(12, Number(inp.value) || 4));
        this.markDirty();
      };
      el('label', undefined, row).textContent = t('ed.townhallLevel');
      const sel = el('select', 'ed-input ed-select', row);
      for (const lv of [1, 2, 3]) {
        const opt = el('option', undefined, sel);
        opt.value = String(lv);
        opt.textContent = `L${lv}`;
      }
      sel.value = String(this.meta.startThLevel);
      sel.onchange = () => {
        this.meta.startThLevel = Number(sel.value);
        this.markDirty();
      };
    }
    const rolesRow = el('div', 'ed-row ed-wrap', panel);
    for (const r of ROLES) {
      const chip = el('span', 'ed-chip', rolesRow);
      chip.title = t(`role.${r}`);
      icon(`hat_${r}`, 14, chip);
      const inp = this.numInput(chip, this.meta.startRoles[r] ?? 0, 0, 12);
      inp.oninput = () => {
        this.meta.startRoles[r] = Math.max(0, Math.min(12, Number(inp.value) || 0));
        this.markDirty();
      };
    }
    const stockRow = el('div', 'ed-row ed-wrap', panel);
    for (const it of ITEM_TYPES) {
      const chip = el('span', 'ed-chip', stockRow);
      chip.title = t('ed.startingStock', { name: t(`item.${it}`) });
      icon(`item_${it}`, 14, chip);
      const inp = this.numInput(chip, this.meta.startStock[it] ?? 0, 0, 99);
      inp.oninput = () => {
        this.meta.startStock[it] = Math.max(0, Math.min(99, Number(inp.value) || 0));
        this.markDirty();
      };
    }

    // generator
    el('div', 'ed-section', panel).textContent = t('ed.generate');
    const genRow = el('div', 'ed-row', panel);
    const seedIn = el('input', 'ed-input ed-grow', genRow);
    seedIn.value = this.meta.seed ?? randomSeed();
    seedIn.maxLength = 40;
    seedIn.title = t('ed.seedTitle');
    const diffSel = el('select', 'ed-input ed-select', genRow);
    for (let dd = 1; dd <= 5; dd++) {
      const opt = el('option', undefined, diffSel);
      opt.value = String(dd);
      opt.textContent = `★${dd}`;
    }
    diffSel.value = '2';
    const genBtn = el('button', 'ed-btn', genRow);
    genBtn.textContent = t('ed.roll');
    genBtn.onclick = () => {
      const seed = seedIn.value.trim() || randomSeed();
      const data = generateVerifiedLevel({ seed, difficulty: Number(diffSel.value) });
      data.id = this.meta.id; // keep editing the same slot
      this.open(data);
      this.flash(t('ed.generated', { name: data.name, seed }), true);
      audio.built();
    };

    // verify
    el('div', 'ed-section', panel).textContent = t('ed.check');
    const verifyRow = el('div', 'ed-row', panel);
    const verifyBtn = el('button', 'ed-btn ed-grow', verifyRow);
    verifyBtn.textContent = t('ed.verify');
    verifyBtn.onclick = () => {
      const report = verifyLevel(this.serialize());
      this.renderReport(report.problems, report.warnings);
      audio.click();
    };
    this.reportBox = el('div', 'ed-report', panel);

    // actions
    const actions = el('div', 'ed-actions', panel);
    const playBtn = el('button', 'ed-btn primary', actions);
    playBtn.textContent = t('ed.playtest');
    playBtn.onclick = () => {
      const data = this.serialize();
      if (data.objectives.length === 0) {
        this.flash(t('ed.needObjective'));
        audio.invalid();
        return;
      }
      audio.click();
      this.cbs.onPlaytest(data);
    };
    const saveBtn = el('button', 'ed-btn', actions);
    saveBtn.textContent = t('ed.save');
    saveBtn.onclick = () => {
      this.cbs.onSave(this.serialize());
      this.dirty = false;
      this.flash(t('ed.saved'), true);
      audio.place();
    };
    const exportBtn = el('button', 'ed-btn', actions);
    exportBtn.textContent = t('ed.copy');
    exportBtn.onclick = () => {
      const code = encodeShareCode(this.serialize());
      const done = () => this.flash(t('ed.copied'), true);
      navigator.clipboard?.writeText(code).then(done, () => {
        window.prompt(t('ed.copyPrompt'), code);
      }) ?? window.prompt(t('ed.copyPrompt'), code);
      audio.click();
    };
    const exitBtn = el('button', 'ed-btn danger', actions);
    exitBtn.textContent = t('ed.exit');
    exitBtn.onclick = () => {
      audio.click();
      this.cbs.onExit();
    };
  }

  private renderReport(problems: string[], warnings: string[]): void {
    const box = this.reportBox!;
    box.innerHTML = '';
    if (problems.length === 0 && warnings.length === 0) {
      const ok = el('div', 'ed-report-line good', box);
      ok.textContent = t('ed.report.ok');
      return;
    }
    for (const p of problems) {
      el('div', 'ed-report-line bad', box).textContent = `✖ ${p}`;
    }
    for (const w of warnings) {
      el('div', 'ed-report-line warn', box).textContent = `⚠ ${w}`;
    }
  }

  private numInput(parent: HTMLElement, value: number, min: number, max: number): HTMLInputElement {
    const inp = el('input', 'ed-input ed-num', parent);
    inp.type = 'number';
    inp.min = String(min);
    inp.max = String(max);
    inp.value = String(value);
    return inp;
  }
}
