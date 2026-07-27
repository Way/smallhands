# Campaign 2 — Storm & Tide

Five handcrafted levels (ids 5–9), unlocked once every Campaign 1 level is
complete. The campaign keeps the game's core promise — **a logistics puzzle
about spending scarce resources on the right infrastructure** — and layers
three new pressures on top of it: water, weather and darkness. None of them
add randomness; all of them add *planning*.

## Design pillars

1. **Deterministic, visible, plannable.** The weather runs on a fixed looping
   schedule shown in the HUD forecast. The tide rises exactly one step per
   rainfall. Night never ends. The player is never surprised — they are
   *scheduled against*.
2. **Every new system prices a decision in resources.** A bridge plank spent
   over water is a plank not delivered. A lantern costs the same log that
   could become a ladder. A lift idled by a storm is time, and time is medals.
3. **No softlocks.** Every level is beatable from any reachable state:
   flood ceilings are tuned so a shelf-height bridge can always cross the
   water, and safe high ground always carries enough resources to fill the
   order without the drowned bonus loot.

## The new mechanics

### Water (`T.WATER`)
- Impassable, unstandable, unbuildable — no ladders in it, no foundations on it.
- **Goods dropped into water sink forever** (splash + toast). Careless
  demolitions and flood-caught haulers feed the fish.
- Bridges span it at bank height; the classic tool, new stakes.

### Dynamic weather (`LevelDef.weather`)
- A looping schedule of `clear | rain | storm` phases; the HUD shows the
  current phase, a countdown, the next two phases — **and what each of them
  costs you**, generated from the rule table so the text can never drift from
  the numbers the sim applies.
- Every rule lives in **`WEATHER_RULES`** (`src/game/types.ts`). Card #70
  split rain and storm apart, because one shared 0.55 multiplier meant the two
  skies were mechanically the same event with different art — nothing to feel,
  nothing to plan:

  | | harvest | wheels (lift + hoist) | lantern light |
  |---|---|---|---|
  | clear | full | turning | full |
  | **rain** | −30 % | turning | full |
  | **storm** | −60 % | **braked** | **−40 %** |

- **Rain** is the gentle one and does exactly one thing — fell in the sun, saw
  in the rain.
- **Storm** is the one you plan around: work crawls, cargo lifts and
  counterweight hoists lock their brakes (riders mid-ascent finish their trip),
  and lantern pools visibly pull in — so a night storm shrinks the workable
  world, not just its speed. Trees thrash, clouds race.
- Two things deliberately **do not** bend to the weather: the town hall's and
  the caravan's own fires (sheltered hearths — a gale must never black out the
  home yard), and **ropes**, which are gravity rather than gears. The rope is
  the storm-proof route, and finding that is the point.
- `Game.wheelsLocked` and `Game.lanternRadius` are the single readers of the
  table; `weatherEffects(kind, floodLevel)` is the single source for every
  readout (forecast lines, the sky glyph's tooltip, the phase-change toast).

### The rising tide (`LevelDef.flood`)
- In flood levels, **every rainfall raises the water table one row**, from
  `flood.start` up to the `flood.min` ceiling. It never recedes.
- Flooded ground items sink; smallies caught wading scramble back to the
  town hall, dropping their load into the drink.
- The ceiling is tuned per level so a bridge one row above the final
  waterline can always be anchored on dry shelf edges — pressure, not a trap.

### Night & lanterns (`LevelDef.night`, the Lantern tool)
- The world is dark outside light circles cast by the town hall, the caravan
  and finished lanterns.
- Smallies **only harvest and raise workshops in the light** — but a
  builder will raise a *lantern* anywhere (1 log + 1 stone, key `L`). Chaining
  light toward far resources is the level's routing puzzle.

## The levels

| # | Name | Teaches | Twist |
| --- | --- | --- | --- |
| 5 | The Ford | Water, bridge-or-lose-it | Goods sink; the caravan is across the river |
| 6 | Monsoon Hollow | Forecast reading, rain slowdown, **the tool budget** | A pond blocks the road east; six planks of bridge, no more |
| 7 | Lantern Ridge | Night, lantern chains | Forge spears at the end of the light chain |
| 8 | The Rising Tide | Flood pressure | Basin drowns first; bridge the new lake at shelf height |
| 9 | Tempest Summit | Everything at once | Night ascent; storms idle the lifts *and gutter the lanterns*, ramps keep walking |

All five are proven completable end-to-end by a scripted headless player on
every run of `npm run test:campaign2`.

## Teaser video — shot list (next step)

Working title: *“Smallhands II — Storm & Tide”*. ~30–40 s, captured from the
real game at 2× zoom, cut on the game's own audio cues.

1. **Cold open (3 s)** — Campaign 1 summit beacon win ceremony, hard cut to black.
2. **Rain rolls in (5 s)** — Monsoon Hollow: sky darkens on the phase change
   toast, rain streaks start, trees lean. Text: *“The weather has plans.”*
3. **The tide (6 s)** — Rising Tide time-lapse: three flood steps swallow the
   basin, a hauler scrambles home, his stone splashes. Text: *“The water
   keeps them.”*
4. **Night (6 s)** — Lantern Ridge fully dark, then a lantern chain lights
   up one pop at a time toward the iron veins. Text: *“Push back the dark.”*
5. **Storm (5 s)** — Tempest Summit: gusts scream, a loaded hauler queues at
   a locked lift, forecast strip shows the calm window coming. Text:
   *“Wait for your window.”*
6. **Montage (6 s)** — bridge snapping across the river tile by tile, spears
   riding a lift, the caravan bar filling.
7. **Title card (4 s)** — logo + *“Campaign 2 — Storm & Tide. Finish
   Campaign 1 to begin.”*

Capture notes: drive scenes via the `window.__smallhands` debug hook
(`startLevel`, `setSpeed`, `game.weatherIdx`, `game.riseWater()`) so every
shot is reproducible; record with Playwright screencast or OBS at 1440×860.
