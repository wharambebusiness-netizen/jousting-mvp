# Jousting MVP — Session 6 Handoff

## Working Style
- User wants full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Generate handoff at session end

## Session 6 Summary
**Focus:** Melee pacing rebalance + developer onboarding documentation.

### What Was Done
1. **Created SYSTEM-OVERVIEW.md** — complete system rundown for onboarding new developers. Covers architecture, all formulas, attack tables, match flow, balance config, AI behavior, state machine API, UI structure, and gotchas. Single-file, standalone.
2. **Extended melee to first-to-4 round wins** (was first-to-3) — melee felt too quick. Deep analysis of stamina economy showed 5 wins would cause exhaustion stalls (both at 0 STA, margins too small for hits, perpetual Draws). 4 wins adds 1-2 meaningful rounds without hitting that wall.
3. **Changed criticals from instant-win to 2 round wins** — analyzed full joust-to-melee arc including carryover penalties, stamina economy, and archetype balance. Instant crits made melee feel like a formality after unseat. Crit = 2 wins preserves the "big hit" moment while giving the losing player a chance to fight back. At 2 wins, landing a crit from 0 gives momentum (2-0); from 2 wins it closes the match (4). Clean scaling.
4. **Moved melee win constants into balance-config.ts** — `meleeWinsNeeded` and `criticalWinsValue` now live alongside all other tuning constants. Future gear/balance passes can adjust from one file.
5. **Pushed to GitHub + deployed to gh-pages**

### Key Design Decisions

**Why not first-to-5:** At 0 stamina both players have effMOM=0, effCTL=0, guard at 50% floor, counter bonus shrinks to ±4. Margins are ~1-3 points vs hit threshold of ~5. Nearly every round is a Draw. The exhaustion tiebreaker would fire constantly, making melee a formality decided by joust score. First-to-4 avoids this.

**Why crit = 2 wins not instant:** Traced through three melee entry scenarios:
- Strong unseat (margin ~35): unseater still wins, but melee is a real phase, not a formality
- Narrow unseat (margin ~28): close joust stays close through melee
- Tied joust: one counter read gives momentum, not instant victory

**Archetype balance impact (mild, all in right direction):**
- Bulwark (was 45%) — mild buff, longer melee suits attrition identity
- Technician (was 45%) — mild buff, more counter-reading opportunities
- Charger (was 55%) — mild nerf, can't rely on one explosive melee round
- Tactician (was 60%) — neutral to mild nerf
- Breaker (was 45%) — slight hurt from longer melee, but designed to win joust not melee

**Crit threshold unchanged (base 15, ~25 at avg guard):** Criticals are a safety valve against stalling. In the longer format they add tension ("can I score the crit before we both exhaust?") rather than removing it. Raising the threshold would make late-game grindier.

### Files Changed
- **NEW** `SYSTEM-OVERVIEW.md` — complete developer onboarding document
- **MODIFIED** `src/engine/balance-config.ts` — added `meleeWinsNeeded: 4`, `criticalWinsValue: 2`
- **MODIFIED** `src/engine/match.ts` — imports from balance-config, unified crit/hit win logic (removed instant-crit code path)
- **MODIFIED** `src/engine/match.test.ts` — updated melee test description and assertion (>= 3 wins)
- **MODIFIED** `src/ui/MeleeTransition.tsx` — "First to 4 round wins. Critical hits count as 2 wins!"
- **MODIFIED** `src/ui/MatchSummary.tsx` — "first to 4, criticals count as 2"
- **UNCHANGED** calculator.ts, phase-joust.ts, phase-melee.ts, types.ts, attacks.ts, archetypes.ts, all other UI

### Balance Config (current full state)
```
softCapKnee:       100    // stats below = linear
softCapK:          50     // diminishing returns intensity
fatigueRatio:      0.8    // fatigue below 80% of max STA
guardFatigueFloor: 0.5    // guard drops to 50% at 0 STA
counterBaseBonus:  4      // base counter bonus
counterCtlScaling: 0.1    // bonus = 4 + CTL × 0.1
meleeHitBase:      3      // hit threshold base
meleeHitGrdScale:  0.031  // hit threshold += GRD × 0.031
meleeCritBase:     15     // crit threshold base
meleeCritGrdScale: 0.154  // crit threshold += GRD × 0.154
meleeWinsNeeded:   4      // NEW — round wins to take melee
criticalWinsValue: 2      // NEW — wins per critical hit
```

### Deployment
- **GitHub:** https://github.com/wharambebusiness-netizen/jousting-mvp
- **Live:** https://wharambebusiness-netizen.github.io/jousting-mvp/
- **Build:** 238KB JS / 71KB gzip
- **65 tests passing**

### Gotchas Carried Forward
- Counter table directions: always verify against v4.1 Sections 2.3/2.4
- Guard High beats Measured Cut (not vice versa)
- Stamina asymmetry dominates melee — expensive attacks lose to cheap ones via fatigue
- `fatigueFactor()` requires maxStamina as 2nd arg
- `resolveCounters()` takes eff CTL values; bonus = 4 + winnerCTL×0.1
- `resolveMeleeRound()` takes defenderEffGuard; thresholds are not flat
- Guard partially fatigues via guardFatigueFloor (0.5)
- softCap only affects stats above knee (100)
- `unseat === 'player1'` means player 1 performed the unseat (player 2 fell)
- Node v20.18.1 triggers Vite warnings but works fine
- **NEW:** Criticals no longer instant-win — they add `criticalWinsValue` (2) to round wins. The win-count check handles everything uniformly.
- **NEW:** `MELEE_WINS_NEEDED` no longer exists in match.ts — it's `BALANCE.meleeWinsNeeded` from balance-config.ts

### What Could Come Next
- **Tune balance config** — adjust constants based on playtesting feedback
- **Gear system** — equipment that modifies base stats (softCap + relative fatigue already handle scaling)
- **Breaker buff** — at 45% win rate, consider guard penetration mechanic or stat adjustment
- **Tactician nerf** — at 60%, could reduce initiative or control slightly
- **AI difficulty levels** — basic AI doesn't use shifts or counter-reading strategically
- **Pass-and-play** — same engine, UI for controller swap
- **Tournament mode** — bracket management over existing 1v1
- **Unity port** — engine is pure TS with zero UI deps, maps to C# static classes
