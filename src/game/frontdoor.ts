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

export interface FrontDoorHooks {
  onPlay: () => void; // enter the game
  onOptions: () => void; // open the options overlay
  onLang: (l: Lang) => void; // apply + persist a language change
  continueLabel: () => string; // "Play" vs "Continue", from game state
}

// copy: [english, german] — ported verbatim from the old landing page.
type Str = [string, string];

export const S: Record<string, Str> = {
  eyebrow: ['Browser puzzle-strategy', 'Puzzle-Strategie fürs Web'],
  tagline: ['Tiny workers · Big plans', 'Kleine Hände · Große Pläne'],
  lede: [
    'The sweet spot between <b>Lemmings</b> and <b>The Settlers</b> — the two favourite games of your childhood, rolled into one.',
    'Der Sweet Spot zwischen <b>Lemmings</b> und <b>Die Siedler</b> — die zwei Lieblingsspiele deiner Kindheit, in einem.',
  ],
  subLede: [
    'You never control the smallhands directly. You shape the world — ladders, lifts, workshops — and your tiny autonomous crew gathers, hauls, builds and crafts on its own. Every level is a delivery puzzle.',
    'Du steuerst die Smallhands nie direkt. Du formst die Welt — Leitern, Aufzüge, Werkstätten — und dein kleiner, eigenständiger Trupp sammelt, schleppt, baut und werkelt von allein. Jedes Level ist ein Lieferrätsel.',
  ],
  playNote: ['Free · in your browser · no download', 'Kostenlos · im Browser · kein Download'],
  chainCaption: [
    'Trees → logs → sawmill → planks → the caravan. Your crew runs the line.',
    'Bäume → Stämme → Sägewerk → Bretter → zur Karawane. Dein Trupp hält die Linie am Laufen.',
  ],
  sweetHead: ['Two classics, one sweet spot', 'Zwei Klassiker, ein Sweet Spot'],
  sweetLemmingsTitle: ['The Lemmings side', 'Die Lemmings-Seite'],
  sweetLemmingsBody: [
    'Indirect control. You never command a worker — you build the world that guides them. Autonomous little creatures, classic 90s problem-solving.',
    'Indirekte Steuerung. Du befiehlst keinem Arbeiter — du baust die Welt, die sie lenkt. Eigenständige kleine Wesen, klassisches 90er-Tüfteln.',
  ],
  sweetSettlersTitle: ['The Settlers side', 'Die Siedler-Seite'],
  sweetSettlersBody: [
    'Visible logistics. Trees become planks, boulders become stone, iron becomes spears — production chains you can watch flow, and a Town Hall to grow your crew.',
    'Sichtbare Logistik. Aus Bäumen werden Bretter, aus Felsblöcken Stein, aus Eisen Speere — Produktionsketten, die du fließen siehst, und ein Rathaus, das deinen Trupp wachsen lässt.',
  ],
  mechHead: ['The puzzle: down is free, up is expensive', 'Das Rätsel: hinab ist gratis, hinauf kostet'],
  mechIntro: [
    'A smallhand with empty hands can climb and hop almost anywhere. Cargo is the hard part — every mechanic is a new answer to “how do the goods get back up?”',
    'Ein Smallhand mit leeren Händen klettert und springt fast überallhin. Fracht ist das Schwere — jede Mechanik ist eine neue Antwort auf „Wie kommen die Waren wieder hinauf?“',
  ],
  mechLadderTitle: ['The ladder rule', 'Die Leiter-Regel'],
  mechLadderBody: [
    'A smallhand carrying goods refuses ladders. Empty hands climb anywhere; cargo needs another way up.',
    'Ein beladener Smallhand verweigert Leitern. Leere Hände klettern überall; Fracht braucht einen anderen Weg nach oben.',
  ],
  mechLiftTitle: ['Cargo lifts', 'Lastenaufzüge'],
  mechLiftBody: [
    'Hoist a loaded worker straight up a cliff face. Up only — place it at the foot of the wall.',
    'Hieven einen beladenen Arbeiter die Klippe hinauf. Nur aufwärts — an den Fuß der Wand bauen.',
  ],
  mechRopeTitle: ['Rope anchors', 'Seilanker'],
  mechRopeBody: [
    'The mirror image of the lift: anchor a rope at a cliff edge and slide cargo down. Down only.',
    'Das Spiegelbild des Aufzugs: ein Seil an der Klippenkante verankern und Fracht hinabrutschen lassen. Nur abwärts.',
  ],
  mechChainTitle: ['Production chains', 'Produktionsketten'],
  mechChainBody: [
    'Route the right raw goods through the right workshops and deliver the finished order to the caravan.',
    'Leite die richtigen Rohstoffe durch die richtigen Werkstätten und liefere den fertigen Auftrag zur Karawane.',
  ],
  contentHead: ['Plenty to build', 'Viel zu bauen'],
  feat1: ['2 hand-crafted campaigns · 9 levels', '2 handgemachte Kampagnen · 9 Level'],
  feat2: ['Storm & Tide: water, weather, rising floods, night & lanterns', 'Sturm & Flut: Wasser, Wetter, steigende Fluten, Nacht & Laternen'],
  feat3: ['Level editor + procedural generator', 'Level-Editor + prozeduraler Generator'],
  feat4: ['Daily challenge & shareable seed codes', 'Tages-Challenge & teilbare Seed-Codes'],
  feat5: ['Medals, best times & feats', 'Medaillen, Bestzeiten & Meisterstücke'],
  feat6: ['English & German, switchable in-game', 'Englisch & Deutsch, im Spiel umschaltbar'],
  techNote: [
    '100% hand-built for the web — TypeScript + Canvas, zero runtime dependencies, procedurally generated pixel art. No installs, no accounts. Runs anywhere a browser does.',
    '100 % von Hand fürs Web gebaut — TypeScript + Canvas, keine Laufzeit-Abhängigkeiten, prozedural erzeugte Pixel-Art. Keine Installation, kein Konto. Läuft in jedem Browser.',
  ],
  ctaHead: ['Ready, overseer?', 'Bereit, Vorsteher?'],
  ctaBody: [
    'Mark a tree, place a sawmill, and watch the little plan come together.',
    'Markiere einen Baum, setze ein Sägewerk und sieh zu, wie der kleine Plan aufgeht.',
  ],
  footer: [
    'An original homage to the genre. All code, pixel art and audio are original to this project.',
    'Eine originale Hommage ans Genre. Code, Pixel-Art und Audio sind allesamt original.',
  ],
  brandOptions: ['Options', 'Optionen'],
};

export const FRONTDOOR_COPY_KEYS: string[] = Object.keys(S);

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
            <li>${this.icon('lantern')}<span>${this.tr('feat2')}</span></li>
            <li>${this.icon('icon_harvest')}<span>${this.tr('feat3')}</span></li>
            <li>${this.icon('crate')}<span>${this.tr('feat4')}</span></li>
            <li>${this.icon('medal_gold')}<span>${this.tr('feat5')}</span></li>
            <li>${this.icon('item_iron')}<span>${this.tr('feat6')}</span></li>
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
