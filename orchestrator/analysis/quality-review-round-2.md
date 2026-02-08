# Quality Review — Round 2

## Round 2 Changes Reviewed

### ai-engine agent: `src/ai/basic-ai.ts`
**Quality: Excellent.** Major additions:
1. **OpponentHistory class** (lines 57-101): Clean pattern tracker with configurable history length. Uses Map for counting, properly bounded by `BALANCE.aiPattern.historyLength`. Threshold of `count >= 2` is simple but effective for 3-item history.
2. **AI Commentary system** (lines 106-175): Per-archetype flavor text with 5 emotional states (lowStamina, highMomentum, aggressive, defensive, patternRead). Fallback to duelist if unknown archetype. Good prioritization order: pattern > low stamina > high momentum > stance > empty string.
3. **Archetype Personality system** (lines 183-201): Stat-neutral AI personality modifiers separate from archetype stats. Each archetype has distinct behavior (Charger prefers Fast, Bulwark prefers Slow, Technician prefers shifts, Breaker is melee-aggressive). Values are reasonable — modifiers are small enough to influence but not dominate.
4. **Caparison selection** (lines 455-483): Archetype-weighted caparison choice with a 20% "no caparison" chance for variety. Weights are sensible (Charger → Thunderweave, Bulwark → Shieldcloth, etc.).
5. **Pattern exploitation** (lines 240-248, 312-317): Only active on hard difficulty. Counter-logic is reasonable (Fast → pick Slow to counter, predicted attack → pick what beats it).
6. **All new signatures are backwards-compatible** — new params (`history`, `commentary`) are optional. No breaking changes.

**No issues found.** Type safety is strong (no `any`), all new interfaces are properly exported, and the difficulty system integrates cleanly with `BALANCE.aiDifficulty`.

### ui-polish agent: `src/ui/helpers.tsx`, `PassResult.tsx`, `MatchSummary.tsx`, `App.css`

**Quality: Good overall.** Notable additions:
1. **helpers.tsx**: New components — `CaparisonBadge`, `joustCapTriggered`, `meleeCapTriggered`, `PassPips`, `StaminaBar`, `Scoreboard`. All properly typed. Scoreboard accepts optional `passNumber`/`totalPasses` for pass progress pips.
2. **PassResult.tsx**: Clean layout with counter badges, caparison trigger display, stats breakdown.
3. **MatchSummary.tsx**: New `MatchTimeline` component with animated pips. LoadoutMini for gear display.
4. **App.css**: Well-organized CSS with animations, rarity themes, mobile responsiveness.

**Bug found: Counter Bonus display hardcoded in PassResult.tsx**
- Lines 111-112: `{counters.player1Bonus > 0 ? '+10' : counters.player1Bonus < 0 ? '-10' : '0'}`
- Lines 116-117: Same pattern for player2.
- The actual counter bonus scales with CTL (range ~4-14), but the UI always displays "+10" or "-10".
- **This is a display bug.** Should use the actual value: `counters.player1Bonus > 0 ? '+' + counters.player1Bonus.toFixed(1) : ...`
- **Not fixed** (PassResult.tsx is owned by ui-polish). Logged for that agent.

### balance-config.ts: `src/engine/balance-config.ts`
- New `aiDifficulty` and `aiPattern` sections added by ai-engine agent.
- Values are reasonable: easy 40% optimal, medium 70%, hard 90%.
- Pattern history length of 3 is short enough to be exploitable but not unfair.

## New Tests Added (Round 2)

| Test Category | Tests Added | Result |
|---|---|---|
| Shift eligibility at exact CTL threshold (all 3 speeds) | 8 | PASS |
| Non-mirror double unseat (asymmetric archetypes) | 2 | PASS |
| Full Giga gear match simulation (shift capability, varied attacks) | 4 | PASS |
| Soft cap ratio: Giga vs base impact | 1 (part of gear sim) | PASS |
| All archetype combinations complete 5-pass joust | 16 | PASS |
| Full match lifecycle (joust → melee → winner) | 1 | PASS |
| Shift denied mid-match from stamina drain | 1 | PASS |

**Total new tests: 32** (calculator.test.ts: 14, match.test.ts: 18)

## Test Suite Summary
```
Tests: 327 passed (327)
Files: 5 passed (5)
Duration: 439ms
```
- Before round 2: 295 tests
- After round 2: 327 tests (+32)

## Game Format Re-evaluation (Round 2)

### AI Behavior Quality Assessment
The AI engine changes are well-designed:
- **Difficulty scaling** uses a clean "optimal vs random" ratio. Easy AI makes random choices 60% of the time — appropriately forgiving. Hard AI is 90% optimal with pattern exploitation — appropriately punishing.
- **Archetype personality** adds character without unbalancing. Modifiers are small (±1 to ±3) compared to base weights (1-5), so they influence but don't dictate.
- **Pattern detection** is simple (count >= 2/3 in history of 3) but effective. Only triggers on hard — good design choice.
- **Commentary** system is well-structured and adds flavor without requiring UI changes (it's opt-in via `WithCommentary` variants).

### Potential Concerns
1. **AI shift cost hardcoded**: In `evaluateShift()` line 376, shift costs are hardcoded as `const shiftCost = candidate.stance === currentAttack.stance ? 5 : 12`. These match `calculator.ts:applyShiftCost()` but if balance constants change, the AI would be out of sync. Not a bug today, but a maintenance risk.
2. **No AI tests**: The AI is validated through playtests but has no unit tests. This is acceptable for now (AI is heuristic, not deterministic) but the pattern detection and commentary could benefit from unit tests in a future round.

## Bugs Found
1. **PassResult.tsx counter display hardcoded** (lines 111-112, 116-117): Shows "+10"/"-10" instead of actual scaled counter bonus value. **Owned by ui-polish agent.**

## Issues
- No engine bugs found.
- No test failures.
- All 327 tests passing.
