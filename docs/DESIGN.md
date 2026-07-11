# Smallhands — Design Package: The Ember Road

A complete design for growing Smallhands from a four-level demo into a game
that stays **demanding, varied and motivating** over dozens of hours: story,
journey, new puzzle mechanics, resources, buildings, roles, a skill tree,
challenge modes and quest systems — plus the order in which to build it all.

Everything here respects the two design pillars the game already has:

1. **Indirect control.** You never steer a smallhand. Every new mechanic must
   be something you *build, mark or configure* — never a unit you click.
2. **Visible logistics.** The puzzle is always "how do goods physically get
   from A to B?". New mechanics add new answers (and new obstacles) to that
   one question; they never bypass it with teleports or magic storage.

Status legend: ✅ shipped · 🔜 next up · 🧭 designed, not scheduled

---

## 1. The story: *The Ember Road*

The campaign so far ends with the Summit Beacon being lit (level 4). The
story continues from that exact moment:

> When the Summit Beacon flared to life, the smallhands expected silence.
> Instead, far across the valley — one after another — old beacons answered.
> Faint, guttering, half-forgotten: the waystations of the **Ember Road**,
> the great trade route that once stitched the scattered villages of the
> smallfolk together. Someone out there is still waiting for deliveries that
> stopped coming a hundred years ago.
>
> So the crew packs the caravan, appoints an Overseer (that's you), and sets
> out to do the only thing smallhands know how to do about a broken world:
> **rebuild the supply line.** One beacon at a time.

The story is told with the tools the game already has — level names, level
blurbs, hint toasts, and the goal caravan — plus one cheap new device: a
short **caravan letter** before each chapter (a styled overlay, ~4 sentences,
signed by a recurring character). No cutscenes, no dialogue trees.

**Recurring characters** (text-only, zero art budget):

- **Marla Quill**, caravan mistress — writes the chapter letters, sets the
  grand orders, dry humour.
- **Old Tam**, retired woodcutter — delivers tutorial hints for new
  mechanics ("In my day we ROPED the crates down, you know").
- **The Rustkin** — not villains, just weather-beaten clockwork leftovers
  from the old kingdom that occasionally jam a route (story dressing for
  hazards; nothing fights anything).

Story tone: warm, hopeful, a little melancholic about the fallen kingdom —
lemmings-era whimsy, not grimdark.

---

## 2. The journey: chapters of the Ember Road

Six chapters, each a biome with its own signature mechanic, 5–6 levels each
(short: 10–25 minutes). Each chapter ends in a **Grand Order** — a large
level that combines everything the chapter taught. Between chapters, the
world map (a simple side-scrolling road with beacon icons) shows progress:
every finished chapter is a beacon that stays lit.

| # | Chapter | Biome | Signature mechanic | New resource / building | Emotional beat |
|---|---------|-------|--------------------|-------------------------|----------------|
| 0 | **The Valley** (existing 4 levels) | green hills | ladders, lifts, chains | — | learning the ropes |
| 1 | **Mistwood** | deep forest, giant trees | **rope anchors** (cargo *down*-transport) | fiber → **ropewalk** → rope | leaving home |
| 2 | **The Sunken Quarry** | flooded stone pits | **water & pumps** | clay → **kiln** → bricks | draining the past |
| 3 | **The Underway** | mines & caverns, darkness | **minecarts & lanterns** | coal, **cart station**, lanterns | courage underground |
| 4 | **Windreach Peaks** | high crags, storms | **balloons & wind** | canvas → **balloon dock** | above the clouds |
| 5 | **The Shattered City** | ruined capital | **all systems + Rustkin jams** | gears → **workshop**, gold | the road reconnected |

Design rule per chapter: **one new traversal verb, one new production chain,
one new hazard.** Never more. Each level in a chapter follows the classic
teaching arc: *introduce → invert → combine → subvert → Grand Order*.

### Why these mechanics, in this order

The core asymmetry of Smallhands is: **down is free, up is expensive** (for
cargo). Every chapter bends that asymmetry a new way instead of repeating it:

- **Rope anchors (Ch. 1)** ✅ *(mechanic shipped; Mistwood levels pending)* —
  the mirror image of the cargo lift: a cheap, build-once *down-only* cargo
  zipline. Suddenly "get goods down a cliff safely" matters (loaded workers
  only survive 2-tile drops). Levels can now put resources *above* the base
  and still be puzzles. Implemented as the **Rope Anchor** tool (2 logs +
  1 plank, no Town Hall gate): placed on a cliff-edge cell, it hangs its rope
  over the side down to the first landing (min. 3 tiles). The pathfinder
  gained a `slide` edge — downward only, allowed while carrying — and the
  solvability verifier and generator account for it, so generated levels may
  now legitimately route cargo *down* tall cliffs.
- **Water (Ch. 2)** — a horizontal wall. Water tiles are impassable;
  a **pump** (new building, needs planks + bricks) drains a connected body
  one row at a time, opening routes *over time*. First mechanic where the
  map itself changes mid-level. Classic puzzle: the iron is at the bottom of
  a flooded pit — pump first or platform over?
- **Minecarts (Ch. 3)** — the first *bulk* transport: you lay rails
  (costly: planks + iron), a cart hauls 4 items at once between two cart
  stations, but only along rails you physically route. Darkness + lanterns
  gate which areas workers will enter at all — a soft wall that costs
  resources to push back. This chapter is where throughput planning replaces
  pure pathfinding as the core challenge.
- **Balloons (Ch. 4)** — the late-game answer to "up", but wind makes it
  situational: a balloon lifts a full crate straight up *while the wind is
  calm*; storm phases ground it. Timing and buffering enter the game
  (stockpile during storms, ship during lulls).
- **Gears & Rustkin jams (Ch. 5)** — finale remix. Gears (iron + coal at
  the workshop) are the master resource that repairs jammed old-world
  machinery pre-placed in levels: a dead ancient lift, a seized drawbridge, a
  rusted cart line. Repairing beats rebuilding — levels become archaeology:
  read the ruined infrastructure, decide what's worth reviving.

### New hazards (spice, never randomness-as-punishment)

- **Crumble tiles** (Ch. 1+): support N crossings, then collapse — visible
  cracks telegraph it. Forces route redundancy.
- **Rising water** (Ch. 2): some levels slowly flood from below; a soft
  timer that converts "solve it eventually" into "solve it efficiently".
- **Cave-ins** (Ch. 3): marked ceilings drop rubble when mined below —
  rubble is *also* a stone source. Hazard = opportunity.
- **Storm cycles** (Ch. 4): global calm/storm rhythm shown by a wind sock.
  Balloons and tall lifts pause in storms.
- **Rustkin jams** (Ch. 5): a wandering clanker occasionally blocks a lift
  or rail until a worker delivers 1 gear to shoo it off. Gentle attrition
  that keeps late-game logistics from going fully idle.

All hazards are deterministic or clearly telegraphed. Nothing kills a
smallhand — this game's tension is about *goods and time*, not lives.

---

## 3. New resources & production chains

Current chain: trees→logs→planks; boulders→stone; veins→iron; plank+iron→spear.

The extended economy stays strictly **two-tier** (raw → refined) with one
three-tier finale, so tooltips stay readable:

| Raw (node) | Refined (building) | Used for |
|------------|--------------------|----------|
| logs (trees) | planks (sawmill) | everything structural |
| stone (boulders) | — | lifts, forges, pumps |
| iron (veins) | spears (forge) | orders, rails |
| **fiber** (reed patches) 🔜 | **rope** (ropewalk) | rope anchors, balloons, deep orders |
| **clay** (clay banks) 🔜 | **bricks** (kiln, needs 1 coal) | pumps, kilns, city rebuilding orders |
| **coal** (coal seams) 🔜 | — (fuel) | kiln, lanterns, workshop |
| **berries/grain** (bushes/farm plots) 🧭 | **bread** (bakery) | crew stamina (see below) |
| **canvas** = rope + fiber 🧭 | (ropewalk) | balloons |
| **gears** = iron + coal 🧭 | (workshop) | repairs, finale orders |
| **gold** (rare nuggets) 🧭 | — | pure order/score item, never a tool cost |

**Bread & stamina (Ch. 2+, campaign only):** workers slowly get *peckish*
(never die, never strike): a peckish smallhand walks at 80% speed. One bread
at the town hall tops up the whole crew for a few minutes. This adds a
gentle upkeep drum to long levels *without* punishing puzzle experimentation
— and it makes the farm/bakery chain matter. Off by default in editor
levels and in Zen mode.

Rule for all new chains: **every input is visible as a carried item.** No
invisible fuel meters — coal physically walks to the kiln.

---

## 4. New roles

Current: hauler, builder, woodcutter, miner. Add at most three — role juggling
is a core lever and too many dilutes it:

- **Farmer** 🧭 (Ch. 2): tends reed/clay/berry/grain nodes (re-growing nodes
  — unlike trees, they regenerate after a cooldown, so farmers create the
  game's first renewable income).
- **Carter** 🔜 (Ch. 3): drives minecarts; number of carters = number of
  carts moving at once.
- **Engineer** 🧭 (Ch. 5): repairs jammed machines and old-world ruins
  (consumes gears), winds up balloons.

---

## 5. The skill tree: *The Guild of Small Plans*

Meta-progression across the whole game. Finishing levels and challenges earns
**Guild Marks** (1 per level, +1 per medal tier, +1 for a daily). Marks are
spent in a three-branch tree. Free respec anytime — the tree is a *strategy
choice*, not a grind wall.

**Balance philosophy:** perks may buy **convenience, information and
flexibility**, never raw multipliers that trivialise puzzles. Campaign levels
are always beatable with zero perks; medal times assume a modest build.

### Branch 1 — Logistics (blue): *move it smarter*

| Tier | Perk | Effect |
|------|------|--------|
| 1 | Sturdy Boots | loaded workers survive 3-tile drops (was 2) |
| 1 | Route Chalk | hover any building to see live haul routes drawn |
| 2 | Queue Discipline | lifts board 2 workers per trip |
| 2 | Pack Frames | haulers *may* carry 2 of the same item at 75% speed |
| 3 | Signal Flags | priority marker: flagged building gets hauls first |
| 3 | Ropemaster | rope anchors cost 1 rope less |

### Branch 2 — Craft (amber): *make it better*

| Tier | Perk | Effect |
|------|------|--------|
| 1 | Sharp Saws | sawmill batch 0.5s faster |
| 1 | Salvage | demolish refunds 75% (was 50%) |
| 2 | Hot Kilns | kiln/forge accept 1 extra input buffer |
| 2 | Blueprint Reuse | second copy of any building costs −25% |
| 3 | Master Smith | forge occasionally (20%) yields a bonus spear |
| 3 | Old-World Manuals | repairs cost 1 gear less |

### Branch 3 — Community (green): *grow the crew*

| Tier | Perk | Effect |
|------|------|--------|
| 1 | Bunk Beds | +1 max crew at every town-hall level |
| 1 | Early Risers | first 2 spawns arrive twice as fast |
| 2 | Hearty Stew | bread feeds the crew 50% longer |
| 2 | Apprentices | role switching is instant (no walk-home) |
| 3 | Town Pride | town hall upgrade time −30% |
| 3 | Festival | winning a level early converts leftover time into bonus Marks |

Tier gates: tier 2 needs 4 Marks in the branch, tier 3 needs 8. Total tree
≈ 40 Marks; a completionist earns ~90 — room for future tiers.

---

## 6. Challenge modes & replayability

- ✅ **Daily Challenge** *(shipped)* — one shared generator seed per day,
  difficulty rises through the week (Mon ★2 … Sun ★4). Same mountain for
  everyone; completion tracked.
- ✅ **Endless generator** *(shipped)* — seeded, verified levels at ★1–★5;
  seeds are shareable text, so "try seed `ember-ridge-42`" is a social loop.
- ✅ **Level editor + share codes** *(shipped)* — the community content loop.
- 🔜 **Medals** — per level: bronze/silver/gold for completion time, plus two
  named feats per level ("no demolish", "crew ≤ 6"). Feats teach advanced
  play patterns; medals feed Guild Marks.
- 🔜 **Weekly Expedition** — one ★5 generated level with a fixed seed and a
  twist rule (e.g. "ladders cost 2 logs", "no ramps or bridges"). Twists
  rotate from a hand-written list; the generator already supports tool
  restriction via `allowedTools`. Note a Ramp is mechanically a Bridge tile
  (`T.RAMP` is just `'platform'`'s diagonal-placement sibling), so a twist
  meant to force lifts/ropes must exclude both `'platform'` and `'ramp'` —
  banning only one still lets the other bridge the gap.
- 🧭 **Order Rush** — score-attack mode: endless stream of small caravan
  orders on a fixed map, 10 minutes, score = deliveries. Leans on the daily
  seed infra.
- 🧭 **Zen Mode** — no objectives, big generated map, all tools unlocked:
  the ant-farm fantasy. Costs almost nothing to build (objectives: []) and
  is a surprisingly strong retention feature for this genre.

---

## 7. Tasks & quests (the "always a next thing" layer)

Three granularities keep every session pointed at a goal:

1. **Side orders (in-level)** 🔜 — while the main order stands, Marla
   occasionally posts an optional extra ("+3 planks in the next 90s → +1
   Guild Mark"). One at a time, ignorable, auto-expires. Uses the existing
   toast + objective UI.
2. **Beacon requests (per chapter)** 🧭 — each chapter has 2–3 optional
   letters from villages off the road ("The mill at Fernhollow needs 6
   bricks — deliver them in any Ch. 2 level"). Cross-level counters; reward:
   cosmetic hats for the crew + Marks.
3. **Achievements (global)** 🧭 — sly, teachable moments: *"Gravity Is Free"*
   (deliver an item that fell 5+ tiles), *"Assembly Line"* (sawmill never
   idle for 3 minutes), *"The Long Way Round"* (win a level without lifts).

---

## 8. The motivation loops, explicitly

- **Minute loop:** mark → haul → build → watch it flow. (Already strong —
  protect it: never add a mechanic that requires micromanagement.)
- **Level loop:** read terrain → plan chain → execute → win screen with
  time/medals → "next" or "retry for gold".
- **Session loop:** daily challenge + one campaign level + tinker in the
  editor. Three different moods, 30–45 minutes.
- **Meta loop:** Marks → skill tree → harder difficulties/weeklies feel
  approachable → more Marks. The Ember Road map with lit beacons is the
  long-term progress fantasy.
- **Creative loop:** editor → share code → friend's time on your level →
  iterate. Zero-server multiplayer.

**Difficulty curve rule:** campaign difficulty comes from *route topology*
(more verticality, split resource sites, hazards), never from tighter
economies alone. The generator's ★ rating mirrors this: higher ★ = more
cliffs/pits and leaner margins, in that order.

---

## 9. Implementation roadmap (code-shaped)

Phase A — ✅ **shipped in this change**
- `leveldata.ts`: serializable level format, share codes, static solvability
  verifier (footprints, sealed-region check, cargo-reachability on a
  player-augmented graph, resource budget).
- `generator.ts`: seeded terrain grammar (flats/cliffs/pits), difficulty
  1–5, economy budgeting, verified generation, daily seed.
- `editor.ts`: in-game editor (terrain sculpting, nodes, buildings,
  objectives, crew/stock, resize, verify, playtest round-trip, save,
  export/import codes, embedded generator).
- Level select "Workshop": daily challenge, generate, editor, import,
  custom level cards; completion tracking for custom/daily levels.

Phase B — the next contentful slice (each item is small and independent)
1. ✅ Rope anchor: new `Tool` + a `PathStep` kind `'slide'`; nav edge = the
   inverse of the lift edge (top→bottom, cargo allowed). Verifier and
   generator account for it; covered by an end-to-end test that builds a
   plateau in the editor and delivers cargo down a 7-tile cliff.
2. 🔜 Medals + per-level best times in `SaveData` (win screen already has
   time). **Needs its own design pass first**: medals must feel genuinely
   rewarding — prestige presentation (a Hall of Fame / trophy shelf where
   players can show off their medals and best times) is part of the scope,
   to be evaluated separately before implementation.
3. Side orders: a `sideOrder` field on `LevelDef` + spawn logic in `sim.ts`.
4. Chapter 1 "Mistwood": 5 levels using rope + crumble tiles (new tile kind
   `T.CRUMBLE` with a crossing counter), caravan letters as overlays.
5. Weekly expedition (seed = ISO week, twist list).

Phase C — 🧭 water, carts, balloons, guild tree, chapters 2–5. Each is its
own vertical slice: mechanic + chain + 5 levels + generator support.

---

## 10. What we deliberately do NOT add

- **Combat.** Spears are trade goods forever. The Rustkin never fight.
- **Worker death.** Failure = lost time, never lost lives; restarts stay
  cheap and guilt-free.
- **Real-time multiplayer.** Seeds and codes are the multiplayer.
- **Hard time limits on campaign levels.** Pressure comes from optional
  medals and soft hazards; the base game stays a thinking game.
- **Direct unit orders** — if a design needs "click worker, send there",
  the design is wrong for this game.
