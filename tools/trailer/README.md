# Teaser trailer renderer

Renders a ~32 s teaser video (1280×720 @ 30 fps, H.264 MP4 with a synthesized
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
- Captions and scene fades are a `position: fixed` overlay whose opacity the
  director sets per frame (CSS animations are frozen — they run on the real
  compositor clock and would race ahead of virtual time).
- The soundtrack (`music.mjs`) is a deterministic, dependency-free chiptune —
  C–Am–F–G arpeggios with bass, hats and a ping-pong delay — rendered to WAV
  and muxed in, in the same hand-synthesized spirit as `src/engine/audio.ts`.

## Scene rundown

1. **Hook** — level 1 in full swing (indirect control, hauling, sawmill)
2. **Build** — the Cliff Shrine: cargo lift + a ladder run appearing tile by tile
3. **Hoist** — Campaign 3's counterweight hoist cycling at a cliff edge
4. **Weather** — Monsoon Hollow's clear→rain crossfade on the forecast HUD
5. **Night** — the lantern chain pushing the frontier of light
6. **Biomes** — three quick cuts through generated worlds (autumn/redrock/slate)
7. **Deliver** — a goal delivery landing at the caravan
8. **End card** — the front door hero: logo, pitch, Play button

## Usage

```bash
npx vite build && npx vite preview &   # serve the production build on :4173
npm run trailer                        # both languages -> tools/trailer/out/
node tools/trailer/render-teaser.mjs --lang=de          # one language
node tools/trailer/render-teaser.mjs --storyboard       # 3 stills/scene, no video
BASE_URL=http://localhost:5173/ node tools/trailer/render-teaser.mjs
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
FF=node_modules/@ffmpeg-installer/linux-x64/ffmpeg
for l in de en; do
  $FF -i tools/trailer/out/smallhands-teaser-$l.mp4 -c:v libx264 -preset slow -crf 23 \
      -pix_fmt yuv420p -movflags +faststart -c:a copy -y public/media/teaser-$l.mp4
  $FF -i tools/trailer/out/smallhands-teaser-$l.mp4 -c:v libvpx-vp9 -crf 33 -b:v 0 \
      -row-mt 1 -c:a libopus -b:a 112k -y public/media/teaser-$l.webm
  $FF -ss 2.6 -i tools/trailer/out/smallhands-teaser-$l.mp4 -frames:v 1 -q:v 3 \
      -y public/media/teaser-poster-$l.jpg
done
```
