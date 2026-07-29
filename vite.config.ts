import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

// Stamped into the bundle so a bug report says which deployment produced it, and
// so the game can tell the player which version they are running.
//
// The displayed version is deliberately NOT package.json's semver. That number has
// never been bumped, there are no tags, and .github/workflows/deploy.yml deploys on
// every push to main — so there is no discrete release to name, and a printed
// "0.1.0" would be silently wrong on every day but the first. The date of the
// deployed commit is the honest answer and needs no human discipline to stay true.
//
// A commit's date is a property of the commit, not of the machine that built it, so
// the output stays reproducible: a *build* timestamp would change every byte of the
// bundle with no source change, churning `dist` diffs and deploy hashes. The short
// sha rides along in __BUILD__ because a date alone cannot separate two pushes made
// on the same day. See game/report.ts and tests/version.mjs.
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 8);
  try {
    return execSync('git rev-parse --short=8 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'nogit'; // a tarball checkout, or git is unavailable
  }
}

function version(): string {
  try {
    return execSync('git log -1 --format=%cd --date=format:%Y.%m.%d', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'dev'; // the mirror of commit()'s 'nogit'
  }
}

// Computed once: `define` needs it twice and it shells out to git.
const VERSION = version();

// A silent "Version dev" on the live site is the one failure this whole file exists to
// avoid, and nothing downstream sees it: `vite build` exits 0, the page renders, and the
// suite that would catch it (tests/version.mjs) is run by hand, never by
// .github/workflows/deploy.yml — which is checkout → npm ci → npm run build → deploy. Even
// if it were wired in there, a checkout has git by definition, so the fallback cannot fire
// in the one environment the suite would run in. So the build refuses instead of shipping.
// GitHub Actions sets CI=true; a local git-less build still produces a runnable bundle.
if (VERSION === 'dev' && process.env.CI) {
  throw new Error('vite.config: no git in a CI build — refusing to ship "Version dev"');
}

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(VERSION),
    __BUILD__: JSON.stringify(`${VERSION}+${commit()}`),
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
