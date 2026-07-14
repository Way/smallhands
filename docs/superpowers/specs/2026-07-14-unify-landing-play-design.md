# Unify the landing page and the game start page into one front door

- **Card:** #4 — Unify landing page & game start page — reuse /play animated background
- **Date:** 2026-07-14
- **Status:** Design approved, ready for implementation planning

## Problem

The site has two front doors that feel disconnected:

- **`/` (landing)** — a static marketing page (`index.html` + `src/landing.ts` + `src/landing.css`). Deliberately tiny and dependency-free; its only import is the game's sprite atlas, used to draw pixel-art icons. It pitches the game and links to `./play/`. It is visually flat.
- **`/play/` (game)** — the game shell (`play/index.html` + `src/main.ts`). Its title screen sits over a **live idle game**: `showTitle()` draws the title overlay, `drawIdleBackdrop()` spins up `idleGame = new Game(LEVELS[0])` with every node marked, and the main `frame()` loop ticks it while slow-panning the camera. The result — weather-driven sky gradient, parallax clouds, occasional birds, night stars, terrain and autonomously moving workers (`src/game/render.ts`) — is the animated scenery we want everywhere.

The marketing page can't cheaply get that animation: the backdrop needs the whole game engine (Game, sim, world, render, weather), which would betray the landing's featherweight design. So instead of copying the animation to the landing, we **merge both pages into one** and keep the single copy of the animation where it already lives.

## Goal

One front door: a scroll-reveal page whose hero is the existing animated backdrop, with the landing's marketing content re-homed beneath it, served at `/`. Drop the separate landing page and the separate `/play/` URL (with a redirect so old links survive).

## Decisions (locked with the user)

1. **Unify to one page** — do not port the animation onto a separate landing. The game start page becomes the single front door; marketing content moves onto it.
2. **Scroll-reveal hero layout** — the first screen is the hero (animated backdrop + `SMALLHANDS` logo + Play button + tagline). Scrolling down reveals the marketing sections (two-classics, mechanics, feats, CTA), the same content as today's landing. The backdrop is **fixed behind the hero only**; marketing sections scroll up over the page background.
3. **Live at `/`, drop `/play/`** — the game shell moves to the root `index.html`. `src/landing.ts` and `src/landing.css` are deleted (content folded in). `play/index.html` becomes a small redirect stub to `../` so old `/play/` links/bookmarks survive. One canonical front door.

## Design

### Two modes on one document

`<body>` toggles between two CSS modes; `#game-canvas` stays `position: fixed; inset: 0` as an always-present backdrop in both.

- **`body.front-door`** (default on load)
  - Document scrolls (`overflow: auto`).
  - A scroll layer (`#frontdoor`) sits above the fixed canvas: a transparent hero (the canvas shows through) holding the logo, Play button and tagline, followed by opaque marketing sections that scroll up over the canvas, then the footer.
  - The idle backdrop animates behind the hero.
- **`body.in-game`**
  - Current behavior: scroll locked (`overflow: hidden`), the canvas is the fullscreen interactive play surface, HUD and overlays (`#ui-root`) active.

**Transitions**
- **Play / Continue** → add `.in-game`, remove `.front-door`, call the existing `showLevelSelect()`.
- **Back to title / quit to menu** → restore `.front-door`, resume the idle backdrop, scroll to top.

### DOM / files

Root `index.html`:

```
#game-canvas   fixed backdrop (idle scene in front-door, live game in-game)
#frontdoor     scroll layer: hero + marketing sections + footer (front-door mode)
#ui-root       HUD + overlays (in-game mode)
```

- **New:** `src/game/frontdoor.ts` — renders the hero + marketing DOM (ported from `landing.ts`'s `view()` / `paintIcons()`), reusing the sprite atlas that `main.ts` already builds. Front-door styles fold into `src/style.css` (or a co-located import).
- **Delete:** `src/landing.ts`, `src/landing.css`.
- **Redirect stub for `/play/`:** a minimal `index.html` that redirects to `../` (`<meta http-equiv="refresh">` plus a JS fallback), host-agnostic so it works on GitHub Pages / itch / any subpath. Place it as a static asset (`public/play/index.html`) so the single-entry build still emits `/play/index.html` verbatim. The old `play/index.html` game entry is removed.
- **`vite.config.ts`:** single root input `index.html`; drop the `play` input; keep `base: './'`. (The redirect is a static asset, not a build input.)

### Marketing content + i18n

- Port the landing's bilingual copy and section markup as-is — hero pitch, "Two classics, one sweet spot", the mechanics grid, the feats list, the CTA band, the footer. No copy rewrite.
- **One language source of truth.** The front door reads and writes the shared `lang` field in the game save (exactly as `landing.ts` does today via `smallhands-save-v1`). The EN/DE toggle moves into the hero topbar; flipping it re-renders the marketing DOM *and* drives the in-game `t()`, so the hero and the game never disagree. Marketing strings stay co-located in `frontdoor.ts` (like today's `S` table) but are gated by the shared `lang`.

### Performance

The idle sim already runs on `/play/`; it now runs on `/`. Guard it:

- **Pause when scrolled away.** When the hero is scrolled out of view, stop ticking the idle sim (reading marketing costs no simulation); resume on scroll back up.
- **`prefers-reduced-motion`.** Draw a single static frame; skip the `requestAnimationFrame` loop.
- **Pause on tab hidden** (`visibilitychange`).

Honest tradeoff: `/` now boots the game engine, so first paint is heavier than the old static landing. That is inherent to the chosen direction — the animated backdrop is the point. First meaningful paint is the canvas backdrop + logo, which draw immediately.

### SEO / meta

- Root `index.html` keeps rich metadata: merge the stronger `<meta name="description">`, `<title>`, and `theme-color` from today's landing head.
- Marketing copy remains JS-rendered with semantic `h1`/`h2`/`h3` — identical crawlability to today's landing, no regression. The site now has a single canonical URL (`/`) instead of split landing/`play` URLs.

## Scope

**In scope**
- Re-home the marketing content onto the game page as a scroll-reveal front door.
- Two CSS modes (`front-door` / `in-game`) on one document.
- Root `index.html` hosting the game; `play/index.html` redirect stub; `vite.config.ts` single input.
- Shared language state between hero and game.
- Performance guards (scroll pause, reduced-motion, tab-hidden).

**Out of scope (YAGNI)**
- No new art or animation — reuse the existing idle backdrop unchanged.
- No SPA router — two CSS modes, not client-side routing.
- No "skip-marketing" deep link variant.
- No marketing copy redesign — port as-is.

## Testing

- **Rework `tests/landing.mjs`** to target `/`: assert the hero, marketing sections and Play CTA render; the EN/DE toggle switches copy; `/play/` redirects to `/`.
- **End-to-end:** Play → `in-game` mode → back-to-title → `front-door` restored (idle backdrop resumes, scroll position reset). Use the project's CHROME_PATH headless-shell + `vite preview` flow.
- Keep existing unit / campaign / weather / i18n suites green.

## Risks / open considerations

- **First-paint weight at `/`** — mitigated by immediate canvas+logo paint; accept the engine-boot cost as the cost of the chosen direction.
- **Scroll vs. game input** — the mode toggle must fully enable/disable page scroll and `touch-action` so the game's drag/pan input never fights the document scroll. Verify on touch devices.
- **Redirect stub durability** — a static `<meta refresh>` + JS redirect is the most portable; a host-level redirect can replace it later if the deploy target supports one.
