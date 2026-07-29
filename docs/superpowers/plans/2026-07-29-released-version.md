# Released Version Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the player which build of Smallhands they are running, as a calendar version derived from the deployed commit's date.

**Architecture:** One build-time stamp, three readouts. `vite.config.ts` derives `__VERSION__` (`2026.07.29`) from `git log -1` and keeps `__BUILD__` as `__VERSION__ + '+' + sha`. The front-door footer and an options-menu row show `__VERSION__`; the bug report keeps `__BUILD__`. A single browser suite asserts the three agree and that the shape is a date.

**Tech Stack:** TypeScript, Vite `define`, plain-DOM UI (no framework), Playwright-core browser tests run as plain `.mjs` under Node.

**Spec:** `docs/superpowers/specs/2026-07-29-released-version-design.md`

## Global Constraints

- **The displayed version is NOT semver.** `package.json`'s `0.1.0` has never been bumped, there are no tags, and every push to `main` deploys. Never print `pkg.version`.
- **Format is exactly `YYYY.MM.DD`** (dots, zero-padded), from `git log -1 --format=%cd --date=format:%Y.%m.%d`.
- **Fallbacks:** `__VERSION__` → `'dev'`, `__BUILD__` → `'dev+nogit'` when git is unavailable. These are failures if they reach production; Task 1's test catches that.
- **`src/game/frontdoor-copy.ts` must stay import-free and free of build-time globals.** Two suites (`tests/frontdoor-data.mjs`, `tests/terminology.mjs`) `import { S }` from it under plain Node, where `__VERSION__` is `undefined`. Labels go in the table; the number is injected by `frontdoor.ts`.
- **Values reach front-door copy through `trf()`, not concatenation.** Cards #67/#25 established that the copy table quotes `{placeholder}`s and never values — `frontdoor.ts:96` `trf(key, vars)` fills them. The version line follows that idiom: copy holds `'Version {v}'`, the renderer supplies `v`. Do not build the string with `+` or a template gap.
- **`version` stays out of `frontdoor-data.mjs`'s `INTERPOLATED` map** (that map guards counts derived from `LEVELS`, and its digit corollary applies only to keys listed in it). `tests/version.mjs` already fails if the interpolation is removed, because the footer would render the literal `{v}` and miss the date regex. One suite per rule.
- **Every copy key needs an `[en, de]` pair.** `Version` is identical in both languages — that is fine and has precedent (`opt.lang.en: ['English', 'English']`).
- **Tests never recompute the date.** Duplicating the derivation makes a test that drifts and then passes while the screen is wrong. Assert agreement and shape only.
- **Browser tests need the production build served:** `npm run build && npm run preview` (→ `http://localhost:4173/`). `define` substitution does not happen in dev.

## File Structure

| File | Responsibility |
|---|---|
| `vite.config.ts` | Derive `__VERSION__` and `__BUILD__` from the commit. The only place the date is computed. |
| `src/vite-env.d.ts` | Declare both globals for TypeScript. |
| `src/game/frontdoor-copy.ts` | The `version` **label** only (import-free data module). |
| `src/game/frontdoor.ts` | Compose the footer version line from label + `__VERSION__`. |
| `src/frontdoor.css` | `.fd-version` styling. |
| `src/engine/i18n.ts` | `opt.version` label. |
| `src/main.ts` | The options-menu version row. |
| `src/style.css` | `.opt-value` styling. |
| `tests/version.mjs` | The one suite owning the three-surface invariant. |
| `package.json` | `test:version` script. |

---

### Task 1: Version source and the front-door footer

The smallest change that carries its own test: derive the stamp **and** render it somewhere, so a browser has something to read.

**Files:**
- Modify: `vite.config.ts` (whole file)
- Modify: `src/vite-env.d.ts` (whole file)
- Modify: `src/game/frontdoor-copy.ts:188` (before `brandOptions`)
- Modify: `src/game/frontdoor.ts:369-371` (the `<footer class="foot">` block)
- Modify: `src/frontdoor.css:647-653` (after the `#frontdoor .foot` block)
- Create: `tests/version.mjs`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: nothing.
- Produces: the globals `__VERSION__: string` (e.g. `'2026.07.29'`) and `__BUILD__: string` (e.g. `'2026.07.29+a1b2c3d4'`); the DOM node `.fd-version` whose text is `` `${label} ${__VERSION__}` ``; the copy key `S.version`; and `tests/version.mjs` exporting nothing but exiting non-zero on failure. Task 2 reads `__VERSION__` and appends to `tests/version.mjs`.

- [ ] **Step 1: Write the failing test**

Create `tests/version.mjs`:

```js
// The version the player sees must be the version the report carries, and it must
// be a real date. Three surfaces read one build-time stamp (__VERSION__, defined in
// vite.config.ts): the front-door footer, the options menu, and the bug report's
// Build line (which carries __BUILD__ = __VERSION__ + '+' + sha).
//
// This suite never recomputes the date. Re-deriving it here would duplicate the
// arithmetic in vite.config.ts, and a duplicated derivation drifts and then goes on
// passing while the screen is wrong. It asserts only that the surfaces agree and
// that the shape is a date — which is also what catches the 'dev' fallback reaching
// a production build, a failure the build itself reports as success.
//
// Requires the production build served at http://localhost:4173/ (npm run preview):
// `define` substitution only happens in a real build, so a dev server would assert
// against the literal token.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try {
    const found = execSync('ls /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1')
      .toString()
      .trim();
    if (found) return found;
  } catch {
    // fall through to playwright default resolution
  }
  return undefined;
}

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--no-sandbox', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => {
  console.log('[pageerror]', e.message);
  failures++;
});

await page.goto(BASE_URL);
await page.waitForTimeout(500);

// ---------------------------------------------------------- 1. the front door
// The label and the number share one line ("Version 2026.07.29"); strip the
// leading label word so the assertion is about the number itself.
const footerLine = (await page.textContent('.fd-version'))?.trim() ?? '';
const shown = footerLine.replace(/^\s*\S+\s+/, '').trim();
const DATE = /^\d{4}\.\d{2}\.\d{2}$/;
check(
  'footer shows a calendar version, not the dev fallback',
  DATE.test(shown),
  `footer reads "${footerLine}"`,
);

await browser.close();
if (failures) {
  console.log(`\nVERSION FAIL: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nVERSION PASS');
```

- [ ] **Step 2: Add the test script**

In `package.json`, add after the `"test:frontdoor-logo"` line:

```json
    "test:version": "node tests/version.mjs",
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm run build && npm run preview &
sleep 3
npm run test:version
```

Expected: FAIL. Playwright times out on `.fd-version` (the node does not exist yet), so the run errors or reports `footer reads ""`.

Stop the preview server before continuing (`kill %1`).

- [ ] **Step 4: Derive the version in the build**

Replace the whole of `vite.config.ts` with:

```ts
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// Stamped into the bundle so a bug report says which deployment produced it, and
// so the game can tell the player which version they are running.
//
// The displayed version is deliberately NOT package.json's semver. That number has
// never been bumped, there are no tags, and .github/workflows/deploy.yml deploys on
// every push to main — so there is no discrete release to name, and a printed
// "0.1.0" would be silently wrong on every day but the first. The date of the
// deployed commit is the honest answer and needs no human discipline to stay true.
//
// A commit's date is a property of the commit, not of the machine that built it, so
// the output stays reproducible: a *build* timestamp would change every byte of the
// bundle with no source change, churning `dist` diffs and deploy hashes. The short
// sha rides along in __BUILD__ because a date alone cannot separate two pushes made
// on the same day. See game/report.ts and tests/version.mjs.
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 8);
  try {
    return execSync('git rev-parse --short=8 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'nogit'; // a tarball checkout, or git is unavailable
  }
}

function version(): string {
  try {
    return execSync('git log -1 --format=%cd --date=format:%Y.%m.%d', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'dev'; // the mirror of commit()'s 'nogit'
  }
}

// Computed once: `define` needs it twice and it shells out to git.
const VERSION = version();

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(VERSION),
    __BUILD__: JSON.stringify(`${VERSION}+${commit()}`),
  },
  // Relative base so the built site works on GitHub Pages, itch.io, or any subpath.
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 8192,
    // One front door: the game and its marketing scroll both live at index.html.
    // /play/ is a static redirect stub (public/play/index.html), not a build input.
  },
  server: {
    host: true,
  },
});
```

Note what left: the `node:fs` import and the `pkg` read. Nothing reads `package.json`'s `version` field any more; it stays in the file as inert npm metadata.

- [ ] **Step 5: Declare the new global**

Replace the whole of `src/vite-env.d.ts` with:

```ts
/// <reference types="vite/client" />

// Build stamps injected by vite.config.ts `define`.
//
// __VERSION__ is the deployed commit's date ("2026.07.29") — the version shown to
// the player in the front-door footer and the options menu. __BUILD__ appends the
// short sha and is reported in bug reports, so a maintainer knows the exact commit.
// Both have git-unavailable fallbacks ("dev", "dev+nogit"); tests/version.mjs fails
// if one of those ever reaches a production build.
declare const __VERSION__: string;
declare const __BUILD__: string;
```

- [ ] **Step 6: Add the footer label to the copy table**

In `src/game/frontdoor-copy.ts`, insert immediately before the `brandOptions:` line (currently line 188):

```ts
  // {v} is filled by frontdoor.ts from __VERSION__. The value stays out of the
  // table for the reason every other count does (cards #67/#25) and for one more:
  // this module must stay import-free and build-global-free so plain Node can load
  // it, and a bare __VERSION__ here would be undefined there.
  version: ['Version {v}', 'Version {v}'],
```

- [ ] **Step 7: Render it in the footer**

In `src/game/frontdoor.ts`, replace the footer block (currently lines 369-371):

```ts
    <footer class="foot">
      <div class="wrap">${this.tr('footer')}</div>
    </footer>
```

with:

```ts
    <footer class="foot">
      <div class="wrap">
        ${this.tr('footer')}
        <p class="fd-version">${this.trf('version', { v: __VERSION__ })}</p>
      </div>
    </footer>
```

`trf` (line 96) is the existing `{placeholder}`-filling variant of `tr` — the same
call shape `feat1`, `campIntro`, `featTools` and `feat4` already use.

- [ ] **Step 8: Style it**

In `src/frontdoor.css`, append immediately after the `#frontdoor .foot { … }` block that
ends at line 653 (the one setting `background-color: #0b0e15`, **not** the earlier
`.foot` rule at line 332 or its `::before`/`::after` ridgeline rules):

```css
/* The build stamp: present for anyone who looks, never competing with the
   footer line above it. Tabular figures so the date does not shimmer between
   builds as digit widths change. */
#frontdoor .fd-version {
  margin-top: 10px;
  opacity: 0.6;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 9: Run the test to verify it passes**

```bash
npm run build && npm run preview &
sleep 3
npm run test:version
kill %1
```

Expected: `ok   footer shows a calendar version, not the dev fallback` then `VERSION PASS`.

- [ ] **Step 10: Check nothing else broke**

```bash
npm run build          # tsc --noEmit must pass with the new global
npm run test:frontdoor-data
npm run test:terminology
```

Expected: all pass. The two copy suites load `frontdoor-copy.ts` under plain Node — if either reds with `__VERSION__ is not defined`, the value leaked into the data module (Step 6 went into the wrong file, or used `__VERSION__` instead of `{v}`).

Then the front-door layout suites, because the footer gained a line:

```bash
npm run build && npm run preview &
sleep 3
npm run test:landing
npm run test:landing-shot
npm run test:frontdoor-mobile
kill %1
```

Expected: all pass. `landing-shot` and `frontdoor-mobile` assert no horizontal overflow at
several widths in both languages (card #77) — a short centred line should not affect them, but
the footer is what changed, so they are the suites that would notice if it did.

- [ ] **Step 11: Commit**

```bash
git add vite.config.ts src/vite-env.d.ts src/game/frontdoor-copy.ts src/game/frontdoor.ts src/frontdoor.css tests/version.mjs package.json
git commit -m "#74 Derive the version from the commit date and show it in the footer"
```

---

### Task 2: The options-menu row

**Files:**
- Modify: `src/engine/i18n.ts:1031` (before `'opt.back'`)
- Modify: `src/main.ts:609-611` (after the export/import block, before `rowBtns`)
- Modify: `src/style.css:930` (after `.opt-label`)
- Modify: `tests/version.mjs` (append check 2)

**Interfaces:**
- Consumes: `__VERSION__` from Task 1; the `shown` constant and `check()` helper already in `tests/version.mjs`.
- Produces: the DOM node `.opt-value` (unique — the version row is the only one that uses it), whose text is exactly `__VERSION__` with no label prefix. Task 3 reuses `shown`.

- [ ] **Step 1: Write the failing test**

In `tests/version.mjs`, insert immediately before the `await browser.close();` line:

```js
// ------------------------------------------------------------- 2. the options menu
// Reached from the front door rather than from a level: it is the same showOptions()
// either way, and style.css keeps that overlay visible in front-door mode on purpose.
// .opt-value is unique to the version row, and carries the number with no label.
await page.click('.fd-options');
await page.waitForTimeout(250);
const inOptions = (await page.textContent('.opt-value'))?.trim() ?? '';
check(
  'options row shows the same version as the footer',
  inOptions === shown && shown !== '',
  `options="${inOptions}" footer="${shown}"`,
);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run build && npm run preview &
sleep 3
npm run test:version
kill %1
```

Expected: FAIL — Playwright times out on `.opt-value`, which does not exist yet.

- [ ] **Step 3: Add the label**

In `src/engine/i18n.ts`, insert immediately before the `'opt.back'` line (currently line 1031):

```ts
  'opt.version': ['Version', 'Version'],
```

- [ ] **Step 4: Add the row**

In `src/main.ts`, in `showOptions`, insert between the closing `}` of the export/import block (currently line 609, whose last statement sets `n.textContent = t('opt.transferDesc')`) and `const rowBtns = document.createElement('div');` (currently line 611):

```ts
  // Which build the player is on. A readout, not a control — so it is built inline
  // rather than through segRow, which exists for segmented choices. Kept last
  // because it is the only row that answers a question instead of setting anything.
  {
    const row = document.createElement('div');
    row.className = 'opt-row';
    const lab = document.createElement('span');
    lab.className = 'opt-label';
    lab.textContent = t('opt.version');
    row.appendChild(lab);
    const val = document.createElement('span');
    val.className = 'opt-value';
    val.textContent = __VERSION__;
    row.appendChild(val);
    box.appendChild(row);
  }
```

- [ ] **Step 5: Style the value**

In `src/style.css`, insert immediately after the `.opt-label` line (currently line 930, above `.opt-note`):

```css
.opt-value { font-size: 14px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm run build && npm run preview &
sleep 3
npm run test:version
kill %1
```

Expected: both checks `ok`, then `VERSION PASS`.

- [ ] **Step 7: Check the i18n suite still passes**

```bash
npm run build
npm run test:i18n
```

Expected: pass. Note this suite is a smoke test and will **not** catch a missing `opt.version` — the browser check in Step 6 is what actually guards the key. If `t('opt.version')` renders the raw string `opt.version` on screen, the key went into the wrong table.

- [ ] **Step 8: Commit**

```bash
git add src/engine/i18n.ts src/main.ts src/style.css tests/version.mjs
git commit -m "#74 Show the version in the options menu"
```

---

### Task 3: Tie the shown version to the reported one

No production code changes — Task 1 already reshaped `__BUILD__`. This task adds the assertion that the two stamps cannot drift apart, which is the reason the report keeps a sha at all.

**Files:**
- Modify: `tests/version.mjs` (append check 3)

**Interfaces:**
- Consumes: `shown` and `check()` from Tasks 1-2; `__BUILD__` from Task 1, reaching the DOM through `report.ts:377` as a markdown line `- **Build:** <version>+<sha>` inside the `.report-text` textarea.
- Produces: nothing.

- [ ] **Step 1: Write the test**

In `tests/version.mjs`, insert immediately before the `await browser.close();` line:

```js
// -------------------------------------------------------------- 3. the bug report
// The report is in-level only (it carries a snapshot of the live map), so this walks
// the same path tests/report-e2e.mjs does. __BUILD__ is the shown version plus the
// short sha: same-day pushes share a version, and this is where they separate.
await page.click('.options-box .big-btn'); // Back → front door
await page.waitForTimeout(250);
await page.click('.fd-play');
await page.waitForTimeout(300);
await page.click('.map-node:not(:disabled)');
await page.click('.map-popover .pop-play');
await page.waitForTimeout(600);

await page.click('.island .menu-trigger');
await page.waitForTimeout(150);
await page.click('.menu-pop .report-open');
await page.waitForTimeout(400);

// .report-preview is the <pre> holding the generated markdown (report-ui.ts:119).
// NOT .report-text — that is the player's own free-text box, which starts empty.
const md = await page.textContent('.report-preview');
const buildLine = md.split('\n').find((l) => l.startsWith('- **Build:**')) ?? '';
check('the report has a Build line', buildLine !== '', md.slice(0, 200));
check(
  'the reported build starts with the version on screen',
  buildLine.startsWith(`- **Build:** ${shown}+`),
  buildLine,
);
```

- [ ] **Step 2: Run the whole suite**

```bash
npm run build && npm run preview &
sleep 3
npm run test:version
kill %1
```

Expected: four checks `ok`, then `VERSION PASS`.

This step is a genuine verification, not a formality: it is the first time the report path runs against the reshaped `__BUILD__`. If the Build line reads `0.1.0+…`, Task 1's `vite.config.ts` change did not land.

- [ ] **Step 3: Prove the assertion can fail**

Temporarily change the expected prefix to a wrong value to confirm the check is live rather than vacuously true:

```bash
# edit tests/version.mjs: `${shown}+` → `9999.99.99+`
npm run test:version    # expect: FAIL on 'the reported build starts with the version on screen'
# revert the edit
```

A check that passes against a deliberately wrong value is checking nothing — `buildLine` being empty would make `startsWith` false, but a mis-scoped selector could make it pass by accident.

- [ ] **Step 4: Run the neighbouring suites**

```bash
npm run build && npm run preview &
sleep 3
npm run test:report-e2e
npm run test:landing
kill %1
```

Expected: both pass. `report-e2e` exercises the same overlay and would catch a broken report; `landing` covers the footer the version line was added to.

- [ ] **Step 5: Commit**

```bash
git add tests/version.mjs
git commit -m "#74 Assert the reported build starts with the version on screen"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `__VERSION__` from commit date, `__BUILD__` = version+sha | 1 (Step 4) |
| `'dev'` / `'dev+nogit'` fallback | 1 (Step 4), asserted 1 (Step 1) |
| `pkg.version` no longer read, comment recording why | 1 (Step 4) |
| Bug report shape changes to `date+sha` | 1 (Step 4), asserted 3 (Step 1) |
| Footer line, label in copy table, composed in `frontdoor.ts` | 1 (Steps 6-7) |
| `.fd-version` CSS | 1 (Step 8) |
| Options row after Save file, before Back | 2 (Step 4) |
| `.opt-value` CSS, `.opt-row`/`.opt-label` reused | 2 (Steps 4-5) |
| `opt.version` i18n key | 2 (Step 3) |
| `tests/version.mjs` + `test:version` script | 1 (Steps 1-2) |
| Check 1 — date format, catches `dev` | 1 (Step 1) |
| Check 2 — options agrees with footer | 2 (Step 1) |
| Check 3 — report build starts with shown version | 3 (Step 1) |
| Test never recomputes the date | All three checks compare surfaces; no date arithmetic appears in `tests/version.mjs` |
| `frontdoor-copy.ts` stays Node-loadable | 1 (Step 10) runs both suites that import it |
| `frontdoor-data.mjs` covers the new pair for free | 1 (Step 10) |

No gaps.

**Placeholder scan:** No TBD/TODO. Every code step carries the literal code. Task 3 repeats the report-open sequence rather than pointing at `report-e2e.mjs`, since tasks may be read out of order.

**Type consistency:** `__VERSION__` and `__BUILD__` are `string` in `vite-env.d.ts` (Task 1 Step 5) and used as strings everywhere. `S.version` is `Str = [string, string]`, matching the table's type. `.fd-version` (Task 1) and `.opt-value` (Task 2) are the selectors the tests read, spelled identically in both places. `shown` is defined in Task 1 Step 1 and consumed unchanged by Tasks 2 and 3.

**One inconsistency found and fixed inline:** the footer test strips the label with `replace(/^\s*\S+\s+/, '')`, which only works because the label is a single word in both languages. This is now stated in the test's own comment and holds for `'Version {v}'`; a multi-word label would need the assertion rewritten to match the date out of the line instead.

## Rebase note (2026-07-29)

This plan was written against `0c20955` and rebased onto `dfd1bf2`, which landed cards #67,
#25 and #77 on the front door. Every line number above was re-derived after the rebase, and
one design point changed rather than merely moving:

- The footer line now goes through **`trf('version', { v: __VERSION__ })`** instead of
  concatenating label and value. Cards #67/#25 made "the copy table holds placeholders, the
  renderer fills them" the module's rule; a concatenated version line would have been the one
  string on the page ignoring it.
- `frontdoor-data.mjs` gained an `INTERPOLATED` map with a no-hardcoded-digits corollary. It is
  **scoped to the keys listed in it**, so a plain `version` key is unaffected — verified by
  reading the loop, not assumed.
- The front door gained `test:landing-shot` and `test:frontdoor-mobile` (overflow guards at
  several widths, both languages). Task 1 Step 10 runs both, because the footer is what changed.
