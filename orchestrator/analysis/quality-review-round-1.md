# Quality Review — Round 1

## Code Quality Assessment

### Engine (15 files reviewed)
- **Overall**: Excellent quality. Clean, modular, well-separated concerns.
- **Type safety**: Strong. No `any` types found. All interfaces properly defined in types.ts.
- **Code patterns**: Consistent across all files. Pure functions, no side effects in engine.
- **Dead code**: `resolvePass()` in calculator.ts is properly marked `@deprecated` with JSDoc. Still used in calculator.test.ts for base-formula validation — acceptable.
- **Naming**: Consistent camelCase, descriptive names. Attack IDs match across attacks.ts and counter tables.

### Potential Issues Found
1. **MeleeRoundResult.margin is absolute value** (phase-melee.ts:153 `Math.abs(margin)`) — the `margin` field loses sign information. The `winner` field compensates, but downstream code must use `winner` not `margin` to determine direction. This is by design but worth noting.
2. **CounterResult type comment stale** (types.ts:185): Comment says `+10, -10, or 0` but bonus actually scales with CTL (e.g., 6 to 14). Minor doc issue.

### No Bugs Found
All formulas verified against handoff spec. Counter tables symmetric. Fatigue, soft cap, guard fatigue all working correctly.

## Game Format Evaluation

### 5-Pass Joust Format
- **Verdict: Compelling.** 5 passes is the right number — enough for stamina management to matter (cheap attacks survive 5, expensive ones exhaust by pass 3), but not so many that games drag.
- The speed/attack decision tree gives 3x6 = 18 possible choices per pass, with shift adding another layer → meaningful decision space.
- No degenerate "always-win" strategy found. All 6 attacks repeated 5x survive as mirror matchups. CF exhausts by pass 3 but still plays. PdL survives all 5 comfortably but deals less impact.

### Counter System
- **Verdict: Well-balanced.** The Agg > Def > Bal > Agg triangle creates genuine rock-paper-scissors tension. No uncounterable attack (every attack is beaten by at least 1 other). The CTL-scaling counter bonus (4 + CTL*0.1) rewards high-control archetypes without making counters irrelevant for low-control ones.

### Shift Mechanic
- **Verdict: Good strategic depth.** Cross-stance shifts cost 2.4x more stamina (12 vs 5) and 2x more initiative (10 vs 5) than same-stance. This makes "reactive" shifts expensive, which is correct — they shouldn't be free. The initiative-priority ordering (lower INIT shifts first = disadvantage) rewards Tactician's high INIT.

### Melee Phase
- **Verdict: Appropriate length.** First-to-4 wins with criticals counting as 2 means matches can end in 2-8 rounds realistically. Guard fatigue floor (50%) prevents infinite turtling. The exhaustion tiebreaker chain (melee wins → joust score → draw) handles all edge cases cleanly.

### Caparisons
- **Verdict: Meaningful strategic depth.** Each caparison has a clear use case tied to playstyle. Thunderweave rewards aggressive play (Fast speed). Shieldcloth rewards defensive play. Stormcloak rewards attrition. Banner of the Giga is a one-shot spike. Irongrip enables otherwise-impossible shifts. No "noise" effects — all feel impactful.

### Potential Degenerate Strategies
- **PdL spam**: Cheapest attack (8 STA), survives 5 passes easily. But it beats only CdL and CEP — if opponent picks CF/BdG, PdL loses the counter. Not dominant.
- **Always Slow+Defensive**: Gains +5 STA/pass, shift threshold only 50. But low momentum means low impact. Opponent outscores through aggressive play.
- **No degenerate strategy found.** The counter triangle and stamina/momentum tradeoffs prevent any single approach from dominating.

## Edge Cases Tested — All Pass

| Test Category | Tests Added | Result |
|---|---|---|
| Both players 0 stamina full pass | 2 | PASS |
| Shift cost differences (same vs cross-stance) | 2 | PASS |
| Maximum gear stacking (Giga on Giga) | 3 | PASS |
| Counter bonus asymmetry | 2 | PASS |
| Unseat threshold extremes | 2 | PASS |
| Melee at guard 0 with carryover | 1 | PASS |
| All 6 joust attacks as degenerate strategy | 6 | PASS |
| All 6 melee attacks mirror matchup | 6 | PASS |
| Melee exhaustion with unequal wins | 1 | PASS |
| Unseat naming convention verification | 1 | PASS |
| Varied attack selection across 5 passes | 1 | PASS |
| Melee stamina drain tracking | 1 | PASS |

**Total new tests: 28** (calculator.test.ts: 12, match.test.ts: 16)
**Total tests now: 295** (was 222)

## Test Coverage Gaps Remaining
1. **AI unit tests**: No tests for basic-ai.ts. AI validated indirectly through playtests.
2. **React component tests**: No UI tests exist.
3. **Unseat with both exceeding threshold with different margins**: Partially tested in calculator.test.ts (section 17, "double unseat: higher margin wins") but only as mirror matchup. A non-mirror double-unseat scenario would be valuable.
4. **Shift eligibility at exact threshold boundary**: canShift uses `>=`, boundary tested at 10 STA but not at exact CTL threshold.

## Improvement Proposals (NOT implemented — for discussion only)

### Format Proposals
1. **Consider Breaker unique mechanic**: Breaker is "anti-Bulwark" by identity but has no mechanical differentiation beyond stats. A "guard shatter" bonus on counter wins vs Defensive attacks would reinforce its identity.
2. **Pass stamina visibility**: Consider showing estimated remaining passes at each attack's cost to help players plan.

### Balance Observation
- Duelist (300 stat total, all 60s) is the strongest generalist — it never has a weakness to exploit. It might benefit from 295 total (e.g., -5 from one stat) to give other archetypes a clearer niche.

## Test Suite Summary
```
Tests: 295 passed (295)
Files: 5 passed (5)
Duration: 446ms
```
