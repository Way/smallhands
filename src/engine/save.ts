// Progress persistence in localStorage.

import { sanitizeLevelData } from '../game/leveldata';
import type { CustomLevelData } from '../game/leveldata';
import { MEDAL_TIERS } from '../game/types';
import type { MedalTier } from '../game/types';

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
  muted: boolean;
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

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as Partial<SaveData>;
      return {
        completed: data.completed ?? [],
        completedCustom: data.completedCustom ?? [],
        records: sanitizeRecords(data.records),
        muted: data.muted ?? false,
      };
    }
  } catch {
    // corrupt or unavailable storage — start fresh
  }
  return { completed: [], completedCustom: [], records: {}, muted: false };
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
