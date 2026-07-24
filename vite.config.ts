import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Stamped into the bundle so a bug report says which deployment produced it —
// "0.1.0 · 2026-07-24T09:12Z" is the difference between a reproducible report
// and a guess about which build the player was on. See game/report.ts.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(`${pkg.version} · ${new Date().toISOString().slice(0, 19)}Z`),
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
