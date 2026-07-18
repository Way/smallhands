// Progress persistence in localStorage.

import { sanitizeLevelData } from '../game/leveldata';
import type { CustomLevelData } from '../game/leveldata';
import { MEDAL_TIERS } from '../game/types';
import type { MedalTier } from '../game/types';
import { LANGS } from './i18n';
import type { Lang } from './i18n';

const KEY = 'smallhands-save-v1';
const CUSTOM_KEY = 'smallhands-custom-v1';

// Personal best for one level. Keyed by `c<id>` for campaign levels and by
// the CustomLevelData id for custom/generated/daily levels.
export interface LevelRecord {
  bestTime: number; // seconds
  medal: MedalTier | null; // best tier ever earned
  feats: string[]; // feat ids ever earned (union across runs)
}

export interface SaveData {
  completed: number[]; // campaign level ids
  completedCustom: string[]; // custom/generated level ids
  records: Record<string, LevelRecord>;
  muted: boolean; // sound effects off
  music: boolean; // background music on/off (default on)
  lang?: Lang; // unset until the player picks one (browser language applies)
  effects?: 'full' | 'reduced'; // weather/light effect intensity
}

function sanitizeRecords(raw: unknown): Record<string, LevelRecord> {
  const out: Record<string, LevelRecord> = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    // reject non-finite and negative times — a bogus negative best can never be
    // beaten and renders as garbage in the time display
    if (typeof r.bestTime !== 'number' || !Number.isFinite(r.bestTime) || r.bestTime < 0) continue;
    out[key] = {
      bestTime: r.bestTime,
      medal: MEDAL_TIERS.includes(r.medal as MedalTier) ? (r.medal as MedalTier) : null,
      feats: Array.isArray(r.feats) ? r.feats.filter((f): f is string => typeof f === 'string') : [],
    };
  }
  return out;
}

// Coerce anything (parsed localStorage, an imported file) into a valid SaveData.
function sanitizeSaveData(raw: unknown): SaveData {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<SaveData>;
  return {
    completed: Array.isArray(data.completed) ? data.completed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [],
    completedCustom: Array.isArray(data.completedCustom)
      ? data.completedCustom.filter((s): s is string => typeof s === 'string')
      : [],
    records: sanitizeRecords(data.records),
    muted: data.muted === true,
    music: data.music !== false, // default on; only an explicit false disables it
    lang: LANGS.includes(data.lang as Lang) ? (data.lang as Lang) : undefined,
    effects: data.effects === 'reduced' ? 'reduced' : data.effects === 'full' ? 'full' : undefined,
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitizeSaveData(JSON.parse(raw));
  } catch {
    // corrupt or unavailable storage — start fresh
  }
  return { completed: [], completedCustom: [], records: {}, muted: false, music: true };
}

export function persistSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage may be unavailable (private mode) — play on without saving
  }
}

// ---- custom levels (editor / generator) -------------------------------------

export function loadCustomLevels(): CustomLevelData[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.map((l) => sanitizeLevelData(l)).filter((l): l is CustomLevelData => l !== null);
      }
    }
  } catch {
    // fall through
  }
  return [];
}

export function persistCustomLevels(levels: CustomLevelData[]): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(levels));
  } catch {
    // storage unavailable — editing still works for this session
  }
}

// Insert or update a level by id. Returns the new list.
export function upsertCustomLevel(levels: CustomLevelData[], data: CustomLevelData): CustomLevelData[] {
  const idx = levels.findIndex((l) => l.id === data.id);
  const next = [...levels];
  if (idx >= 0) next[idx] = data;
  else next.push(data);
  persistCustomLevels(next);
  return next;
}

export function deleteCustomLevel(levels: CustomLevelData[], id: string): CustomLevelData[] {
  const next = levels.filter((l) => l.id !== id);
  persistCustomLevels(next);
  return next;
}

// ---- export / import (move the whole save to another browser or device) ------
// A single self-describing JSON file bundling progress and custom levels. The
// format marker + version let a future format evolve without silently
// swallowing files from a newer build.

const EXPORT_FORMAT = 'smallhands-save';
const EXPORT_VERSION = 1;

export interface ExportBundle {
  save: SaveData;
  customLevels: CustomLevelData[];
}

export function exportAllData(save: SaveData, customLevels: CustomLevelData[]): string {
  return JSON.stringify(
    { format: EXPORT_FORMAT, version: EXPORT_VERSION, save, customLevels },
    null,
    2
  );
}

// Parse an exported file. Returns null when the text is not a Smallhands save
// export (wrong shape, wrong marker, or a version this build doesn't know);
// the payload itself is sanitized field by field, never trusted.
export function importAllData(text: string): ExportBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.format !== EXPORT_FORMAT) return null;
  if (obj.version !== EXPORT_VERSION) return null;
  const customLevels = Array.isArray(obj.customLevels)
    ? obj.customLevels.map((l) => sanitizeLevelData(l)).filter((l): l is CustomLevelData => l !== null)
    : [];
  return { save: sanitizeSaveData(obj.save), customLevels };
}
