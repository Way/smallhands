// Progress persistence in localStorage.

import { sanitizeLevelData } from '../game/leveldata';
import type { CustomLevelData } from '../game/leveldata';

const KEY = 'smallhands-save-v1';
const CUSTOM_KEY = 'smallhands-custom-v1';

export interface SaveData {
  completed: number[]; // campaign level ids
  completedCustom: string[]; // custom/generated level ids
  muted: boolean;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as Partial<SaveData>;
      return {
        completed: data.completed ?? [],
        completedCustom: data.completedCustom ?? [],
        muted: data.muted ?? false,
      };
    }
  } catch {
    // corrupt or unavailable storage — start fresh
  }
  return { completed: [], completedCustom: [], muted: false };
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
