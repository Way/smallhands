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
import { getLang } from '../engine/i18n';
import type { Lang } from '../engine/i18n';
import { S } from './frontdoor-copy'; // used locally in tr()

// Re-exported so frontdoor.ts's public interface is unchanged (the copy table
// now lives in the pure, importable-under-Node data module frontdoor-copy.ts).
// FRONTDOOR_COPY_KEYS is only surfaced here, not read locally, so it is a
// re-export rather than an unused import (would trip noUnusedLocals otherwise).
export { S, FRONTDOOR_COPY_KEYS } from './frontdoor-copy';

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
  }

  private paintIcons(): void {
    this.root.querySelectorAll<HTMLCanvasElement>('canvas[data-sprite]').forEach((c) => {
      const name = c.dataset.sprite;
      if (name) drawIconTo(c, name, 64); // 2× the CSS box for crisp HiDPI edges
    });
  }

  private view(): string {
    const lang = getLang();
    const play = `<button class="big-btn fd-play">▶ ${this.hooks.continueLabel()}</button>`;
    return `
    <header class="fd-topbar">
      <div class="wrap fd-topbar-in">
        <a class="fd-brand" href="#top">
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

      <section class="band">
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

      <section class="band alt">
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
              <div class="mech-ic">${this.icon('item_spear')}</div>
              <div><h3>${this.tr('mechChainTitle')}</h3><p>${this.tr('mechChainBody')}</p></div>
            </article>
          </div>
        </div>
      </section>

      <section class="band">
        <div class="wrap">
          <h2>${this.tr('contentHead')}</h2>
          <ul class="feats">
            <li>${this.icon('goal')}<span>${this.tr('feat1')}</span></li>
            <li>${this.icon('boulder')}<span>${this.tr('feat2')}</span></li>
            <li>${this.icon('lantern')}<span>${this.tr('feat3')}</span></li>
            <li>${this.icon('icon_harvest')}<span>${this.tr('feat4')}</span></li>
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
      </section>
    </main>

    <footer class="foot">
      <div class="wrap">${this.tr('footer')}</div>
    </footer>
    `;
  }
}
