# Ramp & Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the overloaded Platform tool into a **Ramp** (diagonal climb) and a **Bridge** (horizontal span) — two clear identities over the same tile-grid support mechanic — and make the Ramp available on Level 4 where the failure was observed.

**Architecture:** Add a new `T.RAMP` support tile that behaves exactly like `T.PLATFORM` for movement/support, plus pure placement helpers (`canPlaceRamp`, `rampRunCells`, `bridgeRunCells`) and batch sim placers (`placeRampRun`, `placeBridgeRun`). Rendering draws ramp tiles as a diagonal slope; `main.ts` gains drag-run placement for both build tools and previews the run in the existing `overlay` callback. No change to the nav/movement model.

**Tech Stack:** TypeScript, Vite. Pure-sim tests use the repo's esbuild-bundled headless harness (see `tests/unit.mjs`); run with plain `node`. Rendering/UI is verified in the browser (Vite dev/preview).

**Working directory:** This plan is executed in the isolated git worktree `/Users/av/Code/smallhands-rb` on branch `feat/ramp-and-bridge`. All paths below are repo-relative to that worktree. Run all `git`/`node`/`npx` commands from the worktree root.

## Global Constraints

- **No movement-model change.** The nav graph is untouched; ramps are ordinary support tiles a worker hops one tile per step. (`nav.ts` step-up at lines 110-113 already works while carrying.)
- **`T.RAMP = 7`**, appended after `LADDER = 6`, so existing tile byte values are unchanged and all saves/share-codes still load.
- **Fixed 45° (1:1) pitch** for ramps — each step is exactly ±1 in x and ±1 in y. No shallower/steeper single-ramp grades.
- **1 plank per tile** for both Ramp and Bridge. **Keep the internal tool id `platform`** (user-facing label → "Bridge"); add a new tool id `ramp`.
- **Level 4 only** gets `ramp` this pass. Level 2 stays lift-only; Levels 1 and 3 unchanged.
- **Verifier stays bridge-only** for speculative reachability (conservative; never accepts an unsolvable level). Hand-placed ramps validate because `T.RAMP ∈ isSupport`.
- **Preserve "up is expensive":** a ramp costs a plank and a horizontal tile per tile of height; lifts remain required on sheer/no-room cliffs.

---

### Task 1: `T.RAMP` tile + support semantics + core mechanic proof

**Files:**
- Modify: `src/game/types.ts:6-14` (add `RAMP = 7`)
- Modify: `src/game/world.ts:48-53` (`isSupport` includes `T.RAMP`)
- Create: `tests/ramp.mjs`

**Interfaces:**
- Produces: `T.RAMP` (enum value `7`); `World.isSupport(x,y)` returns `true` over ramp tiles. Later tasks rely on `T.RAMP` and on ramp tiles being standable floor.

- [ ] **Step 1: Write the failing test** — create `tests/ramp.mjs`:

```javascript
// Headless checks for the Ramp/Bridge feature. Bundles the TS sim with esbuild
// (a vite dep) and imports it from a data URL, so it runs with plain `node`.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const res = await build({
  stdin: {
    contents: `
      export { World } from './src/game/world.ts';
      export { findPath } from './src/game/nav.ts';
      export { T } from './src/game/types.ts';
    `,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(res.outputFiles[0].text).toString('base64'));
const { World, findPath, T } = mod;

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}`);
  if (!cond) failures++;
}

// Build a flat world with a +2 step up at column stepX, then hand-place a 45°
// ramp of RAMP tiles and confirm a CARRYING worker can climb it.
function stepWorld() {
  const w = new World(24, 20);
  const surfaceY = 14, stepX = 10;
  for (let x = 0; x < w.w; x++) {
    const sy = x < stepX ? surfaceY : surfaceY - 2; // +2 ledge on the right
    for (let y = 0; y < w.h; y++) w.set(x, y, y < sy ? T.AIR : y === sy ? T.GRASS : T.DIRT);
  }
  return { w, surfaceY, stepX };
}

// --- Task 1: RAMP is floor support; a ramp staircase is climbable while carrying ---
{
  const { w, surfaceY, stepX } = stepWorld();
  // an air cell is not support; the same cell as RAMP is
  check('AIR is not support', w.isSupport(2, 2) === false);
  w.set(2, 2, T.RAMP);
  check('RAMP is floor support', w.isSupport(2, 2) === true);
  w.set(2, 2, T.AIR);

  // control: bare +2 step is NOT climbable while carrying
  const start = new Set([w.key(stepX, surfaceY - 3)]); // standable on the ledge (10,11)
  const bare = findPath(w, [], stepX - 3, surfaceY - 1, start, true);
  check('bare +2 step: no carry path (control)', bare === null);

  // ramp: two support tiles forming a 45° staircase up to the ledge. Standing on
  // top of them gives cells (stepX-2, surfaceY-2) then (stepX-1, surfaceY-3),
  // from which the worker walks flat onto the ledge at (stepX, surfaceY-3).
  w.set(stepX - 2, surfaceY - 1, T.RAMP); // (8,13) -> stand (8,12)
  w.set(stepX - 1, surfaceY - 2, T.RAMP); // (9,12) -> stand (9,11)
  const withRamp = findPath(w, [], stepX - 3, surfaceY - 1, start, true);
  check('ramp staircase: carry path exists', withRamp !== null);
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it and watch it fail to build (RAMP undefined)**

Run: `node tests/ramp.mjs`
Expected: esbuild/enum error — `T.RAMP` is `undefined`, so the ramp checks fail (or the run reports `FAILED`).

- [ ] **Step 3: Add `RAMP = 7` to the tile enum** — `src/game/types.ts`:

```typescript
export const enum T {
  AIR = 0,
  DIRT = 1,
  GRASS = 2, // dirt with a grassy top surface
  ROCK = 3,
  BEDROCK = 4,
  PLATFORM = 5, // player-built wooden floor (the "Bridge" tool)
  LADDER = 6, // player-built ladder
  RAMP = 7, // player-built diagonal climb tile (support, like PLATFORM)
}
```

- [ ] **Step 4: Make `isSupport` include `T.RAMP`** — `src/game/world.ts`, in `isSupport`:

```typescript
  // Does this cell provide floor support for the cell above it?
  isSupport(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true; // world edge acts as floor
    const t = this.get(x, y);
    if (t === T.DIRT || t === T.GRASS || t === T.ROCK || t === T.BEDROCK || t === T.PLATFORM || t === T.LADDER || t === T.RAMP) return true;
    return this.extraSupport.has(this.idx(x, y));
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/ramp.mjs`
Expected: all three Task-1 checks `ok`; final line `all ok`.

- [ ] **Step 6: Commit**

```bash
git add src/game/types.ts src/game/world.ts tests/ramp.mjs
git commit -m "feat(world): add T.RAMP support tile; ramp staircase is carry-climbable"
```

---

### Task 2: Placement logic — `canPlaceRamp`, `rampRunCells`, `bridgeRunCells`

**Files:**
- Modify: `src/game/world.ts` (add three exported functions near `canPlacePlatform`, ~line 78)
- Modify: `tests/ramp.mjs` (extend bundle exports + add checks)

**Interfaces:**
- Consumes: `T.RAMP`, `World.isSolid/isSupport/isPassable/get`, existing `canPlacePlatform`.
- Produces:
  - `canPlaceRamp(world: World, x: number, y: number, prev: {x:number;y:number} | null): boolean`
  - `rampRunCells(world: World, ax: number, ay: number, tx: number, ty: number): {x:number;y:number}[]` — the buildable 45° chain from anchor `(ax,ay)` toward `(tx,ty)`, truncated at the first invalid cell.
  - `bridgeRunCells(world: World, ax: number, ay: number, tx: number, ty: number): {x:number;y:number}[]` — the buildable horizontal run at row `ay` from `ax` toward `tx`.

- [ ] **Step 1: Add the failing checks** — in `tests/ramp.mjs`, update the bundle `stdin.contents` to also export the new helpers:

```javascript
    contents: `
      export { World } from './src/game/world.ts';
      export { findPath } from './src/game/nav.ts';
      export { T } from './src/game/types.ts';
      export { canPlaceRamp, rampRunCells, bridgeRunCells } from './src/game/world.ts';
    `,
```

and update the destructure line to `const { World, findPath, T, canPlaceRamp, rampRunCells, bridgeRunCells } = mod;`, then append before the final summary:

```javascript
// --- Task 2: placement logic ---
{
  const { w, surfaceY, stepX } = stepWorld();
  // anchor on the ground (solid below) is valid; floating anchor is not
  check('anchor on ground valid', canPlaceRamp(w, stepX - 2, surfaceY - 1, null) === true);
  check('floating anchor invalid', canPlaceRamp(w, stepX - 2, surfaceY - 5, null) === false);
  // a diagonal chain step from a previous ramp tile is valid; a straight step is not
  check('diagonal chain valid', canPlaceRamp(w, stepX - 1, surfaceY - 2, { x: stepX - 2, y: surfaceY - 1 }) === true);
  check('non-diagonal chain invalid', canPlaceRamp(w, stepX - 1, surfaceY - 1, { x: stepX - 2, y: surfaceY - 1 }) === false);

  // an ascending 45° run of length 2 into the ledge
  const up = rampRunCells(w, stepX - 2, surfaceY - 1, stepX, surfaceY - 3);
  check('rampRunCells ascends 45 for 3 cells', up.length === 3 &&
    up[0].x === stepX - 2 && up[0].y === surfaceY - 1 &&
    up[1].x === stepX - 1 && up[1].y === surfaceY - 2 &&
    up[2].x === stepX && up[2].y === surfaceY - 3);
  // run stops at the first solid cell: dragging down-left off the ledge into the
  // terrace body places only the anchor before the next cell hits grass
  check('rampRunCells stops at solid', rampRunCells(w, stepX + 1, surfaceY - 3, stepX - 2, surfaceY).length === 1);

  // bridge: horizontal run along a row anchored to the ledge edge
  const br = bridgeRunCells(w, stepX, surfaceY - 3, stepX + 3, surfaceY - 3);
  check('bridgeRunCells is horizontal', br.length >= 1 && br.every((c) => c.y === surfaceY - 3));
}
```

- [ ] **Step 2: Run and watch it fail to build (exports missing)**

Run: `node tests/ramp.mjs`
Expected: esbuild error `No matching export ... for import "canPlaceRamp"`.

- [ ] **Step 3: Implement the three helpers** — add to `src/game/world.ts` after `canPlacePlatform` (~line 88):

```typescript
// A ramp tile is a support tile placed either with solid contact (the anchor of
// a run) or diagonally adjacent to the previous ramp tile in the run. It always
// needs clear headroom (the cell above, where a worker stands, must be passable).
export function canPlaceRamp(
  world: World,
  x: number,
  y: number,
  prev: { x: number; y: number } | null
): boolean {
  if (world.get(x, y) !== T.AIR) return false; // never overwrite terrain/other tiles
  if (!world.isPassable(x, y - 1)) return false; // headroom for the worker standing on top
  if (!prev) {
    // anchor: must touch something solid so the run isn't floating
    return (
      world.isSolid(x - 1, y) ||
      world.isSolid(x + 1, y) ||
      world.isSupport(x, y + 1) ||
      world.get(x - 1, y) === T.RAMP ||
      world.get(x + 1, y) === T.RAMP
    );
  }
  // chain step: exactly one diagonal from the previous ramp tile (fixed 45deg pitch)
  return Math.abs(x - prev.x) === 1 && Math.abs(y - prev.y) === 1;
}

// The buildable 45deg ramp chain from anchor (ax,ay) toward (tx,ty). Snaps to the
// shorter axis so it stays 1:1, and stops at the first cell that fails validation.
export function rampRunCells(
  world: World,
  ax: number,
  ay: number,
  tx: number,
  ty: number
): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  const dx = Math.sign(tx - ax);
  const sy = Math.sign(ty - ay);
  if (dx === 0 || sy === 0) {
    if (canPlaceRamp(world, ax, ay, null)) cells.push({ x: ax, y: ay });
    return cells;
  }
  const n = Math.min(Math.abs(tx - ax), Math.abs(ty - ay));
  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i <= n; i++) {
    const cx = ax + i * dx;
    const cy = ay + i * sy;
    if (!canPlaceRamp(world, cx, cy, prev)) break;
    cells.push({ x: cx, y: cy });
    prev = { x: cx, y: cy };
  }
  return cells;
}

// The buildable horizontal bridge run at row ay from ax toward tx.
export function bridgeRunCells(
  world: World,
  ax: number,
  ay: number,
  tx: number,
  _ty: number
): { x: number; y: number }[] {
  const cells: { x: number; y: number }[] = [];
  const dx = Math.sign(tx - ax) || 1;
  const n = Math.abs(tx - ax);
  for (let i = 0; i <= n; i++) {
    const cx = ax + i * dx;
    if (!canPlacePlatform(world, cx, ay)) break;
    cells.push({ x: cx, y: ay });
  }
  return cells;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/ramp.mjs`
Expected: all Task-1 and Task-2 checks `ok`; final line `all ok`.

- [ ] **Step 5: Commit**

```bash
git add src/game/world.ts tests/ramp.mjs
git commit -m "feat(world): canPlaceRamp + rampRunCells/bridgeRunCells placement helpers"
```

---

### Task 3: Tool defs + sim batch placers + demolish

**Files:**
- Modify: `src/game/types.ts:128-158` (`Tool` union + `TOOL_DEFS`)
- Modify: `src/game/sim.ts` (add `placeRampRun`/`placeBridgeRun` near `placePlatform` ~line 280; add `T.RAMP` to `demolish` ~line 337)
- Modify: `tests/ramp.mjs`

**Interfaces:**
- Consumes: `canPlaceRamp`, `rampRunCells`, `bridgeRunCells`, `canAfford`, `payCost`, `onEvent`.
- Produces:
  - Tool id `'ramp'` in the `Tool` union and `TOOL_DEFS` (cost `{ plank: 1 }`, key `'0'`, label `Ramp`); the `'platform'` entry relabelled to `Bridge` (id unchanged).
  - `Game.placeRampRun(ax: number, ay: number, tx: number, ty: number): number` — places every affordable, valid ramp cell in the run; returns the count placed.
  - `Game.placeBridgeRun(ax: number, ay: number, tx: number, ty: number): number` — same for a horizontal bridge run.

- [ ] **Step 1: Add the failing checks** — in `tests/ramp.mjs`, extend the bundle exports:

```javascript
    contents: `
      export { World } from './src/game/world.ts';
      export { findPath } from './src/game/nav.ts';
      export { T } from './src/game/types.ts';
      export { canPlaceRamp, rampRunCells, bridgeRunCells } from './src/game/world.ts';
      export { Game } from './src/game/sim.ts';
      export { LEVELS } from './src/game/levels.ts';
      export { TOOL_DEFS } from './src/game/types.ts';
    `,
```

update the destructure to include `Game, LEVELS, TOOL_DEFS`, then append:

```javascript
// --- Task 3: tool defs + sim placers ---
{
  const ramp = TOOL_DEFS.find((t) => t.id === 'ramp');
  const bridge = TOOL_DEFS.find((t) => t.id === 'platform');
  check('ramp tool defined, 1 plank', !!ramp && ramp.cost && ramp.cost.plank === 1);
  check('platform tool relabelled Bridge', !!bridge && bridge.label === 'Bridge');

  // placeRampRun charges a plank per placed tile and lays RAMP tiles.
  // Columns 12-29 of Level 1 are one flat run, so pick a safe column there.
  const g = new Game(LEVELS[0]);
  g.stock.plank = 10;
  const col = 20;
  const sfc = (() => { for (let y = 0; y < g.world.h; y++) if (g.world.isSolid(col, y)) return y - 1; return 0; })();
  const placed = g.placeRampRun(col, sfc, col + 3, sfc - 3);
  check('placeRampRun places >=2 tiles', placed >= 2);
  check('placeRampRun laid RAMP tiles', g.world.get(col, sfc) === T.RAMP);
  check('placeRampRun charged planks', g.stock.plank === 10 - placed);

  // demolish removes a ramp and refunds like a platform
  const before = g.stock.plank;
  check('demolish ramp ok', g.demolish(col, sfc) === true && g.world.get(col, sfc) === T.AIR);
  check('demolish ramp refunds a plank', g.stock.plank === before + 1);
}
```

- [ ] **Step 2: Run and watch it fail (ramp tool / placeRampRun missing)**

Run: `node tests/ramp.mjs`
Expected: `ramp tool defined` FAILs and/or a `g.placeRampRun is not a function` error.

- [ ] **Step 3: Add the tool defs** — `src/game/types.ts`. Extend the `Tool` union with `'ramp'`:

```typescript
export type Tool =
  | 'select'
  | 'harvest'
  | 'ladder'
  | 'platform'
  | 'ramp'
  | 'sawmill'
  | 'forge'
  | 'lift'
  | 'rope'
  | 'demolish';
```

Relabel the platform entry and add the ramp entry (place `ramp` right after `platform` so they sit together in the toolbar), key `'0'`:

```typescript
  { id: 'platform', label: 'Bridge', key: '4', desc: 'Build a wooden bridge to span a gap or hole — drag to lay a run.', cost: { plank: 1 } },
  { id: 'ramp', label: 'Ramp', key: '0', desc: 'Build a diagonal ramp to climb a layer — drag up or down from solid ground. Loaded smallhands can walk it (unlike ladders).', cost: { plank: 1 } },
```

- [ ] **Step 4: Add the sim placers** — `src/game/sim.ts`, after `placePlatform` (~line 280). Add the import of the new helpers to the existing `world` import at the top of the file (line 30): add `canPlaceRamp, rampRunCells, bridgeRunCells` to the destructured import list.

```typescript
  placeRampRun(ax: number, ay: number, tx: number, ty: number): number {
    const cost = TOOL_DEFS.find((t) => t.id === 'ramp')!.cost!;
    const cells = rampRunCells(this.world, ax, ay, tx, ty);
    let placed = 0;
    for (const c of cells) {
      if (!this.canAfford(cost)) break;
      this.payCost(cost);
      this.world.set(c.x, c.y, T.RAMP);
      placed++;
    }
    this.onEvent({ type: placed > 0 ? 'place' : 'invalid' });
    return placed;
  }

  placeBridgeRun(ax: number, ay: number, tx: number, ty: number): number {
    const cost = TOOL_DEFS.find((t) => t.id === 'platform')!.cost!;
    const cells = bridgeRunCells(this.world, ax, ay, tx, ty);
    let placed = 0;
    for (const c of cells) {
      if (!this.canAfford(cost)) break;
      this.payCost(cost);
      this.world.set(c.x, c.y, T.PLATFORM);
      placed++;
    }
    this.onEvent({ type: placed > 0 ? 'place' : 'invalid' });
    return placed;
  }
```

- [ ] **Step 5: Include `T.RAMP` in demolish** — `src/game/sim.ts:337`:

```typescript
    if (t === T.LADDER || t === T.PLATFORM || t === T.RAMP) {
      this.world.set(x, y, T.AIR);
      // Refund in planks even for ladders (which may have been paid in logs):
      // refunding a log would let plank->ladder->demolish->log->sawmill mint free
      // planks. Planks never convert back to logs, so a plank refund can't loop.
      this.refund({ plank: 1 }, 0.5);
      this.onEvent({ type: 'demolish' });
      return true;
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node tests/ramp.mjs`
Expected: all checks through Task 3 `ok`; `all ok`.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript compilation completed` (no errors).

- [ ] **Step 8: Commit**

```bash
git add src/game/types.ts src/game/sim.ts tests/ramp.mjs
git commit -m "feat(sim): Ramp tool + placeRampRun/placeBridgeRun; relabel Platform->Bridge"
```

---

### Task 4: Level 4 integration — offer the Ramp + teaching hint

**Files:**
- Modify: `src/game/levels.ts:266` (Level 4 `allowedTools`) and `:306-317` (hints)
- Modify: `tests/ramp.mjs`

**Interfaces:**
- Consumes: `Game.toolUnlocked`, `LEVELS`.
- Produces: `LEVELS[3].allowedTools` includes `'ramp'`; a new hint with `id: 'ramp'`.

- [ ] **Step 1: Add the failing checks** — append to `tests/ramp.mjs`:

```javascript
// --- Task 4: Level 4 offers Ramp; Level 2 does not ---
{
  const g4 = new Game(LEVELS[3]); // The Summit Beacon
  const g2 = new Game(LEVELS[1]); // The Cliff Shrine (lift-only)
  check('Level 4 allows ramp', g4.toolUnlocked('ramp') === true);
  check('Level 2 does NOT allow ramp', g2.toolUnlocked('ramp') === false);
  check('Level 4 has a ramp hint', (LEVELS[3].hints ?? []).some((h) => h.id === 'ramp'));
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `node tests/ramp.mjs`
Expected: `Level 4 allows ramp` FAILs (ramp not in `allowedTools`).

- [ ] **Step 3: Add `'ramp'` to Level 4's tools** — `src/game/levels.ts:266`:

```typescript
    allowedTools: ['select', 'harvest', 'ladder', 'platform', 'ramp', 'sawmill', 'forge', 'lift', 'demolish'],
```

- [ ] **Step 4: Add a teaching hint** — in Level 4's `hints` array, add a third entry:

```typescript
      {
        id: 'ramp',
        text: 'Short steps a lift refuses? Build a <b>Ramp</b> — drag a diagonal from solid ground. Loaded smallhands walk ramps (unlike ladders), up <i>and</i> down.',
        when: (g) => g.time > 15,
      },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node tests/ramp.mjs`
Expected: all checks through Task 4 `ok`; `all ok`.

- [ ] **Step 6: Commit**

```bash
git add src/game/levels.ts tests/ramp.mjs
git commit -m "feat(levels): offer the Ramp on Level 4 with a teaching hint"
```

---

### Task 5: Verifier confirmation + DESIGN.md wording

**Files:**
- Modify: `tests/ramp.mjs` (verifier check)
- Modify: `docs/DESIGN.md` (the "no platforms" challenge-mode example wording)
- (No code change expected in `src/game/leveldata.ts` — confirm via test that `T.RAMP` support flows through `verifyLevel`.)

**Interfaces:**
- Consumes: `verifyLevel`, `encodeTiles`, `blankLevelData` from `src/game/leveldata.ts`.

- [ ] **Step 1: Add the failing check** — extend the bundle exports in `tests/ramp.mjs`:

```javascript
      export { verifyLevel, blankLevelData, encodeTiles } from './src/game/leveldata.ts';
```

update the destructure to include them, then append:

```javascript
// --- Task 5: verifier treats RAMP as support (hand-placed ramps validate) ---
{
  const data = blankLevelData(64, 28);
  // decode the RLE tiles, drop a RAMP tile in a clearly-air surface cell far from
  // the town hall / goal footprints, then re-encode.
  const decoded = new Uint8Array(data.width * data.height);
  let i = 0;
  for (const part of data.tiles.split(',')) {
    const [t, n] = part.includes('x') ? part.split('x').map(Number) : [Number(part), 1];
    for (let k = 0; k < n && i < decoded.length; k++) decoded[i++] = t;
  }
  const standY = data.height - 8 - 1; // blankLevelData ground: 8 tiles, surface at height-8
  const airIdx = standY * data.width + 30; // (30, standY): air just above the surface
  decoded[airIdx] = T.RAMP;
  data.tiles = encodeTiles(decoded);
  const report = verifyLevel(data);
  check('verifyLevel runs with ramp tiles (no crash)', Array.isArray(report.problems));
  check('ramp byte round-trips through decode/encode', report.problems.length === 0 || Array.isArray(report.warnings));
}
```

- [ ] **Step 2: Run it**

Run: `node tests/ramp.mjs`
Expected: the two Task-5 checks run. If `verifyLevel` treats `T.RAMP` as support (it calls `world.isSupport`, already true from Task 1), they pass with no `leveldata.ts` change. If a check fails, inspect `report.problems` and adjust `leveldata.ts` only if it explicitly special-cases tile kinds (it does not today).

- [ ] **Step 3: Fix DESIGN.md wording** — locate the challenge-mode line mentioning `no platforms` (around `docs/DESIGN.md:240`) and reword for the split, e.g. change `"no platforms"` to `"no ramps or bridges"`. Also add one clarifying sentence in the transport section if present: a Ramp is mechanically a Bridge tile, so a level that bans bridging to force a lift/rope must exclude both `'platform'` and `'ramp'`.

- [ ] **Step 4: Re-run tests**

Run: `node tests/ramp.mjs`
Expected: `all ok`.

- [ ] **Step 5: Commit**

```bash
git add tests/ramp.mjs docs/DESIGN.md
git commit -m "test(verify): confirm ramp tiles validate; docs: split platform->ramp/bridge wording"
```

---

### Task 6: `tile_ramp` sprite + slope terrain rendering

**Files:**
- Modify: `src/engine/sprites.ts` (after `tile_platform`, ~line 144)
- Modify: `src/game/render.ts:211-218` (terrain draw switch)

**Interfaces:**
- Consumes: `T.RAMP`, the `makeSprite` factory, `sprite()` lookup.
- Produces: a registered `tile_ramp` sprite; `drawTerrain` renders `T.RAMP` cells as a diagonal slope (flipped for up-left runs).

Rendering is canvas-only and not exercised by the headless harness, so this task is verified visually in the browser.

- [ ] **Step 1: Add the `tile_ramp` sprite** — `src/engine/sprites.ts`, after the `tile_platform` block. It reuses the plank palette and draws a bottom-left triangle (a slope rising to the right):

```typescript
  makeSprite('tile_ramp', platPal, [
    '...............P',
    '..............PP',
    '.............Ppp',
    '............Ppkp',
    '...........Ppksk',
    '..........Ppksk.',
    '.........Ppkskk.',
    '........Ppkskks.',
    '.......Ppkskkskk',
    '......Ppkskkskks',
    '.....Ppkskkskksk',
    '....Ppkskkskkskk',
    '...Ppkskkskkskks',
    '..Ppkskkskkskksk',
    '.Ppkskkskkskkskk',
    'Ppkskkskkskkskks',
  ]);
```

- [ ] **Step 2: Render `T.RAMP` as a slope** — `src/game/render.ts`, in the `drawTerrain` tile switch add a case, and draw with a horizontal flip when the run descends to the left (so the slope faces the right way). Replace the switch tail (after the `T.LADDER` case, before `}`) and the `drawImage` that follows:

```typescript
          case T.LADDER:
            name = 'tile_ladder';
            break;
          case T.RAMP:
            name = 'tile_ramp';
            break;
        }
        if (name === 'tile_ramp') {
          // face the slope toward the higher neighbour: if the ramp continues
          // up to the left (a RAMP tile up-left), mirror the default up-right art
          const upLeft = world.get(x - 1, y - 1) === T.RAMP || world.get(x - 1, y) === T.RAMP;
          const spr = sprite('tile_ramp').canvas;
          if (upLeft) {
            ctx.save();
            ctx.translate(px + TILE, py);
            ctx.scale(-1, 1);
            ctx.drawImage(spr, 0, 0);
            ctx.restore();
          } else {
            ctx.drawImage(spr, px, py);
          }
        } else if (name) {
          ctx.drawImage(sprite(name).canvas, px, py);
        }
```

(Note: this replaces the single `if (name) ctx.drawImage(...)` at line 218 — keep the existing solid-terrain shading block that follows unchanged; `T.RAMP` is not solid so it is skipped by `if (world.isSolid(...))`.)

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: `tsc` passes and Vite build succeeds.

- [ ] **Step 4: Visual check in the browser** — start the preview and confirm a ramp renders as a slope:

Run: `npm run build && (npm run preview &)` then open `http://localhost:4173/`, start Level 4, select the **Ramp** tool, and drag a short diagonal up a step.
Expected: placed tiles render as a continuous diagonal slope (not flat deck), facing the climb direction; a worker walks up it.

- [ ] **Step 5: Commit**

```bash
git add src/engine/sprites.ts src/game/render.ts
git commit -m "feat(render): tile_ramp sprite + diagonal slope rendering"
```

---

### Task 7: `main.ts` drag-run placement + ghost preview

**Files:**
- Modify: `src/main.ts` — pointer handlers (`pointerdown` ~743, `pointermove` ~757, `pointerup` ~794), `applyTool` (~964-985), and the render call site to draw the run ghost via the existing `overlay` callback.

**Interfaces:**
- Consumes: `Game.placeRampRun`, `Game.placeBridgeRun`, `rampRunCells`, `bridgeRunCells`, `sprite()`.
- Produces: dragging with the Ramp or Bridge tool builds a run (instead of panning) and previews it; a plain tap still places a single tile.

This task is UI glue over canvas/pointer events; verify manually in the browser.

- [ ] **Step 1: Import helpers + sprite in `main.ts`** — add to the top imports:

```typescript
import { rampRunCells, bridgeRunCells } from './game/world';
import { sprite } from './engine/sprites';
```

and add module-level drag-run state near the other pointer state (~line 741):

```typescript
let runAnchor: { x: number; y: number } | null = null; // build-run start tile
const isRunTool = (t: Tool) => t === 'ramp' || t === 'platform';
```

- [ ] **Step 2: Start a run on pointerdown** — in the `pointerdown` handler, after the `editor` block, before the handler closes:

```typescript
  if (!editor.active && e.button === 0 && game && running && isRunTool(hover.tool)) {
    const dpr = canvas.width / canvas.clientWidth;
    const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
    runAnchor = { x: t.x, y: t.y };
  }
```

- [ ] **Step 3: Suppress panning while building a run** — in `pointermove`, guard the pan branch so a run-tool drag does not pan:

```typescript
  } else if (dragging && !runAnchor) {
    // ...existing pan code unchanged...
```

(Only add the `&& !runAnchor` condition to the existing `else if (dragging)`; the body is unchanged. The hover `tx/ty` update below still runs, so the ghost follows the pointer.)

- [ ] **Step 4: Place the run on pointerup** — in `pointerup`, before the existing `if (dragMoved || e.button !== 0) return;` line, handle the run:

```typescript
  if (runAnchor) {
    const a = runAnchor;
    runAnchor = null;
    const dpr = canvas.width / canvas.clientWidth;
    const t = cam.screenToTile(e.clientX * dpr, e.clientY * dpr);
    if (game && running) {
      if (hover.tool === 'ramp') game.placeRampRun(a.x, a.y, t.x, t.y);
      else game.placeBridgeRun(a.x, a.y, t.x, t.y);
    }
    return;
  }
```

- [ ] **Step 5: Keep single-tap placement working** — in `applyTool`, replace the `'platform'` case and add a `'ramp'` case so a plain tap (no drag) places one tile:

```typescript
    case 'platform':
      g.placeBridgeRun(tx, ty, tx, ty);
      break;
    case 'ramp':
      g.placeRampRun(tx, ty, tx, ty);
      break;
```

- [ ] **Step 6: Preview the run in the overlay** — find the `renderer.draw(...)` call (the one passing `hover` and `timeSec`) and pass an `overlay` callback that draws the pending run when `runAnchor` is set. Add near the draw call:

```typescript
  const runOverlay = (ctx: CanvasRenderingContext2D) => {
    if (!runAnchor || !game) return;
    const cells =
      hover.tool === 'ramp'
        ? rampRunCells(game.world, runAnchor.x, runAnchor.y, hover.tx, hover.ty)
        : bridgeRunCells(game.world, runAnchor.x, runAnchor.y, hover.tx, hover.ty);
    const name = hover.tool === 'ramp' ? 'tile_ramp' : 'tile_platform';
    ctx.globalAlpha = 0.6;
    for (const c of cells) ctx.drawImage(sprite(name).canvas, c.x * TILE, c.y * TILE);
    ctx.globalAlpha = 1;
  };
```

and pass `runOverlay` as the `overlay` argument of `renderer.draw(...)`. (If an overlay is already passed, compose both by calling the existing one first inside `runOverlay`.)

- [ ] **Step 7: Build + manual verification**

Run: `npm run build && (npm run preview &)` then open `http://localhost:4173/`.
Verify on Level 4:
- Selecting **Ramp** and dragging a diagonal shows a translucent ramp ghost that follows the pointer and truncates at invalid cells; releasing builds it and charges planks.
- Selecting **Bridge** and dragging horizontally lays a deck run; a single click still places one tile.
- A loaded hauler climbs a ramp up a 2-tile step, and terrace stone descends a ramp to the town hall.
- The **Select** tool still pans the camera.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts
git commit -m "feat(ui): drag-run placement + ghost preview for Ramp and Bridge tools"
```

---

## Notes for the implementer

- **Run the headless suite often:** `node tests/ramp.mjs` (fast, no browser). The pre-existing `tests/unit.mjs` should also still pass — run it once after Task 3 to confirm no regression: `node tests/unit.mjs`.
- **Do not renumber existing tool keys.** The Ramp uses key `'0'`; the digit-key handler (`main.ts:910`) and toolbar (`ui.ts:162`) pick it up automatically from `TOOL_DEFS`.
- **`const enum T`** is compiled inline by esbuild/tsc; adding `RAMP = 7` at the end is safe and does not shift the earlier values.
- If Task 5's verifier checks fail, the fix is in `src/game/leveldata.ts` only if it special-cases tile kinds (it currently relies on `world.isSupport`, so no change is expected).
