import manifest from '../public/clips/manifest.json';

export interface ClipInfo {
  file: string;
  start: number; // seconds into the recording where the usable window begins
  duration: number;
}

export const CLIPS = manifest as Record<string, ClipInfo>;

// Extra safety lead skipped at the head of every usable window (the capture
// script measures `start` with wall-clock precision of a couple hundred ms).
export const TRIM_PAD = 0.25;

export interface Caption {
  kicker: string; // small uppercase label
  text: string; // main line; *word* is highlighted gold
}

// `offset` shifts the scene deeper into the clip's usable window (seconds) —
// e.g. wetter starts just before the clear->rain flip, so we skip ahead to
// have actual rain on screen for most of the shot.
export const SCENES: { id: keyof typeof manifest; caption: Caption; offset?: number }[] = [
  {
    id: 'mechanik',
    caption: {
      kicker: 'Spielprinzip',
      text: 'Nur *markieren* — deine Crew erledigt den Rest',
    },
  },
  {
    id: 'bauen',
    caption: {
      kicker: 'Forme die Welt',
      text: 'Leitern, Rampen, *Brücken* — baue Wege für schwere Lasten',
    },
  },
  {
    id: 'wetter',
    caption: {
      kicker: 'Dynamisches Wetter',
      text: 'Regen bremst die Arbeit — die *Vorhersage* ist Teil des Puzzles',
    },
  },
  {
    id: 'nacht',
    caption: {
      kicker: 'Tag & Nacht',
      text: 'Gearbeitet wird nur im Licht — *Laternen* schieben die Grenze',
    },
  },
  {
    id: 'hoist',
    caption: {
      kicker: 'Gegengewichts-Aufzug',
      text: 'Die *schwerere* Seite sinkt — Physik ist deine Maschine',
    },
  },
];
