// The teaser's caption deck: one line per mechanic in both languages.
//
// Separate from the renderer because `tests/teaser-caption.mjs` fits every line
// of it against the in-game tool dock — a caption the deck can print is a caption
// the guard has to clear, and a copy of these strings in the test would drift
// from the deck the day either changed.
// One line per mechanic, headline states the rule, sub lands the consequence.
export const COPY = {
  de: {
    hook: { h: 'Keine direkte Steuerung.', sub: 'Du baust die Welt — die Smallies benutzen sie' },
    build: { h: 'Nur leere Hände können klettern.', sub: 'Fracht braucht einen anderen Weg nach oben' },
    dig: { h: 'Fels ist keine Wand.', sub: 'Du markierst den Schacht — ein Gräber teuft ihn' },
    hoist: { h: 'Schwerkraft als Spielelement.', sub: 'Ballast runter, Fracht rauf' },
    convoy: { h: 'Die Karawane hält nach Plan.', sub: 'Belade den Wagen, eh er weiterzieht' },
    storm: { h: 'Stürme ziehen nach Plan auf.', sub: 'Regen bremst die Äxte; Böen blockieren die Aufzüge' },
    tide: { h: 'Jeder Guss hebt die Flut.', sub: 'Rette die Waren, eh das Wasser sie holt' },
    drown: { h: 'Im Fels steht das Wasser.', sub: 'Grab unter den Spiegel, und der Regen holt den Stollen' },
    daynight: { h: 'Der Tag selbst wendet sich.', sub: 'Wettlauf mit der Nacht — Laternen halten das Licht' },
    biomes: { h: 'Jede Seed generiert eine einzigartige Welt.', sub: '6 Biome · Täglicher Auftrag · Level-Editor' },
    deliver: { h: 'Geschwindigkeit und Geschick sind entscheidend.', sub: 'Prestige und Highscores warten auf dich' },
    end: { h: '', sub: '' }, // the front-door hero carries its own tagline + CTA
  },
  en: {
    hook: { h: 'No direct control.', sub: 'You build the world — the smallies use it' },
    build: { h: 'Only empty hands can climb.', sub: 'Cargo needs another way up' },
    dig: { h: 'Rock is not a wall.', sub: 'You mark the shaft — a Digger cuts it' },
    hoist: { h: 'Gravity as a game mechanic.', sub: 'Ballast down, cargo up' },
    convoy: { h: 'The caravan docks on a schedule.', sub: 'Load the wagon before it rolls on' },
    storm: { h: 'Storms roll in on the forecast.', sub: 'Rain slows the axes; gusts lock the lifts' },
    tide: { h: 'Every downpour lifts the tide.', sub: 'Rescue the goods before the water takes them' },
    drown: { h: 'The rock has a waterline.', sub: 'Dig below it and the next rain takes the gallery' },
    daynight: { h: 'The day itself turns.', sub: 'Race the dark — lanterns hold the light' },
    biomes: { h: 'Every seed generates a unique world.', sub: '6 biomes · Daily challenge · Level editor' },
    deliver: { h: 'Speed and skill decide.', sub: 'Prestige and highscores await' },
    end: { h: '', sub: '' },
  },
};
