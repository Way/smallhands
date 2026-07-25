import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Stamped into the bundle so a bug report says which deployment produced it.
// A commit identifies the build exactly, where a timestamp only says "some
// build that day" — and it keeps the output reproducible: a build timestamp
// would change every byte of the bundle with no source change, churning `dist`
// diffs and deploy hashes. See game/report.ts.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 8);
  try {
    return execSync('git rev-parse --short=8 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'nogit'; // a tarball checkout, or git is unavailable
  }
}

export default defineConfig({
  define: {
    __BUILD__: JSON.stringify(`${pkg.version}+${commit()}`),
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
