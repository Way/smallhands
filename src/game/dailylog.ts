// The daily-challenge logbook: everything the save already knows about past
// dailies, derived on demand. Records are written for EVERY solved level under
// `save.records`, keyed by level id — a daily's id is its seed
// (`daily-YYYY-MM-DD`), so a player's whole daily history is already on disk
// (see save.ts). This module is the read side: pure, DOM-free and
// browser-independent so the streak math is unit-testable.
//
// A record only exists once a level is WON (main.ts writes it in the win
// branch), so "attempted but abandoned" leaves no trace anywhere in the save.
// The logbook therefore distinguishes **solved** days from **missed** days, not
// solved from attempted.

import { dailySeed } from './generator';
import type { LevelRecord } from '../engine/save';
import type { MedalTier } from './types';

const KEY_RE = /^daily-\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export interface DailyLogEntry {
  seed: string; // save-record key, e.g. 'daily-2026-07-24'
  label: string; // date label, e.g. '2026-07-24'
  difficulty: number; // re-derived from the date, so an old seed can be replayed
  bestTime: number; // seconds
  medal: MedalTier | null;
  feats: string[];
}

export interface DailyStats {
  solved: number; // dailies ever cleared
  current: number; // days in the streak ending today (or yesterday, see below)
  longest: number; // longest run of consecutive solved days
}

export interface DailyStripDay {
  label: string;
  solved: boolean;
  today: boolean;
  medal: MedalTier | null;
}

// Whole days since the epoch for a 'YYYY-MM-DD' label. UTC on purpose: this is
// only ever used to test adjacency between two calendar dates, and UTC days are
// exactly 24h apart — local days are not (DST), which would make two adjacent
// dates look 23h or 25h apart and break streaks twice a year.
function dayIndex(label: string): number {
  const [y, m, d] = label.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function labelForIndex(i: number): string {
  const dt = new Date(i * DAY_MS);
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${m}-${d}`;
}

// Recover the seed + difficulty for a past date. The day-of-week difficulty rule
// lives in `dailySeed` and must not be duplicated here, so we rebuild that day's
// LOCAL date and ask the generator — the same call the lighthouse makes for
// today. The label round-trip is the validity check: JS rolls impossible dates
// over (2026-02-31 -> 2026-03-03), and a rolled-over date reports a different
// label, so a corrupt or hand-edited key is rejected instead of silently
// pointing at another day's mountain.
export function dailyInfo(label: string): { seed: string; label: string; difficulty: number } | null {
  const [y, m, d] = label.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const info = dailySeed(new Date(y, m - 1, d));
  return info.label === label ? info : null;
}

// Every solved daily, newest first. ISO labels sort lexicographically, so the
// string compare is a date compare.
export function dailyLog(records: Record<string, LevelRecord>): DailyLogEntry[] {
  const out: DailyLogEntry[] = [];
  for (const [key, rec] of Object.entries(records)) {
    if (!KEY_RE.test(key)) continue;
    const info = dailyInfo(key.slice('daily-'.length));
    if (!info || info.seed !== key) continue;
    out.push({
      seed: key,
      label: info.label,
      difficulty: info.difficulty,
      bestTime: rec.bestTime,
      medal: rec.medal,
      feats: rec.feats,
    });
  }
  out.sort((a, b) => (a.label < b.label ? 1 : a.label > b.label ? -1 : 0));
  return out;
}

// Streaks over the solved days. The current streak counts back from today, but
// an unplayed today does NOT break it — the day is not over yet, so a player who
// cleared yesterday still reads "3 days" until midnight, and only misses the
// streak by skipping a whole day.
export function dailyStats(entries: DailyLogEntry[], today: string): DailyStats {
  const days = new Set(entries.map((e) => dayIndex(e.label)));
  const t0 = dayIndex(today);

  let current = 0;
  for (let i = days.has(t0) ? t0 : t0 - 1; days.has(i); i--) current++;

  let longest = 0;
  const sorted = [...days].sort((a, b) => a - b);
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  return { solved: entries.length, current, longest };
}

// The last `days` calendar days, oldest first — the strip that makes a broken
// streak visible: a gap is a day the player never cleared.
export function dailyStrip(entries: DailyLogEntry[], today: string, days = 14): DailyStripDay[] {
  const byDay = new Map(entries.map((e) => [dayIndex(e.label), e]));
  const t0 = dayIndex(today);
  const out: DailyStripDay[] = [];
  for (let i = t0 - days + 1; i <= t0; i++) {
    const hit = byDay.get(i);
    out.push({
      label: labelForIndex(i),
      solved: !!hit,
      today: i === t0,
      medal: hit?.medal ?? null,
    });
  }
  return out;
}
