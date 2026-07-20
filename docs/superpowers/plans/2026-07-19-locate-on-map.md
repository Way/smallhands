# Locate-on-map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player click a HUD resource chip's "Find on map" button or a delivery-objective row to pan+ping the camera to where that item comes from, and show a screen-edge arrow for stranded goods that are off-screen.

**Architecture:** A pure, read-only `Game.locateItem(item)` resolver (raw node → producing building → scarcest-input recursion) is the single source of truth, unit-tested headlessly. The renderer draws an auto-expiring pulse ring (post-darkness pass) and always-on off-screen stranded edge-arrows. `main.ts` owns a short camera-pan tween and wires the HUD's new `onLocate` callback to `game.locateItem` + `renderer.locateRing`. No sim behavior changes.

**Tech Stack:** TypeScript, custom canvas renderer, rolldown-bundled headless unit tests (`tests/unit.mjs`), Vite build, flat `[en, de]` i18n table.

**Design doc:** `docs/superpowers/specs/2026-07-19-locate-on-map-design.md` · **Card:** Harmony #49 · **Slice:** 2 of 3.

## Global Constraints

- **Single source of truth for reachability:** reuse `nodeApproachCells` + `findPath(world, transits, sx, sy, targets, /*carrying*/ false)` — the exact pair `tryAssignHarvest` uses (`sim.ts:1351-1353`). Never hand-roll a second reachability rule (lesson from #45/#47).
- **Reuse node→item / item→producer maps:** `NODE_YIELD[kind].item` (tree→log, boulder→stone, vein→iron); `RECIPES[kind].outputs` (sawmill→plank, forge→spear, workshop→shovel). Do not duplicate these tables.
- **Pure resolver, "nearest" origin = the town hall** (`this.townhall`), not the camera — keeps `locateItem` sim-side and headless-testable.
- **Ring drawn in the post-darkness pass** (`render.ts:164-170`, same transform as `drawStrandedMarkers`) so it reads over the night veil.
- **Reduce motion:** gate every animation on the renderer's `this.reduceMotion` getter and `main.ts`'s `reduceMotion()`; under reduced motion the camera **snaps** (no tween) and the ring/arrow are **static** (no pulse/bob).
- **i18n both languages:** every new user-facing string needs an `[EN, DE]` entry in `src/engine/i18n.ts`.
- **Camera clamp caveat:** `cam.clamp` re-centers worlds smaller than the viewport and overwrites manual `cam.x/y` (`render.ts:25-31`). Correctness relies on the **ring**, never on the pan actually moving; always call `cam.clamp(...)` after writing `cam.x/y`.
- **No behavior change to the sim:** hauling, movement, assignment, production stay untouched. This is a read-only query + camera + render feature; no persistence.

---

### Task 1: `LocateResult` type + `Game.locateItem` resolver (headless, TDD)

The core, fully verifiable with `node tests/unit.mjs` — no browser.

**Files:**
- Modify: `src/game/types.ts` — add the `LocateResult` interface.
- Modify: `src/game/sim.ts` — `locateItem` + private helpers `nodeKindFor`, `producerKind`, `nearestNodeOfKind`, `nearestBuildingOfKind`; ensure `NodeKind`/`BuildingKind`/`LocateResult` are imported.
- Test: `tests/unit.mjs` — new assertion block.

**Interfaces:**
- Consumes (existing, do not modify): `NODE_YIELD` (`types.ts:56`), `RECIPES` (`types.ts:109`), `this.nodes` (`sim.ts:154`), `this.buildings` (`sim.ts:153`), `this.stock` (`sim.ts:162`), `this.townhall` getter (`sim.ts:273`), `this.transits` getter (`sim.ts:300`), `this.thApproach()` (`sim.ts:1013`, private — callable from within `Game`), `nodeApproachCells(world, nx, ny)` (`nav.ts:223`), `findPath(world, transits, sx, sy, targets, carrying)` (`nav.ts:20`), `this.world.w`, `Building.state` (`'ready' | 'blueprint'`, `sim.ts:246`).
- Produces (Task 3 + tests rely on these exact names): `Game.locateItem(item: ItemType, seen?: Set<ItemType>): LocateResult | null`; `LocateResult { x: number; y: number; kind: 'node' | 'building' | 'input' }`.

- [ ] **Step 1: Add the `LocateResult` type**

In `src/game/types.ts`, add near the other small result/interface types (e.g. beside `ObjectiveReq`, ~line 272):

```ts
// Where the camera should go when the player asks "where do I get <item>?"
// kind: 'node' = a raw source node, 'building' = a producer, 'input' = the
// source of a producer's missing input (the recipe had no built producer).
export interface LocateResult {
  x: number; // tile
  y: number; // tile
  kind: 'node' | 'building' | 'input';
}
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/unit.mjs` (uses the already-imported `Game`, `LEVELS`). `nodes` and `buildings` are public arrays; `addBuilding(kind, x, y, ready=true)` creates a building (ready by default).

```js
// ---- Locate-on-map resolver -------------------------------------------------
// A helper to build a ResourceNode literal (all fields required by the type).
function node(id, kind, x, y) {
  return { id, kind, x, y, yieldLeft: 4, marked: false, workerId: null, wobble: 0 };
}

{
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.nodes.length = 0; // deterministic: only the two veins we place
  g.nodes.push(node(9001, 'vein', th.x + 3, th.y));
  g.nodes.push(node(9002, 'vein', th.x + 12, th.y));
  const r = g.locateItem('iron');
  check('locateItem(iron) points at the nearest vein',
    !!r && r.kind === 'node' && r.x === th.x + 3 && r.y === th.y);
}

{
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.addBuilding('forge', th.x + 5, th.y, true); // ready forge produces spear
  const r = g.locateItem('spear');
  check('locateItem(spear) points at the forge that makes it',
    !!r && r.kind === 'building' && r.x === th.x + 5 && r.y === th.y);
}

{
  const g = new Game(LEVELS[0]);
  const th = g.townhall;
  g.buildings = g.buildings.filter((b) => b.kind !== 'sawmill'); // no plank producer
  g.nodes.length = 0;
  g.nodes.push(node(9101, 'tree', th.x + 4, th.y)); // logs come from here
  const r = g.locateItem('plank');
  check('locateItem(plank) with no sawmill points at a log source (input)',
    !!r && r.kind === 'input' && r.x === th.x + 4 && r.y === th.y);
}

{
  const g = new Game(LEVELS[0]);
  g.nodes.length = 0; // no veins; iron is not craftable
  const r = g.locateItem('iron');
  check('locateItem(iron) with no vein and no producer returns null', r === null);
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node tests/unit.mjs`
Expected: FAIL — `g.locateItem is not a function`.

- [ ] **Step 4: Ensure the imports exist in `sim.ts`**

At the top of `src/game/sim.ts`, confirm `NODE_YIELD` and `RECIPES` are imported from `./types` (they are used elsewhere). Add `LocateResult` to the `import type { … } from './types'` block, and confirm `NodeKind` and `BuildingKind` are imported (add any that are missing to the existing type-import block). `nodeApproachCells` and `findPath` are already imported from `./nav` (`sim.ts:53`).

- [ ] **Step 5: Implement the resolver + helpers**

In `src/game/sim.ts`, add these to the `Game` class (near the hauling/reachability helpers, e.g. after `sinkCells` ~line 1055):

```ts
  // --- locate-on-map (card #49) --------------------------------------------
  // Pure, read-only "where do I get <item>?" resolver. Raw items resolve to the
  // nearest source node; crafted items to their producing building, else (no
  // producer built) to the scarcest recipe input's source. "Nearest" is measured
  // from the town hall so the query is camera-independent and headless-testable.
  // See docs/superpowers/specs/2026-07-19-locate-on-map-design.md.

  // The node kind that yields `item` (tree→log, boulder→stone, vein→iron).
  private nodeKindFor(item: ItemType): NodeKind | undefined {
    for (const k of Object.keys(NODE_YIELD) as NodeKind[]) {
      if (NODE_YIELD[k].item === item) return k;
    }
    return undefined;
  }

  // The building kind whose recipe outputs `item` (sawmill→plank, forge→spear,
  // workshop→shovel), or undefined for raw / never-produced items.
  private producerKind(item: ItemType): BuildingKind | undefined {
    for (const k of Object.keys(RECIPES) as BuildingKind[]) {
      if (RECIPES[k]?.outputs[item]) return k;
    }
    return undefined;
  }

  // Nearest live node of `kind`: prefer one a worker can actually path to (from a
  // town-hall approach cell, unloaded — the same reachability tryAssignHarvest
  // uses), ranked by path cost; else fall back to the nearest by straight-line
  // from the town hall, so a walled-off node is still pointed at.
  private nearestNodeOfKind(kind: NodeKind): ResourceNode | undefined {
    const live = this.nodes.filter((n) => n.kind === kind && n.yieldLeft > 0);
    if (live.length === 0) return undefined;

    const originKey = this.thApproach().values().next().value as number | undefined;
    if (originKey !== undefined) {
      const ox = originKey % this.world.w;
      const oy = (originKey - ox) / this.world.w;
      let best: { node: ResourceNode; cost: number } | null = null;
      for (const n of live) {
        const cells = nodeApproachCells(this.world, n.x, n.y);
        if (cells.size === 0) continue;
        const path = findPath(this.world, this.transits, ox, oy, cells, false);
        if (path && (!best || path.cost < best.cost)) best = { node: n, cost: path.cost };
      }
      if (best) return best.node;
    }

    const th = this.townhall;
    let near: ResourceNode | undefined;
    let nd = Infinity;
    for (const n of live) {
      const d = (n.x - th.x) ** 2 + (n.y - th.y) ** 2;
      if (d < nd) { nd = d; near = n; }
    }
    return near;
  }

  // Nearest building of `kind` (by straight-line from the town hall). `ready`
  // selects finished producers; `!ready` selects blueprints/under-construction.
  private nearestBuildingOfKind(kind: BuildingKind, ready: boolean): Building | undefined {
    const th = this.townhall;
    let best: Building | undefined;
    let nd = Infinity;
    for (const b of this.buildings) {
      if (b.kind !== kind) continue;
      if (ready ? b.state !== 'ready' : b.state === 'ready') continue;
      const d = (b.x - th.x) ** 2 + (b.y - th.y) ** 2;
      if (d < nd) { nd = d; best = b; }
    }
    return best;
  }

  locateItem(item: ItemType, seen: Set<ItemType> = new Set()): LocateResult | null {
    if (seen.has(item)) return null; // recipe DAG is acyclic; guard is belt-and-braces
    seen.add(item);

    const nodeKind = this.nodeKindFor(item);
    if (nodeKind) {
      const n = this.nearestNodeOfKind(nodeKind);
      if (n) return { x: n.x, y: n.y, kind: 'node' };
    }

    const pk = this.producerKind(item);
    if (pk) {
      const ready = this.nearestBuildingOfKind(pk, true);
      if (ready) return { x: ready.x, y: ready.y, kind: 'building' };
      const bp = this.nearestBuildingOfKind(pk, false);
      if (bp) return { x: bp.x, y: bp.y, kind: 'building' };
      // no producer on the map → point at the scarcest input's source
      const inputs = Object.keys(RECIPES[pk]!.inputs) as ItemType[];
      let target: ItemType | undefined;
      let low = Infinity;
      for (const inp of inputs) {
        if (this.stock[inp] < low) { low = this.stock[inp]; target = inp; }
      }
      if (target) {
        const r = this.locateItem(target, seen);
        if (r) return { x: r.x, y: r.y, kind: 'input' };
      }
    }
    return null;
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node tests/unit.mjs`
Expected: PASS — all four new checks green, every pre-existing check still `ok`.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/game/types.ts src/game/sim.ts tests/unit.mjs
git commit -m "#49 locateItem resolver + LocateResult (headless)"
```

---

### Task 2: Renderer — pulse ring + off-screen stranded edge-arrows

Add the two visual layers. The ring stays dormant (nothing sets `locateRing` until Task 3); the edge-arrows immediately point at any off-screen stranded item (data already produced by #47's `strandedGroundItems()`).

**Files:**
- Modify: `src/game/render.ts` — public `locateRing` field; `drawLocateRing`; `drawStrandedEdgeArrows`; two call sites in `draw()`.

**Interfaces:**
- Consumes: `game.strandedGroundItems()` (#47), `this.reduceMotion`, `TILE`, `Camera` (`cam.x/y/zoom/rightInset`), the post-darkness transform block (`render.ts:164-170`).
- Produces: `renderer.locateRing: { x: number; y: number; bornAt: number } | null` (Task 3 sets it); the ring auto-clears when it expires.

- [ ] **Step 1: Add the `locateRing` field**

In `src/game/render.ts`, in the `Renderer` class near `effectsReduced` (~line 73), add:

```ts
  // A one-shot "locate" ping set by main.ts's onLocate handler: a pulsing ring
  // over a world tile that fades out after LOCATE_RING_DUR. bornAt is in the
  // renderer's own seconds clock (the `timeSec` passed to draw()).
  locateRing: { x: number; y: number; bornAt: number } | null = null;
  private readonly LOCATE_RING_DUR = 1.6;
```

- [ ] **Step 2: Add `drawLocateRing`**

In `src/game/render.ts`, add a private method near `drawStrandedMarkers` (~line 1493):

```ts
  private drawLocateRing(t: number): void {
    const ring = this.locateRing;
    if (!ring) return;
    const age = t - ring.bornAt;
    if (age < 0 || age >= this.LOCATE_RING_DUR) { this.locateRing = null; return; }
    const { ctx } = this;
    const cx = (ring.x + 0.5) * TILE;
    const cy = (ring.y + 0.5) * TILE;
    const fade = 1 - age / this.LOCATE_RING_DUR; // 1 → 0 over the lifetime
    const wob = this.reduceMotion ? 0 : (0.5 + Math.sin(t * 6) * 0.5) * 0.9;
    const r = TILE * (2.2 + wob);
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffd66a';
    ctx.globalAlpha = 0.9 * fade;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.5 * fade;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
```

- [ ] **Step 3: Add `drawStrandedEdgeArrows`**

In `src/game/render.ts`, add a private method (screen space — no world transform):

```ts
  // Screen-edge arrows pointing at stranded ground items that are scrolled out of
  // view (closes the #47 off-screen deferral). On-screen items are already
  // covered by the #47 warning glyph, so those are skipped.
  private drawStrandedEdgeArrows(game: Game, cam: Camera, W: number, H: number, t: number): void {
    const stranded = game.strandedGroundItems();
    if (!stranded.length) return;
    const { ctx } = this;
    const scale = TILE * cam.zoom;
    const pad = 18;
    const topInset = 96;              // clear the topbar HUD band
    const minX = pad, maxX = W - cam.rightInset - pad;
    const minY = topInset, maxY = H - pad;
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
    const bob = this.reduceMotion ? 0 : Math.sin(t * 4) * 2;
    ctx.save();
    for (const gi of stranded) {
      const sx = (gi.x + 0.5) * scale - cam.x;
      const sy = (gi.y + 0.5) * scale - cam.y;
      if (sx >= 0 && sx <= W - cam.rightInset && sy >= 0 && sy <= H) continue; // on-screen
      const ex = Math.max(minX, Math.min(maxX, sx));
      const ey = Math.max(minY, Math.min(maxY, sy));
      const ang = Math.atan2(sy - midY, sx - midX);
      ctx.save();
      ctx.translate(ex, ey + bob);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = '#ff9d2e';
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
```

- [ ] **Step 4: Call both from `draw()`**

In `src/game/render.ts` `draw()`, extend the post-darkness block and add the screen-space arrows after it (`render.ts:167-171`):

```ts
    if (hover.visible) this.drawGhost(game, hover, timeSec);
    this.drawStrandedMarkers(game, timeSec);
    this.drawLocateRing(timeSec);
    overlay?.(ctx);
    ctx.restore();

    // screen-space: arrows toward off-screen stranded goods (on top of everything)
    this.drawStrandedEdgeArrows(game, cam, W, H, timeSec);
  }
```

(The `}` closes `draw()`; make sure you replace only the tail of the existing post-darkness block, keeping the single method-closing brace.)

- [ ] **Step 5: Build + verify suites stay green**

Run: `npm run build`
Expected: `tsc --noEmit` clean, Vite build succeeds.

Run: `node tests/unit.mjs`
Expected: all checks still `ok` (render-only change).

- [ ] **Step 6: Visual smoke check**

Run `npm run dev`, strand a resource (mine a vein into a pit a loaded hauler can't leave), scroll it off-screen → an amber arrow appears at the screen edge pointing at it; scroll back → the arrow gives way to the #47 on-map glyph. Toggle reduce-motion → the arrow stops bobbing.

- [ ] **Step 7: Commit**

```bash
git add src/game/render.ts
git commit -m "#49 Locate pulse ring + off-screen stranded edge-arrows"
```

---

### Task 3: HUD triggers + camera pan + toast + i18n (wire it all together)

The interaction layer: "Find on map" in the reserve popover, clickable objective rows, the `onLocate` callback, and `main.ts`'s camera pan tween. Everything is DOM, so a touch tap fires the same `click`.

**Files:**
- Modify: `src/engine/i18n.ts` — `hud.findOnMap`, `locate.none`.
- Modify: `src/game/ui.ts` — `HudCallbacks.onLocate`; "Find on map" button in `toggleReservePopover`; objective-row `onclick`.
- Modify: `src/style.css` — `.res-locate` button; objective-row `cursor`/hover.
- Modify: `src/main.ts` — module `panTarget` + `cancelPan()`; `onLocate` handler in `attachHud`; pan tween in `frame()`; cancel-on-manual-pan.

**Interfaces:**
- Consumes: `Game.locateItem(item)` + `LocateResult` (Task 1); `renderer.locateRing` (Task 2); `this.cbs`, `el`, `t`, `toggleReservePopover`, `objRows`, `HudCallbacks` (ui.ts); `cam` (`x/y/zoom/rightInset`), `renderer.viewW/viewH`, `reduceMotion()`, `last`, `audio`, `TILE`, `t` (main.ts).
- Produces: `HudCallbacks.onLocate: (item: ItemType) => void`.

- [ ] **Step 1: Add the i18n strings**

In `src/engine/i18n.ts`, add near the `hud.*` keys (after `hud.inStore`, ~line 326):

```ts
  'hud.findOnMap': ['Find on map', 'Auf Karte finden'],
  'locate.none': ['No {name} source on this map.', 'Keine {name}-Quelle auf dieser Karte.'],
```

- [ ] **Step 2: Add `onLocate` to `HudCallbacks` + the popover button**

In `src/game/ui.ts`, add to the `HudCallbacks` interface (after `onZoom`, ~line 111):

```ts
  onLocate: (item: ItemType) => void;
```

Then in `toggleReservePopover`, after the `res-pop-note` line (~line 565), add a full-width "Find on map" button:

```ts
    const locateBtn = el('button', 'res-act res-locate', pop);
    locateBtn.textContent = t('hud.findOnMap');
    locateBtn.onclick = () => {
      this.closeReservePopover();
      this.cbs.onLocate(item);
    };
```

- [ ] **Step 3: Make objective rows clickable**

In `src/game/ui.ts`, in the objectives build loop (~line 244-250), give each row a click handler + pointer semantics:

```ts
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
```

- [ ] **Step 4: Style the button + clickable rows**

In `src/style.css`, after `.res-pop-note` (~line 166) add:

```css
.res-locate { width: 100%; margin-top: 8px; height: 26px; }
```

And update the objective row to read as clickable — change the `.obj-row` rule (~line 202) to include `cursor: pointer;` and add a hover after line 213:

```css
.obj-row { display: flex; align-items: center; gap: 7px; font-size: 13px; padding: 2px 0; cursor: pointer; }
.obj-row:hover .obj-name { color: var(--text); }
```

- [ ] **Step 5: Add the pan-target state + cancel helper in `main.ts`**

In `src/main.ts`, near the other camera state (module scope, close to `let hud`), add:

```ts
// Locate-on-map (card #49): a pending camera target the frame loop eases toward.
// Cleared the moment the player pans manually (they've taken over).
let panTarget: { x: number; y: number } | null = null;
function cancelPan(): void { panTarget = null; }
```

- [ ] **Step 6: Add the `onLocate` handler in `attachHud`**

In `src/main.ts`, inside the `new Hud(uiRoot, game!, { … })` callbacks object (after `onZoom`, ~line 1043), add:

```ts
    onLocate: (item) => {
      if (!game || !running) return;
      const r = game.locateItem(item);
      if (!r) {
        hud?.toast(t('locate.none', { name: t(`item.${item}`) }));
        return;
      }
      const avw = renderer.viewW - cam.rightInset;
      const tx = (r.x + 0.5) * TILE * cam.zoom - avw / 2;
      const ty = (r.y + 0.5) * TILE * cam.zoom - renderer.viewH / 2;
      renderer.locateRing = { x: r.x, y: r.y, bornAt: performance.now() / 1000 };
      if (reduceMotion()) {
        cam.x = tx; cam.y = ty;
        cam.clamp(game, renderer.viewW, renderer.viewH);
        panTarget = null;
      } else {
        panTarget = { x: tx, y: ty };
      }
      audio.click();
    },
```

- [ ] **Step 7: Ease the camera in `frame()` + cancel on manual pan**

In `src/main.ts` `frame()`, in the keyboard-pan block (~line 2078-2086), cancel a pending locate when the player presses a pan key — add as the first line inside the `if`:

```ts
    if (keys.has('a') || keys.has('d') || keys.has('w') || keys.has('s') ||
        keys.has('arrowleft') || keys.has('arrowright') || keys.has('arrowup') || keys.has('arrowdown')) cancelPan();
```

Immediately after that keyboard-pan block (before the `if (editor.active)` early-return, ~line 2087), add the tween:

```ts
  // locate-on-map: ease the camera toward a pending target, then clamp
  if (panTarget && game && running) {
    const k = 1 - Math.pow(0.0002, dtReal); // frame-rate-independent ease (~0.35s)
    cam.x += (panTarget.x - cam.x) * k;
    cam.y += (panTarget.y - cam.y) * k;
    if (Math.abs(panTarget.x - cam.x) < 0.5 && Math.abs(panTarget.y - cam.y) < 0.5) {
      cam.x = panTarget.x; cam.y = panTarget.y; panTarget = null;
    }
    cam.clamp(game, renderer.viewW, renderer.viewH);
  }
```

Then cancel the tween in the three pointer/wheel pan handlers (the player is dragging/zooming, so a locate pan must yield):
- In the drag-pan branch (`pointermove`, ~line 1663, inside `if (dragMoved) {`), add `cancelPan();` as the first line.
- In the pinch branch (`pointermove`, ~line 1638, inside `if (g) {`), add `cancelPan();` as the first line.
- In the `wheel` handler (~line 1823, right after `if (!g) return;`), add `cancelPan();`.

- [ ] **Step 8: Build + typecheck + suites**

Run: `npm run build`
Expected: `tsc --noEmit` clean, Vite build succeeds.

Run: `node tests/unit.mjs`
Expected: all checks `ok` (Task 1's four locate checks + every pre-existing check).

- [ ] **Step 9: Manual browser smoke**

`npm run dev`:
- Click a resource chip → keep popover opens → click **Find on map** → camera eases to the nearest source and the ring pings it; on a night level (e.g. Lantern Ridge) the ring reads over the dark veil.
- Click a stalled **objective row** → camera centers the producer / missing-input source.
- Click a resource with no source (e.g. iron on a vein-less level) → a toast "No Iron source on this map." appears, camera does not move.
- Switch language to DE → button reads "Auf Karte finden", toast is translated.
- Toggle reduce-motion (OS or options) → the pan snaps instantly and the ring is static.
- Confirm keyboard/drag/wheel pan during a locate immediately takes over (the ease stops).

- [ ] **Step 10: Commit**

```bash
git add src/engine/i18n.ts src/game/ui.ts src/style.css src/main.ts
git commit -m "#49 HUD locate triggers + camera pan + toast (EN+DE)"
```

---

## Self-Review

**Spec coverage:**
- Pure `Game.locateItem` resolver (raw → producer → scarcest-input recursion), town-hall origin, reachable-then-straight-line → Task 1. ✓
- Resource chip → nearest source via "Find on map" in the popover → Task 3 Step 2. ✓
- Objective shortfall → production site / missing input (same resolver) → Task 3 Step 3. ✓
- Off-screen stranded → screen-edge arrow (closes #47 deferral); on-screen reverts to the #47 glyph → Task 2 Steps 3-4. ✓
- Animated pan + auto-expiring pulse ring in the post-darkness pass → Task 2 Steps 1-2,4 + Task 3 Steps 6-7. ✓
- Reduce-motion: instant pan + static ring/arrow → ring `wob` gated on `reduceMotion` (Task 2 Step 2), arrow `bob` gated (Task 2 Step 3), pan snaps under `reduceMotion()` (Task 3 Step 6). ✓
- No source at all → translated toast, camera unmoved → Task 3 Steps 1,6. ✓
- Desktop + touch → all triggers are DOM `onclick` (tap == click), no canvas wiring. ✓
- EN + DE copy → Task 3 Step 1. ✓
- Headless resolver tests; existing suites green → Task 1 Steps 2,6. ✓
- No sim behavior change / no persistence → Tasks 2-3 touch only render/HUD/main; Task 1 adds read-only methods. ✓

**Placeholder scan:** every step ships concrete code, exact commands, and expected output. The only adaptation-to-existing-code notes (Step 4 "confirm imports", Step 7 "confirm `RECIPES`/`NODE_YIELD` imported") point at real, verified symbols, not TODOs.

**Type consistency:** `LocateResult { x, y, kind: 'node'|'building'|'input' }` defined in Task 1 Step 1, returned by `locateItem` (Task 1 Step 5), consumed as `r.x/r.y` in Task 3 Step 6. `renderer.locateRing: { x, y, bornAt }` declared in Task 2 Step 1, written in Task 3 Step 6, read/cleared in Task 2 Step 2. `HudCallbacks.onLocate: (item: ItemType) => void` declared in Task 3 Step 2, called from the popover button + objective rows (Task 3 Steps 2-3), implemented in `attachHud` (Task 3 Step 6). `panTarget`/`cancelPan` declared in Task 3 Step 5, used in Steps 6-7. Helper names `nodeKindFor`/`producerKind`/`nearestNodeOfKind`/`nearestBuildingOfKind` are used identically within Task 1. `Building.state` compared against `'ready'` matches `sim.ts:246`.
