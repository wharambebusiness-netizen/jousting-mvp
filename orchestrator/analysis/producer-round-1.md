# Producer Analysis — Round 1

## Session Context

This is the first round of a new overnight continuous improvement session. 5 agents are active: producer, balance-tuner, qa, polish, reviewer. All agents start at `not-started` status.

## Project State Assessment

### Test Suite
- **477 tests, 7 suites, all passing** — confirmed by running `npx vitest run`
- Test suites: calculator (127), playtest (106), match (71), gigling-gear (48), player-gear (46), gear-variants (44), phase-resolution (35)

### Current Archetype Stats (from archetypes.ts)
```
             MOM  CTL  GRD  INIT  STA  Total
charger:      75   55   50    60   60  = 300
technician:   55   70   55    60   55  = 295
bulwark:      55   55   65    53   62  = 290
tactician:    55   65   50    75   55  = 300
breaker:      62   60   55    55   60  = 292
duelist:      60   60   60    60   60  = 300
```

### Known Balance Issues (from CLAUDE.md + MEMORY.md)
1. **Charger weak at bare (~34-36%)** — below 44% target floor
2. **Technician slightly below 45% at epic/giga** — borderline
3. **Bulwark dominant (~66% at bare)** — above 58% target ceiling
4. **Breaker vs Bulwark (~24%)** — "anti-Bulwark" identity not delivering

### Key Constants (balance-config.ts)
- guardImpactCoeff: 0.18
- guardUnseatDivisor: 15
- breakerGuardPenetration: 0.20
- softCapKnee: 100, softCapK: 50

## Backlog Actions Taken

### Existing Tasks (10) — Updated
- Converted string priorities to numeric (1=highest)
- Refined task descriptions with test-lock warnings and specific stat references
- BL-001 (Technician fix): Added warning about CTL being test-locked, suggested STA/GRD as safer levers
- BL-002 (Charger fix): Added warning that ALL Charger stats are test-locked, suggested STA+2 or INIT+2
- BL-003: Repurposed from "Bulwark at Uncommon" to "breakerGuardPenetration effectiveness" — this is a higher-impact lever since it's NOT test-locked
- BL-009: Clarified reviewer should write findings to analysis, NOT move constants

### New Tasks (3) — Added
- **BL-011** (balance-analyst, P4): Full tier sweep — run sims at all 7 tiers to establish session baseline
- **BL-012** (qa-engineer, P4): Test breaker guard penetration mechanic — verify the mechanic works as designed
- **BL-013** (css-artist, P3): Polish combat result display — visual improvements to result screen

## Task Assignment Summary

| Agent | Assigned Task | Priority | Status |
|-------|--------------|----------|--------|
| balance-tuner | BL-001: Fix Technician at Epic/Giga | P1 | assigned |
| qa | BL-004: Test gear variant interactions | P1 | assigned |
| polish | BL-007: Rarity card styling | P1 | assigned |
| reviewer | BL-009: Magic number audit | P1 | assigned |

## Risk Assessment

### File Ownership Conflicts
- **No conflicts this round**: Each agent touches different files
  - balance-tuner: `archetypes.ts` only (BL-001 doesn't need balance-config.ts)
  - qa: `gear-variants.test.ts` only (BL-004)
  - polish: `App.css` only
  - reviewer: `types.ts` + writes to analysis/ only

### Sequencing Constraints
- BL-002 (Charger) depends on BL-001 (Technician) completing first — same files, same agent
- BL-003 (breakerGuardPenetration) can run in parallel with BL-002 since it only touches balance-config.ts
- BL-005/006/012 (QA tasks) must be sequential — same test files

### Test Stability Risk
- **Balance-tuner stat changes** will break hardcoded test assertions if Charger stats are modified (BL-002). Technician stats are partially locked (CTL=70 in tests). The balance-tuner needs to check test files before making changes.
- **QA adding tests** is low risk — only additive changes

## Metrics to Track

| Metric | Current | Session Target |
|--------|---------|---------------|
| Tests passing | 477 | 495+ |
| Win rate spread (bare) | ~32pp | <25pp |
| Weakest archetype (bare) | Charger ~34% | >40% |
| Strongest archetype (bare) | Bulwark ~66% | <58% |
| Breaker vs Bulwark | ~24% | >35% |

## Next Round Priorities

1. Review balance-tuner results from BL-001 — did Technician improve at epic/giga?
2. Review QA test additions from BL-004 — new test count?
3. If balance-tuner succeeded on BL-001, assign BL-002 (Charger) or BL-003 (breakerGuardPenetration)
4. If QA completed BL-004, assign BL-005 (softCap tests)
5. Check for any test failures introduced by other agents
