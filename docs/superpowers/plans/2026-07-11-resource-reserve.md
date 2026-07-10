# Resource Reserve ("Keep in store") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player set a per-resource floor so haulers deliver only the surplus above it to the caravan, unblocking Level 3 where stone is both an objective and the build material.

**Architecture:** One new `keep` map on the `Game` model plus a single gate change in the hauler scheduler (`tryAssignHaul`) so goal-delivery candidates are only created for stock above the floor. The HUD's always-visible resource chips become clickable to open a small stepper popover that calls `Game.setKeep`, with a badge showing any active floor. A Level 3 hint teaches it.

**Tech Stack:** Vite + TypeScript (strict), DOM-based HUD (`src/game/ui.ts`), canvas renderer. Fast logic tests via esbuild-bundled headless harness (`tests/unit.mjs`); browser flows via Playwright (`tests/e2e.mjs`).

## Global Constraints

- `npm run build` (which runs `tsc --noEmit && vite build`) MUST pass — TypeScript is strict, no `any` leaks.
- No new dependencies.
- `keep` is per-game session state, initialised to all-zero, NOT persisted to disk (fresh `Game` per level resets it).
- The floor gates **only** goal (caravan) deliveries — priority-0 candidates. Production feeding, loose-item collection, output draining, and construction (which deducts from `stock` directly) are untouched.
- `keep[item]` is an integer clamped to `0..99`; default `0` reproduces today's behaviour exactly.
- Item type is `ItemType = 'log' | 'plank' | 'stone' | 'iron' | 'spear'`.
- **Pre-existing uncommitted work:** the working tree may contain an unrelated ladder-cost fix (`src/game/{sim,render,types}.ts`, `tests/unit.mjs`). Every commit below uses **explicit file paths** in `git add` — never `git add -A` — so that work is not swept in.

---

### Task 1: Model + scheduler gate

**Files:**
- Modify: `src/game/sim.ts` (add `keep` field ~line 108; add `setKeep` method near `available()` ~line 200; change goal-delivery gate in `tryAssignHaul` ~line 573)
- Test: `tests/unit.mjs` (append new blocks; it already bundles `Game` and `LEVELS`)

**Interfaces:**
- Produces: `Game.keep: Record<ItemType, number>` (public field, default all-zero).
- Produces: `Game.setKeep(item: ItemType, n: number): void` — clamps to integer `0..99`.
- Consumes: existing `Game.available(item): number` (= `stock[item] - stockReserved[item]`), `Game.tick(dt: number)`, `Game.objectives` (each `{ item, amount, delivered, inbound }`), `Game.stock`.

- [ ] **Step 1: Add the `keep` field**

In `src/game/sim.ts`, immediately after the `stockReserved` declaration (currently line 108):

```ts
  stockReserved: Record<ItemType, number> = { log: 0, plank: 0, stone: 0, iron: 0, spear: 0 };

  // Player-set floor per item: haulers deliver only stock ABOVE this to the
  // caravan, so resources can be banked for construction. 0 = ship everything.
  keep: Record<ItemType, number> = { log: 0, plank: 0, stone: 0, iron: 0, spear: 0 };
```

- [ ] **Step 2: Add the `setKeep` clamp method**

In `src/game/sim.ts`, directly after the existing `available` method (currently lines 200-202):

```ts
  available(item: ItemType): number {
    return this.stock[item] - this.stockReserved[item];
  }

  setKeep(item: ItemType, n: number): void {
    this.keep[item] = Math.max(0, Math.min(99, Math.floor(n)));
  }
```

- [ ] **Step 3: Write the failing tests**

Append to `tests/unit.mjs`, after the existing ladder block and before the final `console.log(failures === 0 ...)` summary lines:

```js
// ---- setKeep clamps to a sane integer range --------------------------------
{
  const g = new Game(LEVELS[0]);
  g.setKeep('stone', -5);
  check('setKeep floors negatives at 0', g.keep.stone === 0);
  g.setKeep('stone', 250);
  check('setKeep caps at 99', g.keep.stone === 99);
  g.setKeep('stone', 3.7);
  check('setKeep truncates to an integer', g.keep.stone === 3);
}

// ---- Reserve: haulers ship only the surplus above the floor ----------------
// Level 1's only haul work is delivering planks to the caravan (no marked
// nodes, no buildings), so plank deliveries are a clean probe of the gate.
{
  const g = new Game(LEVELS[0]); // objective: plank 8
  const plankObj = () => g.objectives.find((o) => o.item === 'plank');

  // floor at or above stock → no caravan haul is ever created
  g.stock.plank = 3;
  g.setKeep('plank', 5);
  for (let i = 0; i < 60 * 12; i++) g.tick(1 / 60); // 12s
  check('nothing ships while stock <= keep', plankObj().inbound + plankObj().delivered === 0);
  check('the reserved stock is untouched', g.stock.plank === 3);

  // drop the floor → the surplus (3 - 1) ships, and stock never dips below it
  g.setKeep('plank', 1);
  for (let i = 0; i < 60 * 25; i++) g.tick(1 / 60); // 25s
  check('surplus ships once the floor drops', plankObj().inbound + plankObj().delivered === 2);
  check('stock never falls below the floor', g.stock.plank >= 1);
}

// ---- Level 3 shape: stone is both the order and the build material ---------
{
  const g = new Game(LEVELS[2]); // objectives include stone 8; goal at west edge
  const stoneObj = () => g.objectives.find((o) => o.item === 'stone');

  // bank 6 stone (the TH Lv2 upgrade cost); only the surplus of a 10 stock ships
  g.stock.stone = 10;
  g.setKeep('stone', 6);
  for (let i = 0; i < 60 * 30; i++) g.tick(1 / 60); // 30s
  check('order stalls at the floor (ships 10-6=4)', stoneObj().delivered === 4);
  check('6 stone stay banked for building', g.stock.stone === 6);

  // release the floor → the order finishes (up to the 8 required)
  g.setKeep('stone', 0);
  for (let i = 0; i < 60 * 30; i++) g.tick(1 / 60); // 30s
  check('lowering the floor lets the order finish', stoneObj().delivered === 8);
  check('stock drops to the remainder (10-8=2)', g.stock.stone === 2);
}
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `node tests/unit.mjs`
Expected: FAIL — the `setKeep` block errors (`g.setKeep is not a function`) or the reserve blocks fail because the gate does not yet subtract `keep` (with today's code, "nothing ships while stock <= keep" fails: planks ship regardless of the floor).

- [ ] **Step 5: Change the goal-delivery gate**

In `src/game/sim.ts`, inside `tryAssignHaul`, in the "goal deliveries from stock" loop (currently line 573), change the single gate line:

```ts
    // 1. goal deliveries from stock
    const goal = this.goal;
    if (goal) {
      for (const o of this.objectives) {
        if (o.delivered + o.inbound >= o.amount) continue;
        if (this.available(o.item) - this.keep[o.item] <= 0) continue;
        cands.push({ source: { t: 'stock' }, sink: { t: 'goal', id: goal.id }, item: o.item, priority: 0 });
      }
    }
```

(Only the `if (this.available(o.item) ...)` line changes — `<= 0` becomes `- this.keep[o.item] <= 0`.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node tests/unit.mjs`
Expected: PASS — `ALL PASS`, including the three new blocks (setKeep clamp, reserve surplus, Level 3 stall/release). The pre-existing ladder checks still pass.

- [ ] **Step 7: Typecheck**

Run: `npm run build`
Expected: `tsc --noEmit` clean, `vite build` succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/game/sim.ts tests/unit.mjs
git commit -m "feat(sim): per-resource 'keep' floor gates caravan deliveries"
```

---

### Task 2: HUD — clickable chips, reserve popover, floor badge

**Files:**
- Modify: `src/game/ui.ts` (class fields ~line 68-79; `buildTopBar` chip loop ~line 100-108; `update` ~line 367-376; add popover/badge methods)
- Modify: `src/style.css` (append chip/popover/badge rules after the `.res-chip` block, ~line 84)

**Interfaces:**
- Consumes (from Task 1): `game.keep[item]`, `game.setKeep(item, n)`, `game.stock[item]`.
- Consumes (existing): `el(tag, cls?, parent?)`, `icon(name, size?, parent?)`, `ITEM_NAMES`, `ITEM_TYPES`, `this.root`, `this.resChips`, `this.resCounts`.
- Produces: no exported interface change; internal HUD behaviour only.

- [ ] **Step 1: Add class fields**

In `src/game/ui.ts`, in the `Hud` class field block (after `private resChips = ...` ~line 68 and near `private tooltip` ~line 77), add:

```ts
  private keepBadges = new Map<ItemType, HTMLElement>();
  private lastKeep: Record<string, number> = {};
  private reservePop: { item: ItemType; el: HTMLElement; refresh: () => void } | null = null;
```

- [ ] **Step 2: Make resource chips clickable with a badge**

In `buildTopBar`, replace the chip-building loop (currently lines 100-108):

```ts
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
```

- [ ] **Step 3: Add the popover + badge methods**

In `src/game/ui.ts`, add these methods to the `Hud` class (e.g. right after `hideTooltip`, ~line 240):

```ts
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
    const refresh = (): void => {
      pop.innerHTML = '';
      el('div', 'res-pop-name', pop).textContent = `${ITEM_NAMES[item]} · ${g.stock[item]} in store`;
      const row = el('div', 'res-pop-row', pop);
      el('span', undefined, row).textContent = 'Keep';
      const minus = el('button', 'res-step', row);
      minus.textContent = '−';
      const val = el('b', 'res-keep-val', row);
      val.textContent = String(g.keep[item]);
      const plus = el('button', 'res-step', row);
      plus.textContent = '+';
      minus.onclick = () => { g.setKeep(item, g.keep[item] - 1); refresh(); this.refreshKeepBadge(item); };
      plus.onclick = () => { g.setKeep(item, g.keep[item] + 1); refresh(); this.refreshKeepBadge(item); };
      el('div', 'res-pop-note', pop).textContent = 'Haulers ship only the surplus to the caravan.';
    };
    refresh();
    const r = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(8, r.left)}px`;
    pop.style.top = `${r.bottom + 6}px`;
    this.reservePop = { item, el: pop, refresh };
    // defer so THIS click doesn't immediately close it
    setTimeout(() => document.addEventListener('click', this.closeReserveOnOutside), 0);
  }
```

- [ ] **Step 4: Keep the badge (and open popover's stock line) in sync in `update`**

In `src/game/ui.ts`, in `update()`, right after the existing resource-count loop (currently ends line 376), add:

```ts
    for (const it of ITEM_TYPES) {
      if (this.lastKeep[it] !== g.keep[it]) {
        this.lastKeep[it] = g.keep[it];
        this.refreshKeepBadge(it);
      }
    }
    this.reservePop?.refresh();
```

- [ ] **Step 5: Add CSS**

In `src/style.css`, append after the `@keyframes chipflash { ... }` block (~line 84):

```css
.res-chip { cursor: pointer; position: relative; border: 1px solid transparent; color: var(--text); }
.res-chip:hover { border-color: var(--panel-border-light); }
.res-chip.has-keep { border-color: var(--accent); }
.keep-badge {
  position: absolute; top: -5px; right: -5px;
  min-width: 15px; height: 15px; padding: 0 3px;
  border-radius: 8px; background: var(--accent); color: #1a1e28;
  font-size: 10px; font-weight: 800; line-height: 15px; text-align: center;
}
.res-pop {
  position: absolute; z-index: 60; padding: 8px 10px; min-width: 150px;
  background: var(--panel-bg); border: 1px solid var(--panel-border-light);
  border-radius: 8px; font-size: 12px; line-height: 1.4; color: var(--text);
}
.res-pop-name { font-weight: 700; margin-bottom: 5px; }
.res-pop-row { display: flex; align-items: center; gap: 8px; }
.res-keep-val { min-width: 20px; text-align: center; font-variant-numeric: tabular-nums; }
.res-step {
  width: 22px; height: 22px; border-radius: 5px; cursor: pointer;
  background: rgba(255, 255, 255, 0.08); border: 1px solid var(--panel-border-light);
  color: var(--text); font-size: 15px; font-weight: 700; line-height: 1;
}
.res-step:hover { border-color: var(--accent); }
.res-pop-note { margin-top: 6px; color: var(--text-dim); font-size: 11px; }
```

- [ ] **Step 6: Typecheck + build**

Run: `npm run build`
Expected: `tsc --noEmit` clean, `vite build` succeeds. (No DOM unit-test harness exists in this repo; UI is verified by build + manual QA below, matching the project's existing convention.)

- [ ] **Step 7: Manual QA**

Run: `npm run dev`, open the printed URL, start **Level 3**.
Verify, in order:
1. The stone chip in the top bar is hoverable (border highlights) and clickable.
2. Clicking it opens a popover below the chip: "Stone · N in store", a `Keep [ 0 ] − +` row, and the "ship only the surplus" note.
3. Click `+` a few times → the number rises, and a yellow badge with that number appears on the chip; the chip border turns accent-yellow.
4. Click `−` past 0 → stays at 0, badge disappears, border returns to normal.
5. Click another chip → the stone popover closes and the new one opens. Click empty space → popover closes.
6. Set "keep 6" on stone, mark boulders to harvest, and confirm stone accumulates in stock past 6 instead of all shipping to the caravan; lower it to 0 and confirm the order fills.

- [ ] **Step 8: Commit**

```bash
git add src/game/ui.ts src/style.css
git commit -m "feat(ui): click a resource chip to set its keep-in-store floor"
```

---

### Task 3: Level 3 discoverability hint

**Files:**
- Modify: `src/game/levels.ts` (Level 3 `hints` array, ~line 231)
- Test: `tests/unit.mjs` (append a predicate check)

**Interfaces:**
- Consumes: `Game.level.hints` (`LevelHint[]` — each `{ id, text, when(g) }`), `Game.stock`, `Game.thLevel`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit.mjs`, before the summary lines:

```js
// ---- Level 3 teaches the reserve exactly when stone is contested -----------
{
  const g = new Game(LEVELS[2]);
  const hint = (g.level.hints ?? []).find((h) => h.id === 'reserve');
  check('level 3 has the reserve hint', !!hint);
  g.stock.stone = 0; g.thLevel = 1;
  check('reserve hint hidden with no stone', hint.when(g) === false);
  g.stock.stone = 2;
  check('reserve hint fires once stone is on hand', hint.when(g) === true);
  g.thLevel = 2;
  check('reserve hint gone after the upgrade', hint.when(g) === false);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/unit.mjs`
Expected: FAIL — `level 3 has the reserve hint` fails (`hint` is undefined; the subsequent `hint.when` throws).

- [ ] **Step 3: Add the hint**

In `src/game/levels.ts`, in Level 3's `hints` array, insert this entry immediately after the `'pit'` hint object (before `'th2'`):

```ts
      {
        id: 'reserve',
        text: 'Stone fills the order <b>and</b> builds your Cargo Lift and Forge. Click the <b>stone counter</b> up top to <b>keep some back</b> before it all ships out.',
        when: (g) => g.stock.stone >= 2 && g.thLevel < 2,
      },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/unit.mjs`
Expected: PASS — `ALL PASS`, including the four new reserve-hint checks.

- [ ] **Step 5: Typecheck**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/game/levels.ts tests/unit.mjs
git commit -m "feat(levels): teach the keep-in-store reserve on Level 3"
```

---

### Task 4: Regression — browser e2e still green

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Build and serve**

Run: `npm run build && (npm run preview &)`
Then confirm: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/` prints `200`.

- [ ] **Step 2: Run the browser e2e (levels 1 & 2)**

Run (macOS; only the Playwright headless-shell is installed here):

```bash
export CHROME_PATH=$(ls ~/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell | tail -1)
BASE_URL=http://localhost:4173/ node tests/e2e.mjs
```

Expected: `E2E PASS: levels 1 and 2 completed`. (Reserve defaults to 0, so levels 1–2 behave exactly as before.) Run in the background — it takes several minutes.

- [ ] **Step 3: Stop the preview server**

Run: `pkill -f "vite preview"`

- [ ] **Step 4: No commit** — verification only.

---

## Self-Review

**Spec coverage:**
- Data model (`keep` field, per-game, default 0, not persisted) → Task 1 Step 1. ✓
- Scheduler gate (only priority-0 goal deliveries) → Task 1 Step 5. ✓
- `setKeep` clamp 0..99 integer → Task 1 Steps 2-3. ✓
- Edge cases (floor too high stalls the order; never ships below floor) → Task 1 Step 3 tests (Level 3 stall/release; "stock never falls below the floor"). ✓
- UX (clickable chips, popover with stepper + explainer, one-at-a-time, floor badge) → Task 2 Steps 2-5. ✓
- Discoverability (Level 3 hint, fires at `stone ≥ 2 && thLevel < 2`) → Task 3. ✓
- Testing (headless gate test + Level-3-shaped test; regression) → Tasks 1 and 4. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". UI verification is manual by necessity (no DOM test harness in this repo) and stated explicitly. ✓

**Type consistency:** `keep`/`setKeep` names match across Task 1 (define) and Task 2/3 (consume). `refreshKeepBadge`, `closeReservePopover`, `toggleReservePopover`, `reservePop.refresh` used consistently within Task 2. `ItemType` values match the codebase. Gate uses `this.keep[o.item]` matching the field name. ✓
