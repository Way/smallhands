# Drag-stack Build + Cursor Cost Readout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players click-drag to lay a run of Ladders (vertical column), Ramps, or Bridges, with a live per-resource cost readout at the cursor and a ghost whose red tail marks where the budget runs out.

**Architecture:** A single `Game.runPlan(tool, ax, ay, tx, ty)` computes the run's cells, how many are affordable, the cost of that affordable prefix, and display rows. The drag ghost (`runOverlay`), the placement (`placeRun`), and the cursor readout (`Hud.showRunCost`) all read this one plan, so they cannot disagree — which also closes the current bug where the ghost draws more tiles than placement lays. Ladder joins Ramp/Bridge as a run tool via a new vertical-column cell generator.

**Tech Stack:** TypeScript, Vite, canvas 2D rendering, DOM HUD. Pure sim logic is unit-tested headlessly by bundling the TS with esbuild and importing it from a data-URL (see `tests/ramp.mjs`). No unit-test framework — tests are plain `node` scripts with a `check(name, cond)` helper.

## Global Constraints

- **In-game build only.** Do not touch the level editor or its paint tools (`src/game/editor.ts`).
- **No balance/cost/sprite changes.** Reuse existing tile sprites (`tile_ladder`, `tile_ramp`, `tile_platform`) and existing tooltip CSS (`.tooltip`, `.tt-cost`, `.insufficient`). Add no CSS, no assets.
- **No new tools.** Ladder/Ramp/Bridge already exist in `TOOL_DEFS`.
- **Verification bar:** `npm run build` (which runs `tsc --noEmit && vite build`) must be clean, and `node tests/drag-run.mjs` must print `all ok`.
- **Ladder wood rule (verbatim from sim):** a ladder costs 1 log if any logs remain, else 1 plank (`ladderWood`). Never change this.
- Red tint color for invalid/unaffordable feedback is `rgba(255,122,107,α)` (matches `outline()` in `render.ts`). Reuse it.

---

### Task 1: `ladderRunCells` — vertical-column cell generator

**Files:**
- Modify: `src/game/world.ts` (add `ladderRunCells`, after `bridgeRunCells`)
- Test: `tests/drag-run.mjs` (create)

**Interfaces:**
- Consumes: existing `canPlaceLadder(world, x, y)`, `World.get`, `T` (all in `world.ts`/`types.ts`).
- Produces: `ladderRunCells(world: World, ax: number, ay: number, _tx: number, ty: number): { x: number; y: number }[]` — a vertical run at column `ax` from `ay` toward `ty` (the x of the target is ignored). The anchor must satisfy `canPlaceLadder`; each later cell only needs clear air (it attaches to the run tile it abuts — a ladder above when descending, a ladder below, which counts as `isSupport`, when ascending). Stops at the first non-air cell. Empty array if the anchor itself is invalid.

- [ ] **Step 1: Write the failing test**

Create `tests/drag-run.mjs` with the esbuild bootstrap and the first block:

```js
// Headless checks for the drag-stack build feature (Ladder/Ramp/Bridge runs +
// runPlan affordability). Bundles the TS sim with esbuild (a vite dep) and
// imports it from a data URL, so it runs with plain `node`.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const res = await build({
  stdin: {
    contents: `
      export { World, ladderRunCells, rampRunCells, bridgeRunCells } from './src/game/world.ts';
      export { T } from './src/game/types.ts';
      export { Game } from './src/game/sim.ts';
      export { LEVELS } from './src/game/levels.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64'));
const { World, ladderRunCells, rampRunCells, bridgeRunCells, T, Game, LEVELS } = mod;

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}`);
  if (!cond) failures++;
}

// A 12x12 world: solid floor on rows 10-11, a wall column at x=6 (rows 4-9),
// air everywhere else. Ladders attach to the wall at x=5.
function wallWorld() {
  const w = new World(12, 12);
  for (let x = 0; x < w.w; x++) { w.set(x, 10, T.ROCK); w.set(x, 11, T.ROCK); }
  for (let y = 4; y <= 9; y++) w.set(6, y, T.ROCK);
  return w;
}

// --- Task 1: ladderRunCells (vertical column) ---
{
  const w = wallWorld();
  // ascend the wall from the floor: anchor (5,9) up to (5,4) => 6 cells, all x=5
  const up = ladderRunCells(w, 5, 9, 5, 4);
  check('ladder ascends the wall for 6 cells',
    up.length === 6 && up.every((c) => c.x === 5) &&
    up[0].y === 9 && up[5].y === 4);

  // a single click (no drag) is a run of length 1
  check('ladder single tile', ladderRunCells(w, 5, 9, 5, 9).length === 1);

  // horizontal drag is ignored — the column snaps to the anchor's x
  const snap = ladderRunCells(w, 5, 9, 2, 9);
  check('ladder ignores horizontal drag', snap.length === 1 && snap[0].x === 5);

  // stop at the first non-air cell
  const w2 = wallWorld();
  w2.set(5, 7, T.ROCK); // block the shaft mid-climb
  check('ladder run stops at solid', ladderRunCells(w2, 5, 9, 5, 4).length === 2);

  // descending stops when it hits the floor
  const down = ladderRunCells(w, 5, 4, 5, 11);
  check('ladder descends and stops at floor', down.length === 6 &&
    down[0].y === 4 && down[5].y === 9);

  // a floating anchor (no wall/ground/ladder) yields nothing
  check('ladder floating anchor invalid', ladderRunCells(w, 2, 3, 2, 1).length === 0);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/drag-run.mjs`
Expected: FAIL — esbuild error `No matching export ... for import "ladderRunCells"` (the function doesn't exist yet).

- [ ] **Step 3: Implement `ladderRunCells`**

In `src/game/world.ts`, immediately after the `bridgeRunCells` function (ends around line 171), add:

```ts
// The buildable vertical ladder column from anchor (ax,ay) toward ty (tx is
// ignored — ladders climb straight up a wall, so the run snaps to the anchor's
// column). The anchor must satisfy the ladder rule; each later cell attaches to
// the run tile it abuts — a ladder above when descending, a ladder below (which
// counts as support, see World.isSupport) when ascending — so like a bridge deck
// it only needs clear air. Stops at the first non-air cell.
export function ladderRunCells(
  world: World,
  ax: number,
  ay: number,
  _tx: number,
  ty: number
): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  if (!canPlaceLadder(world, ax, ay)) return cells;
  cells.push({ x: ax, y: ay });
  const sy = Math.sign(ty - ay);
  if (sy === 0) return cells;
  const n = Math.abs(ty - ay);
  for (let i = 1; i <= n; i++) {
    const cy = ay + i * sy;
    if (world.get(ax, cy) !== T.AIR) break;
    cells.push({ x: ax, y: cy });
  }
  return cells;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/drag-run.mjs`
Expected: all six `ladder ...` checks print `ok`, final line `all ok`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/game/world.ts tests/drag-run.mjs
git commit -m "feat(world): ladderRunCells vertical-column generator"
```

---

### Task 2: `runPlan` + shared placement core + `placeLadderRun`

**Files:**
- Modify: `src/game/types.ts` (add `RunPlan` interface)
- Modify: `src/game/sim.ts` (import `ladderRunCells` + `RunPlan`; add `runPlan`, `runCells`; rewrite `placeRun`; rewire `placeRampRun`/`placeBridgeRun`; add `placeLadderRun`)
- Test: `tests/drag-run.mjs` (add a second block)

**Interfaces:**
- Consumes: `ladderRunCells`/`rampRunCells`/`bridgeRunCells` (Task 1 + existing), `ShortfallRow` (from `types.ts`), `this.stock`, `this.payCost`, `this.onEvent`, `T`.
- Produces:
  - `interface RunPlan { cells: { x: number; y: number }[]; affordable: number; cost: Partial<Record<ItemType, number>>; rows: ShortfallRow[]; }` (in `types.ts`)
  - `Game.runPlan(tool: Tool, ax: number, ay: number, tx: number, ty: number): RunPlan`
  - `Game.placeLadderRun(ax: number, ay: number, tx: number, ty: number): number` (returns tiles placed)
  - `placeRampRun`/`placeBridgeRun` keep their existing signatures `(ax, ay, tx, ty): number`.

- [ ] **Step 1: Write the failing test**

In `tests/drag-run.mjs`, insert this block **before** the final `console.log(failures ...)` lines:

```js
// --- Task 2: runPlan affordability + placement ---
{
  // ladder run of 6 up the wall; wood pooled (log first, then plank)
  const g = new Game(LEVELS[0]);
  g.world = wallWorld();
  g.stock.log = 2; g.stock.plank = 1;
  const lp = g.runPlan('ladder', 5, 9, 5, 4);
  check('ladder plan: 6 cells', lp.cells.length === 6);
  check('ladder plan: affordable = log+plank', lp.affordable === 3);
  check('ladder plan: cost is log-then-plank mix', lp.cost.log === 2 && lp.cost.plank === 1);
  check('ladder plan: row pools wood under log icon',
    lp.rows.length === 1 && lp.rows[0].item === 'log' &&
    lp.rows[0].have === 3 && lp.rows[0].need === 6 && lp.rows[0].short === true);

  // plenty of planks, no logs => all 6 from planks
  const g2 = new Game(LEVELS[0]);
  g2.world = wallWorld();
  g2.stock.log = 0; g2.stock.plank = 10;
  const lp2 = g2.runPlan('ladder', 5, 9, 5, 4);
  check('ladder plan: planks cover the run', lp2.affordable === 6 && lp2.cost.plank === 6 && lp2.cost.log === undefined);
  check('ladder plan: affordable run not short', lp2.rows[0].short === false);

  // placement lays only the affordable prefix and charges the mix
  const g3 = new Game(LEVELS[0]);
  g3.world = wallWorld();
  g3.stock.log = 2; g3.stock.plank = 1;
  const placed = g3.placeLadderRun(5, 9, 5, 4);
  check('placeLadderRun places affordable count', placed === 3);
  check('placeLadderRun spends all wood', g3.stock.log === 0 && g3.stock.plank === 0);
  check('placeLadderRun fills the affordable prefix',
    g3.world.get(5, 9) === T.LADDER && g3.world.get(5, 8) === T.LADDER &&
    g3.world.get(5, 7) === T.LADDER && g3.world.get(5, 6) === T.AIR);

  // bridge run: 1 plank per tile, clamps to stock
  const g4 = new Game(LEVELS[0]);
  g4.world = wallWorld();
  g4.stock.plank = 3;
  const bp = g4.runPlan('platform', 5, 4, 2, 4); // anchor touches the wall, run left
  check('bridge plan: 4 cells', bp.cells.length === 4);
  check('bridge plan: affordable clamps to planks', bp.affordable === 3 && bp.cost.plank === 3);
  check('bridge plan: row shows plank need vs have',
    bp.rows[0].item === 'plank' && bp.rows[0].have === 3 && bp.rows[0].need === 4 && bp.rows[0].short === true);
  const placedB = g4.placeBridgeRun(5, 4, 2, 4);
  check('placeBridgeRun places affordable count', placedB === 3 && g4.stock.plank === 0);
  check('placeBridgeRun fills the affordable prefix',
    g4.world.get(5, 4) === T.PLATFORM && g4.world.get(4, 4) === T.PLATFORM &&
    g4.world.get(3, 4) === T.PLATFORM && g4.world.get(2, 4) === T.AIR);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/drag-run.mjs`
Expected: FAIL — esbuild/runtime error `g.runPlan is not a function` (or a missing-export error), plus the new checks not printing `ok`.

- [ ] **Step 3: Add the `RunPlan` interface**

In `src/game/types.ts`, immediately after the `ShortfallRow` interface (ends around line 257), add:

```ts
// A drag-run's cells, how many the current stock can pay for (`affordable`), the
// resource total for that affordable prefix (`cost`, what a drop spends), and
// display rows for the cursor readout (`rows`, sized to the FULL run so the badge
// can warn). Single source of truth for the ghost, placement and readout.
export interface RunPlan {
  cells: { x: number; y: number }[];
  affordable: number;
  cost: Partial<Record<ItemType, number>>;
  rows: ShortfallRow[];
}
```

- [ ] **Step 4: Wire the sim imports**

In `src/game/sim.ts`, update the imports. Find the `world` import (it already pulls `rampRunCells, bridgeRunCells`) and add `ladderRunCells`; find the `types` import block that already lists `ShortfallRow` and add `RunPlan`. Concretely, ensure these names are imported:

```ts
// from './world' — add ladderRunCells alongside the existing rampRunCells, bridgeRunCells:
import { /* …existing… */ rampRunCells, bridgeRunCells, ladderRunCells } from './world';
// from './types' — add RunPlan alongside the existing ShortfallRow:
import type { /* …existing… */ ShortfallRow, RunPlan } from './types';
```

(If `ShortfallRow`/`RunPlan` are imported as a value vs `type`, match the existing style in the file — `ShortfallRow` is currently a `type` import.)

- [ ] **Step 5: Replace `placeRun` and the run-placement methods**

In `src/game/sim.ts`, replace the whole block from the `placeRun` comment through `placeBridgeRun` (currently lines ~298-319):

```ts
  // Lay a drag-run of tiles, charging the tool's cost per tile and stopping when
  // the player can no longer afford the next one. Shared by Ramp and Bridge.
  private placeRun(toolId: Tool, cells: { x: number; y: number }[], tile: T): number {
    const cost = TOOL_DEFS.find((t) => t.id === toolId)!.cost!;
    let placed = 0;
    for (const c of cells) {
      if (!this.canAfford(cost)) break;
      this.payCost(cost);
      this.world.set(c.x, c.y, tile);
      placed++;
    }
    this.onEvent({ type: placed > 0 ? 'place' : 'invalid' });
    return placed;
  }

  placeRampRun(ax: number, ay: number, tx: number, ty: number): number {
    return this.placeRun('ramp', rampRunCells(this.world, ax, ay, tx, ty), T.RAMP);
  }

  placeBridgeRun(ax: number, ay: number, tx: number, ty: number): number {
    return this.placeRun('platform', bridgeRunCells(this.world, ax, ay, tx, ty), T.PLATFORM);
  }
```

with:

```ts
  // The cells a drag would fill, from the per-tool generator.
  private runCells(tool: Tool, ax: number, ay: number, tx: number, ty: number): { x: number; y: number }[] {
    if (tool === 'ladder') return ladderRunCells(this.world, ax, ay, tx, ty);
    if (tool === 'ramp') return rampRunCells(this.world, ax, ay, tx, ty);
    return bridgeRunCells(this.world, ax, ay, tx, ty); // platform (Bridge)
  }

  // Single source of truth for a drag-run — read by the ghost, placement and the
  // cursor cost readout. `affordable` = how many leading cells the stock covers;
  // `cost` = the resource total for that prefix (what a drop spends); `rows` =
  // full-run need vs have for the readout badge.
  runPlan(tool: Tool, ax: number, ay: number, tx: number, ty: number): RunPlan {
    const cells = this.runCells(tool, ax, ay, tx, ty);
    const n = cells.length;
    if (tool === 'ladder') {
      // 1 wood per rung: spend logs first, then planks (mirrors ladderWood).
      const logsUsed = Math.min(n, this.stock.log);
      const planksUsed = Math.min(n - logsUsed, this.stock.plank);
      const cost: Partial<Record<ItemType, number>> = {};
      if (logsUsed > 0) cost.log = logsUsed;
      if (planksUsed > 0) cost.plank = planksUsed;
      const wood = this.stock.log + this.stock.plank;
      const rows: ShortfallRow[] =
        n > 0 ? [{ item: 'log', have: wood, need: n, short: n > wood }] : [];
      return { cells, affordable: logsUsed + planksUsed, cost, rows };
    }
    // ramp / platform: 1 plank per tile.
    const planks = this.stock.plank;
    const affordable = Math.min(n, planks);
    const cost: Partial<Record<ItemType, number>> = affordable > 0 ? { plank: affordable } : {};
    const rows: ShortfallRow[] =
      n > 0 ? [{ item: 'plank', have: planks, need: n, short: n > planks }] : [];
    return { cells, affordable, cost, rows };
  }

  // Lay a run's affordable prefix, paying its total cost once. The plan already
  // encodes both terrain validity and affordability, so we just place.
  private placeRun(plan: RunPlan, tile: T): number {
    this.payCost(plan.cost);
    for (let i = 0; i < plan.affordable; i++) {
      this.world.set(plan.cells[i].x, plan.cells[i].y, tile);
    }
    this.onEvent({ type: plan.affordable > 0 ? 'place' : 'invalid' });
    return plan.affordable;
  }

  placeRampRun(ax: number, ay: number, tx: number, ty: number): number {
    return this.placeRun(this.runPlan('ramp', ax, ay, tx, ty), T.RAMP);
  }

  placeBridgeRun(ax: number, ay: number, tx: number, ty: number): number {
    return this.placeRun(this.runPlan('platform', ax, ay, tx, ty), T.PLATFORM);
  }

  placeLadderRun(ax: number, ay: number, tx: number, ty: number): number {
    return this.placeRun(this.runPlan('ladder', ax, ay, tx, ty), T.LADDER);
  }
```

Note: `placeRun` no longer references `TOOL_DEFS`; that import stays (other methods use it). `ItemType` is already imported in `sim.ts`.

- [ ] **Step 6: Run tests + build to verify they pass**

Run: `node tests/drag-run.mjs`
Expected: all Task 1 and Task 2 checks print `ok`, final `all ok`, exit 0.

Run: `npm run build`
Expected: `tsc --noEmit` clean, `vite build` succeeds (no type errors from the new `RunPlan`/method signatures).

- [ ] **Step 7: Commit**

```bash
git add src/game/types.ts src/game/sim.ts tests/drag-run.mjs
git commit -m "feat(sim): runPlan single source of truth + placeLadderRun"
```

---

### Task 3: Make Ladder a drag tool (input wiring + description)

**Files:**
- Modify: `src/game/types.ts` (Ladder `ToolDef.desc`)
- Modify: `src/main.ts` (`isRunTool`; `pointerup` run dispatch; `applyTool` ladder case)

**Interfaces:**
- Consumes: `Game.placeLadderRun` (Task 2), existing `runAnchor` plumbing.
- Produces: no new exports — ladder now flows through the existing `runAnchor` → `placeLadderRun` path; a plain click is a length-1 run.

- [ ] **Step 1: Update the Ladder description**

In `src/game/types.ts`, in `TOOL_DEFS`, replace the ladder entry's `desc`. Change:

```ts
  { id: 'ladder', label: 'Ladder', key: '3', desc: 'Build a ladder tile from 1 log — or a plank if you have no logs. Smallhands climb ladders, but never while carrying goods!', cost: { log: 1 } },
```

to:

```ts
  { id: 'ladder', label: 'Ladder', key: '3', desc: 'Build a ladder from 1 log per rung — or planks if you have no logs. Drag up a wall to raise a whole ladder at once. Smallhands climb ladders, but never while carrying goods!', cost: { log: 1 } },
```

- [ ] **Step 2: Add ladder to `isRunTool`**

In `src/main.ts`, change:

```ts
const isRunTool = (t: Tool) => t === 'ramp' || t === 'platform';
```

to:

```ts
const isRunTool = (t: Tool) => t === 'ramp' || t === 'platform' || t === 'ladder';
```

- [ ] **Step 3: Dispatch ladder in the `pointerup` run branch**

In `src/main.ts`, in the `pointerup` handler, change:

```ts
    if (game && running) {
      if (a.tool === 'ramp') game.placeRampRun(a.x, a.y, t.x, t.y);
      else game.placeBridgeRun(a.x, a.y, t.x, t.y);
    }
```

to:

```ts
    if (game && running) {
      if (a.tool === 'ramp') game.placeRampRun(a.x, a.y, t.x, t.y);
      else if (a.tool === 'ladder') game.placeLadderRun(a.x, a.y, t.x, t.y);
      else game.placeBridgeRun(a.x, a.y, t.x, t.y);
    }
```

- [ ] **Step 4: Route the `applyTool` ladder case through the run**

In `src/main.ts`, in `applyTool`, change the ladder case (it currently calls `placeLadder`) to match the ramp/platform cases which already use the run variants:

```ts
    case 'ladder':
      g.placeLadder(tx, ty);
      break;
```

to:

```ts
    case 'ladder':
      g.placeLadderRun(tx, ty, tx, ty);
      break;
```

- [ ] **Step 5: Build to verify it compiles**

Run: `npm run build`
Expected: clean. (`placeLadder` remains defined and is still used by nothing else problematic; leaving it is fine — do not delete it, it is part of the public sim surface used by tests/`window.__smallhands`.)

- [ ] **Step 6: Verify in the running game**

Serve the build and drive a ladder drag with the browse/run harness (see the `testing-smallhands` memory: `npm run build && npm run preview &`, then use `window.__smallhands` `setTool('ladder')` and a pointer drag along a wall). Confirm: dragging up a wall lays a column of ladders in one gesture; a single click still places one ladder; a horizontal drag still snaps to one column.

- [ ] **Step 7: Commit**

```bash
git add src/game/types.ts src/main.ts
git commit -m "feat(ui): ladder is a drag-run tool"
```

---

### Task 4: Ghost with red tail (honest preview)

**Files:**
- Modify: `src/main.ts` (`runOverlay`)

**Interfaces:**
- Consumes: `Game.runPlan` (Task 2), `hover.tx`/`hover.ty`, `sprite`, `TILE` (all already imported/used in `main.ts`).
- Produces: nothing new — replaces the body of the existing `runOverlay`.

- [ ] **Step 1: Replace `runOverlay`**

In `src/main.ts`, replace the whole `runOverlay` const:

```ts
const runOverlay = (ctx: CanvasRenderingContext2D) => {
  if (!runAnchor || !game) return;
  const cells =
    runAnchor.tool === 'ramp'
      ? rampRunCells(game.world, runAnchor.x, runAnchor.y, hover.tx, hover.ty)
      : bridgeRunCells(game.world, runAnchor.x, runAnchor.y, hover.tx, hover.ty);
  const name = runAnchor.tool === 'ramp' ? 'tile_ramp' : 'tile_platform';
  ctx.globalAlpha = 0.6;
  for (const c of cells) ctx.drawImage(sprite(name).canvas, c.x * TILE, c.y * TILE);
  ctx.globalAlpha = 1;
};
```

with:

```ts
const RUN_SPRITE: Record<'ramp' | 'platform' | 'ladder', string> = {
  ramp: 'tile_ramp',
  platform: 'tile_platform',
  ladder: 'tile_ladder',
};

const runOverlay = (ctx: CanvasRenderingContext2D) => {
  if (!runAnchor || !game) return;
  const plan = game.runPlan(runAnchor.tool, runAnchor.x, runAnchor.y, hover.tx, hover.ty);
  const spr = sprite(RUN_SPRITE[runAnchor.tool as 'ramp' | 'platform' | 'ladder']).canvas;
  plan.cells.forEach((c, i) => {
    const affordable = i < plan.affordable;
    ctx.globalAlpha = affordable ? 0.6 : 0.35;
    ctx.drawImage(spr, c.x * TILE, c.y * TILE);
    if (!affordable) {
      ctx.fillStyle = 'rgba(255,122,107,0.35)';
      ctx.fillRect(c.x * TILE, c.y * TILE, TILE, TILE);
    }
  });
  ctx.globalAlpha = 1;
};
```

Note: this removes the last uses of `rampRunCells`/`bridgeRunCells` in `main.ts`. If the `import { rampRunCells, bridgeRunCells } from './game/world'` line now has no remaining users, delete that import to keep the build warning-free; if either is still referenced, keep the ones that are.

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build`
Expected: clean. If `tsc` flags an unused import (`rampRunCells`/`bridgeRunCells`), remove the unused names from the `./game/world` import in `main.ts` and rebuild.

- [ ] **Step 3: Verify in the running game**

Serve the build and drag a Ramp/Bridge/Ladder run longer than your resources allow. Confirm the leading tiles render solid (green feel) and the tail dims with a red wash, and that the boundary is exactly where placement stops (drop the run and count the placed tiles).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(render): drag-run ghost dims the unaffordable tail"
```

---

### Task 5: Cursor cost readout during a drag

**Files:**
- Modify: `src/game/ui.ts` (import `ShortfallRow`; add `runCost`/`runCostSig` fields; add `showRunCost`/`hideRunCost`)
- Modify: `src/main.ts` (`pointermove` shows the readout during a run; hide on `pointerup`/`pointercancel`/`pointerleave`)

**Interfaces:**
- Consumes: `RunPlan.rows` (Task 2), existing `el`/`icon`/`ITEM_ICON`/`TOOL_DEFS` helpers in `ui.ts`, the `.tooltip`/`.tt-cost`/`.insufficient` CSS.
- Produces:
  - `Hud.showRunCost(clientX: number, clientY: number, rows: ShortfallRow[], tool: Tool): void`
  - `Hud.hideRunCost(): void`

- [ ] **Step 1: Import `ShortfallRow` in `ui.ts`**

In `src/game/ui.ts`, add `ShortfallRow` to the existing type import from `./types`:

```ts
import type { BuildingKind, ItemType, Role, ShortfallRow, Tool } from './types';
```

- [ ] **Step 2: Add the HUD fields**

In `src/game/ui.ts`, next to the existing `private needs` / `private needsSig` fields (around line 83), add:

```ts
  private runCost: HTMLElement | null = null;
  private runCostSig = '';
```

- [ ] **Step 3: Add `showRunCost` / `hideRunCost`**

In `src/game/ui.ts`, immediately after `hidePlacementNeeds()` (ends around line 468), add:

```ts
  // While dragging a build-run (Ladder/Ramp/Bridge), show the run's running
  // total cost at the cursor. Unlike the shortfall badge this ALWAYS shows during
  // a drag (the point is the total); a resource the full run can't afford flips
  // to a red have/need. `rows` come straight from Game.runPlan.
  showRunCost(clientX: number, clientY: number, rows: ShortfallRow[], tool: Tool): void {
    if (rows.length === 0) {
      this.hideRunCost();
      return;
    }
    const label = TOOL_DEFS.find((t) => t.id === tool)?.label ?? '';
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
```

- [ ] **Step 4: Show the readout during a drag in `pointermove`**

In `src/main.ts`, find the cursor-cost-badge block in `pointermove`:

```ts
  // cursor cost badge: while placing a cost-bearing tool, spell out which
  // resource is short so a red ghost isn't a mystery (no-op when affordable)
  if (!dragging && game && running) hud?.showPlacementNeeds(e.clientX, e.clientY, hover.tool);
  else hud?.hidePlacementNeeds();
```

Replace it with:

```ts
  // cursor cost readout: during a drag-run show the run's running total (always);
  // otherwise, while placing a cost-bearing tool, spell out any shortfall.
  if (runAnchor && game && running) {
    const plan = game.runPlan(runAnchor.tool, runAnchor.x, runAnchor.y, t.x, t.y);
    hud?.hidePlacementNeeds();
    hud?.showRunCost(e.clientX, e.clientY, plan.rows, runAnchor.tool);
  } else {
    hud?.hideRunCost();
    if (!dragging && game && running) hud?.showPlacementNeeds(e.clientX, e.clientY, hover.tool);
    else hud?.hidePlacementNeeds();
  }
```

(`t` is the tile already computed at the top of `pointermove`.)

- [ ] **Step 5: Hide the readout on pointer end**

In `src/main.ts`, add `hud?.hideRunCost();` in three handlers:

- In `pointerup`, right after `dragging = false;` (first line of the handler):

```ts
canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  hud?.hideRunCost();
```

- In `pointercancel`, alongside the existing resets:

```ts
canvas.addEventListener('pointercancel', () => {
  dragging = false;
  runAnchor = null;
  hud?.hideRunCost();
  applyToolCursor();
});
```

- In `pointerleave`, alongside the other hides:

```ts
canvas.addEventListener('pointerleave', () => {
  hover.visible = false;
  hud?.hideBuildingHint();
  hud?.hidePlacementNeeds();
  hud?.hideRunCost();
  editor.setHover(0, 0, false);
});
```

- [ ] **Step 6: Build to verify it compiles**

Run: `npm run build`
Expected: clean.

- [ ] **Step 7: Verify in the running game**

Serve the build. Drag each of Ladder/Ramp/Bridge and confirm a tooltip follows the cursor showing the tool label and the run's total (e.g. `Bridge 5`); drag past your budget and confirm it flips to a red `have/need` (e.g. `3/5`), matching where the ghost's red tail begins. Confirm the readout disappears on drop and when the pointer leaves the canvas, and that the plain shortfall badge still works when hovering (not dragging).

- [ ] **Step 8: Commit**

```bash
git add src/game/ui.ts src/main.ts
git commit -m "feat(ui): live run-cost readout at the cursor while dragging"
```

---

## Self-Review

**Spec coverage:**
- Ladder drag as vertical column → Task 1 (`ladderRunCells`) + Task 3 (input wiring). ✓
- `runPlan` single source of truth (`cells`/`affordable`/`cost`/`rows`) → Task 2. ✓
- Ladder log→plank cost accounting → Task 2 (`runPlan` ladder branch + `placeLadderRun`). ✓
- Ramp/Bridge single-resource plank cost, affordable clamp → Task 2. ✓
- Ghost with red tail; placement lays only the affordable prefix → Task 4 (`runOverlay`) + Task 2 (`placeRun`). ✓
- Cursor cost readout, always-on during drag, red `have/need` when short, shortfall badge suppressed during drag and restored after → Task 5. ✓
- Discoverability (Ladder desc) → Task 3. ✓
- Latent ghost-vs-placed bug closed → Task 2 + Task 4 (both read `runPlan`). ✓
- Non-goals (no editor changes, no balance/sprite/CSS changes, no horizontal ladders, no always-on hover readout) → respected across all tasks; Global Constraints restate them. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Every code step shows complete code. ✓

**Type consistency:** `runPlan` returns `RunPlan` (Task 2, defined in `types.ts`) consumed by `runOverlay` (Task 4: `.cells`/`.affordable`) and `pointermove` (Task 5: `.rows`). `ShortfallRow` shape `{ item, have, need, short }` is the same one `showRunCost` renders. `placeLadderRun(ax, ay, tx, ty): number` defined in Task 2, called in Task 3 (`pointerup`, `applyTool`). `RUN_SPRITE` keys (`ramp`/`platform`/`ladder`) match the `Tool` values `runAnchor.tool` can hold for run tools. ✓
