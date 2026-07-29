// Shared bundling helper for the headless suites: compiles a virtual
// TypeScript entry (re-exports from src/) with rolldown — vite 8's bundler,
// so it is always present in node_modules — and imports the result from an
// in-memory data URL. Replaces the old esbuild trick: since vite 8, esbuild
// is only an optional peer dependency and is no longer installed.
import { rolldown } from 'rolldown';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const entryId = `${root}__tests_entry__.ts`; // virtual: relative imports resolve against the repo root
const cssStubId = '\0tests-css-stub'; // see the stub-css plugin below

export async function bundleExports(contents) {
  const bundle = await rolldown({
    input: entryId,
    cwd: root,
    platform: 'node',
    logLevel: 'silent',
    plugins: [
      {
        name: 'virtual-entry',
        resolveId(id) {
          return id === entryId ? entryId : null;
        },
        load(id) {
          return id === entryId ? contents : null;
        },
      },
      {
        // Stylesheets become empty modules. Rolldown refuses to bundle CSS at
        // all ("experimental support has been removed"), so without this any
        // module that does `import './x.css'` is untestable here — which locked
        // out src/game/frontdoor.ts, a module whose *numbers* a headless suite
        // very much wants to read. A data test has no opinion about CSS, and
        // nothing else routed through this helper imports any, so stubbing is
        // strictly a widening: no existing suite's bundle changes.
        // The stub id must NOT keep the .css extension — rolldown picks its
        // loader by extension, so `\0css:foo.css` is still parsed as CSS and
        // fails with the identical error. One shared empty module for all of
        // them; they have no exports anyone reads.
        name: 'stub-css',
        resolveId(id) {
          return id.endsWith('.css') ? cssStubId : null;
        },
        load(id) {
          return id === cssStubId ? 'export default undefined;' : null;
        },
      },
    ],
  });
  const { output } = await bundle.generate({ format: 'esm' });
  await bundle.close();
  return import('data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64'));
}
