// Shared bundling helper for the headless suites: compiles a virtual
// TypeScript entry (re-exports from src/) with rolldown — vite 8's bundler,
// so it is always present in node_modules — and imports the result from an
// in-memory data URL. Replaces the old esbuild trick: since vite 8, esbuild
// is only an optional peer dependency and is no longer installed.
import { rolldown } from 'rolldown';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const entryId = `${root}__tests_entry__.ts`; // virtual: relative imports resolve against the repo root

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
    ],
  });
  const { output } = await bundle.generate({ format: 'esm' });
  await bundle.close();
  return import('data:text/javascript;base64,' + Buffer.from(output[0].code).toString('base64'));
}
