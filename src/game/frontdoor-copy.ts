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
  heroHook: ['Up or down, cargo needs a road.', 'Ob hinauf oder hinab — Fracht braucht einen Weg.'],
  playNote: ['Free · in your browser · no download', 'Kostenlos · im Browser · kein Download'],
  chainCaption: [
    'Trees → logs → sawmill → planks → the caravan. Your crew runs the line.',
    'Bäume → Stämme → Sägewerk → Bretter → zur Karawane. Dein Trupp hält die Linie am Laufen.',
  ],
  teaserHead: ['See it in motion', 'Sieh es in Bewegung'],
  teaserCap: [
    '35 seconds: indirect control, the climb rule, the counterweight hoist, storms that lock the lifts, the rising tide, the turning day — and the race for gold.',
    '35 Sekunden: indirekte Steuerung, die Kletter-Regel, die Gegengewichts-Winde, Stürme, die die Aufzüge blockieren, die steigende Flut, der wandelnde Tag — und das Rennen um Gold.',
  ],
  teaserPlayAria: ['Play the teaser video', 'Teaser-Video abspielen'],
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
  mechHead: ['The puzzle: every climb is a build', 'Das Rätsel: jeder Auf- und Abstieg will gebaut sein'],
  mechIntro: [
    'A smallhand steps a single tile up or down for free — anything deeper wants a ladder, ramp, lift or rope. Cargo is the hard part: every mechanic answers one question — how do the goods get up and down?',
    'Ein Smallhand steigt ein einzelnes Feld hinauf oder hinab von allein — alles Tiefere braucht Leiter, Rampe, Aufzug oder Seil. Fracht ist das Schwere: jede Mechanik beantwortet eine Frage — wie kommen die Waren hinauf und hinab?',
  ],
  mechLadderTitle: ['The ladder rule', 'Die Leiter-Regel'],
  mechLadderBody: [
    'A smallhand carrying goods refuses ladders. Empty hands climb them freely; cargo needs a ramp, lift or rope instead.',
    'Ein beladener Smallhand verweigert Leitern. Leere Hände klettern sie mühelos; Fracht braucht stattdessen Rampe, Aufzug oder Seil.',
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
  worldHead: ['A world that fights back', 'Eine Welt, die sich wehrt'],
  worldIntro: [
    'The ground is only half the puzzle. Time, weather and water keep moving while your crew works — read them, or they read you.',
    'Der Boden ist nur das halbe Rätsel. Zeit, Wetter und Wasser laufen weiter, während dein Trupp schuftet — lies sie, sonst lesen sie dich.',
  ],
  worldDayTitle: ['The turning day', 'Der wandelnde Tag'],
  worldDayBody: [
    'On living-clock levels, noon slides into dusk as you play. Once real dark falls, only lantern-light stays workable — string a chain of lanterns along the route before the light runs out.',
    'Auf Levels mit lebendiger Uhr gleitet der Mittag in die Dämmerung, während du spielst. Fällt echte Dunkelheit, lässt sich nur im Laternenlicht arbeiten — zieh eine Kette aus Laternen entlang der Route, ehe das Licht schwindet.',
  ],
  worldWeatherTitle: ['Weather with teeth', 'Wetter mit Zähnen'],
  worldWeatherBody: [
    'Rain slows every swing; storms seize the lifts and hoists, so cargo waits out the gusts. The forecast sits on the board — plan the dry spells and climb between the weathers.',
    'Regen bremst jeden Schlag; Stürme blockieren Aufzüge und Winden, sodass Fracht die Böen abwartet. Die Vorhersage steht auf dem Board — plane die trockenen Fenster und klettere zwischen den Wettern hindurch.',
  ],
  worldFloodTitle: ['The rising tide', 'Die steigende Flut'],
  worldFloodBody: [
    'On flooded levels every downpour lifts the water one step and never lets it back down. It swallows low ground, sinks dropped goods and washes wading workers home. Beat the tide to the loot.',
    'Auf gefluteten Levels hebt jeder Guss das Wasser eine Stufe — und nie senkt es sich wieder. Es verschlingt tiefen Grund, versenkt fallengelassene Waren und spült watende Arbeiter nach Hause. Sei schneller als die Flut.',
  ],
  contentHead: ['Everything in the box', 'Was in der Kiste steckt'],
  feat1: ['2 hand-crafted campaigns · 9 levels', '2 handgemachte Kampagnen · 9 Level'],
  feat2: ['Varied terrain: water, cliffs & rising floods', 'Abwechslungsreiches Terrain: Wasser, Klippen & steigende Fluten'],
  feat3: ['Living day-night cycle, rain, storms & lanterns', 'Lebendiger Tag-Nacht-Zyklus, Regen, Stürme & Laternen'],
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
