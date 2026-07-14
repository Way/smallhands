# Look-Physics Layer — design

**Date:** 2026-07-14
**Status:** proposed (from the physics-engine design discussion), pending review
**Companion spec:** `2026-07-14-counterweight-hoist-design.md` (the sim-physics side
of the same discussion)

## Problem

The world reads as *placed*, not *inhabited*. Motion that should feel physical is
either static or a canned sine wave:

- The rope anchor's rope is a straight polyline (`render.ts:784-797`) — it never
  sways in the wind and never bows under a sliding worker, even though the slide
  is the one move where "gravity does the work" (`SLIDE_SPEED`, `types.ts:172`).
- Items teleport to their rest tile and bounce in place (`GroundItem.bounce`,
  `types.ts:184`; drawn at `render.ts:829`). A log chopped from a treetop appears
  on the ground with no journey.
- A depleted tree vanishes into its yield. Trees already lean in the wind
  (`render.ts:431-453`), which makes the missing *fall* more conspicuous.
- Weather has visual weight (rain streaks, crossfades in `weather-look.ts`) but
  nothing in the world *reacts* to it except treetops.

This is exactly the "natural vibes, ambience, love to details" gap: the sim is
lively, the presentation is stiff.

## Goal

A small cosmetic motion layer — springs, verlet ropes, arcs, ripples — that makes
the world feel physical **without touching simulation state**. Highest
ambience-per-byte investment available; zero risk to determinism, verification,
share codes or headless tests.

## Non-goals

- **No gameplay physics.** Nothing in this layer may alter positions, timings,
  costs or outcomes in `sim.ts`. That work is the companion spec.
- **No general particle/physics library.** Zero runtime dependencies is a project
  pillar (README: ~22 kB gzipped total). Everything here is hand-rolled and small.
- **No new sim-side state.** The sim already owns some cosmetic state
  (`ResourceNode.wobble`, `GroundItem.bounce`, `game.particles` via `spawnBurst`);
  this pass does not migrate those, it only adds render-side motion on top.

## The one architectural rule

**Sim → look is one-way.** The look layer may observe sim state and consume sim
events; the sim never reads look state back. Look-physics runs on the render
clock (`Renderer.lastT`), not the fixed 1/60 sim step (`main.ts:1518`), so a
dropped frame can never desync gameplay. This is the firewall that lets us add
unlimited juice without ever re-opening the determinism argument.

Corollary: everything in this layer sits behind the existing reduced-effects
gate. `Renderer.reduceMotion` already combines the options toggle with the OS
`prefers-reduced-motion` preference (`render.ts:63-68`); when it is set, every
element below degrades to today's static rendering. No new option needed.

## Design

A new module `src/game/motion.ts` owning three tiny primitives, all
frame-rate-independent (integrate with `dt` clamped to ≤ 1/20 s):

1. **Spring** — damped scalar/2-D spring (`value`, `velocity`, stiffness,
   damping). Used for squash-and-stretch, sway targets, camera-free recoil.
2. **VerletRope** — N points (6–10 per rope), pinned head, one constraint-relax
   pass per frame, gravity + wind acceleration. Cheap and stable at this scale.
3. **Flight** — a fire-and-forget parabolic arc from A to B over a fixed
   duration with a tumble angle; calls back on landing (to trigger a puff).

The renderer creates/destroys these per entity id; `motion.ts` keeps a pooled
list so a busy level allocates nothing per frame.

### Elements, in priority order

| # | Element | Trigger (observed sim state / event) | Motion |
|---|---------|--------------------------------------|--------|
| 1 | **Rope sway & bow** | rope anchor exists; worker in a `slide` step on it (`render.ts:985` already branches on `step.kind`) | VerletRope pinned at the post; wind acceleration from the current weather phase; a sliding worker becomes a moving mass point — the rope bows under them and swings back after |
| 2 | **Item flight arcs** | new `GroundItem` appears (id not seen last frame) with a source hint | Flight arc from source (treetop, worker's hands, building door) to the item's rest tile, small tumble; landing dust puff. Logically the item is at its tile from tick 0 — reservation and pathing are unaffected; only the sprite travels |
| 3 | **Tree felling** | tree node's `yieldLeft` hits 0 | creak-lean (spring past its wind sway) → fall arc to the felled side → crash puff; the yield logs' flight arcs (element 2) start from the fallen crown |
| 4 | **Landing squash & dust** | worker completes a `fall` step | vertical squash spring on the worker sprite + reuse of the existing burst particles |
| 5 | **Water reactions** | item lost to water (Campaign 2 loss event); ambient | expanding ripple rings at the entry point; slow ambient shimmer offset — reuses the existing water rendering, adds phase offsets only |
| 6 | **Wind-coupled props** | current weather phase & `WEATHER_FADE` blend | lantern flames stretch, the goal caravan's banner and townhall pennant swing (small VerletRopes); storm = visibly harder pull. Uses the same blend the weather visuals already crossfade with, so props agree with the sky |
| 7 | **Lift cable & car bob** | lift car arrives / departs (`liftCarY` settles) | overshoot-and-settle spring on the car; cable gains 1-px sag curve while loaded |

Elements 1–3 carry most of the value; 4–7 are each an afternoon.

### Event detection without touching the sim

Preferred: diffing observable sim state frame-to-frame in the renderer (new
`GroundItem` ids, `yieldLeft` transitions, `step.kind` changes). Where a diff is
ambiguous — the *source* position of a new ground item — add a **cosmetic event
queue** to the sim: `game.lookEvents.push({kind:'item-spawn', from, to, item})`,
drained by the renderer each frame, ignored by save/tests. This is write-only
breadcrumbs, not state the sim ever reads; it keeps the firewall intact while
sparing the renderer guesswork. (Precedent: `spawnBurst` already emits
render-only particles from inside the sim.)

## Determinism & testing notes

- Look-physics may use `Math.random()` freely — it never feeds back.
- Existing note from the discussion, tracked separately: `sim.ts` itself calls
  `Math.random()` in a few places (idle wander `sim.ts:947`, facing/anim seed at
  spawn). Migrating those to a seeded RNG is worthwhile for future replays but is
  **not** part of this spec.
- `tests/weather-visual.mjs` is the precedent for pixel-level visual assertions;
  a smoke check that (a) a rope's drawn midpoint deviates from the straight line
  while a worker slides and (b) `reduceMotion` restores the straight line, covers
  the firewall and the accessibility gate in one test.

## Affected code (survey, not a plan)

- `src/game/motion.ts` (new) — Spring, VerletRope, Flight, pooling. ~150 lines.
- `src/game/render.ts` — instantiate/drive motions; rope drawing swaps the
  straight polyline for the verlet points when active (`drawRope` region,
  `render.ts:782-804`); item draw consults an active Flight before the static
  bounce (`render.ts:829`); worker squash in the worker draw; all behind
  `this.reduceMotion`.
- `src/game/sim.ts` — optional `lookEvents` breadcrumb array (item spawns with
  source, tree felled, item-lost-to-water). Append-only, drained by render.
- `src/game/weather-look.ts` — expose the blended wind strength the props and
  ropes read (it already computes the crossfade).
- No changes to: `nav.ts`, `leveldata.ts`, `generator.ts`, save format, share
  codes, i18n.

Budget estimate: ≈ +1.5–2 kB gzipped total. No per-frame allocations.

## Success criteria

- Ropes sway in wind, bow under a sliding worker, and settle after — and render
  exactly as today when reduced effects / `prefers-reduced-motion` is on.
- Chopped logs visibly fly from the tree to their rest tile; a felled tree falls
  before its logs appear. No sim timing changes: `npm run test:unit` and
  `npm run test:campaign2` pass unmodified.
- All motion is frame-rate independent (spot-check at 30 / 60 / 144 Hz).
- Bundle stays within ~2 kB gzipped of current size.
- Not one line of `nav.ts`, `leveldata.ts` or the tick logic in `sim.ts` changes
  behavior (the `lookEvents` array is append-only cosmetic data).
