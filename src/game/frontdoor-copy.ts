// Front-door marketing copy — a pure data module with no imports (no CSS, no
// sprites, no DOM), so it can be loaded directly by plain Node (e.g. the
// data-parity test in tests/frontdoor-data.mjs). frontdoor.ts re-exports these.
//
// copy: [english, german]. The German half is written as German, not translated
// from the English line above it (card #67): native phrasing wins over a
// word-for-word match, in-game vocabulary is reused verbatim (Gegengewichts-
// Aufzug, Spaten, Gräber, Werkstatt), and the plural of "Level" stays "Level".
// Terminology registers are fixed and guarded by tests/terminology.mjs: the
// product is Smallhands, the species is Smallie/Smallies (capitalised in DE,
// never translated), the group is a Trupp.
//
// Content claims (campaign/level counts, mechanics on show) must match what
// ships in src/game/levels.ts. Every number this table quotes is a `{c}` / `{n}`
// placeholder that frontdoor.ts fills from LEVELS, TOOL_DEFS and BIOMES, so a
// new campaign, level, tool or landscape cannot leave a stale digit behind. It
// did once — card #67 caught "2 campaigns · 9 levels" long after there were four
// and seventeen — and every correct number since has depended on whoever added
// content also remembering this file (card #25). The one count that CANNOT be
// interpolated is the <meta name="description"> in index.html, a static file the
// table cannot reach; tests/frontdoor-data.mjs owns that one, and also reds if a
// hand-written digit reappears here or a campaign ships without its own hook.
type Str = [string, string];

export const S: Record<string, Str> = {
  eyebrow: ['Browser puzzle-strategy', 'Knobel-Strategie im Browser'],
  tagline: ['Tiny workers · Big plans', 'Kleine Hände · Große Pläne'],
  lede: [
    '<b>Lemmings</b> meets <b>The Settlers</b>&nbsp;— two childhood favourites in one.',
    '<b>Lemmings</b> trifft <b>Die Siedler</b>: zwei Kindheitsklassiker in einem.',
  ],
  subLede: [
    'You never control the smallies. You shape their world with ladders, ramps, lifts and workshops, and your autonomous crew gathers, digs, hauls, builds and crafts on its own. Every level is a delivery puzzle.',
    'Du steuerst die Smallies nie. Du formst ihre Welt: Leitern, Rampen, Aufzüge, Werkstätten. Der Trupp sammelt, gräbt, schleppt, baut und werkelt ganz von allein. Jedes Level ist ein Rätsel um Wege und Waren.',
  ],
  heroHook: ['Up or down, cargo needs a road.', 'Ob hinauf oder hinab: Fracht braucht einen Weg.'],
  playNote: ['Free · in your browser · no download', 'Kostenlos · im Browser · kein Download'],
  chainCaption: [
    'Trees → logs → sawmill → planks → the caravan. Your crew runs the line.',
    'Bäume → Stämme → Sägewerk → Bretter → Karawane. Dein Trupp hält die Kette in Gang.',
  ],
  teaserHead: ['See it in motion', 'Sieh es in Bewegung'],
  teaserCap: [
    '45 seconds: indirect control, the climb rule, shafts cut through solid rock, the counterweight hoist, a caravan that docks on a schedule, storms that lock the lifts, a tide that takes the deep, the turning day — and the race for gold.',
    '45 Sekunden: indirekte Steuerung, die Leiterregel, Schächte durch massiven Fels, der Gegengewichts-Aufzug, eine Karawane, die nach Plan hält, Stürme, die die Aufzüge lahmlegen, eine Flut, die den Stollen holt, das schwindende Licht und das Rennen ums Gold.',
  ],
  teaserPlayAria: ['Play the teaser video', 'Teaser-Video abspielen'],
  sweetHead: ['Two classics, one sweet spot', 'Zwei Klassiker, ein Sweet Spot'],
  sweetLemmingsTitle: ['The Lemmings side', 'Die Lemmings-Seite'],
  sweetLemmingsBody: [
    'Indirect control. You never command a worker — you build the world that guides them. Autonomous little creatures, classic 90s problem-solving.',
    'Indirekte Steuerung: Du befiehlst keinem Smallie etwas, du baust die Welt, die sie lenkt. Eigenständige kleine Wesen, Tüfteln wie in den 90ern.',
  ],
  sweetSettlersTitle: ['The Settlers side', 'Die Siedler-Seite'],
  sweetSettlersBody: [
    'Visible logistics. Trees become planks, boulders become stone, iron becomes spears — production chains you watch flow, plus a Town Hall to grow your crew.',
    'Sichtbare Logistik: Aus Bäumen werden Bretter, aus Felsblöcken Stein, aus Eisen Speere. Produktionsketten, die du fließen siehst, dazu ein Rathaus, das deinen Trupp wachsen lässt.',
  ],
  mechHead: ['The puzzle: every climb is a build', 'Das Rätsel: Jeder Auf- und Abstieg muss gebaut werden'],
  mechIntro: [
    'A smallie steps a single tile up or down for free — anything deeper wants a ladder, ramp, lift or rope. Cargo is the hard part: every mechanic answers one question — how do the goods get up and down?',
    'Ein Smallie steigt von allein ein einzelnes Feld hinauf oder hinab. Alles Tiefere braucht Leiter, Rampe, Aufzug oder Seil. Schwierig wird es bei der Fracht: Jede Mechanik beantwortet dieselbe Frage. Wie kommen die Waren rauf und runter?',
  ],
  mechLadderTitle: ['The ladder rule', 'Die Leiterregel'],
  mechLadderBody: [
    'A smallie carrying goods refuses ladders. Empty hands climb them freely; cargo needs a ramp, lift or rope instead.',
    'Ein beladener Smallie geht keine Leiter hinauf. Mit leeren Händen klettert er mühelos, mit Fracht braucht er Rampe, Aufzug oder Seil.',
  ],
  mechLiftTitle: ['Cargo lifts', 'Lastenaufzüge'],
  mechLiftBody: [
    'Hoist a loaded worker straight up a cliff face. Up only — place it at the foot of the wall.',
    'Ein Lastenaufzug zieht einen beladenen Smallie senkrecht die Felswand hinauf. Nur aufwärts, deshalb an den Fuß der Wand setzen.',
  ],
  mechRopeTitle: ['Rope anchors', 'Seilanker'],
  mechRopeBody: [
    'The mirror of the lift: anchor a rope at a cliff edge and slide cargo down. Down only.',
    'Das Gegenstück zum Aufzug: Seil an der Klippenkante verankern und die Fracht hinabgleiten lassen. Nur abwärts.',
  ],
  mechHoistTitle: ['The counterweight hoist', 'Der Gegengewichts-Aufzug'],
  mechHoistBody: [
    'Two cars on one wheel: the heavier side sinks and lifts the other. Ballast a car with stone and the wheel carries your planks up the drop.',
    'Zwei Körbe an einem Rad: Die schwerere Seite sinkt und zieht die andere hinauf. Belade einen Korb mit Stein, und das Rad hebt dir die Bretter nach oben.',
  ],
  mechDigTitle: ['Shafts and tunnels', 'Schacht und Stollen'],
  mechDigBody: [
    'Mark where to dig and a Digger with a workshop-crafted shovel carves the ground away. That is how you reach the iron sealed below. Bedrock stays put.',
    'Markiere, wo gegraben wird, und ein Gräber mit Spaten aus der Werkstatt trägt den Boden ab. So kommst du an das Eisen, das tief unten eingeschlossen liegt. Grundgestein bleibt, wo es ist.',
  ],
  mechChainTitle: ['Production chains', 'Produktionsketten'],
  mechChainBody: [
    'Route the right raw goods through the right workshops and deliver the finished order to the caravan.',
    'Leite die richtigen Rohstoffe durch die richtigen Werkstätten und liefere den fertigen Auftrag zur Karawane.',
  ],
  worldHead: ['A world that fights back', 'Eine Welt, die sich wehrt'],
  worldIntro: [
    'The ground is only half the puzzle. Clock, weather and water keep moving while your crew works, the caravan keeps hours of its own, and some levels ration your tools. Every one of them runs on a schedule you can read — none of them rolls dice.',
    'Der Boden ist nur die Hälfte des Rätsels. Uhr, Wetter und Wasser laufen weiter, während dein Trupp schuftet. Die Karawane hat ihre eigenen Zeiten, und manche Level rationieren dein Werkzeug. All das folgt einem Plan, den du lesen kannst — gewürfelt wird nie.',
  ],
  worldDayTitle: ['The turning day', 'Der Lauf des Tages'],
  worldDayBody: [
    'On living-clock levels, noon slides into dusk as you play. Once real dark falls, only lantern-light stays workable — string a chain of lanterns along the route before the light runs out.',
    'Wo die Uhr lebt, rutscht der Mittag in die Dämmerung, während du spielst. Wird es richtig dunkel, geht die Arbeit nur noch im Laternenlicht weiter. Zieh eine Kette aus Laternen entlang der Route, bevor das Licht ausgeht.',
  ],
  worldWeatherTitle: ['Weather with teeth', 'Wetter mit Zähnen'],
  worldWeatherBody: [
    'Rain slows every swing; storms seize the lifts and hoists, so cargo waits out the gusts. The forecast sits on the board — plan the dry spells and climb between the weathers.',
    'Regen bremst jeden Schlag. Stürme legen Aufzüge und Winden lahm, dann wartet die Fracht die Böen ab. Die Vorhersage steht oben in der Leiste: Nutze die trockenen Zeitfenster, ehe die nächste Front durchzieht.',
  ],
  worldFloodTitle: ['The rising tide', 'Die steigende Flut'],
  worldFloodBody: [
    'On flooded levels every downpour lifts the water one step and never lets it back down. It swallows low ground, sinks dropped goods and washes wading workers home. Beat the tide to the loot.',
    'Wo die Flut steigt, hebt jeder Regenguss das Wasser um eine Stufe, und es sinkt nie wieder. Es schluckt tiefen Grund, versenkt liegengelassene Waren und spült watende Smallies nach Hause. Sei schneller als das Wasser.',
  ],
  worldConvoyTitle: ["The caravan's timetable", 'Der Fahrplan der Karawane'],
  // The second clause is the sim's actual rule and it is easy to get wrong in a
  // nice-sounding way: a closed window stops *dispatch*, and the delivery lands
  // when the HAULER arrives, not when the wagon comes back (sim.ts never
  // re-checks convoyOpen on the deposit). Promising that the load waits for the
  // wagon would teach the opposite of the good play, which is to keep haulers
  // walking into a closing window because their cargo still counts.
  worldConvoyBody: [
    'On some routes the wagon only stands at the dock for a spell, then rolls on. Nothing new is sent out while it is gone and the crew fills the stockpile instead — but a hauler already on the road finishes its run, and that load still counts.',
    'Auf manchen Routen steht der Wagen nur eine Weile am Verladeplatz, dann zieht er weiter. Solange er fort ist, geht nichts Neues hinaus und der Trupp füllt stattdessen das Lager — wer aber schon unterwegs ist, liefert seine Last noch ab, und sie zählt.',
  ],
  worldBudgetTitle: ['Rationed tools', 'Knappes Werkzeug'],
  worldBudgetBody: [
    'Some levels hand you a handful of bridges or a single hoist. The cap is on what may stand at once, not on what you ever spend — tear one down and the slot comes back, so a span in the wrong place is a mistake, never a dead end.',
    'Manche Level geben dir nur ein paar Brücken oder einen einzigen Aufzug. Begrenzt ist, was gleichzeitig steht, nicht, was du insgesamt verbaust: Was du abreißt, gibt seinen Platz wieder frei. Ein Steg an der falschen Stelle ist ein Fehler, nie eine Sackgasse.',
  ],
  campHead: ['Where the road goes', 'Wohin die Reise geht'],
  campIntro: [
    '{n} levels in {c} campaigns. Each one hands you a single new thing the world does, gives you room to play with it, then asks you to plan around it for real.',
    '{n} Level in {c} Kampagnen. Jede gibt dir eine neue Eigenheit der Welt an die Hand, lässt dich damit spielen und verlangt dann, dass du wirklich damit planst.',
  ],
  campLevels: ['{n} levels', '{n} Level'],
  // One hook per campaign, keyed by campaign number. The name beside it is NOT
  // repeated here — frontdoor.ts reads it from i18n's map.terr<n>, the same
  // string the world map prints, so a campaign rename cannot say two things.
  camp1Body: [
    'The verbs: mark a tree, raise a ladder, drop a sawmill and fill the first order sheet on the board.',
    'Die Grundlagen: einen Baum markieren, eine Leiter stellen, ein Sägewerk setzen und den ersten Auftrag auf der Tafel füllen.',
  ],
  camp2Body: [
    'Bridge the river, read the forecast off the top bar, and outrun a tide that climbs one step with every rainfall and never sinks back.',
    'Den Fluss überbrücken, die Vorhersage oben in der Leiste lesen und schneller sein als eine Flut, die mit jedem Regen um eine Stufe steigt und nie wieder fällt.',
  ],
  camp3Body: [
    'One law: the heavier car sinks. Send ballast down to bring your planks up — and catch a caravan that only docks on a window.',
    'Ein Gesetz: Der schwerere Korb sinkt. Schick Ballast hinab, um die Bretter hinaufzuholen — und erwisch eine Karawane, die nur in einem Zeitfenster hält.',
  ],
  camp4Body: [
    'Craft shovels in the Workshop, put Diggers on them, and sink shafts after an iron seam that runs well below daylight.',
    'Stelle in der Werkstatt Spaten her, setze Gräber daran und teufe Schächte einer Eisenader nach, die weit unter dem Tageslicht verläuft.',
  ],
  camp5Body: [
    'Red rock, and a seam that shares its clock with the water table. Cut too deep and the next downpour takes the gallery you just opened.',
    'Roter Fels und eine Ader, die ihre Uhr mit dem Wasserspiegel teilt. Grab zu tief, und der nächste Guss holt sich den Stollen, den du eben aufgeschlagen hast.',
  ],
  contentHead: ['Everything in the box', 'Was in der Kiste steckt'],
  feat1: ['{c} hand-crafted campaigns · {n} levels', '{c} handgemachte Kampagnen · {n} Level'],
  featTools: [
    '{n} tools, from a ladder rung to a counterweight hoist',
    '{n} Werkzeuge, von der Leitersprosse bis zum Gegengewichts-Aufzug',
  ],
  feat2: ['Meadows, cliffs, rising floods & mine shafts', 'Wiesen, Klippen, steigende Fluten & Stollen'],
  feat3: ['Living day-night cycle, rain, storms & lanterns', 'Lebendiger Tag-Nacht-Zyklus, Regen, Stürme & Laternen'],
  // {n} is BIOMES, not GENERATED_BIOMES: the claim is how many landscapes the
  // game has (all of them reachable in the editor), and the generator draws from
  // a deliberately shorter list — see the comment on GENERATED_BIOMES.
  feat4: ['Level editor + generator, {n} landscapes', 'Level-Editor + Generator, {n} Landschaften'],
  feat5: ['Daily challenge & shareable seed codes', 'Tages-Challenge & teilbare Seed-Codes'],
  feat6: ['Medals, best times & feats', 'Medaillen, Bestzeiten & Auszeichnungen'],
  techNote: [
    'Hand-built for the web: TypeScript + Canvas, zero runtime dependencies, procedurally generated pixel art. No installs, no accounts — runs anywhere a browser does.',
    'Von Hand fürs Web gebaut: TypeScript und Canvas, keine Laufzeit-Abhängigkeiten, Pixel-Art, die im Code entsteht. Keine Installation, kein Konto, läuft überall, wo ein Browser läuft.',
  ],
  // "Baumeister" is taken: it is the DE name of the Builder role (role.builder),
  // so the player gets the neutral "Chef" instead of a job title from the crew.
  ctaHead: ['Ready, overseer?', 'Bereit, Chef?'],
  ctaBody: [
    'Mark a tree, drop a sawmill, watch the plan come together.',
    'Markier einen Baum, setz ein Sägewerk und schau zu, wie der Plan aufgeht.',
  ],
  footer: [
    'A loving homage to the genre. All code, pixel art and audio were made from scratch for this project.',
    'Eine liebevolle Hommage ans Genre. Code, Pixel-Art und Audio sind alle eigens für dieses Spiel entstanden.',
  ],
  // {v} is filled by frontdoor.ts from __VERSION__. The value stays out of the
  // table for the reason every other count does (cards #67/#25) and for one more:
  // this module must stay import-free and build-global-free so plain Node can load
  // it, and a bare __VERSION__ here would be undefined there.
  version: ['Version {v}', 'Version {v}'],
  brandOptions: ['Options', 'Optionen'],
};

export const FRONTDOOR_COPY_KEYS: string[] = Object.keys(S);
