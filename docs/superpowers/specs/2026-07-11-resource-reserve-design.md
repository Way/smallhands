# Resource Reserve ("Keep in store") — Design

**Date:** 2026-07-11
**Status:** Approved design, pending implementation plan

## Problem

The hauler scheduler (`tryAssignHaul` in `src/game/sim.ts`) ranks jobs by priority and puts **goal delivery at priority 0 — the highest**. For every objective item with any unreserved stock, a hauler is immediately dispatched to the caravan (capped only once `delivered + inbound >= amount`). There is no way for the player to hold stock back.

This breaks down when a resource is *both* an objective and a build material. **Level 3** is the clearest case: its order wants **8 stone**, but reaching Town Hall Lv 2 (required for the Forge and Cargo Lift) costs **6 stone**, the Lift costs 2 stone, and the Forge costs 4 stone. Every stone mined is rushed to the caravan before the player can bank the 6 needed to upgrade. Because construction pays its full cost from stock at click-time, the player can never accumulate enough — the level is effectively unwinnable without fighting the scheduler.

## Goal

Give the player a per-resource floor — "keep N of this in store" — so haulers deliver only the **surplus above the floor** to the caravan. This lets the player stockpile for construction while the rest of the economy keeps flowing.

## Non-goals

- No physical/movement-based mechanic (e.g. a Lemmings-style blocker). This is a routing decision, not a chokepoint; a blocker would also obstruct unrelated traffic.
- No change to how construction, production feeding, or loose-item collection are scheduled.
- Not persisted to disk. The floor is per-play-session state, reset on each level start.
- No global "pause all deliveries" toggle (considered and rejected as too coarse).

## Design

### Data model

One new field on `Game` (in `src/game/sim.ts`, beside `stock` and `stockReserved`):

```ts
keep: Record<ItemType, number> = { log: 0, plank: 0, stone: 0, iron: 0, spear: 0 };
```

- Named `keep` to stay distinct from the existing `stockReserved`, which tracks *in-flight haul reservations* — a different concept.
- Initialised to all-zero, so default behaviour is identical to today.
- Reset when a level starts (it is a fresh `Game` instance per level, so this is automatic — no save/load wiring).

### Behaviour — scheduler gate

The only logic change is the goal-delivery candidate gate in `tryAssignHaul`. Today:

```ts
for (const o of this.objectives) {
  if (o.delivered + o.inbound >= o.amount) continue;
  if (this.available(o.item) <= 0) continue;              // <-- changes
  cands.push({ source: { t: 'stock' }, sink: { t: 'goal', id: goal.id }, item: o.item, priority: 0 });
}
```

New gate — ship only what exceeds the floor:

```ts
  if (this.available(o.item) - this.keep[o.item] <= 0) continue;
```

`available(item)` is already `stock[item] - stockReserved[item]` (free, not-in-flight stock). Subtracting `keep[item]` yields the deliverable surplus. Because the gate is re-evaluated every scheduler tick (~0.3s), lowering the floor immediately releases the held stock to the caravan.

**Scope:** this gate touches **only** priority-0 goal deliveries. Production feeding (priority 1), loose-item collection and output draining (priority 2), and construction (`placeLift`/`placeBuilding`/`placeLadder`/`upgrade`, which deduct from `stock` directly) are all unaffected. So "keep 6 stone" lets stock climb past 6, the player places the upgrade/lift/forge (spending from stock, including the reserved amount if they choose), and any remaining surplus still flows to the order.

### Behaviour — edge cases

- **Floor ≥ what you have + what you'll get:** if the player sets `keep` so high that the surplus never reaches the order, the level cannot be completed until they lower it. This is intended and the player's choice; no automatic override.
- **`available - keep` negative:** the `<= 0` gate already handles it (nothing ships). No clamping needed in the scheduler.
- **Stepper bounds:** `keep[item]` is clamped to `>= 0` at the UI. Upper bound `99` (a sane cap; no realistic level needs more).
- **Non-objective items:** the control is offered on every resource chip for uniformity. Reserving an item that is not an objective (e.g. spear on a level that does not want spears) simply has no delivery to gate — harmless.

### UX — click the resource chip

The stock lives in an always-visible top bar as one `res-chip` per item (`buildTopBar` in `src/game/ui.ts`, ~line 99; chips tracked in `this.resChips`).

- Each `res-chip` becomes a clickable button. Clicking opens a small popover anchored to the chip, reusing the existing `tooltip` styling.
- Popover contents: item name, current stock count, a `keep [N] ▲▼` stepper (▲ = +1, ▼ = −1, clamped 0..99), and a one-line explainer: "Haulers ship only the surplus to the caravan."
- Only one popover open at a time; clicking the chip again, clicking another chip, or clicking elsewhere closes it.
- **Floor badge:** when `keep[item] > 0`, the chip shows a small corner badge (e.g. `⊝6`) so a set floor is visible even with the popover closed. This is the in-game answer to "why isn't my stone shipping?"
- Updating a floor takes effect on the next scheduler tick; no confirm step.

### Discoverability

Add a Level 3 `LevelHint` (in `src/game/levels.ts`, level id 3) that fires when stone is contested — e.g. `when: (g) => g.stock.stone >= 2 && g.thLevel < 2`:

> "Stone fills the order **and** builds your Cargo Lift and Forge. Click the stone counter up top to **keep some back** for construction."

This teaches the mechanic exactly where it first bites, without a global tutorial.

## Testing

Using the fast headless harness pattern already established in `tests/unit.mjs` (esbuild-bundles the TS sources, constructs `Game`, steps `tick`):

1. **Gate unit test:** construct a `Game`, set `stock` and `keep` for an objective item, run the scheduler, and assert that (a) no caravan haul is created while `available - keep <= 0`, and (b) once stock exceeds the floor, the surplus is dispatched to the goal. Verify production/loose-item hauls are unaffected by a floor.
2. **Level-3-shaped sim test:** with `keep.stone` set, step the sim and assert stock reaches the Town Hall Lv 2 upgrade cost (6 stone) — i.e. the reserve makes accumulation possible, where today it is starved.
3. **Regression:** with all `keep` at 0, existing behaviour (and the level 1/2 browser e2e) is unchanged.

## Affected files

- `src/game/sim.ts` — add `keep` field; change the goal-delivery gate in `tryAssignHaul`.
- `src/game/ui.ts` — clickable chips, reserve popover with stepper, floor badge.
- `src/game/levels.ts` — Level 3 discoverability hint.
- `src/style.css` — popover/stepper/badge styling.
- `tests/unit.mjs` (or a sibling) — reserve gate + accumulation tests.
