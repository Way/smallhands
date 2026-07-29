// Verifies the front-door marketing copy table has an [en, de] pair for every
// key — a cheap guard against a half-translated string sneaking in — and that
// everything the game says about how much game there is still matches LEVELS.
//
// This suite owns ONE property: **the copy knows how big the game is.** Nothing
// else checks it — the front-door smoke test and the i18n suite never read a
// number. It went stale once (card #67: "2 campaigns · 9 levels" against four
// and seventeen) and stayed right afterwards only because each content commit
// remembered the copy table; card #25 replaced the remembering with arithmetic,
// so the checks are shaped around the ways THAT can fail:
//
//   1. A hardcoded digit. Every count the copy quotes is a {c}/{n} placeholder
//      that frontdoor.ts fills from LEVELS, TOOL_DEFS and BIOMES, so the drift
//      is impossible rather than merely guarded — but only while the placeholder
//      is still there. Typing "5 campaigns" back into the table reds here, and
//      the count is stale again the next time a level lands.
//   2. The <meta name="description"> in index.html. A static file the copy table
//      cannot reach, so this is the one count that IS written by hand, and the
//      one that genuinely needs comparing against LEVELS.
//   3. A campaign shipping without its copy. Campaign 5 shipped with no landing
//      hook and no unlock banner, and the banner fell back to campaign 2's line
//      — "you have unlocked Storm & Tide" after finishing Shaft & Seam. Both
//      surfaces are keyed by campaign number, so both can be checked by number.
import { readFileSync } from 'node:fs';
import { S, FRONTDOOR_COPY_KEYS } from '../src/game/frontdoor-copy.ts';
import { D } from '../src/engine/i18n.ts';
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
// TOOL_COUNT / BIOME_COUNT come from frontdoor.ts itself — the module that puts
// them on the page — not re-derived here. A test that re-implements the filter
// agrees with itself while the page prints something else.
const { LEVELS, TOOL_DEFS, BIOMES, GENERATED_BIOMES, TOOL_COUNT, BIOME_COUNT } = await bundleExports(
  `export { LEVELS } from './src/game/levels.ts';
   export { TOOL_DEFS } from './src/game/types.ts';
   export { BIOMES, GENERATED_BIOMES } from './src/engine/biomes.ts';
   export { TOOL_COUNT, BIOME_COUNT } from './src/game/frontdoor.ts';`,
);
const levels = LEVELS.length;
const campaignIds = [...new Set(LEVELS.map((l) => l.campaign ?? 1))].sort((a, b) => a - b);
const campaigns = campaignIds.length;

// A bare number, not part of a longer one: "17" must not match inside "170".
const says = (str, n) => new RegExp(`(?<!\\d)${n}(?!\\d)`).test(str);

// ---- 1. the copy table quotes no numbers, it quotes placeholders ------------
// Checking for the placeholder rather than for the right digit is the point: a
// number that frontdoor.ts fills in cannot be wrong, and a number typed in by
// hand cannot be trusted. So the failure this catches is someone "simplifying"
// a placeholder away — after which the count is silently stale the next time a
// level lands, which is where card #67 found it.
const INTERPOLATED = {
  feat1: ['{c}', '{n}'], // "{c} hand-crafted campaigns · {n} levels"
  campIntro: ['{c}', '{n}'], // "{n} levels in {c} campaigns…"
  campLevels: ['{n}'], // the per-campaign count pill
  featTools: ['{n}'], // the toolkit size
  feat4: ['{n}'], // the landscape count
};
for (const [key, holders] of Object.entries(INTERPOLATED)) {
  for (const [lang, i] of [['EN', 0], ['DE', 1]]) {
    const line = S[key]?.[i] ?? '';
    for (const h of holders) {
      check(`${key} ${lang} still interpolates ${h}`, line.includes(h), line);
    }
    // The corollary: no stray digit typed in beside the placeholder.
    check(`${key} ${lang} hardcodes no count`, !/\d/.test(line), line);
  }
}

// The two counts the page derives from something other than LEVELS. Read from
// frontdoor.ts and compared against the source lists here, so widening either
// list without meaning to change the claim shows up as a number that moved.
const NON_TOOLS = ['select', 'demolish']; // the cursor and the eraser
check(
  'the toolkit count is every placeable/orderable tool',
  TOOL_COUNT === TOOL_DEFS.filter((d) => !NON_TOOLS.includes(d.id)).length && TOOL_COUNT > 0,
  `${TOOL_COUNT} of ${TOOL_DEFS.length} TOOL_DEFS`,
);
// BIOMES, not GENERATED_BIOMES — "landscapes" is what the game has, and the
// generator deliberately draws from a shorter list. Both are asserted so a
// future edit that swaps one for the other has to do it on purpose.
check('the landscape count is BIOMES', BIOME_COUNT === BIOMES.length, `${BIOME_COUNT}`);
check(
  'the landscape count is not the generator subset',
  GENERATED_BIOMES.length <= BIOMES.length,
  `${GENERATED_BIOMES.length} generated of ${BIOMES.length}`,
);

// ---- 2. every campaign carries its own copy, on both surfaces ---------------
// Keyed by campaign number on the landing page (camp<n>Body), on the world map
// (map.terr<n>) and on the win screen (win.campaign<n>). Each is a place a new
// campaign can arrive without its words: the landing row renders untitled, the
// map prints a raw key, and the unlock banner congratulates the wrong campaign.
for (const id of campaignIds) {
  const perCamp = LEVELS.filter((l) => (l.campaign ?? 1) === id).length;
  check(`campaign ${id} has a landing hook (camp${id}Body)`, Array.isArray(S[`camp${id}Body`]), `${perCamp} levels`);
  check(`campaign ${id} has a name (map.terr${id})`, Array.isArray(D[`map.terr${id}`]));
  // Campaign 1 needs no unlock banner — nothing unlocks it.
  if (id > campaignIds[0]) {
    check(`campaign ${id} has an unlock banner (win.campaign${id})`, Array.isArray(D[`win.campaign${id}`]));
  }
}
// The banner's own safety net, used only if a campaign ever outruns its copy.
check('the generic unlock fallback exists', Array.isArray(D['win.campaignNext']));
check('the generic unlock fallback names the campaign', D['win.campaignNext']?.every((s) => s.includes('{name}')));

// ---- 3. the one count that cannot be interpolated ---------------------------
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
console.log(
  `\nFRONTDOOR DATA PASS (${campaigns} campaigns · ${levels} levels · ${TOOL_COUNT} tools · ${BIOME_COUNT} landscapes)\n` +
    campaignIds
      .map((id) => `  campaign ${id}: ${LEVELS.filter((l) => (l.campaign ?? 1) === id).length} levels`)
      .join('\n'),
);
