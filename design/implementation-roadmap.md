# Implementation Roadmap — S23+ Feature Sprint

## 4 Phases, ~20 hours, each independently deployable

### Phase 1: Type System [0.5 hrs]
**Files**: types.ts only
- Add: GearVariant, GearVariantDefinition, variant registries
- Add: optional `variant` field on GiglingGear and PlayerGear
- Add: `wasUnseated?: boolean` on PlayerState
- Zero logic changes. Exit: 431 tests compile.

### Phase 2: Gear Variant Engine [7 hrs]
**New**: gear-variants.ts (3 variants × 12 slots = 36 definitions)
**Update**: gigling-gear.ts, player-gear.ts (variant-aware stat lookup)
**Update**: LoadoutScreen.tsx (variant selector per slot — 3 radio buttons each)
**Update**: simulate.ts (variant integration)
**Tests**: +70 new. Exit: ~440 tests pass, bare win rates stable.

### Phase 3A: Melee Rebalance [4.5 hrs] (parallel with 3B)
**Update**: calculator.ts (carryover divisors /3→/5, /4→/6, /5→/8)
**Update**: match.ts (wasUnseated flag tracking in transitionToMelee)
**Update**: phase-melee.ts (15% unseated impact bonus)
**Tests**: +10 new, ~50 updated. Exit: ~480 tests pass.

### Phase 3B: Gear Tiering [1.5 hrs] (parallel with 3A)
**Update**: balance-config.ts (uncommon rarity bonus 1→2)
**Tests**: ~15 updated. Exit: ~490 tests pass.

### Phase 4: UI Customization [7 hrs]
**New**: PresetMatchScreen.tsx, SetupCustomScreen.tsx
**Update**: App.tsx (new screen states), LoadoutScreen.tsx (rarity selectors + variants), SetupScreen.tsx
**Tests**: +25 new. Exit: ~510 tests pass, full flow working.

## Orchestrator Missions
Each phase → one mission config in orchestrator/missions/
- Phase 1: engine-dev + test-writer (30 min)
- Phase 2: engine-dev + ui-dev + test-writer + balance-analyst (7 hrs)
- Phase 3A: engine-dev + test-writer + balance-analyst (4.5 hrs)
- Phase 3B: balance-analyst + test-writer (1.5 hrs)
- Phase 4: ui-dev + test-writer + engine-dev (7 hrs)

## Dependency Graph
```
Phase 1 (Types) → Phase 2 (Variants) → Phase 3A (Melee) ∥ Phase 3B (Tiering) → Phase 4 (UI)
```

## Key Constraints
- Variants MUST be truly horizontal (same total stat budget per variant per slot)
- Fixed 3 variants per slot (Aggressive/Balanced/Defensive) — no exceptions
- SoftCap handles stat stacking naturally
- All variant naming follows: "[Aggressive|Balanced|Defensive] [SlotName]" or thematic name
- Counter system (Agg > Def > Bal > Agg) maps to variant philosophy
