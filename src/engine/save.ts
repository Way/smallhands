// Progress persistence in localStorage.

const KEY = 'smallhands-save-v1';

export interface SaveData {
  completed: number[]; // level ids
  muted: boolean;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw) as Partial<SaveData>;
      return { completed: data.completed ?? [], muted: data.muted ?? false };
    }
  } catch {
    // corrupt or unavailable storage — start fresh
  }
  return { completed: [], muted: false };
}

export function persistSave(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage may be unavailable (private mode) — play on without saving
  }
}
