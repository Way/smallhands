// Front-door marketing copy — a pure data module with no imports (no CSS, no
// sprites, no DOM), so it can be loaded directly by plain Node (e.g. the
// data-parity test in tests/frontdoor-data.mjs). frontdoor.ts re-exports these.
//
// copy: [english, german] — ported verbatim from the old landing page.
type Str = [string, string];

export const S: Record<string, Str> = {
  eyebrow: ['Browser puzzle-strategy', 'Puzzle-Strategie fürs Web'],
  tagline: ['Tiny workers · Big plans', 'Kleine Hände · Große Pläne'],
  lede: [
    '<b>Lemmings</b> meets <b>The Settlers</b>&nbsp;— two childhood favourites in one.',
    '<b>Lemmings</b> trifft <b>Die Siedler</b>&nbsp;— zwei Kindheitsklassiker in einem.',
  ],
  subLede: [
    'You never control the smallhands. You shape the world — ladders, lifts, workshops — and your autonomous crew gathers, hauls, builds and crafts on its own. Every level is a delivery puzzle.',
    'Du steuerst die Smallhands nie. Du formst die Welt — Leitern, Aufzüge, Werkstätten — und dein eigenständiger Trupp sammelt, schleppt, baut und werkelt von allein. Jedes Level ist ein Lieferrätsel.',
  ],
  heroHook: ['Down is free. Up is expensive.', 'Hinab ist gratis. Hinauf kostet.'],
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
    'Visible logistics. Trees become planks, boulders become stone, iron becomes spears — production chains you watch flow, plus a Town Hall to grow your crew.',
    'Sichtbare Logistik. Aus Bäumen werden Bretter, aus Felsblöcken Stein, aus Eisen Speere — Produktionsketten, die du fließen siehst, dazu ein Rathaus, das deinen Trupp wachsen lässt.',
  ],
  mechHead: ['The puzzle: down is free, up is expensive', 'Das Rätsel: hinab ist gratis, hinauf kostet'],
  mechIntro: [
    'A smallhand with empty hands climbs and hops almost anywhere. Cargo is the hard part — every mechanic answers one question: how do the goods get back up?',
    'Ein Smallhand mit leeren Händen klettert und springt fast überallhin. Fracht ist das Schwere — jede Mechanik beantwortet eine Frage: Wie kommen die Waren wieder hinauf?',
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
    'The mirror of the lift: anchor a rope at a cliff edge and slide cargo down. Down only.',
    'Das Gegenstück zum Aufzug: ein Seil an der Klippenkante verankern und Fracht hinabrutschen lassen. Nur abwärts.',
  ],
  mechChainTitle: ['Production chains', 'Produktionsketten'],
  mechChainBody: [
    'Route the right raw goods through the right workshops and deliver the finished order to the caravan.',
    'Leite die richtigen Rohstoffe durch die richtigen Werkstätten und liefere den fertigen Auftrag zur Karawane.',
  ],
  contentHead: ['Everything in the box', 'Was in der Kiste steckt'],
  feat1: ['2 hand-crafted campaigns · 9 levels', '2 handgemachte Kampagnen · 9 Level'],
  feat2: ['Varied terrain: water, cliffs & rising floods', 'Abwechslungsreiches Terrain: Wasser, Klippen & steigende Fluten'],
  feat3: ['Dynamic weather: storms, night & lanterns', 'Dynamisches Wetter: Stürme, Nacht & Laternen'],
  feat4: ['Level editor + procedural generator', 'Level-Editor + prozeduraler Generator'],
  feat5: ['Daily challenge & shareable seed codes', 'Tages-Challenge & teilbare Seed-Codes'],
  feat6: ['Medals, best times & feats', 'Medaillen, Bestzeiten & Meisterstücke'],
  techNote: [
    'Hand-built for the web: TypeScript + Canvas, zero runtime dependencies, procedurally generated pixel art. No installs, no accounts — runs anywhere a browser does.',
    'Von Hand fürs Web gebaut: TypeScript + Canvas, keine Laufzeit-Abhängigkeiten, prozedural erzeugte Pixel-Art. Keine Installation, kein Konto — läuft überall, wo ein Browser läuft.',
  ],
  ctaHead: ['Ready, overseer?', 'Bereit, Vorsteher?'],
  ctaBody: [
    'Mark a tree, drop a sawmill, watch the plan come together.',
    'Markiere einen Baum, setz ein Sägewerk, sieh zu, wie der Plan aufgeht.',
  ],
  footer: [
    'A loving homage to the genre. All code, pixel art and audio were made from scratch for this project.',
    'Eine liebevolle Hommage ans Genre. Code, Pixel-Art und Audio sind allesamt eigens für dieses Spiel entstanden.',
  ],
  brandOptions: ['Options', 'Optionen'],
};

export const FRONTDOOR_COPY_KEYS: string[] = Object.keys(S);
