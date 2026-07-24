# In-game bug/feedback report — design

Card #58. Written 2026-07-24.

## Problem

When a player hits a bug, there is no way to hand an agent enough context to
reproduce it. A prose description ("my digger got stuck") is unactionable: the
map state that produced the bug is gone the moment the tab closes.

The goal is a one-click bundle that lets an agent **stand in the exact map** the
player was looking at, see what they saw, and read every number the sim knows.

## Constraints

Smallhands is a static Vite build on GitHub Pages. There is no backend and no
place to POST a report. There is also no mid-level save format — the share code
(`SMH1.`) encodes a *starting* level, not a live game.

## Destination

Copy to clipboard and download to disk. No submit endpoint, no third-party
service, nothing that can break in production or leak player data. The player
pastes the bundle into a Harmony card or a GitHub issue themselves.

## The three artifacts

### 1. Live share code

A `SMH1.` code describing the world **as it is now**, so pasting it into the
game's level import reproduces the situation. This requires extending
`CustomLevelData`, which today cannot express player-placed buildings or
partially harvested nodes.

The extension is **optional fields only, and `v` stays `1`**:

```ts
nodes: { kind; x; y; yieldLeft?: number }[]
buildings?: { kind; x; y; ready: boolean; progress?: number; paused?: boolean }[]
```

No version bump, for two reasons: custom levels already in `localStorage` are
`v: 1` and must keep decoding, and a new code opened by a stale cached bundle
should quietly lose its buildings rather than be rejected outright.

`buildings` deliberately **excludes townhall and goal** — those keep their
existing dedicated fields, and including them would double-place on load.

The snapshot fills the existing start-state fields from live values:

| field | source |
|---|---|
| `tiles` | `world.tiles` now — dug cells, ladders, ramps, platforms included |
| `nodes[].yieldLeft` | surviving nodes only (depleted ones leave `game.nodes`) |
| `startStock` | `game.stock` |
| `startRoles` | `game.desiredRoles` |
| `startThLevel` | `game.thLevel` |
| `startWorkers` | `game.workers.length` |

**Not serialized, on purpose:** lift/rope geometry (`liftTopY`, `ropeBottomY`,
`ropeSide`). Terrain is identical on reload, so `liftTopFor`/`ropeDropFor`
recompute the same values. Storing them would create a second source of truth
that can silently disagree with the terrain.

`levelDefFromData().build()` places buildings after nodes, then patches
`yieldLeft` and `progress` on the created objects directly. This avoids changing
the signatures of `addNode`/`addBuilding`, which every campaign level calls.

**Accepted lossy edge:** the editor has no building tool, so importing a report
code into the *editor* and re-saving drops `buildings`. The reproduction path is
import-and-play, not edit, so this is not worth solving.

### 2. `report.md`

Everything the sim knows, in reading order: level identity and campaign, build
hash, user agent, viewport, language, the player's own words, then elapsed time,
clock hour and `nightAmount()`, weather phase with time remaining, `waterRow`,
town-hall level and upgrade progress, objective progress including inbound,
stock with reserved and keep floors, desired versus actual role counts, one line
per worker (role, task, carried item, cell), one line per building (state,
progress, input/output buffers, paused), nodes with remaining yield, and the
dig-order list.

The report body is **always English** — it is read by agents, not players. The
UI around it is localized EN/DE, and the player's free text is kept verbatim in
whatever language they typed.

### 3. Screenshots

- `viewport.png` — `canvas.toDataURL('image/png')`. The player's exact camera and
  zoom, which is where the bug is.
- `map.png` — a one-shot offscreen `Renderer` at cam `{0,0}` with the zoom fitted
  so the whole level lands under ~2048px wide, and `hover.visible = false`. Gives
  global layout at a glance.

`Renderer` already takes an arbitrary canvas in its constructor, so the second
render needs no changes to the renderer itself.

## UI

`🐞 Report a problem` joins Levels / Restart / Options in the existing HUD menu
popover. **In-level only** — a live map snapshot is meaningless on the front door
or the world map, and a second entry point would mean a second payload shape.

Opening auto-pauses and closing restores the previous speed, the same contract
`showOptions` already uses.

The overlay body: a segmented **Bug · Feedback · Idea** control (drives the title
and the textarea placeholder), a "What happened?" textarea, a scrollable
read-only preview of the generated markdown so nothing leaves blind, and
Copy / Download / Cancel.

## Module boundaries

`sim.ts` (2313 lines) and `main.ts` (2206) are already past the size where they
are pleasant to work in. Nothing new lands in them beyond wiring.

| File | Responsibility | Depends on |
|---|---|---|
| `src/game/report.ts` *(new)* | Pure. `snapshotLevelData(game)`, `collectReport(game, meta)`, `formatReport(data)`. No DOM, no canvas. | sim types, leveldata |
| `src/game/report-ui.ts` *(new)* | The overlay, clipboard, downloads, screenshot capture. | report.ts, render, i18n |
| `src/game/leveldata.ts` | Format extension, sanitize clamps, `levelDefFromData` placement. | — |
| `src/game/ui.ts` | One menu button, one `onReport` callback. | — |
| `src/main.ts` | Wiring and pause handling only. | report-ui |

`report.ts` staying DOM-free is what makes the whole feature testable headlessly:
the node suites can build a real `Game`, mutate it, and assert on the markdown
and the round-tripped code without a browser.

## Testing

New `tests/report.mjs`:

1. Build a real campaign `Game`, then mutate it the way a player would — dig a
   cell, place a ladder, add a ready sawmill and an unfinished lift blueprint,
   spend stock, deplete a tree partially.
2. Assert `formatReport()` contains the expected sections and values.
3. Round-trip: `snapshotLevelData → encodeShareCode → decodeShareCode →
   levelDefFromData → new Game`, then assert terrain, buildings (including
   blueprint progress), node yields and stock all match.
4. Assert a legacy `v: 1` object with no `buildings` and no `yieldLeft` still
   sanitizes and loads.

`tests/i18n.mjs` gets an **explicit** assertion that every `report.*` key exists
in both `en` and `de`. The i18n suite is a smoke test and `t()` returns the raw
key when one is missing, so without this a missing translation ships silently.

## Risks to verify, not assume

1. In-game overlays intercept pointer events only — keydown stays live while
   `running === true`. The textarea must not have keystrokes swallowed by the
   game's shortcut handler.
2. Firing several `<a download>` clicks in a row can trip Chrome's
   multiple-downloads prompt. If it does, fall back to one button per file.
