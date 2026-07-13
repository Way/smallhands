import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Relative base so the built site works on GitHub Pages, itch.io, or any subpath.
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 8192,
    rollupOptions: {
      input: {
        // The marketing landing page is the site's front door…
        main: resolve(root, 'index.html'),
        // …and the game itself lives one level down at /play/.
        play: resolve(root, 'play/index.html'),
      },
    },
  },
  server: {
    host: true,
  },
});
