# Harvest cursor feel — design spec

_2026-07-11_

## Problem

The Harvest tool's only hover feedback is a pulsing green/red outline box on the
tile under the mouse (`drawGhost` → `case 'harvest'` in `render.ts`). It's
correct but lifeless — nothing about aiming, nothing about the act of marking a
tree/boulder/vein for the crew. We want the cursor to *feel* like harvesting.

Approved direction (from the interactive drafts): the **full-juice combo** —
_"The Overseer's Tool."_ One coherent feeling built from four cheap parts.

## Scope

- **Full juice, Harvest tool** (the star): OS pointer swap, on-canvas lock-on
  reticle, hovered-node anticipation, ghost mark-flag preview, and a
  click-commit burst + node kick.
- **Cheap consistency spillover (all tools):** the OS cursor becomes the tool
  you're holding (its toolbar icon); Inspect/Select uses `grab`/`grabbing` to
  advertise panning.
- **Deferred (documented, not built):** rich reticle/burst for
  demolish/build/inspect — the bottom row of the drafts. The reticle helper is
  written so this is a small follow-up.

Truthfulness note: in-game, clicking Harvest **marks** a node for the crew (it
does not chop it). So the click payoff is "the order lands with authority"
(flag slams down, sparks, the node kicks) — not the tree falling. Unmarking
gets a quieter, cooler puff.

## Behaviour

### 1. Pointer swap (OS cursor) — all tools
- In `setTool`, set `canvas.style.cursor` to a data-URI built from the tool's
  toolbar sprite (`TOOL_ICON` in `ui.ts`, scaled 2×, `imageSmoothing` off), with
  a per-tool hotspot. Cached per tool.
- `select` → native `grab`; during a pan drag → `grabbing`, restored on
  pointer-up. (Its pixel-arrow icon would only fight the native arrow.)
- Falls back to `default` if a tool has no icon.

### 2. Lock-on reticle — Harvest, on-canvas (in `drawGhost`)
- `node = game.nodeAt(tx, ty)`.
- Renderer keeps an eased `harvestLock` (0→1) that rises while a harvestable
  node is under the cursor and falls otherwise (dt-based ease).
- Over a node: four gold corner-brackets frame the node's box and **tighten**
  as `harvestLock`→1, plus a soft pulsing gold fill. Node box:
  - tree: `x=n.x*TILE, y=(n.y-1)*TILE, w=TILE, h=2*TILE`
  - boulder/vein: `x=n.x*TILE, y=n.y*TILE, w=TILE, h=TILE`
- Over bare ground: no box — just a faint 1px tile tick (the hoe cursor already
  shows the target). This replaces the old outline entirely.

### 3. Node anticipation — Harvest, in `drawNodes`
- `draw()` computes the hovered node id (only when tool is harvest + hover
  visible) and an eased `hoverEase` (0→1), passes both to `drawNodes`.
- The hovered node reacts: a tree's canopy sway amplitude grows and it lifts a
  touch (leans in); a boulder/vein does a small shiver. Subtle but felt — the
  world anticipates the order. Respects `prefers-reduced-motion` by damping.

### 4. Ghost mark-flag preview — Harvest, in `drawGhost`
- Over an **unmarked** harvestable node, draw the existing `mark` sprite at the
  same offset `drawNodes` uses, semi-transparent and pulsing, so you preview the
  flag you're about to plant. (Already-marked nodes skip this — they show the
  real flag.)

### 5. Click-commit payoff — `applyTool` (`main.ts`) + `sim`
- On a successful `toggleMark`:
  - **Marked:** `n.wobble = 0.35` (reuses the existing worked-node shake) for a
    kick, plus `spawnBurst` at the node — a gold spark burst layered with a
    kind-tinted burst (green for tree, steel for rock/vein).
  - **Unmarked:** a small, cool grey puff (`spawnBurst`, n≈3).
- Existing `onEvent({type:'place'})` sound in `toggleMark` stays.

## Touch points

- `src/game/render.ts` — rewrite `case 'harvest'` in `drawGhost`; add a
  `reticle()` helper + `harvestLock`/`hoverEase`/`lastGhostT` fields; thread a
  hovered-node id + ease through `drawNodes`; compute them in `draw()`.
- `src/main.ts` — `setTool` sets the tool cursor; a cached `toolCursor()`
  data-URI builder + hotspot map; `grabbing` on pan; enrich the `harvest` case
  in `applyTool`.
- `src/game/ui.ts` — export `TOOL_ICON` (or lift it to a shared const) so
  `main.ts` can reuse it.
- `src/game/sim.ts` — no API change needed; reuse `spawnBurst`, `toggleMark`,
  `nodeAt`, and the `wobble` field.

## Testing / verification

- Most of this is canvas animation — verified by **running the game** and
  watching/screenshotting: hoe cursor appears in Harvest; reticle locks onto a
  tree; hovered tree leans; ghost flag previews; clicking plants a flag with a
  spark burst and a kick; clicking again unmarks with a soft puff; other tools
  show their own cursor; Inspect shows grab/grabbing.
- Unit-test the one pure helper worth it: node hover-box geometry (tree vs
  boulder/vein) if extracted.
- `tsc` clean + `vite build` clean.

## Non-goals

- No change to marking mechanics, worker behaviour, or the actual chopping
  burst workers already emit.
- No new sprites (reuse `icon_harvest`, `mark`, existing tool icons).
