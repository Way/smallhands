// Campaign/level unlock state, computed from the save file. Kept free of DOM
// imports so the headless suites can pin the gating rules directly.
//
// The rules (same as the old level grid): a campaign opens once every level of
// all previous campaigns is done; within a campaign levels unlock in sequence
// (the globally previous level must be completed).
//
// `unlockAll` is the local dev-mode override (see engine/devmode.ts): it
// bypasses every unlock gate but never fakes completion — `done`/`complete`
// stay truthful, so medals, fog and the journey trail read exactly as earned.

import type { LevelDef } from './levels';
import type { MapCampaignState } from './worldmap';

export function computeCampaignStates(
  levels: LevelDef[],
  completed: number[],
  unlockAll = false
): MapCampaignState[] {
  const ids = [...new Set(levels.map((l) => l.campaign ?? 1))].sort((a, b) => a - b);
  const doneByCampaign = new Map(
    ids.map((c) => [
      c,
      levels.filter((l) => (l.campaign ?? 1) === c).every((l) => completed.includes(l.id)),
    ])
  );
  const gate = (c: number) => ids.filter((x) => x < c).every((x) => doneByCampaign.get(x));
  return ids.map((c) => ({
    campaign: c,
    unlocked: unlockAll || gate(c),
    complete: doneByCampaign.get(c)!,
    levels: levels
      .map((def, index) => ({ def, index }))
      .filter(({ def }) => (def.campaign ?? 1) === c)
      .map(({ def, index }) => ({
        index,
        def,
        unlocked:
          unlockAll || (gate(c) && (index === 0 || completed.includes(levels[index - 1].id))),
        done: completed.includes(def.id),
      })),
  }));
}
