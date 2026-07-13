// Smallhands landing page — the site's front door. The game itself lives at
// /play/ (see vite.config.ts). This page is deliberately tiny and dependency-
// free, in the spirit of the game: its only import is the game's own pixel-art
// renderer, so every icon you see here is the exact art the game draws.

import './landing.css';
import { buildAtlas, drawIconTo } from './engine/sprites';

// ---- language -----------------------------------------------------------------
// The landing shares the game's persisted language. It lives as `lang` inside
// the `smallhands-save-v1` JSON blob (see engine/save.ts, KEY). We read and
// merge only that one field so a choice made here carries straight into the
// game — without pulling the game's whole save/leveldata graph into this bundle.

type Lang = 'en' | 'de';
const SAVE_KEY = 'smallhands-save-v1';

function detectLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return nav.toLowerCase().startsWith('de') ? 'de' : 'en';
}

function readLang(): Lang {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const l = (JSON.parse(raw) as { lang?: unknown }).lang;
      if (l === 'en' || l === 'de') return l;
    }
  } catch {
    // corrupt or unavailable storage — fall through to browser language
  }
  return detectLang();
}

function writeLang(lang: Lang): void {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    data.lang = lang;
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // storage unavailable (private mode) — the on-screen toggle still works
  }
}

// ---- copy: [english, german] --------------------------------------------------

type Str = [string, string];

const S = {
  metaTitle: ['Smallhands — Tiny Workers, Big Plans', 'Smallhands — Kleine Hände, große Pläne'],

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
  play: ['▶ Play now', '▶ Jetzt spielen'],
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
} satisfies Record<string, Str>;

let lang: Lang = readLang();
const t = (key: keyof typeof S): string => S[key][lang === 'de' ? 1 : 0];

// ---- rendering ----------------------------------------------------------------

// A pixel-art icon rendered from the game's own sprite atlas. `data-sprite` is
// the sprite name; drawn crisp at 2× and scaled down by CSS for a clean edge.
function icon(name: string, cls = ''): string {
  return `<canvas class="px${cls ? ' ' + cls : ''}" data-sprite="${name}" aria-hidden="true"></canvas>`;
}

function view(): string {
  return `
  <header class="topbar">
    <div class="wrap topbar-in">
      <a class="brand" href="#top">
        ${icon('ling_work', 'brand-mark')}
        <span>Smallhands</span>
      </a>
      <div class="seg" role="group" aria-label="Language">
        <button class="seg-btn" data-lang="en" aria-pressed="${lang === 'en'}">EN</button>
        <button class="seg-btn" data-lang="de" aria-pressed="${lang === 'de'}">DE</button>
      </div>
    </div>
  </header>

  <main id="top">
    <section class="hero">
      <div class="wrap hero-in">
        <p class="eyebrow">${t('eyebrow')}</p>
        <h1 class="logo">Smallhands</h1>
        <p class="tagline">${t('tagline')}</p>
        <p class="lede">${t('lede')}</p>
        <p class="sub-lede">${t('subLede')}</p>
        <div class="cta-row">
          <a class="big-btn" href="./play/">${t('play')}</a>
          <span class="cta-note">${t('playNote')}</span>
        </div>
        <div class="chain" aria-hidden="true">
          ${icon('tree')}<span class="arrow">→</span>${icon('item_log')}<span class="arrow">→</span>${icon('sawmill')}<span class="arrow">→</span>${icon('item_plank')}<span class="arrow">→</span>${icon('ling_walk_a')}<span class="arrow">→</span>${icon('goal')}
        </div>
        <p class="chain-cap">${t('chainCaption')}</p>
      </div>
    </section>

    <section class="band">
      <div class="wrap">
        <h2>${t('sweetHead')}</h2>
        <div class="two-col">
          <article class="card">
            <div class="card-icons">${icon('ling_walk_a')}${icon('ling_work')}${icon('ling_climb_a')}</div>
            <h3>${t('sweetLemmingsTitle')}</h3>
            <p>${t('sweetLemmingsBody')}</p>
          </article>
          <article class="card">
            <div class="card-icons">${icon('townhall')}${icon('sawmill')}${icon('forge')}</div>
            <h3>${t('sweetSettlersTitle')}</h3>
            <p>${t('sweetSettlersBody')}</p>
          </article>
        </div>
      </div>
    </section>

    <section class="band alt">
      <div class="wrap">
        <h2>${t('mechHead')}</h2>
        <p class="band-intro">${t('mechIntro')}</p>
        <div class="mech-grid">
          <article class="mech">
            <div class="mech-ic">${icon('tile_ladder')}</div>
            <div><h3>${t('mechLadderTitle')}</h3><p>${t('mechLadderBody')}</p></div>
          </article>
          <article class="mech">
            <div class="mech-ic">${icon('lift_mast')}</div>
            <div><h3>${t('mechLiftTitle')}</h3><p>${t('mechLiftBody')}</p></div>
          </article>
          <article class="mech">
            <div class="mech-ic">${icon('rope_anchor')}</div>
            <div><h3>${t('mechRopeTitle')}</h3><p>${t('mechRopeBody')}</p></div>
          </article>
          <article class="mech">
            <div class="mech-ic">${icon('item_spear')}</div>
            <div><h3>${t('mechChainTitle')}</h3><p>${t('mechChainBody')}</p></div>
          </article>
        </div>
      </div>
    </section>

    <section class="band">
      <div class="wrap">
        <h2>${t('contentHead')}</h2>
        <ul class="feats">
          <li>${icon('goal')}<span>${t('feat1')}</span></li>
          <li>${icon('lantern')}<span>${t('feat2')}</span></li>
          <li>${icon('icon_harvest')}<span>${t('feat3')}</span></li>
          <li>${icon('crate')}<span>${t('feat4')}</span></li>
          <li>${icon('medal_gold')}<span>${t('feat5')}</span></li>
          <li>${icon('item_iron')}<span>${t('feat6')}</span></li>
        </ul>
        <p class="tech-note">${t('techNote')}</p>
      </div>
    </section>

    <section class="band cta-band">
      <div class="wrap cta-in">
        <h2>${t('ctaHead')}</h2>
        <p>${t('ctaBody')}</p>
        <a class="big-btn" href="./play/">${t('play')}</a>
      </div>
    </section>
  </main>

  <footer class="foot">
    <div class="wrap">${t('footer')}</div>
  </footer>
  `;
}

// The sprite atlas is built once; icons are drawn from it on every render.
let atlasReady = false;

function paintIcons(rootEl: HTMLElement): void {
  if (!atlasReady) {
    buildAtlas();
    atlasReady = true;
  }
  rootEl.querySelectorAll<HTMLCanvasElement>('canvas[data-sprite]').forEach((c) => {
    const name = c.dataset.sprite;
    if (name) {
      // Draw at 2× the CSS box so the pixel art stays crisp on HiDPI screens.
      drawIconTo(c, name, 64);
    }
  });
}

function render(): void {
  const rootEl = document.getElementById('landing-root');
  if (!rootEl) return;
  document.documentElement.lang = lang;
  document.title = t('metaTitle');
  rootEl.innerHTML = view();
  paintIcons(rootEl);
  rootEl.querySelectorAll<HTMLButtonElement>('.seg-btn[data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.lang === 'de' ? 'de' : 'en';
      if (next === lang) return;
      lang = next;
      writeLang(lang);
      render();
    });
  });
}

render();
