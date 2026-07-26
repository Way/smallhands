// Verifies the front-door marketing copy table has an [en, de] pair for every
// key — a cheap guard against a half-translated string sneaking in — and that
// the two places advertising the game's size agree with the shipped LEVELS.
//
// The size claim lives in TWO copies that cannot see each other (card #67):
//   1. S.feat1 in src/game/frontdoor-copy.ts — the "Everything in the box" list
//   2. the <meta name="description"> in index.html — not reachable from the table
// Adding a campaign or a level makes both stale, and neither the front-door
// smoke test nor the i18n suite reads a number, so this suite owns the drift.
import { readFileSync } from 'node:fs';
import { S, FRONTDOOR_COPY_KEYS } from '../src/game/frontdoor-copy.ts';
import { bundleExports } from './bundle.mjs';

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

check('has copy keys', FRONTDOOR_COPY_KEYS.length >= 20);
for (const k of FRONTDOOR_COPY_KEYS) {
  const pair = S[k];
  check(`${k} has [en, de]`, Array.isArray(pair) && pair.length === 2 && pair[0] && pair[1]);
}

// ------------------------------------------------------------- the size claim
// levels.ts pulls in the T tile enum, so it needs bundling rather than node's
// type stripping (same trick as tests/unit.mjs).
const { LEVELS } = await bundleExports(`export { LEVELS } from './src/game/levels.ts';`);
const levels = LEVELS.length;
const campaigns = new Set(LEVELS.map((l) => l.campaign ?? 1)).size;

// A bare number, not part of a longer one: "17" must not match inside "170".
const says = (str, n) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(str);

for (const [lang, i] of [['EN', 0], ['DE', 1]]) {
  const line = S.feat1[i];
  check(`feat1 ${lang} advertises ${campaigns} campaigns`, says(line, campaigns), line);
  check(`feat1 ${lang} advertises ${levels} levels`, says(line, levels), line);
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const meta = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
check('index.html has a meta description', meta.length > 0);
check(`meta description advertises ${campaigns} campaigns`, says(meta, campaigns));
check(`meta description advertises ${levels} levels`, says(meta, levels));

// Search engines render roughly 155-160 characters, so a count that sits past
// the cut is a count nobody reads. The full string may run longer; the numbers
// have to land inside the visible prefix.
const SERP_CHARS = 155;
const head = meta.slice(0, SERP_CHARS);
check(
  `both counts survive the ${SERP_CHARS}-char search snippet`,
  says(head, campaigns) && says(head, levels),
  `${meta.length} chars total`,
);

if (failures) {
  console.log(`\nFRONTDOOR DATA FAIL: ${failures}`);
  process.exit(1);
}
console.log(`\nFRONTDOOR DATA PASS (${campaigns} campaigns · ${levels} levels)`);
