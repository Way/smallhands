# Campaign 5 — Deep & Drowning

Five handcrafted levels (ids 18–22), unlocked once every Campaign 4 level is
complete. Campaign 5 adds **no new `LevelDef` field, tool, item, role or
building** — every pressure it uses already shipped. Its identity is
**pairings the game has never made**: Campaign 2 flooded a meadow, Campaign 4 dug
a dry mine, and nobody had ever dug *below a water table*.

It is also the first territory to leave the meadow palette (`biome: 'redrock'`),
so the sequel to *Shaft & Seam* reads as a different country at a glance.

## Design pillars

Inherited from Campaign 2 (`docs/CAMPAIGN2.md`) and still binding:

1. **Deterministic, visible, plannable.** The tide rises exactly one row per
   rainfall and the HUD forecast already says when rain is coming. The player is
   never surprised — they are *scheduled against*.
2. **Every pressure prices a decision in resources.** A shaft driven toward the
   deep drift is shovel-time spent on ore that may drown; the shallow scrape is
   always there and always slower.
3. **No softlocks.** Every order sheet is fillable entirely from above the final
   waterline. Deep seams are the fast route and the medal route — never the only
   route.

## The core interaction: `flood` × `dig`

Both systems shipped years apart and had never met. What the campaign leans on:

| Rule | Consequence for the player |
|---|---|
| `riseWater()` runs at each **rain** phase start, raises the table one row from `flood.start` up to `flood.min`, and never recedes | The forecast strip *is* the level timer. "You have three rains" is a readable budget. |
| It converts **every AIR cell** at or below the new row, map-wide, including sealed chambers | A water **table**, not a flow. No sealing-cheese. |
| **A cell opened at or below the table fills as it is cut** (`openCell`) | **You cannot dig below the water table.** A shaft driven past the line fills as it goes, and water is not diggable (`isSolid` excludes it) — so the shaft stops itself and nothing ever drains a lake. |
| **Timber standing in a flooding row is swept away** (`sweepTile`) | A laddered shaft is not a dry corridor through the lake. The budget slot comes back; the materials do not. |
| Goods in the new water **sink**; a smallie caught wading is rescued home and drops its load | The deep gallery is a place you must *clear out*, not merely abandon. |

The last two are the card's sim changes; see `## The rising tide` in
`docs/architecture.md` for why each is load-bearing.

## Authoring invariants

Both are silent softlocks, so `tests/campaign5.mjs` asserts them from the level
**data** rather than discovering them in the play loop:

1. **The town hall, the caravan and the row each of them RESTS ON stay above
   `flood.min`.** The footprint alone is not enough: water is not `isSupport`, so
   flooding the support row stops the floor being standable and the dock becomes
   unreachable with no warning. This is exactly the bug the check caught in level
   21 during authoring.
2. **Every objective item is obtainable from above the final waterline** — with
   margin, because a drowned hauler's load is gone and an exact-fit sheet would
   softlock on a single mistake. Recipe items resolve to their raw inputs.

## The levels

| # | Name | New pairing | Sheet | Proof time | First rise |
| --- | --- | --- | --- | --- | --- |
| 18 | The Seeping Floor | **flood × dig** | iron 16 · stone 18 | 154 s | 100 s |
| 19 | Two Galleries | flood × dig × one wheel | iron 8 · stone 12 | 241 s | 90 s |
| 20 | Ballast & Bilge | **flood × hoist × sinking goods** | iron 24 · stone 20 | 129 s | 60 s |
| 21 | The Rope Shift | **flood × storm × rope** | plank 12 · stone 12 · iron 4 | 190 s | 70 s |
| 22 | Low Water | everything × convoy | spear 5 · stone 8 | 408 s | 80 s |

**18 · The Seeping Floor** — two very different sources of iron: a shallow scrape
in the first solid row (one dig per vein, the ore steps up to the surface on its
own, safe for ever) and a drift at row 23 that pays triple and drowns on the first
rain. The lift goes on the shaft floor, campaign 4's own move — and *that floor is
the row the water takes*, because a lift cannot be parked one row higher: its base
must be standable, and the cell above a dug floor is standing on air.

**19 · Two Galleries** — two depths, two clocks, and `toolLimit { lift: 1 }`. The
stone is in the lower gallery, which is the one the water is coming for, so the
level is a question about order: quarry deep first, then **move the wheel
upstairs** — a demolished machine hands back half its materials *and* its slot.

**20 · Ballast & Bilge** — the crew lives on a dry plateau; the rich ore lies in a
stepped basin below, and a cliff-edge hoist fetches it up on plateau-stone ballast.
The wheel has a **shelf life**: machine geometry is measured once at placement and
never re-measured, so the cars keep swinging while the lower station itself turns to
lake. Ballast dropped after that is gone. The plateau's stone is both the ballast
and half the sheet, and the keep floor is how that argument is settled — bank it too
long, though, and the cars go too light to swap (the floor gates *every* autonomous
consumer, not just the caravan).

**21 · The Rope Shift** — the caravan is walled into the deep, so deliveries run
downhill, which is the only direction a rope carries cargo. This is the level that
finally *teaches* what Campaign 2 only wrote down: **a storm brakes every wheel in
the world, and a rope is gravity.** The tide's part is a quarry below the gallery —
rich, a short carry from the dock, and drowning.

**22 · Low Water** — the finale. Iron in the deep, the caravan on the heights, and
three schedules to read together: the rain that raises the table, the storms that
brake both wheels at once, and a dock that is only home 40 s in every 60.
`toolLimit { lift: 1, hoist: 1 }` names the intended pair out loud, as Campaign 4's
finale did.

All five are proven completable end-to-end by a scripted headless player on every
run of `npm run test:campaign5`, which prints each level's completion time **and
the wall-clock of its first rise** — because `flood.min` and the rain cadence are
coupled, and a schedule that rains faster than a crew can carve a shaft turns the
opening beat from tense into pointless.

## Two hazards worth knowing before authoring more of these

Both were found the hard way while tuning, and neither throws:

- **A two-deep scrape strands its digger.** A digger stands *in* the cell it is
  opening, so the second cut drops it into a trench whose lip has lost its support —
  and an unstandable lip cannot be stepped up onto. Nothing but a ladder gets it out.
  Keep player-facing scrapes one row deep, or ladder them.
- **The keep floor starves machines, not just the caravan.** `spare()` is the one
  policy for every autonomous consumer, so banking stone to protect a hoist's
  ballast also stops haulers loading that stone into its cars. Bank the build cost,
  release the ballast.
