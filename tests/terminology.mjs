// Terminology guard (card #60). Two words that look alike mean different things:
//
//   Smallhands  — the PRODUCT. Title, logo, save keys, export format, debug hook.
//   smallie(s)  — the INHABITANTS. Lowercase in EN, capitalised in DE (loanword).
//
// The rename is the kind that rots: it lives in ~90 prose strings across two
// languages, and the i18n suite is only a smoke test, so a half-renamed pair
// ships silently. This suite is a lint, not a sim test — it reads the copy
// tables and greps the tree, so it costs milliseconds and no browser.
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { D } from '../src/engine/i18n.ts';
import { S } from '../src/game/frontdoor-copy.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

// ---------------------------------------------------------------- copy tables
// The only strings allowed to say "Smallhands" are the two that name the
// product to the player. Everything else in the table is about the creatures.
const BRAND_KEYS = new Set(['import.prompt', 'save.importError']);

const brandLeaks = [];
for (const [k, [en, de]] of Object.entries(D)) {
  if (BRAND_KEYS.has(k)) continue;
  if (/smallhand/i.test(en) || /smallhand/i.test(de)) brandLeaks.push(k);
}
check('no i18n string calls an inhabitant a "smallhand"', brandLeaks.length === 0, brandLeaks.join(', '));

const fdLeaks = Object.entries(S)
  .filter(([, [en, de]]) => /smallhand/i.test(en) || /smallhand/i.test(de))
  .map(([k]) => k);
check('no front-door string calls an inhabitant a "smallhand"', fdLeaks.length === 0, fdLeaks.join(', '));

// Both brand strings must survive intact — the rename must not eat the product name.
check('brand: import prompt still says Smallhands', /Smallhands level code/.test(D['import.prompt'][0]) && /Smallhands-Level-Code/.test(D['import.prompt'][1]));
check('brand: save-import error still says Smallhands', /Smallhands save/.test(D['save.importError'][0]) && /Smallhands-Spielstand/.test(D['save.importError'][1]));

// ---------------------------------------------------------------- the species
const allPairs = [...Object.entries(D), ...Object.entries(S)];
const speciesKeys = allPairs.filter(([, [en, de]]) => /smallie/i.test(en) || /smallie/i.test(de));
check('the species word is actually used in the copy', speciesKeys.length >= 15, `${speciesKeys.length} keys`);

// EN treats it as a species: lowercase unless it opens a sentence.
const enCaps = speciesKeys.filter(([, [en]]) => /[a-z,;]\s+Smallies?\b/.test(en)).map(([k]) => k);
check('EN keeps "smallie" lowercase mid-sentence', enCaps.length === 0, enCaps.join(', '));

// DE treats it as a loanword noun: always capitalised, never translated.
const deLower = speciesKeys.filter(([, [, de]]) => /\bsmallie/.test(de)).map(([k]) => k);
check('DE keeps "Smallie" capitalised', deLower.length === 0, deLower.join(', '));
const deTranslated = speciesKeys.filter(([, [, de]]) => /Kleinlinge|Kleine Helfer|Winzlinge/.test(de)).map(([k]) => k);
check('DE keeps the loanword (not a translation)', deTranslated.length === 0, deTranslated.join(', '));

// ---------------------------------------------------------------- tree sweep
// The product name is always PLURAL ("Smallhands"), so any singular "smallhand"
// anywhere in the tree is a creature reference the rename missed. Dated design
// snapshots are excluded on purpose: they record what was true when written.
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.claude', 'out', 'coverage']);
const SKIP_PATHS = ['docs/superpowers/', 'docs/mockups/'];
const EXTS = new Set(['.ts', '.mjs', '.js', '.md', '.html', '.css']);

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, acc);
    } else if (EXTS.has(extname(e.name))) {
      acc.push(full);
    }
  }
  return acc;
}

const files = walk(ROOT).filter((f) => {
  const rel = f.slice(ROOT.length);
  return !SKIP_PATHS.some((p) => rel.startsWith(p)) && !rel.endsWith('tests/terminology.mjs');
});

const singulars = [];
for (const f of files) {
  const rel = f.slice(ROOT.length);
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      // singular only: "smallhand" not followed by another word character
      if (/smallhand(?![\w-])/i.test(line)) singulars.push(`${rel}:${i + 1}`);
    });
}
check('no singular "smallhand" left in the tree', singulars.length === 0, singulars.slice(0, 8).join(' '));

// The brand must still be present where it belongs.
const save = readFileSync(join(ROOT, 'src/engine/save.ts'), 'utf8');
check('brand: save keys untouched', save.includes("'smallhands-save-v1'") && save.includes("'smallhands-custom-v1'"));
const frontdoor = readFileSync(join(ROOT, 'src/game/frontdoor.ts'), 'utf8');
check('brand: front-door logo still reads Smallhands', /class="logo">Smallhands</.test(frontdoor));
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
check('brand: README title still reads Smallhands', readme.startsWith('# Smallhands'));
check('README describes the inhabitants as smallies', /smallies/.test(readme));

if (failures) {
  console.log(`\nTERMINOLOGY FAIL: ${failures}`);
  process.exit(1);
}
console.log('\nTERMINOLOGY PASS');
