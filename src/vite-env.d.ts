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
