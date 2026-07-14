# Smallhands teaser video

A ~30-second teaser cut from **real gameplay**: a Playwright script plays the
production build headlessly (marking resources, building a bridge, catching a
weather flip, lighting lanterns, running the counterweight hoist) and records
one webm clip per scene; a [Remotion](https://remotion.dev) composition then
cuts the montage — German captions, fade transitions, end card — and mixes in
a procedurally generated chiptune track.

## Pipeline

```
npm run build && npm run preview        # repo root: serve the game at :4173
cd video
npm install
export CHROME_PATH=/path/to/chromium               # for capture
node capture.mjs                                   # -> public/clips/*.webm + manifest.json
node music.mjs                                     # -> public/music.wav
export CHROME_PATH=/path/to/headless_shell         # Remotion wants old-headless
npx remotion render src/index.ts Teaser out/teaser.mp4
```

`node capture.mjs wetter nacht` re-captures a subset of scenes.
`npx remotion studio src/index.ts` opens the interactive editor.

Environment knobs for `capture.mjs`: `BASE_URL` (default `http://localhost:4173/`),
`CHROME_PATH`, `LANG_OVERRIDE` (`de` default, or `en` for an English teaser —
captions in `src/scenes.ts` are separate and stay German unless edited).

## How it works

- `capture.mjs` boots the real game via its `window.__smallhands` debug hook,
  seeds a save slot (all levels unlocked, German, muted), then drives each
  scene with the game's own placement APIs (`toggleMark`, `placeBridgeRun`,
  `placeHoist`, …) exactly like the campaign solvability tests do. A small
  injected `__cine` helper adds eased camera pans and hint-toast muting.
  Scene setup is fast-forwarded at high game speed; the "usable window" of
  each recording is logged to `public/clips/manifest.json`.
- Recording quirk: under screencast load the game's frame loop clamps `dt`,
  so at 1× the sim runs below wall clock — scenes therefore record at 2–5×.
- `music.mjs` renders a deterministic 30s chiptune WAV (112 BPM, C-major
  pentatonic motif over a I–V–vi–IV bass, dotted-eighth echo) with zero deps.
- `src/Teaser.tsx` lays the clips out on a 900-frame timeline (title, five
  captioned scenes, end card) using `@remotion/transitions` fades and trims
  each clip by the manifest's measured window start.

Clips, music and the rendered MP4 are build artifacts and stay untracked —
only the pipeline is committed.
