// Verifies the front-door marketing copy table has an [en, de] pair for every
// key — a cheap guard against a half-translated string sneaking in.
import { S, FRONTDOOR_COPY_KEYS } from '../src/game/frontdoor-copy.ts';

let failures = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
};

check('has copy keys', FRONTDOOR_COPY_KEYS.length >= 20);
for (const k of FRONTDOOR_COPY_KEYS) {
  const pair = S[k];
  check(`${k} has [en, de]`, Array.isArray(pair) && pair.length === 2 && pair[0] && pair[1]);
}

if (failures) {
  console.log(`\nFRONTDOOR DATA FAIL: ${failures}`);
  process.exit(1);
}
console.log('\nFRONTDOOR DATA PASS');
