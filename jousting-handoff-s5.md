# Jousting MVP — Session 5 Handoff

## Working Style
- User wants full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Generate handoff at ~60k tokens

## Session 5 Summary
**Focus:** Balance scaling system — future-proofing formulas for gear/progression.

### What Was Done
1. **Discussed combat system scalability** — analyzed what breaks when stats inflate from gear/levels
2. **Implemented 5 balance scaling changes** to the calculator engine:
   - Soft cap (diminishing returns) on stats above 100
   - Fatigue threshold relative to max stamina (not hardcoded 40)
   - Partial guard fatigue (guard drops to 50% at 0 stamina)
   - Counter bonus scales with winner's effective control
   - Melee hit/crit thresholds relative to defender's guard
3. **Created `balance-config.ts`** — single file with all tuning constants
4. **Rewrote test suite** — 57 calculator tests + 8 match tests = 65 total (up from 50)
5. **Initialized git repo**, committed, pushed to GitHub, deployed to gh-pages
6. **Ran balance simulation** across all archetype matchups

### Key Design Decisions

**Calibration philosophy:** Config values set so current (no-gear) gameplay is minimally affected. Only Charger Fast+CF momentum (110→108.33) changes at base stats. The system is ready for gear to push stats higher without breaking.

**Soft cap formula:** `softCap(value) = value` when ≤ knee (100), otherwise `knee + excess * K / (excess + K)` where K=50. Piecewise — linear below threshold, compressed above. This means current stats (mostly 20-95 range) are untouched.

**Fatigue ratio 0.8:** threshold = maxStamina × 0.8. For Charger (STA 50) this gives threshold 40 (same as old hardcoded value). For Bulwark (STA 65) it's 52 — higher threshold means Bulwark's fatigue buffer advantage is narrowed, which is intentional to prevent STA stacking from being purely beneficial.

**Guard fatigue floor 0.5:** `guardFF = 0.5 + 0.5 × fatigueFactor`. At full stamina, guard is 100% effective. At 0 stamina, guard drops to 50%. This prevents the infinite turtle problem where a Bulwark could stack guard and never lose it to fatigue.

**Counter scaling:** `bonus = 4 + winnerEffCTL × 0.1`. At average CTL 60, bonus = 10 (matches old flat value). Low-CTL brute force builds (Charger Fast+CF with CTL 20) get only ±6 from counters. High-CTL builds (Technician with CTL 85) get ±12.5. This rewards counter-play knowledge proportionally to skill investment.

**Melee thresholds:** `hitThreshold = 3 + defenderGuard × 0.031`, `critThreshold = 15 + defenderGuard × 0.154`. At average guard ~65, thresholds are ~5 and ~25 (matching old flat values). Tanky defenders require bigger margins to score against.

### Balance Simulation Results (simple heuristic AI)
| Archetype | Win Rate |
|-----------|----------|
| Tactician | 60% |
| Charger | 55% |
| Duelist | 50% |
| Technician | 45% |
| Bulwark | 45% |
| Breaker | 45% |

Spread of 45-60% is reasonable. Tactician slightly overperforms due to high initiative + control benefiting from scaled counter system. Bulwark's old turtle dominance is reduced by guard fatigue. Real player choice would tighten this further.

### Files Changed
- **NEW** `src/engine/balance-config.ts` — all tuning constants
- **MODIFIED** `src/engine/calculator.ts` — softCap, relative fatigue, guard fatigue, scaled counters, relative melee thresholds
- **MODIFIED** `src/engine/phase-joust.ts` — passes maxStamina/CTL/guard to calculator
- **MODIFIED** `src/engine/phase-melee.ts` — passes maxStamina/CTL/guard to calculator
- **REWRITTEN** `src/engine/calculator.test.ts` — 57 tests covering new scaling properties
- **UNCHANGED** `src/engine/match.test.ts` — all 8 tests still pass (directional assertions)
- **UNCHANGED** all UI files, types.ts, attacks.ts, archetypes.ts, match.ts

### Architecture Tree (engine only)
```
src/engine/
├── balance-config.ts    # NEW — tuning constants (softCap, fatigue, counters, thresholds)
├── types.ts             # Enums, interfaces (unchanged)
├── attacks.ts           # 12 attacks + speeds (unchanged)
├── archetypes.ts        # 6 archetypes (unchanged)
├── calculator.ts        # All formulas — now with scaling (5 functions modified, 2 added)
├── phase-joust.ts       # Joust pass resolution (updated call sites)
├── phase-melee.ts       # Melee round resolution (updated call sites)
├── match.ts             # State machine (unchanged)
├── calculator.test.ts   # 57 tests (rewritten for scaling properties)
└── match.test.ts        # 8 integration tests (unchanged)
```

### Function Signature Changes
```
fatigueFactor(currentStamina, maxStamina)          // was: fatigueFactor(currentStamina)
resolveCounters(atk1, atk2, eff1Ctl, eff2Ctl)     // was: resolveCounters(atk1, atk2)
resolveMeleeRound(margin, defenderEffGuard)        // was: resolveMeleeRound(margin)
```

### New Exported Functions
```
softCap(value: number): number
guardFatigueFactor(ff: number): number
```

### Deployment
- **GitHub:** https://github.com/wharambebusiness-netizen/jousting-mvp
- **Live:** https://wharambebusiness-netizen.github.io/jousting-mvp/
- **Build:** 238KB JS / 71KB gzip

### Gotchas Carried Forward
- Counter table directions: always verify against v4.1 Sections 2.3/2.4
- Guard High beats Measured Cut (not vice versa)
- Stamina asymmetry dominates melee — expensive attacks lose to cheap ones via fatigue
- fatigueFactor() now requires maxStamina as 2nd arg
- resolveCounters() takes eff CTL values; bonus = 4 + winnerCTL×0.1 (=10 at CTL 60)
- resolveMeleeRound() takes defenderEffGuard; thresholds are no longer flat 5/25
- Guard now partially fatigues via guardFatigueFloor (0.5 = drops to 50% at 0 stamina)
- softCap only affects stats above knee (100); only Charger Fast+CF momentum (110→108.33) is affected currently
- Node v20.18.1 triggers Vite warnings but works fine

### What Could Come Next
- **Tune balance config** — adjust constants based on playtesting feedback
- **Gear system** — add equipment that modifies base stats (softCap + relative fatigue already handle scaling)
- **Breaker buff** — at 45% win rate, Breaker's anti-Bulwark niche is less valuable now that guard fatigues naturally. Consider giving Breaker a unique mechanic (guard penetration?) or stat adjustment
- **Tactician nerf** — at 60%, Tactician may be slightly overtuned. Could reduce initiative or control slightly
- **AI difficulty levels** — the basic AI doesn't use shifts or counter-reading
- **Pass-and-play** — same engine, just UI for controller swap
- **Tournament mode** — bracket management layer over existing 1v1 engine
- **Unity port** — engine is pure TS with zero UI deps, maps directly to C# static classes
