/// <reference types="vite/client" />

// Build stamps injected by vite.config.ts `define`.
//
// __VERSION__ is the deployed commit's date ("2026.07.29") — the version shown to
// the player in the front-door footer and the options menu. __BUILD__ appends the
// short sha and is reported in bug reports, so a maintainer knows the exact commit.
// Both have git-unavailable fallbacks — 'dev' for the version, 'nogit' for the sha —
// but they are failures, not modes. They do not always pair up into "dev+nogit":
// commit() has a GITHUB_SHA escape hatch and version() has none, so a git-less CI build
// would stamp 'dev+<a real sha>'. That is exactly the build vite.config.ts now refuses
// to produce, because nothing further downstream would notice it; tests/version.mjs
// catches the same thing locally, against a build that has already been made.
declare const __VERSION__: string;
declare const __BUILD__: string;
