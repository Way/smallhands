// Headless checks for the local dev-mode unlock: the ?dev flag parser and the
// campaign gating (with and without the unlock-all override). No browser —
// bundles the TS sources like tests/unit.mjs does.
import { bundleExports } from './bundle.mjs';

const mod = await bundleExports(`
  export { parseDevUnlock } from './src/engine/devmode.ts';
  export { computeCampaignStates } from './src/game/progress.ts';
  export { LEVELS } from './src/game/levels.ts';
`);
const { parseDevUnlock, computeCampaignStates, LEVELS } = mod;

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name}`);
    failures++;
  }
}

// ---- the ?dev flag parser ---------------------------------------------------
{
  // production builds ignore the flag entirely — no cheat door for players
  check('prod build: ?dev=1 is ignored', parseDevUnlock('?dev=1', false) === false);
  check('prod build: bare ?dev is ignored', parseDevUnlock('?dev', false) === false);

  // dev builds still default to the real, gated progression
  check('dev build: no query means gated', parseDevUnlock('', true) === false);
  check('dev build: unrelated params mean gated', parseDevUnlock('?foo=1', true) === false);

  // the opt-in spellings
  check('dev build: bare ?dev unlocks', parseDevUnlock('?dev', true) === true);
  check('dev build: ?dev=1 unlocks', parseDevUnlock('?dev=1', true) === true);
  check('dev build: ?dev=true unlocks', parseDevUnlock('?dev=true', true) === true);
  check('dev build: ?dev=TRUE unlocks (case-insensitive)', parseDevUnlock('?dev=TRUE', true) === true);
  check('dev build: ?dev=unlock unlocks', parseDevUnlock('?dev=unlock', true) === true);
  check('dev build: ?dev among other params unlocks', parseDevUnlock('?lang=de&dev=1', true) === true);

  // explicit "off" spellings stay off
  check('dev build: ?dev=0 stays gated', parseDevUnlock('?dev=0', true) === false);
  check('dev build: ?dev=false stays gated', parseDevUnlock('?dev=false', true) === false);
  check('dev build: ?dev=nonsense stays gated', parseDevUnlock('?dev=nonsense', true) === false);
}

// ---- normal gating (unlockAll = false): unchanged rules ---------------------
{
  const fresh = computeCampaignStates(LEVELS, []);
  const allLevels = fresh.flatMap((c) => c.levels);
  check('fresh save: campaign 1 is open', fresh[0].unlocked === true);
  check('fresh save: later campaigns are fogged', fresh.slice(1).every((c) => !c.unlocked));
  check('fresh save: exactly 1 level unlocked', allLevels.filter((l) => l.unlocked).length === 1);
  check('fresh save: the unlocked level is the first', allLevels.find((l) => l.unlocked)?.index === 0);
  check('fresh save: nothing is done', allLevels.every((l) => !l.done));

  // finishing level 1 unlocks exactly the next level in sequence
  const afterOne = computeCampaignStates(LEVELS, [LEVELS[0].id]);
  const afterOneLevels = afterOne.flatMap((c) => c.levels);
  check('1 win: 2 levels unlocked', afterOneLevels.filter((l) => l.unlocked).length === 2);
  check('1 win: level 1 reads done', afterOneLevels.find((l) => l.index === 0)?.done === true);

  // a full save reads fully complete
  const done = computeCampaignStates(LEVELS, LEVELS.map((l) => l.id));
  check('full save: every campaign complete', done.every((c) => c.complete && c.unlocked));
  check('full save: every level done', done.flatMap((c) => c.levels).every((l) => l.done && l.unlocked));
}

// ---- dev unlock (unlockAll = true): every gate opens, progress stays honest --
{
  const dev = computeCampaignStates(LEVELS, [], true);
  const devLevels = dev.flatMap((c) => c.levels);
  check('dev unlock: every campaign is open', dev.every((c) => c.unlocked));
  check('dev unlock: every level is playable', devLevels.every((l) => l.unlocked));
  check('dev unlock: covers all levels', devLevels.length === LEVELS.length);
  check('dev unlock: completion is NOT faked (levels)', devLevels.every((l) => !l.done));
  check('dev unlock: completion is NOT faked (campaigns)', dev.every((c) => !c.complete));

  // real wins still record on top of the override
  const devWithWin = computeCampaignStates(LEVELS, [LEVELS[0].id], true);
  check(
    'dev unlock: a real win still reads done',
    devWithWin.flatMap((c) => c.levels).find((l) => l.index === 0)?.done === true
  );
}

if (failures) {
  console.error(`DEVMODE FAIL: ${failures} checks failed`);
  process.exit(1);
}
console.log('DEVMODE PASS');
