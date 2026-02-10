# Code Review — Round 2

## Summary

Reviewed balance-tuner's Technician MOM change and completed BL-010 gear system type safety audit. The archetypes change is valid; 14 of the 15 expected test failures have been fixed by other agents, but 1 remains in match.test.ts:78 where the assertion was incorrectly flipped. Gear system type safety is solid — no `any`, no `as` casts, exhaustive slot mappings, proper RNG typing. Two minor findings: optional gear stat fields could allow silent zero-bonus gear, and variant parameter is not validated against a known set. Neither is a blocker. Fixed stale CounterResult comment in types.ts.

## Changes Reviewed

### balance-tuner: Technician MOM 55→58 (archetypes.ts)
- **Change**: Single field change, `momentum: 55` → `momentum: 58`
- **Assessment**: Clean, minimal change. New total = 298 (within 290-300 range). No structural issues.
- **Problem**: Originally 15 tests failed from this change. Other agents have fixed 14 of them. **1 test still fails**: `match.test.ts:78` — the Charger vs Technician worked example. The assertion was incorrectly updated to `expect(p1.player2.impactScore).toBeGreaterThan(p1.player1.impactScore)` but actual values show Charger (61.68) still beats Technician (61.12). The assertion should be `expect(p1.player1.impactScore).toBeGreaterThan(p1.player2.impactScore)` — Charger still wins pass 1, just by a smaller margin.
- **BLOCK**: 1 test still failing in match.test.ts:78. Fix: change line 79 from `expect(p1.player2.impactScore).toBeGreaterThan(p1.player1.impactScore)` back to `expect(p1.player1.impactScore).toBeGreaterThan(p1.player2.impactScore)` and update the comment at line 77-78.

### qa: gear-variants.test.ts — 112 new tests
- **Assessment**: QA added thorough coverage of gear variant interactions (aggressive vs defensive, degenerate strategy detection, mixed variants, stress tests). Test design is sound — tests horizontal power invariants, stat routing correctness, and full match completion. All 156 gear-variants tests now pass (the BL-004 tests were updated for the new Technician MOM value).
- **NOTE**: The deterministic cycling approach (N=30, cycling through attacks) in BL-004 tests is fragile to ANY stat change, as documented in MEMORY.md. This is a known trade-off — the tests are valuable but require maintenance on every balance change.

### polish: App.css, index.css — Rarity card styling
- **Assessment**: CSS-only changes. No engine impact. Outside my review scope for code quality, but confirms no engine/UI coupling issues.

## BL-010: Gear System Type Safety Audit

### 1. Slot Mappings — Exhaustive ✅

**gigling-gear.ts**:
- `GEAR_SLOT_STATS` is typed `Record<SteedGearSlot, ...>` — TypeScript enforces all 6 slots present
- `ALL_STEED_SLOTS` array matches the `SteedGearSlot` union (chamfron, barding, saddle, stirrups, reins, horseshoes)
- `STEED_SLOT_DESCRIPTIONS` is typed `Record<SteedGearSlot, string>` — exhaustive
- `sumGearStats()` iterates `ALL_STEED_SLOTS` and accesses `loadout[slot]` — all slots covered

**player-gear.ts**:
- `PLAYER_GEAR_SLOT_STATS` is typed `Record<PlayerGearSlot, ...>` — all 6 slots enforced
- `ALL_PLAYER_SLOTS` array matches the `PlayerGearSlot` union
- `PLAYER_SLOT_DESCRIPTIONS` is typed `Record<PlayerGearSlot, string>` — exhaustive
- `sumPlayerGearStats()` iterates `ALL_PLAYER_SLOTS` — all slots covered

**gear-variants.ts**:
- `STEED_GEAR_VARIANTS` is typed `Record<SteedGearSlot, Record<GearVariant, ...>>` — exhaustive on both axes
- `PLAYER_GEAR_VARIANTS` is typed `Record<PlayerGearSlot, Record<GearVariant, ...>>` — exhaustive on both axes

**Verdict**: All slot mappings are exhaustive via `Record<>` typing. Adding a new slot to the union type would produce compile errors at every mapping site. No gaps.

### 2. RNG Parameter Types ✅

**gigling-gear.ts**:
- `createStatGear(slot, rarity, rng: () => number = Math.random, variant?)` — correct typing
- `createFullLoadout(gigRarity, gearRarity, rng: () => number = Math.random, variant?)` — correct typing

**player-gear.ts**:
- `createPlayerGear(slot, rarity, rng: () => number = Math.random, variant?)` — correct typing
- `createFullPlayerLoadout(gearRarity, rng: () => number = Math.random, variant?)` — correct typing

**gear-utils.ts**:
- `rollInRange(min, max, rng: () => number)` — correct typing

**Verdict**: RNG parameter is consistently typed as `() => number` with `Math.random` as default. No `any` types, no unsafe casts. Tests can pass deterministic RNGs. Sound.

### 3. Variant Parameter Validation ⚠️ (NOTE)

**Finding**: The `variant` parameter in `createStatGear()` and `createPlayerGear()` is typed `GearVariant | undefined`. When provided, it's used to look up `STEED_GEAR_VARIANTS[slot][variant]` or `PLAYER_GEAR_VARIANTS[slot][variant]`. Since `GearVariant` is a string literal union (`'aggressive' | 'balanced' | 'defensive'`), TypeScript prevents invalid values at compile time. However, at runtime (e.g., from JSON deserialization or API input), an invalid variant string would cause `STEED_GEAR_VARIANTS[slot][variant]` to return `undefined`, which would then silently crash when accessing `.primaryStat` on `undefined`.

**Severity**: NOTE — not a current problem since all callers pass literal values or `undefined`. Would become relevant if gear is loaded from external data (savegames, API). No fix needed now; flag for future serialization layer.

### 4. Edge Cases in createFullLoadout / createFullPlayerLoadout ✅

**gigling-gear.ts `createFullLoadout()`**:
- Always creates all 6 gear pieces (no conditional logic)
- Returns a complete `GiglingLoadout` with all 6 slots populated
- `giglingRarity` is stored on the loadout for rarity bonus calculation
- No edge case gaps — function is straightforward

**player-gear.ts `createFullPlayerLoadout()`**:
- Always creates all 6 gear pieces
- Returns a complete `PlayerLoadout` with all 6 slots populated
- No edge case gaps

**Edge case**: Both `GiglingLoadout` and `PlayerLoadout` have all slot fields as optional (`?`). This means a loadout with missing gear is valid at the type level. `sumGearStats()` and `sumPlayerGearStats()` handle this correctly with `if (!gear) continue`. However, `GiglingGear` has optional `primaryStat` and `secondaryStat` fields — gear with no stats is technically valid. The accumulator handles this (`if (gear.primaryStat) { ... }`), so no runtime issue exists. But it means a gear piece could silently contribute zero stats if constructed without stat fields.

**Severity**: NOTE — the factory functions always populate stat fields, so this path is unreachable in practice. Only relevant if someone manually constructs gear objects without using the factory.

### 5. Additional Type Safety Observations

- **No `any` types** in gigling-gear.ts, player-gear.ts, gear-variants.ts, or gear-utils.ts
- **No `as` casts** in any gear system file
- **`BALANCE` object is `as const`** — all config values are literal types, preventing accidental mutation
- **`StatBonuses` is re-exported** from both gigling-gear.ts and player-gear.ts for consumer convenience — no type inconsistency risk since both re-export from gear-utils.ts
- **Validation functions** (`validateSteedGear`, `validatePlayerGear`) correctly check stat ranges against `BALANCE.gearStatRanges[gear.rarity]` — but they don't validate the `slot` field matches the gear's actual slot, or that the stat types match the slot mapping. This is a very minor concern since the factory functions always produce correct gear.

## Issues Found

### BLOCK
- **[match.test.ts:78] Incorrect assertion direction in Charger vs Technician worked example.** The test was updated to expect `p1.player2.impactScore > p1.player1.impactScore` (Technician wins pass 1) but actual values are Charger=61.68 vs Technician=61.12. Charger still wins pass 1 — the MOM+3 narrowed the gap but didn't flip it. **Fix**: Change line 79 to `expect(p1.player1.impactScore).toBeGreaterThan(p1.player2.impactScore)` and update comment at lines 77-78 to "Charger barely wins pass 1 (raw MOM advantage narrowly overcomes Technician's CEP counter + CTL accuracy)".

### WARN
- **[Coordination] Test assertion update was incorrect.** Whoever updated match.test.ts line 78-79 guessed the impact direction wrong after the Technician MOM+3 change. This highlights the need for computed test expectations rather than manual direction guesses when stat changes are small.

### NOTE
- **[gear system] Variant parameter not runtime-validated.** `createStatGear()` and `createPlayerGear()` trust the `variant` parameter at runtime. If gear is ever deserialized from external data, add a runtime check. Low priority — no external data paths exist today.
- **[types.ts] Optional stat fields on GiglingGear/PlayerGear.** `primaryStat` and `secondaryStat` are optional, allowing zero-stat gear. Factory functions always populate them, so this is safe in practice. Consider making them required if the type contract should enforce it.
- **[types.ts:178] Fixed stale CounterResult comment.** Updated from "+10, -10, or 0" to reflect scaled counter bonus formula.

## Refactors Applied

- **[types.ts:178]** Updated `CounterResult` field comments to accurately describe the scaled counter bonus formula (counterBaseBonus + CTL*0.1) instead of the legacy flat ±10 description.

## Tech Debt Filed

- **[MEDIUM] Test-locked archetype stats create maintenance burden** — Every balance change to archetype stats cascades to 10-20 test assertions. Consider a test helper that reads archetype stats from the source data rather than hardcoding expected values. Estimated effort: M
- **[LOW] Runtime variant validation for deserialization** — Add a runtime guard (`if (!(variant in STEED_GEAR_VARIANTS[slot]))`) when gear is loaded from external sources. Estimated effort: S
- **[LOW] Make GiglingGear/PlayerGear stat fields required** — Change `primaryStat?` to `primaryStat` in types.ts to enforce that all gear has stats. Would require updating any code that constructs minimal gear objects for testing. Estimated effort: S

## Sign-off

**CHANGES REQUESTED** — 1 test still failing in match.test.ts:78 due to an incorrectly flipped assertion. The fix is a single-line change (swap player1/player2 in the expect). All other code reviewed this round is clean.

Tests passing: 588/589 (1 failure in match.test.ts — worked example assertion direction)
