# Birds in the sky — design

**Date:** 2026-07-12
**Status:** Approved (brainstorm), pending implementation

## Goal

Add occasional birds crossing the sky to give the scenery more life. Restrained:
the sky is empty most of the time; every so often a lone bird (or, less often, a
small V-flock) drifts across and leaves.

## Rendering approach

The backdrop is entirely procedural vector art — sky gradient, sun, parallax
hills, and clouds — with no sprites. Birds follow the same style: a procedural
**silhouette** (the classic distant seagull "M" / `︵`, two small arcs) whose
wings flap via a sine on the wing angle.

Rejected: a pixel-art sprite in the atlas (clashes in scale/style with the vector
sky, more work), and any text/emoji glyph.

## Where it lives

Inline in `src/game/render.ts`, mirroring the existing `cloudSeeds` / `effects`
pattern: a `birds` state array on the `Renderer` plus a private `drawBirds(...)`
called from `drawSky` (just after the clouds). No new module — one more backdrop
element belongs with the others (~50 lines).

## Behavior

- **Spawn timer.** A `nextSpawnAt` time (render clock). When it fires, spawn one
  event: **~80% a lone bird** (occasionally a pair), **~20% a small V-flock of
  3–5**. Schedule the next spawn `~18–38s` later, so the sky is empty most of the
  time.
- **Movement.** Each bird drifts horizontally at a gentle speed, with a **random
  direction** chosen per spawn event (a V-flock points the way it travels), in the
  upper sky band (~25–45% of viewport height, varied). A bird despawns once fully
  off-screen.
- **Parallax.** Same slow parallax as clouds (`cam.x * ~0.06`) so birds sit in the
  sky plane and don't track the foreground.
- **Layering.** Drawn just after clouds — reads in front of them, but small enough
  to still feel distant.

## Look

- Muted slate, semi-transparent (~`rgba(60,72,92,0.55)`) — reads as distant, not a
  harsh black cutout.
- Small wingspan (~10–16 px), scaled per bird.
- Wings flap slowly; each flock member gets a phase offset so the flock isn't
  robotically synchronized.

## Accessibility

`Renderer.reduceMotion` (`prefers-reduced-motion`) already gates other motion.
Birds are purely decorative, so when reduced motion is set, `drawBirds` returns
early — no birds spawn or draw at all.

## Notes

- The title screen uses the same `Renderer`/`idleGame`, so birds appear there too
  for free.
- Randomness (spawn timing, lone-vs-flock, direction, jitter) uses `Math.random()`
  — fine here because the renderer is view-only; the simulation stays deterministic.

## Out of scope

- Bird sounds.
- Birds reacting to gameplay (landing on trees, fleeing chops, etc.).
- Night/weather variants — the in-game sky is always the daytime gradient.
