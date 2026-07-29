// The unified front door. The game's animated title screen doubles as the
// marketing page: the hero (logo + Play) sits over the live idle backdrop
// drawn on #game-canvas, and the marketing sections scroll up over it.
//
// Ported from the old standalone landing page (src/landing.ts), but wired into
// the game (onPlay/onOptions callbacks) instead of navigating to /play/. The
// shared language lives in the game save; this surface reads it via getLang()
// and reports changes through the onLang hook (see applyLanguage in main.ts).

import '../frontdoor.css';
import { drawIconTo } from '../engine/sprites';
import { getLang, t } from '../engine/i18n';
import type { Lang } from '../engine/i18n';
import { S } from './frontdoor-copy'; // used locally in tr()
import { LEVELS } from './levels';
import { TOOL_DEFS } from './types';
import { BIOMES } from '../engine/biomes';

// Re-exported so frontdoor.ts's public interface is unchanged (the copy table
// now lives in the pure, importable-under-Node data module frontdoor-copy.ts).
// FRONTDOOR_COPY_KEYS is only surfaced here, not read locally, so it is a
// re-export rather than an unused import (would trip noUnusedLocals otherwise).
export { S, FRONTDOOR_COPY_KEYS } from './frontdoor-copy';

// ---------------------------------------------------------- the content claims
// Everything the page says about how much game there is is COUNTED here, not
// written down. Card #67 found `feat1` reading "2 hand-crafted campaigns · 9
// levels" against a game that had four and seventeen, and fixed it by hand; it
// stayed correct afterwards only because campaign 5's own commit remembered to
// edit the string. Card #25 removed the remembering: levels.ts is already in
// this bundle — main.ts imports it for the world map — so reading it is free.

// Campaign id → how many levels it holds, in play order. Derived rather than
// listed so a sixth campaign appears on the landing page the day it appears in
// the game, with no second place to remember.
function campaignRollCall(): { id: number; levels: number }[] {
  const byId = new Map<number, number>();
  for (const l of LEVELS) {
    const c = l.campaign ?? 1;
    byId.set(c, (byId.get(c) ?? 0) + 1);
  }
  return [...byId.entries()].sort((a, b) => a[0] - b[0]).map(([id, levels]) => ({ id, levels }));
}

// "Tools" as the player counts them. `select` is the cursor and `demolish` is
// the eraser — neither is a thing you build with, so neither belongs in a count
// that reads as "look how much toolkit you get".
// Exported so tests/frontdoor-data.mjs asserts against THIS value rather than
// re-deriving it: a test that re-implements the filter passes happily while the
// page advertises a different number.
export const TOOL_COUNT = TOOL_DEFS.filter((d) => d.id !== 'select' && d.id !== 'demolish').length;

// Landscapes, i.e. BIOMES — every palette the game has, all of them reachable in
// the editor. Deliberately NOT GENERATED_BIOMES, which is shorter on purpose
// (the generator's seed pick is stable against that list's length).
export const BIOME_COUNT = BIOMES.length;

// One icon per campaign — the mechanic that campaign is *about*, so the row
// reads as a promise rather than decoration. Keyed by id with a fallback,
// because sprite() throws on an unknown name and an unillustrated campaign must
// not take the whole page down with it (tests/frontdoor-data.mjs reds instead).
// `storm` and `wave` deliberately repeat the pressure cards above: campaigns 2
// and 5 ARE those pressures, and the echo is the promise. `vein` and the shovel
// are not interchangeable, though — at 34px the shovel is a thin dark shape,
// while the seam reads as ore in rock, which is what Shaft & Seam is called.
const CAMP_ICON: Record<number, string> = {
  1: 'sawmill',
  2: 'storm',
  3: 'hoist_post',
  4: 'vein',
  5: 'wave',
};

export interface FrontDoorHooks {
  onPlay: () => void; // enter the game
  onOptions: () => void; // open the options overlay
  onLang: (l: Lang) => void; // apply + persist a language change
  continueLabel: () => string; // "Play" vs "Continue", from game state
}

export class FrontDoor {
  private root: HTMLElement;
  private hooks: FrontDoorHooks;

  constructor(root: HTMLElement, hooks: FrontDoorHooks) {
    this.root = root;
    this.hooks = hooks;
  }

  private tr(key: string): string {
    return S[key][getLang() === 'de' ? 1 : 0];
  }

  // tr() with {placeholder} filling, so every number the copy quotes arrives
  // from the level table instead of being typed into the string.
  private trf(key: string, vars: Record<string, string | number>): string {
    let s = this.tr(key);
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }

  private icon(name: string, cls = ''): string {
    return `<canvas class="px${cls ? ' ' + cls : ''}" data-sprite="${name}" aria-hidden="true"></canvas>`;
  }

  show(): void {
    this.root.style.display = '';
    this.render();
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  render(): void {
    const lang = getLang();
    document.documentElement.lang = lang;
    this.root.innerHTML = this.view();
    this.paintIcons();
    this.root.querySelectorAll<HTMLButtonElement>('.seg-btn[data-lang]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.lang === lang));
      btn.addEventListener('click', () => {
        const next: Lang = btn.dataset.lang === 'de' ? 'de' : 'en';
        if (next === getLang()) return;
        this.hooks.onLang(next);
        this.render();
      });
    });
    this.root.querySelectorAll<HTMLButtonElement>('.fd-play').forEach((b) =>
      b.addEventListener('click', () => this.hooks.onPlay()),
    );
    this.root.querySelector<HTMLButtonElement>('.fd-options')?.addEventListener('click', () =>
      this.hooks.onOptions(),
    );
    // Teaser video: nothing but the (lazy) poster image loads until the click,
    // then the <video> element is created on the spot and starts playing.
    this.root.querySelector<HTMLButtonElement>('.teaser-poster')?.addEventListener('click', (e) => {
      const frame = (e.currentTarget as HTMLElement).closest('.teaser-frame');
      if (!frame) return;
      const video = document.createElement('video');
      video.poster = `media/teaser-poster-${getLang()}.jpg`;
      video.controls = true;
      video.playsInline = true;
      // WebM first (VP9/Opus, smaller, plays on codec-free Chromium builds),
      // MP4 (H.264/AAC) as the Safari fallback.
      for (const [ext, type] of [['webm', 'video/webm'], ['mp4', 'video/mp4']] as const) {
        const s = document.createElement('source');
        s.src = `media/teaser-${getLang()}.${ext}`;
        s.type = type;
        video.appendChild(s);
      }
      frame.replaceChildren(video);
      // play() inside the click's call stack counts as the user gesture; if an
      // autoplay policy still objects, retry muted rather than sit on a still.
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => undefined);
      });
    });
  }

  private paintIcons(): void {
    this.root.querySelectorAll<HTMLCanvasElement>('canvas[data-sprite]').forEach((c) => {
      const name = c.dataset.sprite;
      if (name) drawIconTo(c, name, 64); // 2× the CSS box for crisp HiDPI edges
    });
  }

  // One row of the campaign roll-call. The name is read from i18n's map.terr<n>
  // — the very string the world map prints — so a campaign rename can never make
  // the landing page and the level select disagree. The hook is optional at
  // runtime on purpose: a campaign that ships before its copy shows up as a
  // titled row rather than throwing out of tr() and blanking the whole page.
  private campRow(c: { id: number; levels: number }): string {
    const hookKey = `camp${c.id}Body`;
    const hook = S[hookKey] ? `<p>${this.tr(hookKey)}</p>` : '';
    return `
            <li class="camp">
              <div class="mech-ic">${this.icon(CAMP_ICON[c.id] ?? 'goal')}</div>
              <div>
                <h3>${t(`map.terr${c.id}`)}<span class="camp-count">${this.trf('campLevels', { n: c.levels })}</span></h3>
                ${hook}
              </div>
            </li>`;
  }

  private view(): string {
    const lang = getLang();
    const play = `<button class="big-btn fd-play">▶ ${this.hooks.continueLabel()}</button>`;
    const camps = campaignRollCall();
    const size = { c: camps.length, n: LEVELS.length };
    return `
    <header class="fd-topbar">
      <div class="wrap fd-topbar-in">
        <!-- Named here rather than by its text: below 380px the wordmark is
             hidden (the bar has no room for it next to the language toggle) and
             the icon is aria-hidden, which would leave the link nameless. -->
        <a class="fd-brand" href="#top" aria-label="Smallhands">
          ${this.icon('ling_work', 'fd-brand-mark')}
          <span>Smallhands</span>
        </a>
        <div class="fd-topbar-actions">
          <button class="fd-options">${this.tr('brandOptions')}</button>
          <div class="seg" role="group" aria-label="Language">
            <button class="seg-btn" data-lang="en" aria-pressed="${lang === 'en'}">EN</button>
            <button class="seg-btn" data-lang="de" aria-pressed="${lang === 'de'}">DE</button>
          </div>
        </div>
      </div>
    </header>

    <main id="top">
      <section class="hero">
        <div class="wrap hero-in">
          <p class="eyebrow">${this.tr('eyebrow')}</p>
          <h1 class="logo">Smallhands</h1>
          <p class="tagline">${this.tr('tagline')}</p>
          <p class="lede">${this.tr('lede')}</p>
          <p class="sub-lede">${this.tr('subLede')}</p>
          <p class="hero-hook">${this.tr('heroHook')}</p>
          <div class="cta-row">
            ${play}
            <span class="cta-note">${this.tr('playNote')}</span>
          </div>
          <div class="chain" aria-hidden="true">
            ${this.icon('tree')}<span class="arrow">→</span>${this.icon('item_log')}<span class="arrow">→</span>${this.icon('sawmill')}<span class="arrow">→</span>${this.icon('item_plank')}<span class="arrow">→</span>${this.icon('ling_walk_a')}<span class="arrow">→</span>${this.icon('goal')}
          </div>
          <p class="chain-cap">${this.tr('chainCaption')}</p>
        </div>
      </section>

      <section class="band teaser-band">
        <div class="wrap">
          <h2>${this.tr('teaserHead')}</h2>
          <div class="teaser-frame">
            <button class="teaser-poster" aria-label="${this.tr('teaserPlayAria')}">
              <img loading="lazy" decoding="async" width="1280" height="720"
                src="media/teaser-poster-${lang}.jpg" alt="${this.tr('teaserPlayAria')}">
              <span class="teaser-playbtn" aria-hidden="true">▶</span>
              <!-- The badge cannot be measured without loading the video, which is
                   the one thing the lazy poster exists to avoid — so it is written by
                   hand and guarded instead: tests/teaser-embed.mjs compares it with
                   the duration the browser reports for the shipped file. -->
              <span class="teaser-dur" aria-hidden="true">0:46</span>
            </button>
          </div>
          <p class="chain-cap">${this.tr('teaserCap')}</p>
        </div>
      </section>

      <section class="band alt">
        <div class="wrap">
          <h2>${this.tr('sweetHead')}</h2>
          <div class="two-col">
            <article class="card">
              <div class="card-icons">${this.icon('ling_walk_a')}${this.icon('ling_work')}${this.icon('ling_climb_a')}</div>
              <h3>${this.tr('sweetLemmingsTitle')}</h3>
              <p>${this.tr('sweetLemmingsBody')}</p>
            </article>
            <article class="card">
              <div class="card-icons">${this.icon('townhall')}${this.icon('sawmill')}${this.icon('forge')}</div>
              <h3>${this.tr('sweetSettlersTitle')}</h3>
              <p>${this.tr('sweetSettlersBody')}</p>
            </article>
          </div>
        </div>
      </section>

      <section class="band">
        <div class="wrap">
          <h2>${this.tr('mechHead')}</h2>
          <p class="band-intro">${this.tr('mechIntro')}</p>
          <div class="mech-grid">
            <article class="mech">
              <div class="mech-ic">${this.icon('tile_ladder')}</div>
              <div><h3>${this.tr('mechLadderTitle')}</h3><p>${this.tr('mechLadderBody')}</p></div>
            </article>
            <article class="mech">
              <div class="mech-ic">${this.icon('lift_mast')}</div>
              <div><h3>${this.tr('mechLiftTitle')}</h3><p>${this.tr('mechLiftBody')}</p></div>
            </article>
            <article class="mech">
              <div class="mech-ic">${this.icon('rope_anchor')}</div>
              <div><h3>${this.tr('mechRopeTitle')}</h3><p>${this.tr('mechRopeBody')}</p></div>
            </article>
            <article class="mech">
              <div class="mech-ic">${this.icon('hoist_post')}</div>
              <div><h3>${this.tr('mechHoistTitle')}</h3><p>${this.tr('mechHoistBody')}</p></div>
            </article>
            <article class="mech">
              <div class="mech-ic">${this.icon('icon_dig')}</div>
              <div><h3>${this.tr('mechDigTitle')}</h3><p>${this.tr('mechDigBody')}</p></div>
            </article>
            <article class="mech">
              <div class="mech-ic">${this.icon('item_spear')}</div>
              <div><h3>${this.tr('mechChainTitle')}</h3><p>${this.tr('mechChainBody')}</p></div>
            </article>
          </div>
        </div>
      </section>

      <section class="band alt">
        <div class="wrap">
          <h2>${this.tr('worldHead')}</h2>
          <p class="band-intro">${this.tr('worldIntro')}</p>
          <div class="mech-grid world-grid">
            <article class="mech">
              <div class="mech-ic">${this.icon('moon')}</div>
              <div><h3>${this.tr('worldDayTitle')}</h3><p>${this.tr('worldDayBody')}</p></div>
            </article>
            <article class="mech">
              <div class="mech-ic">${this.icon('storm')}</div>
              <div><h3>${this.tr('worldWeatherTitle')}</h3><p>${this.tr('worldWeatherBody')}</p></div>
            </article>
            <article class="mech">
              <div class="mech-ic">${this.icon('wave')}</div>
              <div><h3>${this.tr('worldFloodTitle')}</h3><p>${this.tr('worldFloodBody')}</p></div>
            </article>
            <article class="mech">
              <div class="mech-ic">${this.icon('goal')}</div>
              <div><h3>${this.tr('worldConvoyTitle')}</h3><p>${this.tr('worldConvoyBody')}</p></div>
            </article>
            <article class="mech">
              <div class="mech-ic">${this.icon('tile_platform')}</div>
              <div><h3>${this.tr('worldBudgetTitle')}</h3><p>${this.tr('worldBudgetBody')}</p></div>
            </article>
          </div>
        </div>
      </section>

      <section class="band">
        <div class="wrap">
          <h2>${this.tr('campHead')}</h2>
          <p class="band-intro">${this.trf('campIntro', size)}</p>
          <ul class="camps">
            ${camps.map((c) => this.campRow(c)).join('')}
          </ul>
        </div>
      </section>

      <section class="band alt">
        <div class="wrap">
          <h2>${this.tr('contentHead')}</h2>
          <ul class="feats">
            <li>${this.icon('goal')}<span>${this.trf('feat1', size)}</span></li>
            <li>${this.icon('tile_ladder')}<span>${this.trf('featTools', { n: TOOL_COUNT })}</span></li>
            <li>${this.icon('boulder')}<span>${this.tr('feat2')}</span></li>
            <li>${this.icon('lantern')}<span>${this.tr('feat3')}</span></li>
            <li>${this.icon('icon_harvest')}<span>${this.trf('feat4', { n: BIOME_COUNT })}</span></li>
            <li>${this.icon('crate')}<span>${this.tr('feat5')}</span></li>
            <li>${this.icon('medal_gold')}<span>${this.tr('feat6')}</span></li>
          </ul>
          <p class="tech-note">${this.tr('techNote')}</p>
        </div>
      </section>

      <section class="band cta-band">
        <div class="wrap">
          <h2>${this.tr('ctaHead')}</h2>
          <p>${this.tr('ctaBody')}</p>
          ${play}
        </div>
        <div class="fd-skyline" aria-hidden="true">
          ${this.icon('tree')}${this.icon('sawmill')}${this.icon('ling_walk_a')}${this.icon('townhall')}${this.icon('ling_work')}${this.icon('forge')}${this.icon('tree')}
        </div>
      </section>
    </main>

    <footer class="foot">
      <div class="wrap">
        ${this.tr('footer')}
        <p class="fd-version">${this.trf('version', { v: __VERSION__ })}</p>
      </div>
    </footer>
    `;
  }
}
