# Show the released version of the game (card #74)

## Problem

Nothing in the shipped game tells a player which version they are running.

A build stamp already exists — `__BUILD__`, defined in `vite.config.ts` as
`${pkg.version}+${commit()}` — but it has exactly one consumer, the bug report
(`main.ts` passes it to `showReportOverlay`). A player who wants to say "it broke
on the build I played yesterday" outside that form has nothing to quote, and a
visitor deciding whether to try the game sees no version at all.

The naive fix — print `pkg.version` — does not work here, because that number is
not a version of anything:

- `package.json` says `0.1.0` and has never been bumped.
- There are no git tags and no CHANGELOG.
- `.github/workflows/deploy.yml` deploys on **every push to `main`**.

So there is no discrete release to name. Printing `v0.1.0` in the footer would be
a number that is wrong on every day but the first, and wrong silently.

## Decision

**The commit date is the version.** Push-to-main *is* the release, so the date of
the deployed commit is the most honest thing the site can claim, and it needs no
human discipline to stay true.

```
__VERSION__  '2026.07.29'            what the player sees
__BUILD__    '2026.07.29+a1b2c3d4'   what the bug report carries
```

Derived in `vite.config.ts` from `git log -1 --format=%cd --date=format:%Y.%m.%d`,
alongside the existing `commit()`.

Three properties this keeps, each of which the alternatives lose:

- **Reproducible.** A commit's date is a property of the commit, not of the
  machine that built it — so the bundle stays byte-stable across rebuilds. This is
  the exact reason the file's existing comment gives for preferring a commit over
  a build timestamp, and a date-of-commit obeys it where a date-of-build would not.
- **Cannot go stale.** A hand-bumped semver silently lies the moment a push is not
  bumped, and every push deploys.
- **Meaningful to a human.** `2026.07.29` answers "am I on the current build?"
  without a lookup table. A bare sha does not.

### Fallback

`commit()` already returns `'nogit'` when git is unavailable (tarball checkout).
The version mirrors it with `'dev'`, so `__BUILD__` reads `dev+nogit`.

This fallback is a *failure* if it ever reaches production, and it is silent —
the build succeeds and the site looks fine. §Testing below makes it loud.

### Same-day pushes collide, deliberately

Two pushes on one day produce the same `__VERSION__`. That is acceptable for a
*displayed* version: it answers "which day's build" and the exact commit is still
one field away in the bug report, which keeps the sha. Precision lives in the
report; legibility lives on screen.

### `pkg.version` stops being read

The `readFileSync` of `package.json` leaves `vite.config.ts`, with a comment
recording that the displayed version is deliberately not semver. The
`package.json` `version` field itself stays as inert npm metadata.

**Accepted consequence:** the bug report's build field changes shape from
`0.1.0+sha` to `2026.07.29+sha`. Strictly more informative — it trades a frozen
number for a real date. `report.ts` prints the string verbatim, so nothing there
changes.

## Surfaces

Two readouts, chosen so that both audiences are covered without new chrome.

### Front-door footer

```
A loving homage to the genre. All code, pixel art and audio were made from scratch…
Version 2026.07.29
```

**One constraint dictates the wiring.** `src/game/frontdoor-copy.ts` is a pure
data module with no imports — deliberately, so plain Node can load it. Two suites
rely on that: `tests/frontdoor-data.mjs` and `tests/terminology.mjs` both
`import { S }` from it directly. A bare `__VERSION__` inside it would be
`undefined` under Node and redden both, for a reason neither suite is about.

(`terminology.mjs` also touches `frontdoor.ts`, but reads it as *text* via
`readFileSync` rather than importing it — so composing the line there is safe.
Nothing loads `frontdoor.ts` under Node.)

So the copy table gets only the **label** and `frontdoor.ts` composes the line,
the way it already composes every other string through `tr()`:

- `frontdoor-copy.ts`: `version: ['Version', 'Version']` (identical in both
  languages, as `opt.lang.en` already is — `tests/frontdoor-data.mjs` requires
  both halves truthy, not distinct).
- `frontdoor.ts`: the `.foot` block renders the footer line, then a
  `<p class="fd-version">` with `${this.tr('version')} ${__VERSION__}`.
- `frontdoor.css`: one `.fd-version` rule under the existing `#frontdoor .foot`
  block — dimmer than the footer text, tabular numerals.

### Options overlay

A label-and-value row in `showOptions` (`main.ts`), placed after **Save file** and
before **Back**.

`showOptions` currently has two row shapes: the `segRow` helper (label + segmented
control) and hand-built rows carrying a button. This is a third — label plus static
text, no control — so it is built inline rather than forced through `segRow`.

It reuses `.opt-row` and `.opt-label` unchanged; `.opt-row` is already
`display: flex; justify-content: space-between`, so a plain value span lands right
without new layout. One `.opt-value` rule is added to `style.css` beside
`.opt-label` (14px, `var(--text-dim)`, tabular numerals).

Copy: `'opt.version': ['Version', 'Version']` in `src/engine/i18n.ts`, with the
other `opt.*` keys.

## Testing

New suite `tests/version.mjs`, plus a `test:version` script. It drives a real
browser against the production build, because that is the only place `__VERSION__`
is actually substituted — a Node-level test would assert against the literal
token.

The suite **never recomputes the date**. Re-deriving it would duplicate the
arithmetic in `vite.config.ts`, and a duplicated derivation drifts and then goes on
passing while the screen is wrong. It only asserts that the surfaces agree and that
the shape is a date:

1. **Footer version matches `/^\d{4}\.\d{2}\.\d{2}$/`.** This is the check that
   earns the suite: it catches `dev` or `nogit` reaching production, which no other
   guard sees and which the build reports as success.
2. **The options row shows the same string as the footer.** Two readouts, one
   source — they cannot drift apart.
3. **The bug report's build field starts with that string + `+`.** Ties the
   displayed version to the reported one, so a report can always be traced back to
   what the player was looking at. Concretely: open `.report-box` from the pause
   menu the way `tests/report-e2e.mjs` does, read the generated markdown out of the
   `.report-preview` `<pre>` (`report-ui.ts:119` — *not* `.report-text`, which is the
   player's own free-text box and starts empty), and match the `- **Build:**` line
   (`report.ts:377`) against `<footer version>+`.

Implementation note: `window.__smallhands` is assigned inside `startLevel`, so it
does not exist on the front door. Step 1 reads rendered text rather than the hook.

Covered for free: `tests/frontdoor-data.mjs` already walks `FRONTDOOR_COPY_KEYS`
and requires an `[en, de]` pair per key, so the new `version` key is checked by
existing machinery. `tests/i18n.mjs` is a smoke test and will *not* catch a missing
`opt.version` — hence the explicit check in step 2.

## Files touched

| File | Change |
|---|---|
| `vite.config.ts` | add `__VERSION__`; derive commit date; drop the `package.json` read |
| `src/vite-env.d.ts` | `declare const __VERSION__: string` |
| `src/game/frontdoor-copy.ts` | `version` label key |
| `src/game/frontdoor.ts` | render the version line in `.foot` |
| `src/frontdoor.css` | `.fd-version` |
| `src/engine/i18n.ts` | `opt.version` |
| `src/main.ts` | version row in `showOptions` |
| `src/style.css` | `.opt-value` |
| `tests/version.mjs` | new suite |
| `package.json` | `test:version` script |

## Out of scope

- A CHANGELOG, git tags, or a release process. The point of the calendar version
  is that it needs none of them; adding one is a separate decision.
- A copy-to-clipboard control on the version. The bug report already carries the
  exact build automatically, which is the path that matters.
- Showing the version on the world map or in the HUD. Two surfaces cover both
  audiences; a third would be chrome for its own sake.
