// i18n smoke: switch to German via the options menu, verify surfaces re-render.
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
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
await page.goto(BASE_URL);
await page.waitForTimeout(600);

// English front door by default (headless is en-US)
check('front-door tagline is English', (await page.textContent('.tagline')) === 'Tiny workers · Big plans');

// switch to German via the hero language toggle; the front door re-renders
await page.click('.seg-btn[data-lang="de"]');
await page.waitForTimeout(300);
check('front-door re-renders in German', (await page.textContent('.tagline')) === 'Kleine Hände · Große Pläne');

// enter the game in German
await page.click('.fd-play'); // Spielen
await page.waitForTimeout(300);
const header = await page.textContent('.worldmap .map-title');
check('level select header is German', header === 'Wähle ein Level');
await page.click('.map-node:not(:disabled)');
await page.waitForTimeout(200);
const firstName = await page.textContent('.map-popover .lv-name');
check('level 1 name is German', firstName === 'Erste Schritte');


// start level 1: HUD in German
await page.click('.map-popover .pop-play');
await page.waitForTimeout(600);
const deliver = await page.textContent('.objectives h3 span');
check('HUD "Deliver" header is German', deliver === 'Liefern');
const toolLabel = await page.textContent('.tool-btn .tool-label');
check('first tool label is German', toolLabel === 'Prüfen');


// in-game options via the gear, switch back to English -> HUD rebuilds live.
// The gear lives in the island's burger popover, which opens on click.
await page.click('.island .menu-trigger');
await page.click('.menu-pop .speed-btn[title="Optionen"]');
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
