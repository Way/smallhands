// Tiny i18n: a flat key table with [en, de] pairs, {param} interpolation and
// graceful fallback — t() returns the input unchanged when it isn't a known
// key, so user-authored text (custom level names, blurbs) passes through.
//
// The simulation never calls t(): levels and events carry KEYS, and only the
// display layer (HUD, overlays, editor) translates. That keeps saves, share
// codes and the headless tests language-independent.

export type Lang = 'en' | 'de';
export const LANGS: Lang[] = ['en', 'de'];

let current: Lang = 'en';

export function setLang(l: Lang): void {
  current = l;
}

export function getLang(): Lang {
  return current;
}

export function detectLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return nav?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const entry = D[key];
  let s = entry ? entry[current === 'de' ? 1 : 0] : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

// ---- the dictionary: [english, german] ---------------------------------------

const D: Record<string, [string, string]> = {
  // items
  'item.log': ['Log', 'Stamm'],
  'item.plank': ['Plank', 'Brett'],
  'item.stone': ['Stone', 'Stein'],
  'item.iron': ['Iron', 'Eisen'],
  'item.spear': ['Spear', 'Speer'],
  'item.shovel': ['Shovel', 'Spaten'],

  // roles (plural, as shown in the crew panel)
  'role.hauler': ['Haulers', 'Träger'],
  'role.builder': ['Builders', 'Baumeister'],
  'role.woodcutter': ['Woodcutters', 'Holzfäller'],
  'role.miner': ['Miners', 'Bergleute'],
  'role.digger': ['Diggers', 'Gräber'],

  // weather
  'weather.clear': ['Clear', 'Klar'],
  'weather.rain': ['Rain', 'Regen'],
  'weather.storm': ['Storm', 'Sturm'],

  // resource nodes
  'node.tree': ['Tree', 'Baum'],
  'node.boulder': ['Boulder', 'Felsblock'],
  'node.vein': ['Iron vein', 'Eisenader'],

  // buildings (inspect toasts)
  'building.townhall': ['Town Hall', 'Rathaus'],
  'building.sawmill': ['Sawmill', 'Sägewerk'],
  'building.forge': ['Forge', 'Schmiede'],
  'building.workshop': ['Workshop', 'Werkstatt'],
  'building.lift': ['Cargo Lift', 'Lastenaufzug'],
  'building.rope': ['Rope Anchor', 'Seilanker'],
  'building.lantern': ['Lantern', 'Laterne'],
  'building.goal': ['Delivery target', 'Lieferziel'],

  // tools
  'tool.select.label': ['Inspect', 'Prüfen'],
  'tool.select.desc': [
    'Inspect things. Drag, scroll or use WASD to pan; +/− or pinch to zoom.',
    'Untersuche Dinge. Ziehen, Scrollen oder WASD zum Schwenken; +/− oder Kneifen zum Zoomen.',
  ],
  'tool.harvest.label': ['Harvest', 'Ernten'],
  'tool.harvest.desc': [
    'Mark trees, boulders and iron veins for your crew to harvest. Click again to unmark.',
    'Markiere Bäume, Felsblöcke und Eisenadern für deinen Trupp. Erneut klicken zum Abwählen.',
  ],
  'tool.ladder.label': ['Ladder', 'Leiter'],
  'tool.ladder.desc': [
    'Build a ladder from 1 log per rung — or planks if you have no logs. Drag up a wall to raise a whole ladder at once. Smallhands climb ladders, but never while carrying goods!',
    'Baue eine Leiter — 1 Stamm je Sprosse, oder Bretter, wenn keine Stämme mehr da sind. Zieh an einer Wand hoch, um eine ganze Leiter auf einmal zu bauen. Smallhands klettern Leitern, aber nie mit Fracht!',
  ],
  'tool.platform.label': ['Bridge', 'Brücke'],
  'tool.platform.desc': [
    'Build a wooden bridge to span a gap or hole — drag to lay a run.',
    'Baue eine Holzbrücke über Lücken und Löcher — ziehen, um eine Strecke zu legen.',
  ],
  'tool.ramp.label': ['Ramp', 'Rampe'],
  'tool.ramp.desc': [
    'Build a diagonal ramp to climb a layer — drag up or down from solid ground. Loaded smallhands can walk it (unlike ladders).',
    'Baue eine diagonale Rampe eine Ebene hinauf — von festem Boden aus nach oben oder unten ziehen. Beladene Smallhands können sie begehen (anders als Leitern).',
  ],
  'tool.sawmill.label': ['Sawmill', 'Sägewerk'],
  'tool.sawmill.desc': [
    'Saws logs into planks. Needs a builder to construct it.',
    'Sägt Stämme zu Brettern. Ein Baumeister muss es errichten.',
  ],
  'tool.lift.label': ['Cargo Lift', 'Lastenaufzug'],
  'tool.lift.desc': [
    'Carries a worker and their cargo UP a cliff face. Place at the base of a cliff. Up only!',
    'Befördert einen Arbeiter samt Fracht eine Klippe HINAUF. An den Fuß der Klippe bauen. Nur aufwärts!',
  ],
  'tool.rope.label': ['Rope Anchor', 'Seilanker'],
  'tool.rope.desc': [
    'Anchors a rope at a cliff edge. Smallhands slide DOWN it — cargo and all. Down only!',
    'Verankert ein Seil an einer Klippenkante. Smallhands rutschen daran HINAB — samt Fracht. Nur abwärts!',
  ],
  'tool.hoist.label': ['Counterweight Hoist', 'Gegengewichts-Aufzug'],
  'tool.hoist.desc': [
    'Two cargo cars on a pulley at a cliff edge — the heavier side sinks. Send ballast down to raise goods up. Stone counts double!',
    'Zwei Lastenkörbe an einer Seilrolle über der Klippe — die schwerere Seite sinkt. Schicke Ballast hinab, um Waren hinaufzuheben. Stein zählt doppelt!',
  ],
  'tool.lantern.label': ['Lantern', 'Laterne'],
  'tool.lantern.desc': [
    'Raises a lantern post that lights the night around it. Smallhands harvest and build only where there is light — but brave builders will raise a lantern anywhere.',
    'Errichtet einen Laternenpfahl, der die Nacht ringsum erhellt. Smallhands ernten und bauen nur im Licht — aber mutige Baumeister errichten eine Laterne überall.',
  ],
  'tool.forge.label': ['Forge', 'Schmiede'],
  'tool.forge.desc': [
    'Forges spears from planks and iron. Needs a builder to construct it.',
    'Schmiedet Speere aus Brettern und Eisen. Ein Baumeister muss sie errichten.',
  ],
  'tool.workshop.label': ['Workshop', 'Werkstatt'],
  'tool.workshop.desc': [
    'Crafts shovels from a plank and iron — a digger needs one to dig. Needs a builder to construct it.',
    'Fertigt Spaten aus einem Brett und Eisen — ein Gräber braucht einen zum Graben. Ein Baumeister muss sie errichten.',
  ],
  'tool.dig.label': ['Dig', 'Graben'],
  'tool.dig.desc': [
    'Mark a tunnel or shaft to carve out — drag to paint a run. A digger with a shovel removes the ground over time. Bedrock and tiles under buildings stay put.',
    'Markiere einen Tunnel oder Schacht zum Ausheben — ziehen für eine Strecke. Ein Gräber mit Spaten trägt den Boden nach und nach ab. Grundgestein und Felder unter Gebäuden bleiben.',
  ],
  'tool.demolish.label': ['Demolish', 'Abreißen'],
  'tool.demolish.desc': [
    'Remove a ladder, bridge, ramp or building. Refunds half the cost.',
    'Entfernt Leiter, Brücke, Rampe oder Gebäude. Erstattet die halben Kosten.',
  ],

  // feats
  'feat.no-demolish.name': ['No Demolish', 'Nichts abgerissen'],
  'feat.no-demolish.desc': ['Win without demolishing anything', 'Gewinne, ohne etwas abzureißen'],
  'feat.light-touch.name': ['Light Touch', 'Sanfte Hand'],
  'feat.light-touch.desc': ['Leave half of all resource nodes untouched', 'Lass die Hälfte aller Ressourcen unangetastet'],

  // ---- campaign levels ---------------------------------------------------------
  'lvl1.name': ['First Steps', 'Erste Schritte'],
  'lvl1.desc': [
    'Meet your smallhands. Chop wood, saw planks, and load the trade caravan.',
    'Lerne deine Smallhands kennen. Fälle Holz, säge Bretter und belade die Handelskarawane.',
  ],
  'lvl1.hint.welcome': [
    'Welcome, overseer! You never control the <b>smallhands</b> directly — you shape the world, they do the work. Select the <b>Harvest</b> tool and mark a few trees.',
    'Willkommen, Vorsteher! Du steuerst die <b>Smallhands</b> nie direkt — du formst die Welt, sie erledigen die Arbeit. Wähle das <b>Ernten</b>-Werkzeug und markiere ein paar Bäume.',
  ],
  'lvl1.hint.sawmill': [
    'Logs are piling up! Place a <b>Sawmill</b> (costs 6 logs) on flat ground. A builder will construct it, then haulers will feed it logs — 1 log becomes 2 planks.',
    'Die Stämme stapeln sich! Setze ein <b>Sägewerk</b> (kostet 6 Stämme) auf ebenen Boden. Ein Baumeister errichtet es, dann füttern es die Träger — aus 1 Stamm werden 2 Bretter.',
  ],
  'lvl1.hint.deliver': [
    'Planks are flowing! Haulers automatically carry them to the <b>caravan</b> on the right. Fill the order to finish the level.',
    'Die Bretter fließen! Träger bringen sie automatisch zur <b>Karawane</b> rechts. Erfülle den Auftrag, um das Level abzuschließen.',
  ],
  'lvl2.name': ['The Cliff Shrine', 'Der Klippenschrein'],
  'lvl2.desc': [
    'The shrine sits on a high ledge — and loaded smallhands refuse ladders. Send goods up anyway.',
    'Der Schrein thront auf einem hohen Felsvorsprung — und beladene Smallhands verweigern Leitern. Bring die Waren trotzdem hinauf.',
  ],
  'lvl2.hint.ledge': [
    'The shrine is <b>7 tiles up</b> that cliff. Ladders get empty-handed smallhands up and down — but a hauler carrying stone <b>will not touch a ladder</b>.',
    'Der Schrein liegt <b>7 Felder</b> über der Klippe. Leitern bringen leere Hände hinauf und hinab — aber ein Träger mit Stein <b>rührt keine Leiter an</b>.',
  ],
  'lvl2.hint.lift': [
    'To move goods up, build a <b>Cargo Lift</b> on the ground right beside the cliff face. It hoists a loaded hauler to the top. Add a <b>ladder</b> nearby so they can climb back down for the next load!',
    'Um Waren nach oben zu bringen, baue einen <b>Lastenaufzug</b> direkt an der Klippenwand. Er hievt einen beladenen Träger nach oben. Stelle eine <b>Leiter</b> daneben, damit er für die nächste Ladung hinabklettern kann!',
  ],
  'lvl3.name': ['Iron in the Deep', 'Eisen in der Tiefe'],
  'lvl3.desc': [
    'Iron waits at the bottom of an old pit. Upgrade the town hall, forge spears for the garrison.',
    'In einer alten Grube wartet Eisen. Baue das Rathaus aus und schmiede Speere für die Garnison.',
  ],
  'lvl3.hint.pit': [
    'Iron veins glitter in <b>the pit</b>. Empty-handed smallhands can hop down safely (up to 5 tiles) — but hauling iron out again is the real puzzle. Plan your lift money!',
    'In <b>der Grube</b> glitzern Eisenadern. Mit leeren Händen springen Smallhands sicher hinab (bis zu 5 Felder) — aber das Eisen wieder herauszuschaffen ist das eigentliche Rätsel. Plane dein Aufzugs-Budget!',
  ],
  'lvl3.hint.reserve': [
    'Stone fills the order <b>and</b> builds your Cargo Lift and Forge. Click the <b>stone counter</b> up top to <b>keep some back</b> before it all ships out.',
    'Stein erfüllt den Auftrag <b>und</b> baut Lastenaufzug und Schmiede. Klicke oben auf den <b>Stein-Zähler</b>, um <b>etwas zurückzubehalten</b>, bevor alles verschifft wird.',
  ],
  'lvl3.hint.th2': [
    'The <b>Forge</b> and <b>Cargo Lift</b> need Town Hall level 2. Stockpile planks and stone, then press <b>Upgrade</b> in the crew panel.',
    '<b>Schmiede</b> und <b>Lastenaufzug</b> brauchen Rathaus-Stufe 2. Lagere Bretter und Stein, dann drücke <b>Ausbauen</b> im Trupp-Panel.',
  ],
  'lvl3.hint.forge': [
    'Town Hall upgraded! Build a <b>Forge</b> — it turns 1 plank + 1 iron into a spear for the garrison.',
    'Rathaus ausgebaut! Baue eine <b>Schmiede</b> — sie macht aus 1 Brett + 1 Eisen einen Speer für die Garnison.',
  ],
  'lvl4.name': ['The Summit Beacon', 'Das Gipfelfeuer'],
  'lvl4.desc': [
    'A beacon must be raised on the mountain. Three terraces, one grand supply line.',
    'Auf dem Berg soll ein Leuchtfeuer entstehen. Drei Terrassen, eine große Versorgungslinie.',
  ],
  'lvl4.hint.summit': [
    'The <b>beacon site</b> is three terraces up. Every plank, stone and spear must climb the whole mountain — chain lifts and ladders into one supply line.',
    'Die <b>Leuchtfeuer-Stelle</b> liegt drei Terrassen hoch. Jedes Brett, jeder Stein, jeder Speer muss den ganzen Berg hinauf — verkette Aufzüge und Leitern zu einer Versorgungslinie.',
  ],
  'lvl4.hint.chain': [
    'Tip: lifts only need Town Hall 2 — but each terrace needs its own lift. Consider moving production <b>up the mountain</b> instead of hauling everything from below.',
    'Tipp: Aufzüge brauchen nur Rathaus 2 — aber jede Terrasse braucht ihren eigenen. Verlagere die Produktion lieber <b>den Berg hinauf</b>, statt alles von unten zu schleppen.',
  ],
  'lvl4.hint.ramp': [
    'Short steps a lift refuses? Build a <b>Ramp</b> — drag a diagonal from solid ground. Loaded smallhands walk ramps (unlike ladders), up <i>and</i> down.',
    'Kleine Stufen, die ein Aufzug verschmäht? Baue eine <b>Rampe</b> — ziehe eine Diagonale von festem Boden aus. Beladene Smallhands begehen Rampen (anders als Leitern), hinauf <i>und</i> hinab.',
  ],
  'lvl5.name': ['The Ford', 'Die Furt'],
  'lvl5.desc': [
    'A river splits the valley — smallhands cannot swim, and goods dropped in the water are gone for good.',
    'Ein Fluss teilt das Tal — Smallhands können nicht schwimmen, und Waren im Wasser sind für immer verloren.',
  ],
  'lvl5.hint.river': [
    'A <b>river</b> cuts the valley in two. Smallhands cannot swim — and anything dropped in the water <b>sinks forever</b>. The caravan waits on the far side.',
    'Ein <b>Fluss</b> zerschneidet das Tal. Smallhands können nicht schwimmen — und alles, was ins Wasser fällt, <b>versinkt für immer</b>. Die Karawane wartet am anderen Ufer.',
  ],
  'lvl5.hint.bridge': [
    "Span the river with the <b>Bridge</b> tool: start on the bank's edge and <b>drag straight across</b> the water. One plank per tile — save enough!",
    'Überspanne den Fluss mit dem <b>Brücken</b>-Werkzeug: Beginne an der Uferkante und <b>ziehe gerade hinüber</b>. Ein Brett pro Feld — spare genug an!',
  ],
  'lvl6.name': ['Monsoon Hollow', 'Die Monsunsenke'],
  'lvl6.desc': [
    'The monsoon rolls in on a schedule. Wet axes bite slow — read the forecast and plan the dry spells.',
    'Der Monsun kommt nach Fahrplan. Nasse Äxte beißen langsam — lies die Vorhersage und plane die Trockenphasen.',
  ],
  'lvl6.hint.forecast': [
    'See the <b>forecast</b> up top? The monsoon is punctual. In the <b>rain</b>, chopping and mining take almost twice as long — fell in the sun, saw in the rain.',
    'Siehst du die <b>Vorhersage</b> oben? Der Monsun ist pünktlich. Im <b>Regen</b> dauern Fällen und Abbauen fast doppelt so lang — fälle bei Sonne, säge bei Regen.',
  ],
  'lvl6.hint.pond': [
    'The hollow holds a <b>pond</b> — and the caravan waits beyond it. Three <b>Bridge</b> planks across the gap open the road east.',
    'In der Senke liegt ein <b>Teich</b> — und die Karawane wartet dahinter. Drei <b>Brücken</b>-Bretter über die Lücke öffnen den Weg nach Osten.',
  ],
  'lvl7.name': ['Lantern Ridge', 'Laternengrat'],
  'lvl7.desc': [
    'Night on the ridge. Smallhands work only in the light — push the darkness back, lantern by lantern.',
    'Nacht über dem Grat. Smallhands arbeiten nur im Licht — dräng die Dunkelheit zurück, Laterne um Laterne.',
  ],
  'lvl7.hint.dark': [
    'It is <b>pitch dark</b> beyond the town fires. Smallhands only harvest and build <b>in the light</b> — but a builder will raise a <b>Lantern</b> (1 log + 1 stone) anywhere. Chain lanterns toward the iron.',
    'Jenseits der Stadtfeuer ist es <b>stockfinster</b>. Smallhands ernten und bauen nur <b>im Licht</b> — aber ein Baumeister errichtet eine <b>Laterne</b> (1 Stamm + 1 Stein) überall. Verkette Laternen bis zum Eisen.',
  ],
  'lvl7.hint.forge2': [
    'The caravan wants <b>spears</b>: light a path to the veins, then build a <b>Forge</b> in a lit spot — 1 plank + 1 iron each.',
    'Die Karawane will <b>Speere</b>: Beleuchte den Weg zu den Adern und baue dann eine <b>Schmiede</b> an einer hellen Stelle — je 1 Brett + 1 Eisen.',
  ],
  'lvl8.name': ['The Rising Tide', 'Die steigende Flut'],
  'lvl8.desc': [
    'Every rainfall lifts the water one step higher. The lowlands are rich — loot them before the tide takes them.',
    'Jeder Regen hebt das Wasser eine Stufe. Das Tiefland ist reich — plündere es, bevor die Flut es holt.',
  ],
  'lvl8.hint.tide': [
    'Storm clouds hang over the lowlands — <b>every rainfall raises the water one step</b>, and it never goes back down. The forecast tells you exactly when. The basin drowns first!',
    'Sturmwolken hängen über dem Tiefland — <b>jeder Regen hebt das Wasser eine Stufe</b>, und es sinkt nie wieder. Die Vorhersage sagt dir genau, wann. Das Becken ertrinkt zuerst!',
  ],
  'lvl8.hint.rampout': [
    'The hills are three tiles apart — <b>ramps</b> carry loaded smallhands up and down. Anyone caught by the tide scrambles home, dropping their load into the drink.',
    'Zwischen den Ebenen liegen drei Felder Höhe — <b>Rampen</b> tragen beladene Smallhands hinauf und hinab. Wen die Flut erwischt, der rettet sich heim — und seine Last versinkt.',
  ],
  'lvl8.hint.bridge2': [
    'Once the basin drowns, the only road east is a <b>bridge at shelf height</b> across the new lake. Anchor it on the shelf edge and drag straight over.',
    'Ist das Becken ertrunken, führt der einzige Weg nach Osten über eine <b>Brücke auf Absatzhöhe</b> über den neuen See. Verankere sie an der Absatzkante und ziehe gerade hinüber.',
  ],
  'lvl9.name': ['Tempest Summit', 'Sturmgipfel'],
  'lvl9.desc': [
    'The grand finale: a night ascent through rain and storm. Lifts stop in the gusts — climb between the weathers.',
    'Das große Finale: ein Nachtaufstieg durch Regen und Sturm. Aufzüge stoppen in den Böen — klettere zwischen den Wettern.',
  ],
  'lvl9.hint.finale': [
    'The last ascent: <b>night</b>, <b>rain</b> and <b>storm</b> in turn. Lanterns light the terraces, rain slows the harvest — and in a <b>storm the lifts lock their brakes</b>. Watch the forecast and move cargo in the calm windows.',
    'Der letzte Aufstieg: <b>Nacht</b>, <b>Regen</b> und <b>Sturm</b> im Wechsel. Laternen erhellen die Terrassen, Regen bremst die Ernte — und im <b>Sturm verriegeln die Aufzüge ihre Bremsen</b>. Behalte die Vorhersage im Blick und bewege Fracht in den ruhigen Fenstern.',
  ],
  'lvl9.hint.upgrade2': [
    'The Forge (and any lift) needs <b>Town Hall 2</b> — bank 8 planks and 6 stone early. Ramps climb in any weather; lifts are faster but sit out every storm.',
    'Die Schmiede (und jeder Aufzug) braucht <b>Rathaus 2</b> — lege früh 8 Bretter und 6 Steine zurück. Rampen steigen bei jedem Wetter; Aufzüge sind schneller, setzen aber jeden Sturm aus.',
  ],
  'lvl9.hint.stormplan': [
    'A <b>storm</b> is rolling in! Haulers will queue at locked lifts until it passes — ramps keep walking, lifts wait it out.',
    'Ein <b>Sturm</b> zieht auf! Träger warten an verriegelten Aufzügen, bis er vorbei ist — Rampen laufen weiter, Aufzüge sitzen ihn aus.',
  ],

  // ---- HUD -----------------------------------------------------------------------
  'hud.deliver': ['Deliver', 'Liefern'],
  'hud.crew': ['Crew', 'Trupp'],
  'crew.idle': ['{n} idle', '{n} frei'],
  'crew.needDigger': ['⚠ Assign a digger for the dig plan', '⚠ Weise einen Gräber für den Grabplan zu'],
  'crew.needShovel': ['⚠ Craft a shovel in the Workshop', '⚠ Fertige einen Spaten in der Werkstatt'],
  'hud.weather': ['Weather', 'Wetter'],
  'hud.then': ['then', 'dann'],
  'wx.flood': ['🌊 rain lifts the tide', '🌊 Regen hebt die Flut'],
  'wx.floodTitle': [
    'Every rainfall raises the water one step — for good.',
    'Jeder Regen hebt das Wasser eine Stufe — für immer.',
  ],
  'hud.paused': ['Paused', 'Pausiert'],
  'hud.clockTitle': [
    'Time on this map — runs with the game speed, so it holds while paused.',
    'Zeit auf dieser Karte — läuft mit dem Spieltempo und hält in der Pause.',
  ],
  'hud.zoom': ['zoom', 'Zoom'],
  'hud.upgradeBtn': ['Upgrade Town Hall → {n}', 'Rathaus ausbauen → {n}'],
  'hud.thMax': ['Town Hall {n} (max)', 'Rathaus {n} (max.)'],
  'hud.upgrading': ['Upgrading… {p}%', 'Ausbau… {p} %'],
  'hud.chipTitle': ['{name} — click to keep some in store', '{name} — klicke, um etwas im Lager zu behalten'],
  'hud.keep': ['Keep', 'Behalten'],
  'hud.keepAll': ['All', 'Alle'],
  'hud.keepReset': ['Reset', 'Zurücksetzen'],
  'hud.keepNote': ['Haulers ship only the surplus to the caravan.', 'Träger liefern nur den Überschuss zur Karawane.'],
  'hud.inStore': ['{name} · {n} in store', '{name} · {n} im Lager'],
  // touch confirm bar (tap to aim, ✓ to commit) + touch-only hints
  'hud.ctaBuild': ['Build', 'Bauen'],
  'hud.ctaMark': ['Mark', 'Markieren'],
  'hud.ctaUnmark': ['Unmark', 'Abwählen'],
  'hud.ctaDemolish': ['Demolish', 'Abreißen'],
  'hud.ctaDig': ['Dig', 'Graben'],
  'hud.tapToAim': ['Tap the map to aim', 'Tippe zum Zielen auf die Karte'],
  'hud.tapExtend': ['Tap further along to extend', 'Tippe weiter entlang, um zu verlängern'],
  'hud.tiles': ['{a}/{b} tiles', '{a}/{b} Felder'],
  'hud.speedMenu': ['Speed and zoom', 'Tempo und Zoom'],
  'hud.rotateHint': [
    'Tip: turn your device sideways to see more of the world.',
    'Tipp: Im Querformat siehst du mehr von der Welt.',
  ],
  'tt.uses': ['Uses', 'Braucht'],
  'tt.makes': ['Makes', 'Erzeugt'],
  'tt.perBatch': ['⏱ {n}s per batch', '⏱ {n} s pro Durchgang'],
  'tt.requiresTh': ['Requires Town Hall level {n}', 'Benötigt Rathaus-Stufe {n}'],
  'hud.needs': ['<b>{label}</b> needs', '<b>{label}</b> braucht'],
  'th.status': ['<b>Town Hall</b> · Level {n} · {a}/{b} crew', '<b>Rathaus</b> · Stufe {n} · {a}/{b} im Trupp'],
  'th.upgradingBody': ['Upgrading… {p}% — a builder is on the way.', 'Ausbau… {p} % — ein Baumeister ist unterwegs.'],
  'th.maxBody': ['Fully upgraded — max crew reached.', 'Voll ausgebaut — maximale Truppgröße erreicht.'],
  'th.upgradeTo': ['Upgrade → Level {n} ({m} crew)', 'Ausbau → Stufe {n} ({m} im Trupp)'],
  'th.upgradeShort': ['Upgrade', 'Ausbauen'],
  'th.hover': ['<b>Town Hall</b> · Lv {n}', '<b>Rathaus</b> · St. {n}'],
  'th.hoverCrew': ['Crew {a}/{b}', 'Trupp {a}/{b}'],
  'th.hoverClick': ['Click: upgrade → Lv {n} ({m} crew)', 'Klick: Ausbau → St. {n} ({m} im Trupp)'],
  'th.hoverMax': ['Max level', 'Höchste Stufe'],
  'ui.dismiss': ['dismiss', 'ausblenden'],

  // ---- menus, overlays, toasts ----------------------------------------------------
  'btn.play': ['Play', 'Spielen'],
  'btn.continue': ['Continue', 'Weiter'],
  'btn.title': ['Home', 'Startseite'],
  'btn.cancel': ['Cancel', 'Abbrechen'],
  'btn.resume': ['▶ Resume {name}', '▶ Weiter: {name}'],
  'resume.title': ['Paused while you were away', 'Pausiert, während du weg warst'],
  'resume.body': [
    'The game paused when the tab lost focus, so nothing ran without you.',
    'Das Spiel wurde pausiert, als der Tab den Fokus verlor — es lief nichts ohne dich weiter.',
  ],
  'resume.btn': ['▶ Resume', '▶ Weiter'],
  'btn.levels': ['Levels', 'Level'],
  'menu.levels': ['☰ Levels', '☰ Level'],
  'menu.restart': ['↺ Restart', '↺ Neustart'],
  'menu.options': ['⚙ Options', '⚙ Optionen'],
  'select.title': ['Choose a level', 'Wähle ein Level'],
  'shelf.gold': ['<b>{a}/{b}</b> campaign gold', '<b>{a}/{b}</b> Kampagnen-Gold'],
  'lvl10.name': ['The Turning Wheel', 'Das drehende Rad'],
  'lvl10.desc': [
    'The caravan waits below the mining shelf. Cargo cannot survive the drop — but the old counterweight wheel can lower it gently.',
    'Die Karawane wartet unterhalb der Bergterrasse. Fracht überlebt den Absturz nicht — doch das alte Gegengewichtsrad senkt sie sanft hinab.',
  ],
  'lvl10.hint.wheel': [
    'A <b>Counterweight Hoist</b> (key H) hangs two cargo cars over a cliff edge. One law: <b>the heavier side sinks</b>. Build one at the shelf edge.',
    'Ein <b>Gegengewichts-Aufzug</b> (Taste H) hängt zwei Lastenkörbe über die Klippenkante. Ein Gesetz: <b>die schwerere Seite sinkt</b>. Baue einen an der Terrassenkante.',
  ],
  'lvl10.hint.route': [
    'Tap the hoist with <b>Inspect</b> and choose what to <b>send down</b> — a loaded top car needs no counterweight; down is free.',
    'Tippe den Aufzug mit <b>Prüfen</b> an und wähle, was <b>hinabfahren</b> soll — ein beladener oberer Korb braucht kein Gegengewicht; abwärts ist frei.',
  ],
  'lvl10.hint.hop': [
    'Empty-handed smallhands simply hop down short cliffs. Someone should wait below to carry the goods to the caravan.',
    'Smallhands mit leeren Händen hüpfen kurze Klippen einfach hinab. Unten sollte jemand warten, der die Waren zur Karawane trägt.',
  ],
  'lvl11.name': ['Ballast Ridge', 'Ballastgrat'],
  'lvl11.desc': [
    'The caravan camps high on the ridge, the timber grows in the valley. Every plank that rides up must be paid for in falling stone.',
    'Die Karawane lagert hoch auf dem Grat, das Holz wächst im Tal. Jedes Brett, das hinauffährt, wird mit fallendem Stein bezahlt.',
  ],
  'lvl11.hint.up': [
    'This time the cargo must go <b>UP</b>. Send planks to the hoist’s bottom car — the wheel will only turn once the top car is <b>heavier</b>.',
    'Diesmal muss die Fracht <b>HINAUF</b>. Schicke Bretter in den unteren Korb — das Rad dreht sich erst, wenn der obere Korb <b>schwerer</b> ist.',
  ],
  'lvl11.hint.ballast': [
    'Mark the ridge boulders: haulers load loose <b>stone as ballast</b> on their own (stone counts double). Nothing is lost — the ballast just moves downhill.',
    'Markiere die Felsen auf dem Grat: Träger laden losen <b>Stein als Ballast</b> von selbst (Stein zählt doppelt). Nichts geht verloren — der Ballast wandert nur talwärts.',
  ],
  'lvl11.hint.backpath': [
    'The old miners left an <b>adit</b> in the cliff foot — a tunnel to a ladder shaft. Empty hands climb it freely; cargo will not touch a ladder — it rides the wheel or not at all.',
    'Die alten Bergleute ließen einen <b>Stollen</b> am Klippenfuß zurück — ein Tunnel zu einem Leiterschacht. Leere Hände klettern frei hindurch; Fracht rührt keine Leiter an — sie fährt mit dem Rad oder gar nicht.',
  ],
  'lvl12.name': ['The High Forge', 'Die Hohe Schmiede'],
  'lvl12.desc': [
    'Iron and stone crown the plateau; the timber stays below. Raise a forge in the sky — and mind the storms, for they seize the wheel.',
    'Eisen und Stein krönen das Plateau; das Holz bleibt unten. Errichte eine Schmiede im Himmel — und achte auf die Stürme, denn sie packen das Rad.',
  ],
  'lvl12.hint.highforge': [
    'The caravan wants <b>spears</b>. Forge them up top where the iron is: hoist planks up on stone ballast, and build the forge beside the veins.',
    'Die Karawane will <b>Speere</b>. Schmiede sie oben, wo das Eisen liegt: Hebe Bretter mit Steinballast hinauf und baue die Schmiede neben den Adern.',
  ],
  'lvl12.hint.stormbrake': [
    'The storm has seized the hoist’s brake! Watch the forecast — chop, mine and forge through the gusts, ship in the calm.',
    'Der Sturm hat die Bremse des Aufzugs gepackt! Achte auf die Vorhersage — hacke, grabe und schmiede im Sturm, verschiffe in der Ruhe.',
  ],
  'lvl13.name': ['The Buried Seam', 'Die vergrabene Ader'],
  'lvl13.desc': [
    'Iron and the caravan lie sealed in a gallery beneath the meadow. Craft a shovel, sink a shaft, and tunnel through to them.',
    'Eisen und die Karawane liegen versiegelt in einem Stollen unter der Wiese. Fertige einen Spaten, teufe einen Schacht ab und grabe dich zu ihnen durch.',
  ],
  'lvl13.hint.seam': [
    'The iron seam and the caravan are <b>buried</b> below. Build a <b>Workshop</b> (Town Hall 2) and it will craft a <b>shovel</b> from a plank and iron — a digger needs one.',
    'Die Eisenader und die Karawane sind <b>vergraben</b>. Baue eine <b>Werkstatt</b> (Rathaus 2) — sie fertigt aus Brett und Eisen einen <b>Spaten</b>, den ein Gräber braucht.',
  ],
  'lvl13.hint.shaft': [
    'A shovel is ready! Assign a <b>Digger</b> in the crew panel, then use the <b>Dig</b> tool to sink a <b>vertical shaft</b> straight down to the gallery.',
    'Ein Spaten ist fertig! Weise im Trupp-Panel einen <b>Gräber</b> zu und teufe mit dem <b>Grab</b>-Werkzeug einen <b>senkrechten Schacht</b> hinab zum Stollen.',
  ],
  'lvl13.hint.tunnel': [
    'Down in the gallery, drag the <b>Dig</b> tool sideways to carve a <b>tunnel</b> to the iron seam and the caravan. Miners work the vein; haulers carry the iron along the flat.',
    'Im Stollen ziehst du das <b>Grab</b>-Werkzeug seitwärts für einen <b>Tunnel</b> zur Eisenader und zur Karawane. Bergleute bauen die Ader ab; Träger tragen das Eisen eben hinüber.',
  ],

  // world map (level select)
  'map.terr1': ['Home Meadows', 'Heimatwiesen'],
  'map.terr2': ['Storm & Tide', 'Sturm & Flut'],
  'map.terr3': ['Weight & Wheel', 'Gewicht & Rad'],
  'map.terr4': ['Shaft & Seam', 'Schacht & Ader'],
  'map.lockedHint': ['Finish {name} to unlock', 'Schließe {name} ab zum Freischalten'],
  'dev.badge': ['🔧 DEV · all levels unlocked', '🔧 DEV · alle Level freigeschaltet'],
  'map.nodeAria': ['Level {n}: {name} — {status}', 'Level {n}: {name} — {status}'],
  'map.daily.aria': ['Daily Challenge — {status}', 'Tages-Challenge — {status}'],
  'map.progress': ['{done} of {total} cleared', '{done} von {total} geschafft'],
  'map.facts.tools': ['{n} tools', '{n} Werkzeuge'],
  'map.tag.night': ['Night', 'Nacht'],
  'map.tag.rain': ['Rain', 'Regen'],
  'map.tag.storm': ['Storm', 'Sturm'],
  'map.tag.tide': ['Rising tide', 'Steigende Flut'],
  'legend.mine': ['My levels', 'Meine Level'],
  'drawer.empty': [
    'No levels yet — build one in the editor or import a share code.',
    'Noch keine Level — baue eins im Editor oder importiere einen Code.',
  ],

  'win.campaign3': [
    '<b>⚙ Campaign 3 unlocked — Weight & Wheel!</b><br/>Two cars on a pulley and one law: the heavier side sinks. Send ballast down to raise your cargo to the heights.',
    '<b>⚙ Kampagne 3 freigeschaltet — Gewicht & Rad!</b><br/>Zwei Körbe an einer Seilrolle und ein Gesetz: die schwerere Seite sinkt. Schicke Ballast hinab, um deine Fracht in die Höhen zu heben.',
  ],

  'status.ready': ['Ready', 'Bereit'],
  'status.locked': ['Locked', 'Gesperrt'],
  'status.done': ['✓ Complete', '✓ Geschafft'],
  'card.best': ['Best', 'Bestzeit'],
  'card.gold': ['Gold', 'Gold'],
  'medal.gold': ['Gold', 'Gold'],
  'medal.silver': ['Silver', 'Silber'],
  'medal.bronze': ['Bronze', 'Bronze'],
  'slot.medal': ['{tier} medal', '{tier}-Medaille'],
  'slot.none': ['No medal yet', 'Noch keine Medaille'],
  'daily.name': ['Daily Challenge', 'Tages-Challenge'],
  'daily.desc': [
    '{label} · difficulty ★{d}. One shared seed per day — same mountain for everyone.',
    '{label} · Schwierigkeit ★{d}. Ein gemeinsamer Seed pro Tag — derselbe Berg für alle.',
  ],
  'daily.title': ['Daily · {label}', 'Täglich · {label}'],
  'daily.diff.easy': ['Easy', 'Leicht'],
  'daily.diff.med': ['Medium', 'Mittel'],
  'daily.diff.hard': ['Hard', 'Schwer'],
  'daily.tag.proc': ['Procedural', 'Prozedural'],
  'daily.tag.shared': ['Shared seed', 'Gemeinsamer Seed'],
  'gen.cardName': ['Generate a level', 'Level generieren'],
  'editor.cardName': ['Level editor', 'Level-Editor'],
  'import.cardName': ['Import code', 'Code importieren'],
  'import.prompt': ['Paste a Smallhands level code:', 'Füge einen Smallhands-Level-Code ein:'],
  'import.error': [
    'That code could not be read — make sure the whole SMH1.… string was copied.',
    'Der Code konnte nicht gelesen werden — kopiere die komplette SMH1.…-Zeichenkette.',
  ],
  'custom.defaultDesc': ['A custom level.', 'Ein eigenes Level.'],
  'action.edit': ['Edit this level', 'Level bearbeiten'],
  'action.copy': ['Copy share code', 'Teilen-Code kopieren'],
  'action.delete': ['Delete this level', 'Level löschen'],
  'confirm.delete': ['Delete "{name}"? This cannot be undone.', '„{name}" löschen? Das kann nicht rückgängig gemacht werden.'],
  'btn.delete': ['Delete level', 'Level löschen'],
  'confirm.abandonNamed': [
    'Abandon "{name}"? Progress in the current level will be lost.',
    '„{name}" aufgeben? Der Fortschritt im aktuellen Level geht verloren.',
  ],
  'confirm.abandon': ['Abandon the current level?', 'Das aktuelle Level aufgeben?'],
  'btn.abandon': ['Abandon level', 'Level aufgeben'],
  'confirm.restart': [
    'Restart "{name}"? Progress in the current level will be lost.',
    '„{name}" neu starten? Der Fortschritt im aktuellen Level geht verloren.',
  ],
  'btn.restart': ['Restart level', 'Level neu starten'],
  'confirm.leaveEditor': ['Leave the editor? Unsaved changes will be lost.', 'Editor verlassen? Ungespeicherte Änderungen gehen verloren.'],
  'btn.leaveEditor': ['Leave editor', 'Editor verlassen'],
  'gen.title': [
    '<b>Generate a level</b><br/>The same seed and difficulty always build the same level.',
    '<b>Level generieren</b><br/>Derselbe Seed mit derselben Schwierigkeit baut immer dasselbe Level.',
  ],
  'gen.difficulty': ['Difficulty', 'Schwierigkeit'],
  'diff.1': ['★1 Stroll', '★1 Spaziergang'],
  'diff.2': ['★2 Hike', '★2 Wanderung'],
  'diff.3': ['★3 Climb', '★3 Kletterpartie'],
  'diff.4': ['★4 Expedition', '★4 Expedition'],
  'diff.5': ['★5 Ascent', '★5 Gipfelsturm'],
  'gen.play': ['▶ Play', '▶ Spielen'],
  'gen.openEditor': ['✎ Open in editor', '✎ Im Editor öffnen'],
  'gen.reroll': ['New random seed', 'Neuer Zufalls-Seed'],
  'win.title': ['Level complete!', 'Level geschafft!'],
  'cer.line': [' · {time} · Crew {n} · Town Hall {m}', ' · {time} · Trupp {n} · Rathaus {m}'],
  'win.orderDelivered': ['ORDER DELIVERED', 'LIEFERUNG ERFÜLLT'],
  'medalname.gold': ['GOLD MEDAL', 'GOLDMEDAILLE'],
  'medalname.silver': ['SILVER MEDAL', 'SILBERMEDAILLE'],
  'medalname.bronze': ['BRONZE MEDAL', 'BRONZEMEDAILLE'],
  'win.firstClear': ['★ First clear', '★ Erstmals geschafft'],
  'win.newRecord': ['★ New record', '★ Neuer Rekord'],
  'win.beatBronze': ['Beat the bronze time for a medal', 'Unterbiete die Bronze-Zeit für eine Medaille'],
  'feat.done': ['{desc} — done!', '{desc} — geschafft!'],
  'win.next': ['Next: {name} →', 'Weiter: {name} →'],
  'win.campaign2': [
    '<b>🌩 Campaign 2 unlocked — Storm & Tide!</b><br/>Rivers to bridge, tides that rise with every rainfall, storms that stop the lifts — and nights worked by lantern light.',
    '<b>🌩 Kampagne 2 freigeschaltet — Sturm & Flut!</b><br/>Flüsse zum Überbrücken, Fluten, die mit jedem Regen steigen, Stürme, die die Aufzüge stoppen — und Nächte im Laternenschein.',
  ],
  'win.campaign4': [
    '<b>⛏ Campaign 4 unlocked — Shaft &amp; Seam!</b><br/>Craft shovels in the Workshop, assign Diggers, and carve tunnels and shafts to buried iron and sealed caravans.',
    '<b>⛏ Kampagne 4 freigeschaltet — Schacht &amp; Ader!</b><br/>Fertige Spaten in der Werkstatt, weise Gräber zu und schlage Tunnel und Schächte zu vergrabenem Eisen und versiegelten Karawanen.',
  ],
  'win.allDone': [
    '<b>You have finished every campaign!</b><br/>The workshop awaits: daily challenges, generated mountains and your own creations.',
    '<b>Du hast alle Kampagnen abgeschlossen!</b><br/>Die Werkstatt wartet: Tages-Challenges, generierte Berge und eigene Kreationen.',
  ],
  'win.again': ['🎲 Another one', '🎲 Noch eins'],
  'win.backToEditor': ['✎ Back to editor', '✎ Zurück zum Editor'],
  'toast.upgraded': [
    '<b>Town Hall level {n}!</b> New buildings unlocked and a bigger crew.',
    '<b>Rathaus Stufe {n}!</b> Neue Gebäude freigeschaltet und ein größerer Trupp.',
  ],
  'toast.locked': ['<b>{label}</b> unlocks at Town Hall level {n}.', '<b>{label}</b> wird mit Rathaus-Stufe {n} freigeschaltet.'],
  'toast.wx.clear': ['☀️ The sky clears — full speed ahead.', '☀️ Der Himmel klart auf — volle Kraft voraus.'],
  'toast.wx.rain': ['🌧️ <b>Rain</b> sets in — chopping and mining slow down.', '🌧️ <b>Regen</b> setzt ein — Fällen und Abbauen dauern länger.'],
  'toast.wx.rainFlood': [
    '🌧️ <b>Rain</b> — harvesting slows, and <b>the water rises!</b>',
    '🌧️ <b>Regen</b> — die Ernte wird langsamer, und <b>das Wasser steigt!</b>',
  ],
  'toast.wx.storm': [
    '🌩️ <b>Storm!</b> Cargo lifts lock their brakes until it passes.',
    '🌩️ <b>Sturm!</b> Die Lastenaufzüge verriegeln ihre Bremsen, bis er vorüberzieht.',
  ],
  'toast.flood.one': [
    '🌊 <b>The tide swallows the low ground!</b> A smallhand scrambled home, dropping their load.',
    '🌊 <b>Die Flut verschlingt das Tiefland!</b> Ein Smallhand rettete sich nach Hause und verlor seine Last.',
  ],
  'toast.flood.many': [
    '🌊 <b>The tide swallows the low ground!</b> {n} smallhands scrambled home, dropping their loads.',
    '🌊 <b>Die Flut verschlingt das Tiefland!</b> {n} Smallhands retteten sich nach Hause und verloren ihre Lasten.',
  ],
  'inspect.left': ['<b>{name}</b> — {n} left.', '<b>{name}</b> — noch {n}.'],
  'inspect.marked': ['Marked for harvest.', 'Zum Abbau markiert.'],
  'inspect.unmarked': ['Use the Harvest tool to mark it.', 'Markiere sie mit dem Ernten-Werkzeug.'],
  'inspect.blueprint': [' (under construction)', ' (im Bau)'],
  // live hover-to-inspect tooltips (buildings + resource nodes)
  'inspect.yieldLeft': ['{n} left', 'noch {n}'],
  'inspect.buildingPct': ['Building… {p}%', 'Bau… {p} %'],
  'inspect.working': ['Working {p}%', 'Arbeitet {p} %'],
  'inspect.idleNeeds': ['Idle · needs {name}', 'Leerlauf · braucht {name}'],
  'inspect.idleReady': ['Idle · ready', 'Leerlauf · bereit'],
  'inspect.lift': ['Lifts crew up {n} tiles · up only', 'Hebt Trupp {n} Felder hoch · nur aufwärts'],
  'inspect.carrying': ['Carrying…', 'Trägt…'],
  'inspect.idle': ['Idle', 'Leerlauf'],
  'inspect.rope': ['Crew slide down {n} tiles · down only', 'Trupp rutscht {n} Felder hinab · nur abwärts'],
  'inspect.hoist': ['Trades weight over a {n}-tile drop · heavier side sinks', 'Tauscht Gewicht über {n} Felder · die schwerere Seite sinkt'],
  'hoist.top': ['Top car', 'Oberer Korb'],
  'hoist.bottom': ['Bottom car', 'Unterer Korb'],
  'hoist.weight': ['weight {n}', 'Gewicht {n}'],
  'hoist.sendDown': ['Send down ▼', 'Hinab senden ▼'],
  'hoist.sendUp': ['Send up ▲', 'Hinauf senden ▲'],
  'hoist.cycling': ['Cars are swapping…', 'Die Körbe tauschen die Plätze…'],
  'hoist.needsBallast': [
    'Waiting for ballast — the top car must outweigh the bottom one.',
    'Wartet auf Ballast — der obere Korb muss den unteren überwiegen.',
  ],
  'hoist.stormLocked': ['Storm brake engaged.', 'Sturmbremse eingerastet.'],
  'hoist.hint': [
    'Tap the hoist with Inspect to choose which goods ride down or up.',
    'Tippe den Aufzug mit Prüfen an, um zu wählen, welche Waren hinab- oder hinauffahren.',
  ],
  'sound.on': ['🔊 Sound on', '🔊 Ton an'],
  'sound.off': ['🔇 Sound off', '🔇 Ton aus'],

  // ---- options -------------------------------------------------------------------
  'opt.title': ['Options', 'Optionen'],
  'opt.language': ['Language', 'Sprache'],
  'opt.lang.en': ['English', 'English'],
  'opt.lang.de': ['Deutsch', 'Deutsch'],
  'opt.sound': ['Sound', 'Ton'],
  'opt.on': ['On', 'An'],
  'opt.off': ['Off', 'Aus'],
  'opt.effects': ['Weather & light effects', 'Wetter- & Lichteffekte'],
  'opt.effects.full': ['Full', 'Voll'],
  'opt.effects.reduced': ['Reduced', 'Reduziert'],
  'opt.effectsNote': [
    'Reduced skips rain streaks, sway and flicker. The system reduced-motion preference is always respected.',
    'Reduziert verzichtet auf Regenschlieren, Schwanken und Flackern. Die System-Einstellung für reduzierte Bewegung wird immer beachtet.',
  ],
  'opt.reset': ['Reset progress', 'Fortschritt zurücksetzen'],
  'opt.resetDesc': [
    'Clears medals, best times and level completion. Custom levels are kept.',
    'Löscht Medaillen, Bestzeiten und Levelfortschritt. Eigene Level bleiben erhalten.',
  ],
  'confirm.reset': [
    'Reset all progress? Medals, best times and completion will be wiped.',
    'Wirklich allen Fortschritt zurücksetzen? Medaillen, Bestzeiten und Abschlüsse werden gelöscht.',
  ],
  'btn.reset': ['Reset', 'Zurücksetzen'],
  'opt.transfer': ['Save file', 'Spielstand-Datei'],
  'opt.transferDesc': [
    'Export downloads your progress and custom levels as a file. Import loads such a file — for example on another device.',
    'Export lädt Fortschritt und eigene Level als Datei herunter. Import lädt so eine Datei — zum Beispiel auf einem anderen Gerät.',
  ],
  'btn.export': ['Export', 'Exportieren'],
  'btn.import': ['Import', 'Importieren'],
  'confirm.import': [
    'Load this save file? Your current progress and custom levels will be replaced.',
    'Diesen Spielstand laden? Dein aktueller Fortschritt und deine eigenen Level werden ersetzt.',
  ],
  'save.importError': [
    'This file is not a valid Smallhands save.',
    'Diese Datei ist kein gültiger Smallhands-Spielstand.',
  ],
  'opt.back': ['← Back', '← Zurück'],

  // ---- editor --------------------------------------------------------------------
  'ed.tool.ground.label': ['Ground', 'Boden'],
  'ed.tool.ground.desc': [
    'Paint earth (drag to sculpt). Grass grows on top automatically.',
    'Male Erdreich (ziehen zum Formen). Gras wächst oben automatisch.',
  ],
  'ed.tool.rock.label': ['Rock', 'Fels'],
  'ed.tool.rock.desc': ['Paint hard rock.', 'Male harten Fels.'],
  'ed.tool.erase.label': ['Dig', 'Graben'],
  'ed.tool.erase.desc': [
    'Dig terrain away (drag to carve caves, pits and cliffs).',
    'Trage Terrain ab (ziehen für Höhlen, Gruben und Klippen).',
  ],
  'ed.tool.tree.label': ['Tree', 'Baum'],
  'ed.tool.tree.desc': ['Plant a tree on the surface of this column (4 logs).', 'Pflanze einen Baum auf dieser Säule (4 Stämme).'],
  'ed.tool.boulder.label': ['Boulder', 'Felsblock'],
  'ed.tool.boulder.desc': ['Place a boulder (4 stone).', 'Setze einen Felsblock (4 Steine).'],
  'ed.tool.vein.label': ['Iron', 'Eisen'],
  'ed.tool.vein.desc': ['Place an iron vein (4 iron).', 'Setze eine Eisenader (4 Eisen).'],
  'ed.tool.townhall.label': ['Town Hall', 'Rathaus'],
  'ed.tool.townhall.desc': ['Move the Town Hall to this column.', 'Versetze das Rathaus in diese Säule.'],
  'ed.tool.goal.label': ['Caravan', 'Karawane'],
  'ed.tool.goal.desc': ['Move the delivery caravan (goal) to this column.', 'Versetze die Lieferkarawane (Ziel) in diese Säule.'],
  'ed.tool.eraseNode.label': ['Un-plant', 'Entfernen'],
  'ed.tool.eraseNode.desc': ['Remove a tree, boulder or iron vein.', 'Entferne Baum, Felsblock oder Eisenader.'],
  'ed.title': ['Level Editor', 'Level-Editor'],
  'ed.name': ['Name', 'Name'],
  'ed.blurb': ['Blurb', 'Beschreibung'],
  'ed.size': ['Size', 'Größe'],
  'ed.resize': ['Resize', 'Anpassen'],
  'ed.resized': ['World resized to {w}×{h}.', 'Welt auf {w}×{h} geändert.'],
  'ed.order': ['Delivery order', 'Lieferauftrag'],
  'ed.start': ['Starting crew & stock', 'Start-Trupp & -Lager'],
  'ed.workers': ['Workers', 'Arbeiter'],
  'ed.townhallLevel': ['Town Hall', 'Rathaus'],
  'ed.generate': ['Generate', 'Generieren'],
  'ed.roll': ['🎲 Roll', '🎲 Würfeln'],
  'ed.generated': ['Generated "{name}" from seed "{seed}".', '„{name}" aus Seed „{seed}" generiert.'],
  'ed.seedTitle': ['Seed — the same seed always builds the same level', 'Seed — derselbe Seed baut immer dasselbe Level'],
  'ed.check': ['Check & play', 'Prüfen & Spielen'],
  'ed.verify': ['✔ Verify level', '✔ Level prüfen'],
  'ed.playtest': ['▶ Playtest', '▶ Testspielen'],
  'ed.save': ['💾 Save', '💾 Speichern'],
  'ed.saved': ['Saved to your levels.', 'In deinen Leveln gespeichert.'],
  'ed.copy': ['⧉ Copy code', '⧉ Code kopieren'],
  'ed.copied': ['Share code copied to clipboard.', 'Teilen-Code in die Zwischenablage kopiert.'],
  'ed.copyPrompt': ['Copy this level code:', 'Kopiere diesen Level-Code:'],
  'ed.exit': ['← Exit', '← Verlassen'],
  'ed.needObjective': ['Add at least one delivery objective first.', 'Lege zuerst mindestens ein Lieferziel fest.'],
  'ed.flash.building': ['Move the building first.', 'Versetze zuerst das Gebäude.'],
  'ed.flash.bedrock': ['The bottom row is bedrock — the world needs a floor.', 'Die unterste Reihe ist Grundgestein — die Welt braucht einen Boden.'],
  'ed.flash.noGround': ['This column has no ground to stand on.', 'Diese Säule hat keinen Boden.'],
  'ed.flash.tooClose': ['Too close to a building.', 'Zu nah an einem Gebäude.'],
  'ed.flash.noGroundHere': ['No ground here.', 'Hier ist kein Boden.'],
  'ed.flash.needsClear': [
    'Needs clear air on flat, solid ground (and room from other buildings).',
    'Braucht freie Luft auf ebenem, festem Boden (und Abstand zu anderen Gebäuden).',
  ],
  'ed.report.ok': [
    '✔ Looks solvable — buildings placed, goods routable, resources sufficient.',
    '✔ Sieht lösbar aus — Gebäude platziert, Waren transportierbar, Ressourcen ausreichend.',
  ],
  'ed.startingStock': ['Starting {name}', 'Start-{name}'],
  'ed.defaultName': ['My Level', 'Mein Level'],

  // ---- verifier ---------------------------------------------------------------------
  'verify.thBuried': [
    'Town Hall is buried or floating — it needs clear air on solid, level ground.',
    'Das Rathaus ist verschüttet oder schwebt — es braucht freie Luft auf festem, ebenem Boden.',
  ],
  'verify.goalBuried': [
    'The caravan (goal) is buried or floating — it needs clear air on solid, level ground.',
    'Die Karawane (Ziel) ist verschüttet oder schwebt — sie braucht freie Luft auf festem, ebenem Boden.',
  ],
  'verify.nodeGround': ['A {kind} at ({x}, {y}) is not standing on solid ground.', '{kind} bei ({x}, {y}) steht nicht auf festem Boden.'],
  'verify.noObjectives': ['No delivery objectives — the level cannot be won.', 'Keine Lieferziele — das Level kann nicht gewonnen werden.'],
  'verify.wood': [
    'Wood may run short: the order needs ~{need} logs (incl. a sawmill) but only {have} are obtainable.',
    'Das Holz könnte knapp werden: Der Auftrag braucht ~{need} Stämme (inkl. Sägewerk), aber nur {have} sind erreichbar.',
  ],
  'verify.stone': [
    'Not enough stone in the level: order needs {need}, only {have} obtainable.',
    'Nicht genug Stein im Level: Der Auftrag braucht {need}, nur {have} sind erreichbar.',
  ],
  'verify.iron': [
    'Not enough iron in the level: crafted tools (spears/shovels) need {need}, only {have} obtainable.',
    'Nicht genug Eisen im Level: gefertigte Werkzeuge (Speere/Schaufeln) brauchen {need}, nur {have} sind erreichbar.',
  ],
  'verify.spearStone': [
    'Crafted tools need a forge or workshop (Town Hall 2) — stone for the upgrade and building may run short.',
    'Gefertigte Werkzeuge brauchen eine Schmiede oder Werkstatt (Rathaus 2) — der Stein für Ausbau und Gebäude könnte knapp werden.',
  ],
  'verify.waterFloat': [
    '{n} water tile(s) without ground below or banks beside (first at ({x}, {y})) — the pool would float in mid-air.',
    '{n} Wasserfeld(er) ohne Boden darunter oder Ufer daneben (erstes bei ({x}, {y})) — der Teich würde in der Luft schweben.',
  ],
  'verify.thDoor': ['No standable spot at the Town Hall door.', 'Kein begehbarer Platz an der Rathaustür.'],
  'verify.sealed': [
    'The {kind} at ({x}, {y}) is sealed off from the Town Hall — no air path connects them.',
    '{kind} bei ({x}, {y}) ist vom Rathaus abgeschottet — kein Luftweg verbindet sie.',
  ],
  'verify.goalUnreachable': [
    'Loaded smallhands can never reach the caravan from the Town Hall — even with platforms and lifts. Goods cannot be delivered.',
    'Beladene Smallhands erreichen die Karawane vom Rathaus aus nie — selbst mit Brücken und Aufzügen. Waren können nicht geliefert werden.',
  ],
  'verify.stranded': [
    'Goods harvested at the {kind} ({x}, {y}) may never reach the stockpile — check for a lift-able cliff face or a platform route.',
    'Waren vom {kind} ({x}, {y}) erreichen das Lager womöglich nie — prüfe auf eine aufzugstaugliche Klippenwand oder eine Brückenroute.',
  ],

  // ---- generator ----------------------------------------------------------------------
  'gen.desc': ['Generated (seed "{seed}", difficulty {d}){features}.', 'Generiert (Seed „{seed}", Schwierigkeit {d}){features}.'],
  'gen.feat.cliff.one': ['1 cliff to hoist goods up', '1 Klippe, an der Waren hochmüssen'],
  'gen.feat.cliff.many': ['{n} cliffs to hoist goods up', '{n} Klippen, an denen Waren hochmüssen'],
  'gen.feat.pit.one': ['1 pit to haul goods out of', '1 Grube, aus der Waren herausmüssen'],
  'gen.feat.pit.many': ['{n} pits to haul goods out of', '{n} Gruben, aus denen Waren herausmüssen'],
  'gen.feat.ridge': ['a ridge to cross', 'ein Bergrücken zum Überqueren'],
  'gen.feat.mesa': ['a mesa to scale', 'ein Tafelberg zum Erklimmen'],
  'gen.feat.canyon': ['a canyon to haul out of', 'ein Canyon, aus dem Waren herausmüssen'],
  'gen.feat.terraces': ['terraced shelves to climb', 'Terrassen zum Erklimmen'],

  // ---- in-world effects -------------------------------------------------------------
  'fx.crew': ['Crew {a} → {b}', 'Trupp {a} → {b}'],
};
