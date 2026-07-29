# Teaser trailer renderer

Renders a ~45 s teaser video (1280×720 @ 30 fps, H.264 MP4 with a synthesized
chiptune soundtrack) straight out of the real game — no screen recording, no
external footage.

## How it works

- The page's clock (`requestAnimationFrame`, `performance.now`, `Date.now`) is
  replaced before the game boots; the director advances virtual time by exactly
  1/30 s per captured frame. The game's fixed-timestep loop makes the whole take
  deterministic, and every frame is a lossless PNG screenshot — no dropped
  frames, no screencast compression, regardless of machine speed.
- Scenes are staged through the game's own `window.__smallhands` debug hook,
  reusing the proven scripted solutions from `tests/e2e.mjs`,
  `tests/campaign2.mjs` and `tests/campaign3.mjs`: the sim is fast-forwarded
  into a lively state (direct `game.tick` calls), then captured at 1×.
- Captions and scene fades are a `position: fixed` overlay (`page-lib.mjs`) whose
  opacity the director sets per frame (CSS animations are frozen — they run on the
  real compositor clock and would race ahead of virtual time).
- The soundtrack (`music.mjs`) is a deterministic, dependency-free chiptune —
  C–Am–F–G arpeggios with bass, hats and a ping-pong delay — rendered to WAV
  and muxed in, in the same hand-synthesized spirit as `src/engine/audio.ts`.

## Scene rundown

1. **Hook** — level 1 in full swing (indirect control, hauling, sawmill)
2. **Build** — the Cliff Shrine: cargo lift + a ladder run appearing tile by tile
3. **Dig** — The Buried Seam: a shaft sunk from the meadow and a drift driven east through rock, the sealed caravan waiting at the end of it
4. **Hoist** — Campaign 3's counterweight hoist cycling at a cliff edge
5. **Convoy** — Ballast Ridge: the loaded wagon rolls off its dock when the window shuts, and the dock stays behind
6. **Storm** — The High Forge under a storm: darkened sky, slanted rain, gusts that seize the lifts
7. **Rising tide** — The Rising Tide: a downpour lifts the water and floods the basin
8. **Drowned deep** — The Seeping Floor: a drift dug below the water table goes under on camera when the rain arrives
9. **Day-night** — The Waning Light: noon turns to dusk and the lantern chain holds the light
10. **Biomes** — three quick cuts through generated worlds (autumn/redrock/slate)
11. **Deliver** — a plank landing at the trade wagon, crates stacked in its bed
12. **End card** — the front door hero: logo, pitch, Play button

Scenes 3, 5 and 8 stage the mechanics the shipped video predates (digging,
the convoy window, flood × dig). Two of them put their subject in the map's
bottom rows, where no camera move can lift it — those set `textTop`, which
flips the caption and its veil to the empty sky instead.

## Where the caption sits

**The lower third is measured off the in-game tool dock, never tuned.** A new scene
inherits this and needs to do nothing; what it must not do is hard-code a `bottom`.

`__fitCaption()` in `page-lib.mjs` runs once per scene and sets a single
`--tov-bottom` — the dock's height plus 14 px of air — which positions the text
block *and* ends the veil's gradient ramp. Four things about it are load-bearing:

- **It measures the dock's ink, not its box.** A chip is a fixed 52 px with its
  content centred, so a two-line label (`Rope Anchor`, `Seilanker`) overflows it top
  and bottom; the box's edge reads 78 px where the ink reads 80. Descendant rects
  are the honest edge.
- **One number moves the text and its contrast together.** The veil is the only
  thing that makes a caption legible over bright ground, and it is bottom-anchored —
  so its ramp *ends* at the caption's last line and holds from there to the bottom
  edge. Lifting the text without lifting the gradient strands it above its own
  darkening, in exactly the scenes (tide, hook) where that is fatal.
- **The dock is measured even when `hud: false` hides it**, so the band is one
  height for all fourteen scenes. A lower third that shifts between cuts reads as a
  mistake; a strip of unused veil under a hidden HUD does not. The renderer logs the
  band once and flags it if a captioned scene ever moves it.
- **The block grows upward**, because it is anchored by its bottom. That is why
  German — wider than English, and the `deliver` headline wraps to two lines — can
  never push a caption back down into the chips.

The veil holding through the dock is deliberate as well: it dims the chip row while
a caption is up (the veil rides the caption's own envelope), so the chrome that means
nothing in a video reads as a vignette rather than as buttons — without ever popping
in and out between cuts the way a per-scene HUD fade would.

`npm run test:teaser-caption` is the guard — every level × every line of the deck ×
both languages, asserting the air over the dock, the single band, and the veil
tracking the text. It cannot tell you whether the lower third *reads* well; that is
what `--storyboard` is for.

## Usage

Host the preview and the render in ONE shell, and pick your own port: the render
reloads the page for the end card, and a preview left running from another shell
(or another checkout on the shared :4173) either dies under an agent harness that
reaps detached jobs — killing the render mid-scene — or quietly serves a different
`dist` than the one you just built.

```bash
npx vite build
( npx vite preview --port 4191 --strictPort & PV=$!; trap "kill $PV" EXIT
  until curl -sf http://localhost:4191/ >/dev/null; do sleep 0.5; done
  BASE_URL=http://localhost:4191/ npm run trailer )   # both langs -> tools/trailer/out/

# variations (same BASE_URL, and CHROME_PATH where the browser isn't found)
node tools/trailer/render-teaser.mjs --lang=de          # one language
node tools/trailer/render-teaser.mjs --storyboard       # 3 stills/scene, no video
node tools/trailer/render-teaser.mjs --only=dig,drown   # stage a subset while iterating
```

Encoding prefers a full ffmpeg (`npm i --no-save @ffmpeg-installer/ffmpeg`) for
H.264+AAC; with only Playwright's bundled ffmpeg it falls back to a silent VP8
WebM. A full two-language render takes a few minutes; output lands in
`tools/trailer/out/` (git-ignored).

## Landing-page embed

The front door's "See it in motion" section plays the teaser from
`public/media/` — a lazy poster JPEG until clicked, then a `<video>` with a
WebM (VP9/Opus) source first and an MP4 (H.264/AAC) fallback for Safari.
After re-rendering the trailer, refresh those assets:

```bash
# the installer build only exists on linux-x64; a system ffmpeg with libx264,
# libvpx-vp9 and libopus does the same job (macOS: brew install ffmpeg)
FF=$([ -x node_modules/@ffmpeg-installer/linux-x64/ffmpeg ] \
      && echo node_modules/@ffmpeg-installer/linux-x64/ffmpeg || command -v ffmpeg)
for l in de en; do
  $FF -i tools/trailer/out/smallhands-teaser-$l.mp4 -c:v libx264 -preset slow -crf 23 \
      -pix_fmt yuv420p -movflags +faststart -c:a copy -y public/media/teaser-$l.mp4
  $FF -i tools/trailer/out/smallhands-teaser-$l.mp4 -c:v libvpx-vp9 -crf 33 -b:v 0 \
      -row-mt 1 -c:a libopus -b:a 112k -y public/media/teaser-$l.webm
  # the poster is the still that has to sell the click, so it comes from the
  # delivery beat (~40.8 s): the wagon with crates in its bed, the sawmill, and a
  # hauler carrying planks between them — the whole loop in one frame. Re-check the
  # timestamp after any retiming; a caption caught mid-fade reads as a broken image.
  # And LOOK at the result — this frame is the one place a caption bug ships as a
  # still image, which is how the sub-line printed across the chip row for weeks.
  $FF -ss 40.8 -i tools/trailer/out/smallhands-teaser-$l.mp4 -frames:v 1 -q:v 3 \
      -y public/media/teaser-poster-$l.jpg
done
```
