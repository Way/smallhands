# Smallhands — Tiny Workers, Big Plans

A browser-based puzzle-strategy builder about **indirect control and visible logistics**,
inspired by the classic 90s problem-solving strategy genre (Lemmings-style creature
management crossed with The Settlers-style production chains).

You never control the smallhands directly. You shape the world — ladders, platforms,
cargo lifts, workshops — and your tiny autonomous crew gathers, hauls, builds and
crafts on its own. Every level is a delivery puzzle: route the right goods to the goal.

**100% hand-built for the web**: TypeScript + Canvas 2D, zero runtime dependencies,
procedurally generated pixel art and WebAudio sound. The production build is a
self-contained static site (~22 kB gzipped).

## Core mechanics

- **Indirect control** — smallhands pick their own jobs based on their role
  (hauler / builder / woodcutter / miner). You set role counts, mark resources,
  and place buildings; they do the rest.
- **The ladder rule** — a smallhand carrying goods *refuses ladders*. Empty hands
  climb anywhere; cargo needs another way up.
- **Cargo lifts** — hoist a loaded worker straight up a cliff face. Up only!
- **Rope anchors** — the mirror image of the lift: anchored at a cliff edge,
  smallhands slide *down* the rope, cargo and all. Down only!
- **One-way falls** — empty workers hop down up to 5 tiles, loaded ones only 2.
  Getting down is easy; the puzzle is getting things back up.
- **Production chains** — trees → logs → sawmill → planks; boulders → stone;
  iron veins → forge (plank + iron → spear).
- **Town Hall progression** — upgrade to unlock the forge and cargo lift and to
  grow your crew.
- **Two handcrafted campaigns** — nine levels, each verified completable
  end-to-end. Campaign 1 (four levels) teaches the logistics core, from a
  gentle tutorial to a three-terrace summit supply line. **Campaign 2 —
  Storm & Tide** (five levels, unlocked by finishing Campaign 1) adds:
  - **Water** — rivers and ponds are impassable and goods dropped in are lost
    for good; bridge them or lose the cargo.
  - **Dynamic weather on a visible forecast** — rain slows chopping and
    mining, storms lock the cargo lifts' brakes. The schedule is
    deterministic and shown in the HUD, so planning around it *is* the puzzle.
  - **The rising tide** — in flood levels every rainfall raises the water one
    permanent step; loot the lowlands before they drown, then bridge the lake.
  - **Night & lanterns** — smallhands only harvest and build in the light.
    Lantern posts (1 log + 1 stone) can be raised anywhere, pushing the
    frontier of light toward the far resources.
- **Medals & personal bests** — every level has gold/silver/bronze time
  thresholds and two feats (*No Demolish*, *Light Touch*). Wins end in a
  medal ceremony with an honest time gauge; the level select carries a
  trophy shelf and per-level medal slots. Records live in localStorage.
- **Two languages & an options menu** — the whole game (levels, hints, HUD,
  editor, verifier) ships in **English and German**; the language follows the
  browser until the player picks one in the **Options** menu (reachable from
  the title, the level select and in-game via ⚙). Options also cover sound,
  a reduced-effects mode (rain streaks, sway, flicker off) and a progress
  reset. Language switches apply live — even mid-level.

## The Workshop: editor, generator & daily challenge

Beyond the campaign, the level select offers a **Workshop** row:

- **Level editor** — sculpt terrain (ground / rock / dig), plant trees,
  boulders and iron veins, move the Town Hall and caravan, set the delivery
  order, starting crew, stock and Town Hall level. One click **verifies**
  the level with a static solvability analysis (buried buildings, sealed-off
  resources, cargo routes checked on a graph that assumes you may build
  platforms and lifts, resource budget vs. the order) and **Playtest** drops
  you straight into the real game — and back into the editor.
- **Procedural generator** — seeded, difficulty ★1–★5. Terrain is built from
  a grammar of flats, cliffs and pits (the classic "get it back up" puzzle),
  the economy is budgeted to the generated order, and every roll is
  re-verified until it passes. The same seed always builds the same level —
  share seeds with friends.
- **Daily challenge** — one shared seed per calendar day, difficulty rising
  through the week. Completion is tracked.
- **Share codes** — any level (edited or generated) exports as a compact
  `SMH1.…` text code; import codes from the level select. No server needed —
  levels and progress live in localStorage.

The design for where the game goes next — story, chapters, new mechanics,
skill tree, challenge modes — lives in [`docs/DESIGN.md`](docs/DESIGN.md).

## Controls

| Input | Action |
| --- | --- |
| Left click | Use selected tool / place |
| Drag / WASD / arrows | Pan camera |
| Mouse wheel | Zoom (pixel-perfect steps) |
| `1`–`9`, `0`, `L` | Select tool |
| `Space` | Pause / resume |
| `Esc` | Back to inspect tool |

## Development

```bash
npm install
npm run dev      # dev server with HMR
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build locally
```

## End-to-end smoke test

With a preview server running on port 4173, this drives a real browser through
levels 1 and 2 (harvesting, sawmill production, goal deliveries, cargo lift and
ladder logistics) and fails if the levels can't be completed:

```bash
npm run build && npm run preview &   # serve dist on :4173
node tests/e2e.mjs
```

A second suite drives the level editor (open, verify, sculpt, playtest,
return), checks the generator across 30 seed × difficulty combinations
(verified + booted in the real simulation + deterministic), round-trips a
share code and soaks a generated level for 60 simulated seconds:

```bash
node tests/editor-generator.mjs
```

Two headless suites need no browser at all: `tests/unit.mjs` covers pure
simulation logic (ladders, reserves, medals, water, weather, flood, night),
and `tests/campaign2.mjs` plays every Campaign 2 level start-to-finish with a
scripted player and fails unless the win state is reached:

```bash
npm run test:unit
npm run test:campaign2
```

A third browser suite (`npm run test:i18n`, preview server required) switches
the game to German through the options menu and verifies every open surface —
title, level select, in-game HUD — re-renders live and the choice persists.

## Hosting

The build output in `dist/` is a fully static site with relative asset paths —
host it anywhere (GitHub Pages, itch.io, Netlify, any static file server).
A GitHub Actions workflow (`.github/workflows/deploy.yml`) is included that
builds and publishes to GitHub Pages on every push to `main` — enable
**Settings → Pages → Source: GitHub Actions** in the repository to activate it.

## Credits

An original homage to the genre. All code, pixel art (generated from in-repo
string maps) and audio (WebAudio synthesis) are original to this project.
