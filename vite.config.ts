import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works on GitHub Pages, itch.io, or any subpath.
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 8192,
  },
  server: {
    host: true,
  },
});
