# Marketing & Distribution Plan

How Smallhands goes to market: a free first island as the funnel, a paid full
game on the stores, and a build-in-public dev journey (Harmony card #24) as the
engine that fills the funnel.

## Model

- **Free demo**: Campaign 1 (four levels) playable in the browser, everywhere,
  zero friction. Ends on a cliffhanger — after the summit supply line, tease
  Campaign 2's water/tide/night mechanics as locked content. Consider including
  the procedural generator at ★1–★2 to demonstrate replay value.
- **Paid full game**: all campaigns + Workshop (editor, generator, daily
  challenge), medals/feats. **$9.99 / 9,99 €** with a 10–15 % launch discount.
  Price can rise later alongside content updates (announced in advance).

## Two economies, two tracks

Web portals and paid stores are different economies. Portals are free-to-play
and ad-monetized; stores sell games but bring no traffic.

### Track 1 — Paid stores (the revenue)

| Platform | Notes |
|---|---|
| **Steam** | Primary. $100 fee (recouped after $1k). Wrap the web build in **Tauri** (fits the zero-dependency ethos; Electron as fallback). Demo + Next Fest + wishlists. Medals/PBs map to achievements & leaderboards. |
| **itch.io** | Publish immediately, no approval, ~90 % default rev share. Free in-browser demo and paid full version on one page — exactly our model. |
| **GOG / Epic** | Later, after Steam traction. GOG is curated and premium-friendly; Epic discovery is poor for tiny indies. |

### Track 2 — Free web portals (the funnel)

Campaign 1 (+ optionally the daily challenge) under the same name:

- **CrazyGames** (~35 M MAU) and **Poki** (~30 M MAU) — ad rev share via their
  SDKs. CrazyGames offers +50 % revenue for 2-month launch exclusivity (decide
  this trade-off before submitting elsewhere). Neither allows linking out to
  stores — the portal version is brand-building; players find the game by name.
- **Newgrounds** — smaller, allows external links, real indie community.
- **Armor Games, GameJolt** — low-effort submissions given the static build.
- **Own domain** — the canonical home: free island, trailer, presskit,
  prominent Steam/itch buttons. Static hosting is effectively free.
- Kongregate no longer accepts new web game uploads.

## Build in public (Harmony card #24)

Build-in-public is not a separate track — it solves the go-to-market cold
start. Steam launches live or die on wishlists gathered before launch; the dev
journey is where they come from. Every post/video ends with the same two
links: **play the free island** and **wishlist on Steam**.

### Two stories, two audiences — keep the framing separate

1. **Game story** — "Lemmings meets The Settlers: indirect control, visible
   logistics." Audience: players, nostalgia communities, German games press.
   This sells copies. Game-facing channels (Steam page, portals, game
   subreddits, press) never lead with the toolchain.
2. **Process story** — "Building a commercial game with Claude Code,
   orchestrated via Harmony; zero runtime deps, ~22 kB gzipped." Audience:
   devs, indie hackers, AI-tooling crowd (HN, dev.to, X/Bluesky). Easier to
   reach; followers become launch-day buyers and amplifiers.

They mix badly (parts of the gaming audience are hostile to "AI-made games";
devs find exactly that interesting) but reinforce each other when kept apart.

**Disclosure:** Steam's store page has a mandatory AI-usage field. State it
matter-of-factly: AI-assisted code; art and audio are *procedurally generated
by hand-written code*, not AI-generated. Maintain a "how it's made" FAQ page
and link it everywhere — answer the AI-skepticism question once.

### Cadence & assets

- One blog post **or** devlog video per week — alternate *mechanic episodes*
  (ladder rule, counterweight hoist, rising tide) and *process episodes* (how
  a Harmony card becomes shipped code).
- `tools/trailer/` deterministic capture is the b-roll factory — polished
  footage for every post at near-zero effort.
- The daily challenge is recurring content: a weekly "seed of the week" clip
  is a zero-writing-effort touchpoint for both audiences.
- Milestones are episodes: itch page live → portal launches → Steam page live
  → Next Fest → launch retrospective **with real numbers** (post-launch
  transparency posts reliably earn a second dev-audience wave).

### Priority order when time is tight

Game quality → Steam page/GIFs → devlog cadence. A skipped devlog week costs
little; a weak store page costs the launch.

## Promotion sequence

1. **Now**: itch.io page (free demo, "full version coming"), own domain,
   presskit (presskit() format, EN+DE), trailer. Origin blog post kicks off
   the dev journey; consider making the Harmony board public.
2. **+2–4 weeks**: Steam page live — capsule art, 6–8 GIFs of the *aha*
   mechanics, trailer. Weekly devlog rhythm starts. Pitch German press
   (GameStar, GamersGlobal) and German YouTubers — full German localization +
   Settlers nostalgia is an unfair advantage.
3. **Ongoing**: submit demo to CrazyGames/Poki/Newgrounds (exclusivity
   decision first). Post GIFs to r/BaseBuildingGames, r/WebGames,
   r/playmygame; the ladder rule is the signature hook.
4. **At ~2–3 k wishlists**: register for Steam Next Fest (one shot per game —
   it amplifies momentum, it doesn't create it; wishlist *velocity* in the
   48 h before the fest matters most). Pitch press/creators 4–6 weeks ahead;
   coordinate creator videos to drop during the fest. Note: 68–88 % of
   wishlists come from the store page, not the demo — the page is the lever.
5. **Launch**: $9.99/9,99 € with launch discount, Steam + itch simultaneously.
   Finale devlog: full retrospective with numbers, then "first week in
   numbers" follow-up.

**Main risk to avoid:** launching quietly on Steam with near-zero wishlists
"just to be live." The launch is a one-shot algorithmic event — let the page
marinate and collect wishlists first, even if the game is done months earlier.
