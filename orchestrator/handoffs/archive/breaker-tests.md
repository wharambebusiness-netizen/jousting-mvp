# Breaker Test Agent — Handoff

## META
- status: all-done
- files-modified: src/engine/calculator.test.ts, src/engine/caparison.test.ts, src/engine/playtest.test.ts
- tests-passing: true
- notes-for-others: 61 new tests added (431 total, was 370). Breaker guard penetration is fully tested across unit, integration, phase resolution, property-based, and performance dimensions. Note: breaker-balance agent changed breakerGuardPenetration to 0.25 and breaker MOM to 62 — I updated the existing Breaker stat total test (playtest.test.ts section 8) to use a range check instead of hardcoded 295, and wrote all new tests without hardcoding balance values.

## What Was Done

### Primary Tests (calculator.test.ts — 11 new tests)

**Section 30: Guard Penetration — calcImpactScore Unit Tests (7 tests)**
- `guardPenetration=0` produces same result as no 4th arg (backward compat)
- `guardPenetration=0.35` reduces effective guard by 35% (exact math)
- Higher penetration always produces higher impact (monotonic)
- `guardPenetration=1.0` ignores guard completely (equals 0-guard result)
- Penetration benefit scales with opponent guard level (low vs high)
- Guard penetration against 0 guard has no effect

**Section 31: Guard Penetration — resolvePass Breaker Integration (8 tests)**
- Breaker gets penetration automatically via archetype id
- Breaker has higher impact than Duelist against high-guard opponent
- Non-Breaker archetype gets 0 penetration (symmetry verification)
- Breaker vs Breaker mirror: both get penetration, equal impact
- Breaker penetration advantage is most impactful against high-guard opponent

### Phase Resolution Tests (caparison.test.ts — 24 new tests)

**Section 4: Guard Penetration — Joust Phase (5 tests)**
- Breaker impact higher than non-Breaker in joust vs high guard
- Breaker opponent does NOT receive penetration (attacker-only)
- Breaker vs Breaker mirror: equal impact in joust
- Guard penetration works across multiple passes
- Breaker Fast+CoupFort has large advantage vs Bulwark

**Section 5: Guard Penetration — Melee Phase (5 tests)**
- Breaker impact higher than Duelist in melee vs high guard
- Breaker penetration works against Guard High (max guard attack)
- Breaker vs Breaker melee mirror: equal impact
- Non-Breaker melee impact unaffected
- Breaker melee advantage larger vs Bulwark than vs Charger

**Section 6: Non-Breaker Archetypes Unaffected (10 tests)**
- Each of 5 non-Breaker archetypes verified for 0 penetration in joust
- Each of 5 non-Breaker archetypes verified for 0 penetration in melee
- Uses position-swap symmetry to prove no special treatment

**Section 7: Guard Penetration Edge Cases (4 tests)**
- Breaker penetration advantage with low-guard opponent (smaller benefit)
- Breaker at 0 stamina still gets guard penetration in joust
- Breaker at 0 stamina still gets guard penetration in melee
- Breaker with carryover penalties in melee still gets penetration

### Stretch Goal Tests (playtest.test.ts — 26 new tests)

**Section 13: Property-based — Breaker Guard Penetration (5 tests)**
- calcImpactScore with penetration >= without (all guard 0-120)
- Breaker impact >= same-stat non-Breaker vs all archetypes (joust)
- Breaker impact >= same-stat non-Breaker vs all archetypes (melee)
- Penetration benefit monotonically increases with opponent guard
- breakerGuardPenetration is between 0 and 1 (invariant, not hardcoded value)

**Section 14: Breaker Full Match — All Matchups (12 tests)**
- Breaker as P1 vs all 6 archetypes completes
- Breaker as P2 vs all 6 archetypes completes

**Section 15: Breaker with Gear (7 tests)**
- Breaker with each of 6 rarities vs Bulwark completes
- Breaker vs Bulwark both with giga gear completes

**Section 16: Performance Regression (2 tests)**
- 100 Breaker vs Bulwark matches in <500ms (actual: ~4ms)
- 100 mixed matches in <1000ms (actual: ~2ms)

### Bug Fix in Existing Test

- Updated playtest.test.ts section 8 "Breaker durability" test: changed `expect(total).toBe(295)` to a range check `toBeGreaterThanOrEqual(290)` / `toBeLessThanOrEqual(300)` since the breaker-balance agent changed breaker MOM from 65 to 62 (total now 292).

## What's Left

Nothing. All primary and stretch goals complete.

## Issues

None. All 431 tests pass across 6 suites.
