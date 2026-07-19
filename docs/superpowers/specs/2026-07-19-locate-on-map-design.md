# Locate-on-map — design

**Date:** 2026-07-19
**Status:** Design (approved) → ready for implementation plan
**Card:** Harmony #49
**Slice:** 2 of 3 in the "point the player at what matters" family. Slice 1 (#47, merged PR #71) = stranded-goods marker; Slice 3 = invalid-cursor "why is my cursor grey?" reason. This doc covers **Slice 2 only**.

## Problem

When a resource shows `0 in store` or an objective stalls, the game gives the player no way to ask "where do I get this / where is the problem?" — they must scan the whole world by hand. This is the discoverability half of the play session that produced #47 (the original question was literally "where do I get iron?"). Slice 1 diagnosed *stuck* goods; this slice answers *where do I find / make what I'm missing*.

Also folds in the one piece Slice 1 explicitly deferred: an **off-screen indicator** for stranded goods scrolled out of view (a stranded pile currently shows nothing until the player scrolls to it).

## Goal

Make HUD elements **clickable locators**. Clicking "Find on map" in a resource chip's popover, or clicking an objective row, pans the camera to the relevant world position and pings it with a pulsing highlight ring:

- **Resource / objective item** → the nearest source of that item (raw node, or the building that produces it, or — if no producer exists — the source of its missing input).
- **Stranded goods off-screen** → a passive screen-edge arrow pointing at them.

Diagnosis / navigation only — point the camera at what matters; do not auto-build or auto-suggest a fix.

## Non-goals (explicitly out of scope)

- **Invalid-cursor "why is my cursor grey?" reason** — Slice 3.
- **Auto-fix / build suggestions** (highlighting where a ladder/ramp/lift would help) — out of scope; this is navigation only.
- **Any change to sim behavior**: hauling, movement, assignment, production. This is a read-only query + camera + render feature.
- **Persistence**: the game keeps no mid-level save; nothing new is serialized.
- **A path line / breadcrumb trail** to the target — just center + ring. YAGNI for this slice.

## Approach

Follow the Slice 1 shape: a **pure, read-only `Game` query** is the single source of truth, unit-tested headlessly; rendering and camera are thin consumers. Reuse existing primitives — do **not** invent a second version (the recurring lesson, cf. #45, #47):

- **Reachability** reuses the hauler planner's `findPath(world, transits, sx, sy, targets, carrying)` (`nav.ts:20`) and `this.transits` — never a hand-rolled reachability rule.
- **Node → item** mapping reuses `NODE_YIELD[kind].item` (`types.ts:56`: tree→log, boulder→stone, vein→iron).
- **Item → producer** mapping reuses `RECIPES` (`types.ts:109`: sawmill→plank, forge→spear, workshop→shovel).
- **Ring** reuses the lantern-range ring / `reticle()` idiom (`render.ts`), drawn in the **post-darkness pass** (like the #47 glyph) so it reads at night.
- **Off-screen arrow** reuses `game.strandedGroundItems()` (#47) and the screen-space projection `sx = (tile+0.5)*TILE*cam.zoom - cam.x` already used by `drawDarkness`.

Rejected architectures:
- **Locate logic + ring drawn from `main.ts`'s `overlay?` hook** — the ring needs the renderer's internal post-darkness world transform; reaching it from the overlay callback duplicates that transform block. Rejected.
- **Give the HUD a `cam`/`renderer` reference** and drive locate from `ui.ts` — breaks the current boundary (HUD knows only `Game` + a callbacks object) and puts camera animation off-model in the HUD. Rejected. The HUD reaches the camera through **one new callback** instead (mirrors the existing `onZoom`).

## Component architecture

Four thin pieces around one pure query:

| Piece | Where | Responsibility |
|---|---|---|
| `Game.locateItem(item)` | `sim.ts` | Pure resolver: item → `{x, y, kind}` world target (or `null`). Testable headless. |
| Camera pan tween | `main.ts` `frame()` | Ease `cam.x/y` toward the target, then the existing `clamp`. Reduce-motion → snap. |
| Locate ring | `render.ts` | Pulsing ring on the target in the post-darkness pass; auto-expires. |
| Edge arrows | `render.ts` | Passive screen-edge arrows for off-screen stranded items. |
| `onLocate(item)` callback | `ui.ts` → `main.ts` | HUD → main glue; the only way the HUD reaches `cam`/`renderer`/`game`. |

The HUD (`ui.ts`) imports only `Game` today and holds `game` + a `HudCallbacks` object; it gets `cam`/`renderer` access **only** through the new `onLocate` callback, wired in `attachHud` (`main.ts`) where `cam`, `renderer`, and `game` are module-level singletons.

## The resolver — `Game.locateItem(item: ItemType): LocateResult | null`

Pure, read-only. Origin for "nearest" is the **town hall** (`this.townhall`) — deterministic and sim-side (workers originate there), which keeps the resolver independent of the camera and therefore unit-testable. Not the camera center.

```ts
export interface LocateResult {
  x: number;              // tile
  y: number;              // tile
  kind: 'node' | 'building' | 'input';
}
```

Resolution order:

1. **Raw item** (`log` / `stone` / `iron` — any item that is some `NODE_YIELD[kind].item`):
   Among live nodes of that kind (`yieldLeft > 0`):
   - Prefer the **nearest reachable** one — a node from whose harvest/approach cell a worker can path (`findPath`, unloaded, from the town-hall approach to the node's stand cell). Rank reachable candidates by path cost.
   - If **none** is reachable, fall back to the **nearest by straight-line** distance from the town hall (so a walled-off vein still gets pointed at — "there it is, but you can't get to it yet").
   - Return `{ x: n.x, y: n.y, kind: 'node' }`.

2. **Crafted item** (`plank` / `spear` / `shovel` — some `RECIPES[k].outputs[item]`):
   a. Nearest **ready** building of the producing kind → return it (`kind: 'building'`).
   b. Else nearest **blueprint** (not-yet-ready) building of that kind → return it (`kind: 'building'`) — "it's being built here."
   c. Else no producer exists → recurse into the recipe's **missing input**: pick the input the player is **shortest of** in `this.stock` (tie-break by recipe input order), and return `locateItem(thatInput)` with its `kind` forced to `'input'`. Recursion terminates because inputs bottom out at raw nodes.

3. **Nothing applies** (no node, no producer, no input source anywhere) → `null`.

Notes:
- Ground items / stock of the item itself are **not** "sources" — the resolver points at where the item is *produced or harvested*, not at a loose pile (loose stranded piles already have their own #47 marker and, in this slice, their own edge arrow).
- The resolver never mutates anything and never consults hauler reservations/cooldowns; "reachable" here means a route exists (same spirit as Slice 1's route-existence semantics).

## Camera focus + pulse ring

- `onLocate(item)` (main.ts): `const r = game.locateItem(item)`. If `null` → show the `locate.none` toast and stop. Else:
  - Compute a centered camera target: `camX = (r.x + 0.5) * TILE * cam.zoom - availW / 2`, `camY = (r.y + 0.5) * TILE * cam.zoom - vh / 2`, where `availW = viewportW - cam.rightInset`.
  - Store it as the pan target and set `renderer.locateRing = { x: r.x, y: r.y, bornAt: <clock> }`.
- `frame()` eases `cam.x/y` toward the pan target (exponential/`lerp` over ~0.35s) **before** the existing `cam.clamp(...)` call, so clamp bounds the eased value. On worlds smaller than the viewport (e.g. level 1) `clamp` re-centers regardless — that is fine: the ring still pings the target, the camera just doesn't need to move. (Documented gotcha: `clamp` overwrites manual `cam.x/y` on small worlds — we rely on the ring, never on the pan, for correctness.)
- **Renderer** `drawLocateRing(timeSec)` runs in the **post-darkness pass** (same `ctx.save()/translate/scale` block that draws `drawGhost` / `drawStrandedMarkers`, `render.ts:164–170`). A pulsing ring (~2–3 tiles radius) centered on `((x+0.5)*TILE, (y+0.5)*TILE)`, reusing the lantern-ring gradient / dashed-stroke idiom. It **auto-expires** ~1.6s after `bornAt` (clear the field), so it's a ping, not a permanent highlight.
- **Reduce-motion** (`this.reduceMotion`, already `prefersReducedMotion || effectsReduced`): the pan **snaps** instantly (main sets `cam` straight to the target, no tween) and the ring is **static** (no pulse; still fades out on expiry). Matches the approved behavior.

## Off-screen stranded edge-arrow (closes the #47 deferral)

- Renderer overlay `drawStrandedEdgeArrows(game)` — **always on**, not click-driven, drawn in **screen space** (like `drawDarkness`).
- For each `game.strandedGroundItems()`:
  - Project to screen: `sx = (gi.x + 0.5) * TILE * cam.zoom - cam.x`, `sy = (gi.y + 0.5) * TILE * cam.zoom - cam.y`.
  - If `(sx, sy)` is **inside** the visible viewport → skip (the #47 on-map glyph already covers it).
  - If **outside** → clamp the point to the viewport edge (inset below the topbar HUD band and inside `rightInset` so arrows never hide under chrome), and draw a small amber (`warn`-palette) triangle/arrow pointing from the edge toward the true position (angle from viewport center to `(sx, sy)`).
- **Reduce-motion:** static arrow (no pulse/bob). Purely visual; nothing downstream consumes it.

## HUD interaction (all DOM — tap == click, no canvas touch wiring)

- **Resource chip popover** (`toggleReservePopover`, `ui.ts`): add a **"Find on map"** button to the popover body → `this.cbs.onLocate(it)`, then close the popover. The chip's own click still opens the popover (unchanged keep/reserve UX); locate is a deliberate second action inside it.
- **Objective rows** (`ui.ts`, the `obj-row` elements): add `row.onclick = () => this.cbs.onLocate(o.item)` plus a `cursor:pointer` / hover affordance so they read as clickable.
- **New callback:** add `onLocate: (item: ItemType) => void` to `HudCallbacks`; wire it in `attachHud` (`main.ts`) to the `onLocate` handler above.
- Because both surfaces are DOM elements, a touch **tap** fires the same `click` handler — no canvas tap-dispatch code (unlike the #47 stranded glyph, which lives on the canvas).
- **Signature refresh:** no new signature string is needed. The "Find on map" button label is static and the objective row's existing text is already refreshed by `update()`; locate is fire-and-forget with no persistent HUD state. (Noted because the sig-staleness rule bit prior cards — it does not apply here.)

## i18n (EN + DE)

New keys in `src/engine/i18n.ts` (`[EN, DE]` tuple form):

- `hud.findOnMap`: `['Find on map', 'Auf Karte finden']`
- `locate.none`: `['No {name} on this map yet.', 'Kein {name} auf dieser Karte.']` — interpolates the localized item name via the existing `t(key, {name})` mechanism (as `hud.chipTitle` already does).

Objective rows may also gain a `title`/aria hint key (`hud.locateObjective`) if a tooltip is wanted; optional, decide during implementation.

## Testing

**Headless (`tests/unit.mjs`, bundles the sim, no browser)** — the resolver is pure and public, so:

1. On a level that has an iron vein, `g.locateItem('iron')` returns that vein's `{x, y}` (`kind: 'node'`).
2. Build a ready `forge`, then `g.locateItem('spear')` returns the forge's tile (`kind: 'building'`).
3. With no sawmill present, `g.locateItem('plank')` recurses to a `log` source — returns a tree tile with `kind: 'input'`.
4. On a constructed level with no vein and where iron is not craftable, `g.locateItem('iron')` returns `null`.
5. (If feasible to set up deterministically) two veins with one walled off → returns the reachable one even when it is farther; else at least assert the straight-line fallback returns the nearer of two reachable veins.

Deterministic; no timing/animation assertions.

**Browser smoke (manual, `window.__smallhands` hook)** — camera pan, pulsing ring, and edge arrows are visual and are verified live, not asserted:
- Click a resource chip's "Find on map" → camera eases to the nearest source and the ring pings it; on a night level the ring reads over the dark veil.
- Click a stalled objective row → camera centers the producer / missing input.
- Strand a pile, scroll it off-screen → a screen-edge arrow points at it; scroll back → the arrow gives way to the on-map glyph.
- Toggle reduce-motion (OS setting or options) → pan snaps, ring/arrow are static.
- Switch language to DE → the toast and button copy are translated.

Re-read the `window.__smallhands` hook after any `startLevel` (it is replaced on level start) and use the **live clamped** `cam` for coordinate math (both documented in the `testing-smallhands` memory).

## Files touched (anticipated)

- `src/game/types.ts` — `LocateResult` interface (and any item→producer-kind helper, or derive inline from `RECIPES`).
- `src/game/sim.ts` — `locateItem` resolver + a nearest-node / reachable helper; reuses `NODE_YIELD`, `RECIPES`, `findPath`, `this.transits`, `this.townhall`, `this.stock`.
- `src/game/render.ts` — `locateRing` field, `drawLocateRing` (post-darkness pass), `drawStrandedEdgeArrows` (screen space); both reduce-motion-gated.
- `src/main.ts` — `onLocate` handler, camera pan tween in `frame()` before `clamp`, `locate.none` toast, set `renderer.locateRing`.
- `src/game/ui.ts` — "Find on map" button in the reserve popover; objective-row click; `onLocate` in `HudCallbacks`.
- `src/engine/i18n.ts` — EN + DE strings.
- `src/engine/sprites.ts` — optional arrow sprite (or draw a triangle in code).
- `tests/unit.mjs` — resolver tests.
- Styles (wherever HUD CSS lives) — `cursor:pointer`/hover for objective rows, "Find on map" button.

## Acceptance criteria

- Clicking a resource chip's "Find on map" locates + rings the nearest source of that resource (raw node, producer, or missing-input source).
- Clicking a stalled objective row locates the relevant production site / missing input.
- A stranded item off-screen shows a screen-edge arrow pointing to it; on-screen it reverts to the #47 on-map glyph (closes the #47 deferral).
- Works on desktop (click) and touch (tap); the ring/arrow render correctly over the night veil; reduce-motion → instant pan + static ring/arrow.
- When no source exists at all, a translated toast explains it; the camera does not move.
- `locateItem` is unit-tested headlessly (EN + DE copy present); existing suites stay green.
- No regression to hauling / movement / production / render of existing features (additive; sim behavior untouched).
