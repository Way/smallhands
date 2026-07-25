// Fast headless checks for the daily logbook derivation (src/game/dailylog.ts):
// which save keys count as dailies, newest-first order, streak math and the
// recent-days strip. Pure logic — no browser.
import { bundleExports } from './bundle.mjs';

const mod = await bundleExports(`
  export { dailyLog, dailyStats, dailyStrip, dailyInfo } from './src/game/dailylog.ts';
  export { dailySeed } from './src/game/generator.ts';
`);
const { dailyLog, dailyStats, dailyStrip, dailyInfo, dailySeed } = mod;

let failures = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
};

const rec = (bestTime, medal = null, feats = []) => ({ bestTime, medal, feats });

// ---- which keys are dailies ----
{
  const records = {
    'daily-2026-07-20': rec(300, 'silver'),
    'daily-2026-07-22': rec(240, 'gold', ['no-demolish']),
    'daily-2026-07-24': rec(280),
    c3: rec(120, 'gold'), // campaign level
    'gen-1234': rec(90), // generated/custom level
    'daily-2026-02-31': rec(10), // impossible date — JS would roll it over
    'daily-2026-7-4': rec(10), // unpadded — not a daily key
    'daily-nope': rec(10),
  };
  const log = dailyLog(records);
  check('only well-formed daily keys are listed', log.length === 3);
  check(
    'newest first',
    log.map((e) => e.label).join(',') === '2026-07-24,2026-07-22,2026-07-20'
  );
  check('record fields carried through', log[1].bestTime === 240 && log[1].medal === 'gold' && log[1].feats[0] === 'no-demolish');
  check('rolled-over date rejected', !log.some((e) => e.label.startsWith('2026-02')));
  check('seed is the save key', log[0].seed === 'daily-2026-07-24');
}

// ---- difficulty is re-derived from the date, matching the live daily rule ----
{
  const label = '2026-07-20';
  const info = dailyInfo(label);
  const live = dailySeed(new Date(2026, 6, 20));
  check('dailyInfo matches dailySeed for the same day', info.seed === live.seed && info.difficulty === live.difficulty);
  check('impossible date returns null', dailyInfo('2026-02-31') === null);
  check('garbage returns null', dailyInfo('not-a-date') === null);

  // the rule itself: Sunday is the hard one (difficulty 4)
  const sunday = new Date(2026, 6, 20);
  while (sunday.getDay() !== 0) sunday.setDate(sunday.getDate() + 1);
  const sundayLabel = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;
  check('Sunday re-derives as difficulty 4', dailyInfo(sundayLabel).difficulty === 4);
}

// ---- streaks ----
{
  const log = dailyLog({
    'daily-2026-07-22': rec(1),
    'daily-2026-07-23': rec(1),
    'daily-2026-07-24': rec(1),
  });
  const s = dailyStats(log, '2026-07-24');
  check('streak ending today counts every day', s.current === 3);
  check('solved counts the entries', s.solved === 3);
  check('longest equals the run', s.longest === 3);
}
{
  // today not played yet — the day is not over, so the streak stands
  const log = dailyLog({ 'daily-2026-07-22': rec(1), 'daily-2026-07-23': rec(1) });
  check('unplayed today does not break the streak', dailyStats(log, '2026-07-24').current === 2);
  // ...but a skipped whole day does
  check('a skipped day breaks the streak', dailyStats(log, '2026-07-25').current === 0);
}
{
  const log = dailyLog({
    'daily-2026-07-10': rec(1),
    'daily-2026-07-11': rec(1),
    'daily-2026-07-12': rec(1),
    'daily-2026-07-13': rec(1),
    'daily-2026-07-23': rec(1),
    'daily-2026-07-24': rec(1),
  });
  const s = dailyStats(log, '2026-07-24');
  check('longest survives a later gap', s.longest === 4);
  check('current counts only the live run', s.current === 2);
}
{
  const s = dailyStats(dailyLog({}), '2026-07-24');
  check('empty log has zero streaks', s.solved === 0 && s.current === 0 && s.longest === 0);
}
{
  // month and year boundaries are real days apart, not string neighbours
  const log = dailyLog({ 'daily-2025-12-31': rec(1), 'daily-2026-01-01': rec(1) });
  check('streak crosses the year boundary', dailyStats(log, '2026-01-01').current === 2);
}

// ---- recent-days strip ----
{
  const log = dailyLog({ 'daily-2026-07-24': rec(1, 'gold'), 'daily-2026-07-22': rec(1) });
  const strip = dailyStrip(log, '2026-07-24', 5);
  check('strip has one dot per day', strip.length === 5);
  check('strip is oldest first, ending today', strip[0].label === '2026-07-20' && strip[4].label === '2026-07-24');
  check('today is flagged', strip[4].today === true && strip.filter((d) => d.today).length === 1);
  check('solved days marked with their medal', strip[4].solved === true && strip[4].medal === 'gold');
  check('missed days marked unsolved', strip[3].solved === false && strip[3].medal === null);
  check('a solved day mid-window is found', strip[2].label === '2026-07-22' && strip[2].solved === true);
}

console.log(failures === 0 ? 'DAILYLOG PASS' : `DAILYLOG FAIL: ${failures} checks failed`);
process.exit(failures === 0 ? 0 : 1);
