# Terrain Vision — beautiful, organic, still a puzzle

A design brainstorm for the next generation of Smallhands landscapes: how to keep
the "get it back up" puzzle intact while making generated (and handcrafted)
terrain look and feel like state-of-the-art 2D level art — rolling, layered,
soft-edged — instead of flat slabs joined by sheer right-angle cliffs.

## 1. Where we are today

### The movement contract (the physics we must respect)

Everything below is anchored in `nav.ts` / `types.ts`; these numbers are the
grammar of the whole game and the new terrain must be designed *around* them:

| Move | Empty hands | Carrying cargo |
| --- | --- | --- |
| Step **up** 1 tile (the little hop) | ✅ | ✅ |
| Step up ≥ 2 tiles | ❌ (ladder/lift) | ❌ (lift/ramp only) |
| Drop down | ≤ 5 tiles | ≤ 2 tiles |
| Ladders | ✅ | ❌ (the ladder rule) |

Two consequences that shape everything:

1. **A 1-tile step is free, in both directions, for everyone.** It is not a
   puzzle element at all — which means we can use it *as terrain texture*
   without touching solvability.
2. **The puzzle "wall" begins at exactly 2 tiles up** (cargo) and 2–5 down
   (asymmetry). Any elevation change of ≥ 2 up is a deliberate design
   statement, never decoration.

There is a third, subtler contract: `liftTopFor` requires a **clean vertical
solid face of ≥ 3 tiles** beside the mast column, and `ropeDropFor` requires a
**≥ 3 open drop**. If we roughen cliff faces, every cliff must keep at least
one column with a clean ≥ 3 face, or lifts/ropes become unplaceable and
verified levels stop verifying.

### The current generator (`generator.ts`)

`planTerrain` emits a 1D heightmap as a run of perfectly flat segments
(6–17 tiles wide) joined by instant jumps: up-cliffs of +3…+6, down-steps of
−3…−4, pits of −3…−5 and back. Fill is mechanical: one grass row, two dirt
rows, rock below, bedrock floor. The result is solvable and legible — and
reads as slabs. There is no relief *within* a flat, no shape vocabulary beyond
"flat / cliff / pit", and the profile between features is a horizontal line.

### The current look (`render.ts`, `sprites.ts`)

One 16×16 noise tile per terrain type, a 2 px highlight on top/left exposed
edges, a 2 px shadow on right edges, a rare dark blob from `tileHash`. Grass
is a single tile with a fixed 2-pixel green lip. Cliff faces are uninterrupted
columns of the identical rock tile. The sky/parallax/weather layer is already
strong (crossfading weather looks, birds, night); the *terrain* layer is the
part that lags behind it.

### The complaint, precisely

- Flats are ruler-flat, cliffs are sheer → **harsh, artificial silhouettes**.
- When a smallhand does hop a 1-tile step, the step is a blocky right angle
  taller than the sprite itself — it *reads* as climbing furniture, not
  walking a hillside bank.
- Every level is the same three words: flat, cliff, pit.

## 2. The core idea: two-frequency terrain

Split terrain into two explicit frequencies, each with its own job:

- **Macro skeleton (puzzle):** the existing grammar — regions separated by
  deliberate cliffs (≥ 3), pits, and (new) shape motifs. This is what the
  solver/verifier reasons about. Unchanged in spirit: it guarantees the level
  has a construction answer.
- **Micro relief (beauty):** *within* each macro region, the ground meanders
  by ±1–2 tiles using **only 1-tile steps** with a minimum run length between
  steps (≥ 2–3 flat tiles before the next step). Because 1-tile steps are free
  for everyone, micro relief is invisible to the puzzle — pure texture.

### Micro relief rules (the walkability invariant)

Formalize it: **within one macro region, every standable column must be
reachable from every other, in both directions, while carrying.** With steps
capped at ±1 this holds by construction; we additionally verify it (see §7).

Construction sketch (all seeded, deterministic):

1. Generate the macro profile exactly as today: flats at height `h`.
2. For each flat wider than ~8 tiles, overlay a smoothed 1D noise (2–3 octave
   value noise / midpoint displacement) quantized to integers, amplitude
   scaled to the flat's width (±1 for short flats, ±2 for long ones).
3. Post-process the quantized profile so consecutive columns never differ by
   more than 1, and each plateau run is ≥ 2 tiles (kills staccato zigzag).
4. **Clamp to zero near feature boundaries** (3–4 tiles on either side of a
   cliff/pit lip) so cliff heights stay exactly what the macro plan promised —
   a +3 cliff must never accidentally become a walkable +2/+1 staircase, and a
   −2 relief dip at a lip must never turn a 5-drop into a lethal-for-cargo 7.
5. **Reserve flat pads.** Buildings need flat, clear ground (`canPlaceBuilding`
   checks a solid row under the whole footprint): Town Hall 4 wide, goal 4,
   sawmill/forge 3. The planner already knows where TH and goal go — extend it
   to reserve 2–3 additional flat build pads per region (relief amplitude 0),
   so players are never hunting for a legal sawmill spot on a bumpy meadow.
   Pads are also where resource nodes prefer to cluster loosely.

This single change answers the "1-level steps" wish directly: gentle banks and
rises become the *default fabric* of the land, the smallhands stroll over them
(cargo included), and the only hard edges left are the ones the puzzle put
there on purpose.

### Why not real slopes?

The sim is tile-quantized; true sub-tile slopes would touch `nav.ts`,
`settle`, placement, the editor and share codes. Instead: keep collision
blocky, **render slopes** (§4). Classic 2D-game trick — Terraria, Dead Cells
tilework, most modern pixel platformers do exactly this: square physics,
sloped art.

## 3. A richer macro vocabulary (shape motifs)

Today's grammar has three words. Give it a real vocabulary — each motif is
still expressed as heights + cliffs, so the verifier keeps working unchanged:

- **Ridge / summit** — up-cliff, short high flat, down-cliff. Reads as a peak;
  goal-on-the-summit is the classic finale. (Partially exists via up+down.)
- **Mesa / butte** — a tall flat-topped block rising from a plain, cliffs both
  sides; resources on top tease a rope-anchor return route (rope down is the
  fun direction for cargo).
- **Canyon** — the inverse: two cliff walls facing each other with a floor
  between. A wide, deep pit with real estate at the bottom; iron veins and the
  night-level lantern crawl live here.
- **Terraced hillside** — 2–3 stacked cliffs of +3 with narrow shelves; the
  supply-line set piece (campaign 1's finale, now generatable).
- **Basin / valley** — a broad, shallow (−1…−2 via micro relief only) dish in
  a long flat; visually breaks the horizon without any puzzle meaning. In
  Campaign-2-style levels, basins are where ponds/floodwater sit naturally.
- **Notched cliff (ragged face)** — a cliff of +5 rendered as +4 with a 1-tile
  ledge one tile below the lip (5 = 4+1) or a 1-wide notch bitten out of the
  lip. Cargo still can't climb it (any sub-step ≥ 2 keeps the wall), empty
  hands still ladder it, and it silhouettes like real rock.
  **Invariant:** keep one clean ≥ 3 vertical face column per cliff so
  `liftTopFor`/`ropeDropFor` still find purchase — never split a cliff into
  2+2 sub-steps (that keeps out cargo but locks out lifts too).
- **Overhang / cornice (visual-only)** — 2–3 px of grass/rock art protruding
  past the cliff lip, no tile change. Pure silhouette candy, zero nav impact.

Difficulty maps naturally: d1–2 draws mostly ridges/basins/terraces, d4–5
draws mesas, canyons, notched faces, and stacks motifs. Level naming already
has the right poetry (`Windy Terraces`, `Hollow Gorge`) — pick the name pool
from the motifs actually used, so the name describes the level.

### Optional spice: the natural ramp

The RAMP tile already exists (player-built, 45°, cargo-legal). A d1-only
motif could bake a short *natural* switchback (2–3 ramp tiles of packed
earth art) into one cliff — it teaches the ramp affordance by example and
gives easy seeds one gentle "scenic path". Costs nothing in code (ramps are
ordinary support tiles) but is a real economy change (a free cargo route up
one cliff), so it should be rare, shallow (+2/+3 only), and never on the
goal-critical cliff at d ≥ 2.

## 4. Look & feel: from tiles to landscape

Ordered by impact-per-effort; all render-side, none touch the sim.

### 4.1 Edge-aware autotiling (the big one)

Replace "same tile everywhere + 2 px edge lines" with a neighbor-bitmask
lookup (the classic 47-blob reduced to what a heightmap needs — in practice
~12 cases: flat top, top-left/right convex corner, left/right face, concave
inner corners, bottom, single column). Because sprites are generated from
string maps, variants can be *derived*: take the base tile, then stamp a
rounded grass lip that curls 2–3 px over the corner, ragged dirt fringe
hanging under overhang corners, rounded rock shoulders. The lookup can happen
at draw time from `world.isSolid` neighbors (cheap; terrain already draws per
tile) with baked variants in the atlas.

This alone removes most of the "harsh edge" reading: every silhouette corner
becomes rounded, grassy, slightly irregular.

### 4.2 Slope wedges on 1-tile steps

Wherever the surface steps by exactly 1, draw a triangular grass/earth wedge
sprite in the air tile beside the step (pure decoration — collision unchanged;
`isPassable` still sees AIR, and the wedge must stay a background flourish the
eye reads as a bank). With micro relief everywhere, the whole level reads as
rolling hills while the sim stays blocky. The little hop animation now happens
"up a bank" instead of "onto a crate". Also fixes the current visual of a
smallhand scaling a right angle taller than itself.

### 4.3 Strata & cliff-face character

Cliff faces are where the eye rests. Give rock columns sedimentary variety:

- **Depth banding:** blend tile palette darker with depth below the local
  surface (not absolute y), so tall cliffs show light→dark gradation.
- **Strata lines:** every 3–5 rows (seeded per level), a 1-px darker band
  across dirt/rock — instantly reads "geology".
- **Face decals** via `tileHash`: cracks, embedded pebbles, an ore glint deep
  down, moss patches on faces adjacent to water or in rain-heavy levels,
  hanging roots in the first dirt rows under a grass lip.
- **Ambient occlusion:** soft 3–4 px gradient (instead of the current hard
  2 px line) in concave corners and under overhangs/notches.

### 4.4 Surface decoration layer

Deterministic (`tileHash`-driven) props on grass tiles, density ~1 in 5,
biome-scaled: grass tufts (2–3 variants, gentle sway reusing the tree-sway
shear with tiny amplitude, honoring reduced-motion), flowers, pebbles,
mushrooms clustered near trees, reeds beside water, tiny cairns near cliff
lips. Rules: props never obscure a smallhand's silhouette (max ~6 px, muted
palette, drawn *behind* workers), never spawn on reserved build pads or the
goal/TH aprons — readability is a mechanic in this game.

### 4.5 Biomes / palettes

Seed-derived biome per level = palette swaps (the sprite atlas is
string-map + palette, so a biome is literally a palette object) + prop set +
sky/parallax tint via the existing `weather-look` interpolation:

- **Meadow** (current look, default)
- **Autumn forest** — ochre grass, russet trees, warm sky
- **Chalk coast** — pale cliffs, marram grass; pairs with water levels
- **Red-rock canyon** — terracotta strata, sparse scrub; pairs with canyons
- **Slate highlands** — cool grey-green, heather props; pairs with terraces
- **Altitude banding** (orthogonal to biome): above a seeded snowline the
  grass tile swaps to frost/snow, rock lightens — tall levels get white caps,
  which also *communicates height*, i.e. the puzzle.

Daily challenges rotate biome with the weekday for a recognizable ritual
("storm Friday in the red canyon").

### 4.6 Depth & atmosphere

The sky layer is already good; tie the terrain into it:

- Parallax hills reshaped per biome (silhouette sets, not just sine waves),
  including a third, nearest scrub-line layer.
- A faint atmospheric fog gradient rising from the terrain's lowest third —
  valleys feel deep, summits feel airy.
- Soft canopy shadow blobs under trees; buildings already pop, keep them.

## 5. Set pieces & delight

One (max two) per level, seeded, purely scenic, placed on terrain that
supports them: a thin waterfall streaking a tall cliff face into a splash
mist (water levels), standing stones on a summit, a ruined arch half-buried
in a basin, a beehive tree, a distant windmill on the parallax layer. These
are the screenshots players share; they cost a sprite each.

## 6. What deliberately does *not* change

- The macro puzzle grammar and its guarantees (budgeted economy, verified
  solvability, seeded determinism, share codes: same seed → same level).
- Tile semantics, `nav.ts`, the movement table — zero sim changes in
  phases 1–3 (the natural ramp motif in §3 is the only sim-visible option,
  and it's additive + rare).
- Editor & share-code format: relief and biome bake into the same tile grid
  (biome id becomes one new optional field, defaulting to meadow for old
  codes).
- Readability first: decoration is background; workers, cargo, tools and
  ghosts keep contrast priority; reduced-effects mode disables sway/fog
  extras.

## 7. Verification & tests (how we keep it honest)

- Existing: `verifyLevel` (cargo reachability TH↔goal, node budgets),
  `tests/editor-generator.mjs` 30-seed matrix, sim soak. All must stay green.
- New property test (headless, cheap): for N seeds × difficulties, for each
  macro region assert `cargoReach` from the region's leftmost standable cell
  covers every standable column in the region (the walkability invariant),
  and assert every cliff retains a clean ≥ 3 lift face and every generated
  level still places TH/goal/pads on flat ground.
- Golden-seed screenshots (the e2e harness already boots real levels) for
  eyeballing autotile/decoration regressions.

## 8. Suggested build order

1. ✅ **Micro relief + flat pads** in the generator (+ `tests/terrain.mjs`
   property suite: determinism, verifier-clean, the step invariant — 0/1 or
   ≥3, never exactly 2 — flat TH/goal pads, a liftable face on every cliff).
2. ✅ **Edge-aware tiles + slope wedges + strata/depth banding/AO** in
   `render.ts`/`sprites.ts`: rounded grass lips, side-wrap, lip fringes,
   16×18 grass-bank wedges on every 1-step, sedimentary bands, face cracks,
   concave-corner occlusion.
3. ✅ **Decoration layer + biome palettes**: hash-scattered tufts, flowers,
   pebbles, mushrooms; five seeded biomes (meadow, autumn, chalk, red rock,
   slate) with sky/hill tinting through the weather crossfade, plus snow
   caps above the summit line in the slate highlands.
4. ✅ **New macro motifs**: ridge, mesa, canyon (budgets like a pit, tells
   its own story), terraced climbs — one large motif per level at ★2–3, two
   at ★4+ — plus ragged 1-tile notched lips on cliffs ≥ 4 (the face keeps a
   clean ≥ 3 rise, so the lift-face invariant holds) and motif-aware naming
   ("Foggy Table", "Silent Ridge"). Still open: the optional d1 natural ramp.
5. ✅ **Parallax + scenic layer**: three strict layers — sky-drowned horizon
   range, biome-shaped mid ridge (buttes for red rock, dunes for chalk,
   peaks with snow tips for slate, rolling hills elsewhere) with a distant
   tree line, and a near scrub line. Plus the scenic one-offs, all
   render-only and deterministic per level: valley fog pooled over the
   lowest ground (deep maps only), at most one monument (standing stones or
   a ruined arch on the highest span, clear of the town hall and caravan),
   and a waterfall wherever a cliff drops ≥ 3 straight into open water —
   which means flood levels grow falls as the tide rises.

Still open from the whole vision: the optional ★1 natural-ramp motif (it
needs sim-side care — natural ramps must not refund planks on demolish).

Each phase ships independently and is verifiable on its own; nothing blocks
on anything later in the list.
