# Stranded-goods marker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn the player, on the map, when a dropped resource can never be hauled to a useful destination — so silently-stranded goods (e.g. iron mined onto a ledge a loaded hauler can't leave) stop being invisible.

**Architecture:** A read-only detector on `Game` reuses the hauler planner's own reachability (`sourceCells` / `sinkCells` / `findPath(…, carrying=true)`) to decide if a ground item has any loaded carry-route to an accepting sink. A per-item cached `stranded` flag (grace-gated, recomputed on a throttle in `tick`) drives a pulsing on-map glyph drawn above the night veil, plus a one-line reason on hover/tap. No change to hauling behavior.

**Tech Stack:** TypeScript, custom canvas renderer, rolldown-bundled headless unit tests (`tests/unit.mjs`), Vite build.

**Design doc:** `docs/superpowers/specs/2026-07-19-stranded-goods-marker-design.md` · **Card:** Harmony #47

## Global Constraints

- **Single source of truth for reachability:** the detector MUST reuse `sourceCells`, `sinkCells`, `findPath`, and `this.transits` — never a second, hand-rolled reachability rule. (Lesson from card #45.)
- **Faithful carry rule:** loaded haulers cannot climb ladders (`nav.ts:138`); they ascend only via ramp step-ups / a cargo **lift**, cross gaps via a **bridge/platform**, descend via fall / **rope anchor**. Reason copy must therefore say "ramp, bridge, or lift" — **never** "ladder."
- **Render-only signal, no persistence:** the game keeps no mid-level save; do not serialize the new fields.
- **Reduce motion:** any pulse MUST be gated on `this.reduceMotion` (renderer) — static glyph when reduced.
- **i18n both languages:** every new user-facing string needs EN + DE entries in `src/engine/i18n.ts` (`[EN, DE]` tuple form).
- **No behavior change to hauling:** `tryAssignHaul` / worker movement stay byte-for-byte unchanged.
- **Diagnosis only:** show the problem; do not suggest or auto-build a fix. Off-screen indicator is out of scope (deferred to Slice 2).

---

### Task 1: Detector + ground-item state (headless, TDD)

The core: `GroundItem.stranded` / `idleFor` fields, the pure detector, and the `tick` bookkeeping — all verifiable with `node tests/unit.mjs`, no browser.

**Files:**
- Modify: `src/game/types.ts` — `GroundItem` interface (add `stranded`, `idleFor`).
- Modify: `src/game/sim.ts` — new detector methods; init both fields where a `GroundItem` is created (`dropItem`, ~`sim.ts:864`); bookkeeping + throttled recompute in `tick` (~`sim.ts:2006`).
- Test: `tests/unit.mjs` — new assertion blocks.

**Interfaces:**
- Consumes (existing, do not modify): `sourceCells(s: Source): Set<number> | null` (`sim.ts:1026`); `sinkCells(s: Sink): Set<number> | null` (`sim.ts:1042`, resolves `{t:'goal',id}` because the caravan is a `kind:'goal'` building); `thApproach()`, `buildingApproach(b)`; `findPath(world, transits, sx, sy, targets, carrying)` (`nav.ts:20`); `this.transits`; `this.goal` getter (`sim.ts:277`, may be `undefined`); `RECIPES` (already imported); `this.objectives` (each has `item`, `amount`, `delivered`, `inbound`); `world.w`.
- Produces (later tasks + tests rely on these exact names):
  - `Game.strandedGroundItems(): GroundItem[]` — items currently flagged stranded.
  - `GroundItem.stranded: boolean`, `GroundItem.idleFor: number`.

- [ ] **Step 1: Add the fields to `GroundItem`**

In `src/game/types.ts`, extend the interface (around line 251):

```ts
export interface GroundItem {
  id: number;
  item: ItemType;
  x: number; // tile
  y: number;
  reserved: boolean;
  bounce: number; // spawn animation timer
  stranded: boolean; // cached: no loaded carry-route to any accepting sink
  idleFor: number; // seconds settled & unreserved (drives the grace period)
}
```

- [ ] **Step 2: Initialise the fields on every drop**

In `src/game/sim.ts` `dropItem` (~line 864), where the `GroundItem` literal is built:

```ts
    const gi: GroundItem = { id: this.id(), item, x: spot.x, y: spot.y, reserved: false, bounce: 0.4, stranded: false, idleFor: 0 };
```

- [ ] **Step 3: Write the failing tests**

Append to `tests/unit.mjs` (uses the already-imported `Game`, `LEVELS`, `T`). `dropItem` is an internal method reached the same way existing tests reach `g.stock` / `g.world`.

```js
// ---- Stranded-goods detector ------------------------------------------------
// A dropped item is "stranded" when a LOADED hauler could never carry it to any
// accepting sink. We build a fully isolated shelf (an air moat on both sides) so
// the geometry is deterministic and independent of Level 1's terrain.
function islandShelf(g) {
  const W = g.world;
  const gy = 20; // floor row of the shelf
  const L = g.townhall.x + 12;
  const R = L + 6;
  // air moat from the sky to just above the world floor across L-1..R+1
  for (let x = L - 1; x <= R + 1; x++) for (let y = 0; y < W.h - 1; y++) W.set(x, y, T.AIR);
  // a short solid floor for L..R only — nothing can walk or be carried on/off it
  for (let x = L; x <= R; x++) W.set(x, gy, T.DIRT);
  return { gy, L, R };
}

{
  const g = new Game(LEVELS[0]); // objective is plank; stone is nobody's sink
  const { gy, L } = islandShelf(g);
  g.dropItem('stone', L + 3, gy - 1);
  for (let i = 0; i < 60 * 4; i++) g.tick(1 / 60); // past the 3s grace
  check('stone marooned on an island is flagged stranded',
    g.strandedGroundItems().some((gi) => gi.item === 'stone'));
}

{
  const g = new Game(LEVELS[0]);
  const { gy, L } = islandShelf(g);
  // a log with no consumer on the shelf is stranded...
  g.dropItem('log', L + 4, gy - 1);
  for (let i = 0; i < 60 * 4; i++) g.tick(1 / 60);
  check('a log with no reachable sink is stranded',
    g.strandedGroundItems().some((gi) => gi.item === 'log'));
  // ...a ready sawmill on the SAME shelf eats logs, so a local sink is now
  // reachable without leaving the shelf → no longer stranded.
  g.addBuilding('sawmill', L + 1, gy - 2, true);
  for (let i = 0; i < 60 * 2; i++) g.tick(1 / 60);
  check('a consuming building on the same shelf clears the stranded flag',
    !g.strandedGroundItems().some((gi) => gi.item === 'log'));
}

{
  const g = new Game(LEVELS[0]);
  // a stone dropped by the town hall reaches the stockpile fine — never stranded
  g.dropItem('stone', g.townhall.x + 3, g.townhall.y);
  for (let i = 0; i < 60 * 4; i++) g.tick(1 / 60);
  check('a reachable drop is never flagged stranded',
    !g.strandedGroundItems().some((gi) => gi.item === 'stone'));
}
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node tests/unit.mjs`
Expected: FAIL — `g.strandedGroundItems is not a function` (method not defined yet).

- [ ] **Step 5: Implement the detector**

In `src/game/sim.ts`, add these methods to the `Game` class (near the hauling helpers, after `sinkCells`):

```ts
  // --- stranded-goods detection --------------------------------------------
  // A dropped item is "stranded" when a LOADED hauler could never carry it to a
  // sink that would accept it. Reuses the exact reachability the hauler planner
  // uses (sourceCells / sinkCells / findPath carrying=true) so the marker can
  // never disagree with what haulers actually do. Diagnosis only — see
  // docs/superpowers/specs/2026-07-19-stranded-goods-marker-design.md.
  private readonly STRAND_GRACE = 3; // seconds settled+unreserved before flagging

  strandedGroundItems(): GroundItem[] {
    return this.groundItems.filter((gi) => gi.stranded);
  }

  // Every sink that would take `item`: the stockpile (always), any ready+unpaused
  // building whose recipe consumes it, and the caravan if an objective is open.
  private acceptingSinkCells(item: ItemType): Set<number> {
    const cells = new Set<number>();
    for (const k of this.thApproach()) cells.add(k);
    for (const b of this.buildings) {
      if (b.state !== 'ready' || b.paused) continue;
      if (RECIPES[b.kind]?.inputs[item]) {
        for (const k of this.buildingApproach(b)) cells.add(k);
      }
    }
    const goal = this.goal;
    if (goal && this.objectives.some((o) => o.item === item && o.delivered + o.inbound < o.amount)) {
      for (const k of this.sinkCells({ t: 'goal', id: goal.id }) ?? []) cells.add(k);
    }
    return cells;
  }

  private computeStranded(gi: GroundItem): boolean {
    if (gi.reserved) return false;
    const origins = this.sourceCells({ t: 'ground', id: gi.id });
    if (!origins || origins.size === 0) return true; // no standable pickup cell
    const sinks = this.acceptingSinkCells(gi.item);
    if (sinks.size === 0) return true; // nothing would ever accept it
    for (const okey of origins) {
      const ox = okey % this.world.w;
      const oy = (okey - ox) / this.world.w;
      if (findPath(this.world, this.transits, ox, oy, sinks, true)) return false;
    }
    return true; // no loaded carry-route to any sink
  }

  private recomputeStranded(): void {
    for (const gi of this.groundItems) {
      gi.stranded = gi.idleFor >= this.STRAND_GRACE && this.computeStranded(gi);
    }
  }
```

- [ ] **Step 6: Wire bookkeeping + throttle into `tick`**

In `src/game/sim.ts` `tick` (~line 2057), replace the ground-item loop and add a throttled recompute:

```ts
    for (const gi of this.groundItems) {
      if (gi.bounce > 0) gi.bounce -= dt;
      if (gi.reserved || gi.bounce > 0) gi.idleFor = 0;
      else gi.idleFor += dt;
    }

    this.strandTimer -= dt;
    if (this.strandTimer <= 0) {
      this.recomputeStranded();
      this.strandTimer = 0.5;
    }
```

Add the timer field near the other tick timers (e.g. beside `hintTimer`):

```ts
  private strandTimer = 0;
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node tests/unit.mjs`
Expected: PASS — all four new checks green, and every pre-existing check still `ok`.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add src/game/types.ts src/game/sim.ts tests/unit.mjs
git commit -m "#47 Stranded-goods detector + ground-item state (headless)"
```

---

### Task 2: On-map warning glyph

Render a pulsing amber `!` above each stranded item, above the night veil, reduce-motion-safe.

**Files:**
- Modify: `src/engine/sprites.ts` — new `warn` sprite.
- Modify: `src/game/render.ts` — draw call in the post-darkness pass (~`render.ts:167`); new private `drawStrandedMarkers`.

**Interfaces:**
- Consumes: `game.strandedGroundItems()` (Task 1); `sprite('warn')`; `this.reduceMotion`; `TILE`; the post-darkness world-transform block in the main draw method.
- Produces: purely visual; nothing downstream consumes it.

- [ ] **Step 1: Add the `warn` sprite**

In `src/engine/sprites.ts`, near the `mark` sprite (~line 1061), add an amber disc with a white exclamation:

```ts
  makeSprite('warn', { a: '#ff9d2e', A: '#ffc061', k: '#5a2f06', w: '#fff4e0' }, [
    '..AAAA..',
    '.AaaaaA.',
    'AawwwaaA',
    'Aawwwaak',
    'Aaawaaak',
    'AaawaaaK',
    '.Aawa Ak',
    '..kkkk..',
  ]);
```

(Any legible `!`-in-a-disc at this scale is fine; keep it 8×8 to match the `mark` footprint. Replace a stray space if the pixel editor complains — every row must be the same width.)

- [ ] **Step 2: Add the draw method**

In `src/game/render.ts`, add a private method (near `drawGroundItems`):

```ts
  private drawStrandedMarkers(game: Game, t: number): void {
    const stranded = game.strandedGroundItems();
    if (!stranded.length) return;
    const { ctx } = this;
    const spr = sprite('warn').canvas;
    const bob = this.reduceMotion ? 0 : Math.sin(t * 4) * 1.5;
    for (const gi of stranded) {
      ctx.drawImage(spr, gi.x * TILE + 4, (gi.y - 1) * TILE - 2 + bob);
    }
  }
```

- [ ] **Step 3: Call it above the darkness veil**

In `src/game/render.ts` main draw method, inside the post-darkness world-transform block (the `ctx.save()` at ~line 164 that re-applies the camera and draws the ghost), add the call so the glyph renders bright over the night veil:

```ts
    if (hover.visible) this.drawGhost(game, hover, timeSec);
    this.drawStrandedMarkers(game, timeSec);
    overlay?.(ctx);
```

- [ ] **Step 4: Build + verify existing suites stay green**

Run: `npm run build`
Expected: `tsc --noEmit` clean, Vite build succeeds.

Run: `node tests/unit.mjs`
Expected: all checks still `ok` (render change touches no sim logic).

- [ ] **Step 5: Visual smoke check**

Run the app (`npm run dev`) on Level 1, drop a resource somewhere a loaded hauler can't leave (e.g. mine a vein into a pit with no lift), and confirm a pulsing `!` appears over it after ~3s and reads clearly. On a night level (e.g. Lantern Ridge), confirm it stays visible over the dark veil. Toggle reduce-motion (OS setting) and confirm the glyph is static.

- [ ] **Step 6: Commit**

```bash
git add src/engine/sprites.ts src/game/render.ts
git commit -m "#47 Draw pulsing warning glyph over stranded goods"
```

---

### Task 3: Hover / tap reason

Explain the glyph: hover (desktop) or tap (touch) a stranded item in Inspect mode → a one-line reason.

**Files:**
- Modify: `src/game/sim.ts` — `strandedItemAt(x, y)` lookup.
- Modify: `src/game/ui.ts` — `showStrandedHint(...)`.
- Modify: `src/game/main.ts` — dispatch in the Inspect/`select` branches (desktop pointermove ~`main.ts:1677`, touch tap ~`main.ts:1470`, live refresh ~`main.ts:1524`).
- Modify: `src/engine/i18n.ts` — EN + DE reason string.

**Interfaces:**
- Consumes: `game.strandedGroundItems()`; the existing `select`-tool hint dispatch that calls `hud.showBuildingHint` / `hud.showNodeHint`; `this.ensureHint()` / `this.positionHint()` / `this.hintSig` in `ui.ts`; `t(key)`.
- Produces: `Game.strandedItemAt(x: number, y: number): GroundItem | undefined`; `HUD.showStrandedHint(gi, clientX, clientY)`.

- [ ] **Step 1: Add the lookup on `Game`**

In `src/game/sim.ts` (near `nodeAt`, ~line 834):

```ts
  strandedItemAt(x: number, y: number): GroundItem | undefined {
    return this.groundItems.find((gi) => gi.stranded && gi.x === x && gi.y === y);
  }
```

- [ ] **Step 2: Add the i18n string**

In `src/engine/i18n.ts`, add (near the other `inspect.*` / `node.*` keys):

```ts
  'inspect.stranded': [
    'Stranded — no way to carry this out. Connect it with a ramp, bridge, or lift.',
    'Gestrandet — kein Abtransport möglich. Verbinde es mit einer Rampe, Brücke oder einem Lift.',
  ],
```

- [ ] **Step 3: Add the hint renderer to the HUD**

In `src/game/ui.ts`, beside `showNodeHint` (~line 815):

```ts
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
```

Ensure `GroundItem` is imported in `ui.ts` (add to the existing `import type { … } from './types'` / `'../game/types'` line if absent).

- [ ] **Step 4: Dispatch on desktop hover**

In `src/game/main.ts`, the `select`-tool pointermove branch (~line 1677) currently resolves a building then a node. Check a stranded item first (it draws on top and is the most actionable):

```ts
  if (!dragging && game && running && hover.tool === 'select') {
    const si = game.strandedItemAt(t.x, t.y);
    const b = si ? undefined : game.buildingAt(t.x, t.y);
    const n = si || b ? undefined : game.nodeAt(t.x, t.y);
    if (si) hud?.showStrandedHint(si, e.clientX, e.clientY);
    else if (b) hud?.showBuildingHint(b, e.clientX, e.clientY);
    else if (n) hud?.showNodeHint(n, e.clientX, e.clientY);
```

Leave the existing `else`/`hideHint` path (when none match) exactly as it is.

- [ ] **Step 5: Dispatch on touch tap + live refresh**

In the touch tap-to-inspect `select` branch (~line 1470), mirror the same precedence, storing the tapped stranded item alongside the existing `touchInspect` target so it re-renders live:

```ts
  if (hover.tool === 'select') {
    const si = g.strandedItemAt(tx, ty);
    const b = si ? undefined : g.buildingAt(tx, ty);
    const n = si || b ? undefined : g.nodeAt(tx, ty);
    // ...set touchInspect target to whichever matched (follow the existing shape:
    // it already tracks a building `b` and node `n`; add `si` the same way)...
  }
```

And in the live-refresh loop (~line 1524, which re-calls `showBuildingHint`/`showNodeHint` each frame), add the stranded case with the same precedence:

```ts
    if (si) hud.showStrandedHint(si, touchInspect.cx, touchInspect.cy);
    else if (b) hud.showBuildingHint(b, touchInspect.cx, touchInspect.cy);
    else if (n) hud.showNodeHint(n, touchInspect.cx, touchInspect.cy);
```

(Follow the exact field names the existing `touchInspect` object uses — read the block first; the shape is `{ b, n, cx, cy }`-style. Add an `si` field mirroring `n`.)

- [ ] **Step 6: Build + typecheck + suites**

Run: `npm run build`
Expected: clean.

Run: `node tests/unit.mjs && node tests/i18n.mjs`
Expected: all `ok` — the i18n test verifies every key has both EN and DE.

- [ ] **Step 7: Manual check**

`npm run dev`, strand a resource, select the Inspect tool, hover (desktop) / tap (touch) the glyph → the one-line reason appears and follows the cursor. Switch language to DE and confirm the translated string shows.

- [ ] **Step 8: Commit**

```bash
git add src/game/sim.ts src/game/ui.ts src/game/main.ts src/engine/i18n.ts
git commit -m "#47 Hover/tap reason for stranded goods (EN+DE)"
```

---

## Self-Review

**Spec coverage:**
- Detection via faithful reuse of `findPath(carrying=true)` + sink set → Task 1 (`computeStranded` / `acceptingSinkCells`). ✓
- `stranded` + `idleFor` fields, ~0.5s throttle, ~3s grace, reserved never flagged → Task 1 Steps 1–2, 6. ✓
- Pure `strandedGroundItems()` + headless unit tests → Task 1 Steps 3–7. ✓
- Glyph in post-darkness pass, reduce-motion static, `warn` sprite → Task 2. ✓
- Hover/tap reason, tooltip signature includes stranded state, EN+DE → Task 3 (sig `['stranded', gi.id]`; `inspect.stranded` tuple). ✓
- No hauling behavior change; no persistence → nothing writes to `tryAssignHaul`/save; fields init-only. ✓
- Off-screen indicator + fix hints excluded → not present in any task. ✓

**Placeholder scan:** test code, sprite rows, detector body, and i18n string are all concrete. The touch-tap wiring (Task 3 Steps 5) intentionally defers to the existing `touchInspect` object's field names — the implementer reads that block first; this is adaptation to existing code, not a missing spec.

**Type consistency:** `strandedGroundItems()`, `strandedItemAt()`, `showStrandedHint()`, `GroundItem.stranded`/`idleFor`, `STRAND_GRACE`, `strandTimer`, `acceptingSinkCells`, `computeStranded`, `recomputeStranded` — names used identically across tasks and tests. `sinkCells({t:'goal',id})` confirmed valid (caravan is a `kind:'goal'` building).
