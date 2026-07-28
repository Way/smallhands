// Front-door teaser embed check: the "See it in motion" section must hand the
// browser a playable video of the CURRENT render, and the duration badge on the
// poster must tell the truth about it.
//
// Worth its own suite because every failure here is silent. The section is lazy —
// a poster button until it is clicked — so nothing touches public/media on load,
// and a shorter, older render sitting there still paints a perfectly good page.
// The badge is hand-written for exactly that reason (measuring it would mean
// loading the video the poster exists to defer), so this is the only thing that
// can catch it drifting from the file.
//
// Usage: BASE_URL=http://localhost:4173/ CHROME_PATH=… node tests/teaser-embed.mjs
import { chromium } from 'playwright-core';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4173/';
const TOL = 0.6; // the badge is whole seconds; VP9 and H.264 also differ by a frame

let fails = 0;
const check = (label, ok, detail) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail === undefined ? '' : ` — ${detail}`}`);
  if (!ok) fails++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => check('no page errors', false, e.message));

try {
  await page.goto(BASE_URL, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  const before = await page.evaluate(() => {
    const btn = document.querySelector('.teaser-frame .teaser-poster');
    return {
      hasButton: !!btn,
      hasVideo: !!document.querySelector('.teaser-frame video'),
      posterSrc: btn?.querySelector('img')?.getAttribute('src') ?? null,
      badge: btn?.querySelector('.teaser-dur')?.textContent?.trim() ?? null,
    };
  });
  check('the teaser frame starts as a poster button', before.hasButton && !before.hasVideo);
  check('poster points at a public/media still', /^media\/teaser-poster-(en|de)\.jpg$/.test(before.posterSrc ?? ''), before.posterSrc);
  check('the poster carries a duration badge', /^\d+:\d{2}$/.test(before.badge ?? ''), before.badge);

  const trigger = page.locator('.teaser-frame .teaser-poster');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await page.waitForSelector('.teaser-frame video', { timeout: 5000 });

  // Metadata is what proves WHICH file the browser accepted, and how long it is.
  const meta = await page.evaluate(async () => {
    const v = document.querySelector('.teaser-frame video');
    if (v.readyState < 1) {
      await new Promise((res) => {
        v.addEventListener('loadedmetadata', res, { once: true });
        setTimeout(res, 8000);
      });
    }
    await new Promise((res) => setTimeout(res, 900)); // let playback get going
    return {
      sources: [...v.querySelectorAll('source')].map((s) => `${s.type} ${s.getAttribute('src')}`),
      currentSrc: v.currentSrc,
      duration: v.duration,
      readyState: v.readyState,
      currentTime: v.currentTime,
      error: v.error ? v.error.code : null,
    };
  });

  check('sources offer WebM first, MP4 second', /webm/.test(meta.sources[0] ?? '') && /mp4/.test(meta.sources[1] ?? ''), meta.sources.join(' | '));
  check('the browser accepted a source', !!meta.currentSrc && meta.error === null, meta.currentSrc || `media error ${meta.error}`);
  check('metadata loaded', meta.readyState >= 1, `readyState ${meta.readyState}`);
  check('playback advances', meta.currentTime > 0, `${meta.currentTime?.toFixed(2)} s in`);

  const [m, s] = (before.badge ?? '0:00').split(':').map(Number);
  const badgeS = m * 60 + s;
  check(
    'the badge matches the shipped file',
    Number.isFinite(meta.duration) && Math.abs(Math.ceil(meta.duration) - badgeS) <= TOL,
    `badge ${before.badge} (${badgeS}s) vs ${meta.duration?.toFixed(2)}s`
  );
} finally {
  await browser.close();
}

console.log(fails ? `\nTEASER EMBED FAIL (${fails})` : '\nTEASER EMBED PASS');
process.exit(fails ? 1 : 0);
