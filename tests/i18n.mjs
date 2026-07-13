// i18n smoke: switch to German via the options menu, verify surfaces re-render.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

function findChrome() {
  try {
    const found = execSync('ls /opt/pw-browsers/chromium-*/chrome-linux/chrome 2>/dev/null | head -1').toString().trim();
    if (found) return found;
  } catch {}
  return undefined;
}
let failures = 0;
const check = (name, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:4173/play/');
await page.waitForTimeout(600);

// English title by default (headless is en-US)
check('title subtitle is English', (await page.textContent('.title-sub')) === 'Tiny workers · Big plans');

// open options from the title, switch to German
await page.click('.title-options');
await page.waitForTimeout(200);
check('options menu opens', (await page.$$('.options-box')).length === 1);
await page.click('.seg-btn:has-text("Deutsch")');
await page.waitForTimeout(300);
check('options re-render in German', (await page.textContent('.opt-title')) === 'Optionen');

await page.click('.options-box .big-btn'); // back -> title
await page.waitForTimeout(200);
check('title re-renders in German', (await page.textContent('.title-sub')) === 'Kleine Hände · Große Pläne');

// level select in German
await page.click('button.big-btn'); // Spielen
await page.waitForTimeout(300);
const header = await page.textContent('.title-logo:not(:first-child), .level-select .title-logo');
check('level select header is German', header === 'Wähle ein Level');
const firstName = await page.textContent('.level-card .lv-name');
check('level 1 name is German', firstName === 'Erste Schritte');


// start level 1: HUD in German
await page.click('.level-card:not(.locked)');
await page.waitForTimeout(600);
const deliver = await page.textContent('.objectives h3 span');
check('HUD "Deliver" header is German', deliver === 'Liefern');
const toolLabel = await page.textContent('.tool-btn .tool-label');
check('first tool label is German', toolLabel === 'Prüfen');


// in-game options via the gear, switch back to English -> HUD rebuilds live
await page.click('.menubar .speed-btn[title="Optionen"]');
await page.waitForTimeout(200);
await page.click('.seg-btn:has-text("English")');
await page.waitForTimeout(300);
await page.click('.options-box .big-btn'); // back -> resumes the game
await page.waitForTimeout(300);
const deliverEn = await page.textContent('.objectives h3 span');
check('HUD rebuilt in English mid-level', deliverEn === 'Deliver');
const running = await page.evaluate(() => {
  const { game } = window.__smallhands;
  return !game.paused;
});
check('game resumed after leaving options', running === true);

// language choice persists across reload
await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('smallhands-save-v1') ?? '{}');
  window.__lang = raw.lang;
});
check('language choice persisted to the save', (await page.evaluate(() => window.__lang)) === 'en');

await browser.close();
console.log(failures === 0 ? 'I18N SMOKE PASS' : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
