// Local dev mode — testing conveniences that must never leak into production.
//
// The only convenience so far: unlock every campaign level, so a tester can
// jump straight into any level without replaying the whole unlock chain. It is
// deliberately double-gated: the bundle must be a Vite dev build
// (`import.meta.env.DEV` — statically `false` in `vite build`, so the branch
// folds out of production) AND the page URL must opt in with a `?dev` query
// flag. `npm run dev` alone therefore still shows the real, gated progression,
// and the gating logic itself stays testable on the dev server.

// The pure rule, split out so the headless suites can pin it without a
// browser. Accepts `?dev`, `?dev=1`, `?dev=true` and `?dev=unlock`; any other
// value — or a production build — leaves the game untouched.
export function parseDevUnlock(search: string, isDevBuild: boolean): boolean {
  if (!isDevBuild) return false;
  const value = new URLSearchParams(search).get('dev');
  if (value === null) return false;
  return ['', '1', 'true', 'unlock'].includes(value.toLowerCase());
}

// Live check for the running page. `import.meta.env.DEV` is written out
// verbatim so Vite can statically replace it; the typeof/location guards keep
// the module importable from the node-side test bundles, where neither the
// Vite env object nor a window exists.
export function devUnlockAll(): boolean {
  const isDevBuild = typeof import.meta.env !== 'undefined' && import.meta.env.DEV === true;
  return parseDevUnlock(typeof location !== 'undefined' ? location.search : '', isDevBuild);
}
