# Jousting MVP — Session 15 Handoff (Combat Logic Review)

## What Was Done

### Comprehensive Combat Logic Review
Full analysis of every engine file, all attack tables, archetype stats, formulas, and AI behavior. Found and fixed 5 significant issues.

### Changes Made

#### 1. Joust Counter Table Fix — Port de Lance beats Coup en Passant
**File:** `src/engine/attacks.ts`
- **Problem:** Coup en Passant had ZERO counters (beaten by nothing). This made it strictly dominant over Port de Lance for any defensive player. Port de Lance was beaten by 3/5 attacks while only beating 1.
- **Fix:** Port de Lance now also beats Coup en Passant. Rationale: stable defensive posture catches the mobile passing strike.
- **Result:** Coup en Passant now has 1 counter (2 beats / 1 beaten). Port de Lance improves from 1/3 to 2/3. Defensive stance now has an interesting internal choice: PdL for max guard (but more vulnerable), CEP for mobile counter-immune play (but beaten by PdL).

#### 2. Melee Precision Thrust Stat Fix
**File:** `src/engine/attacks.ts`
- **Problem:** Precision Thrust had deltaGuard -5, making it strictly dominated by Measured Cut on every axis (worse guard, more expensive, AND worse counter profile 1/2 vs 2/1).
- **Fix:** deltaGuard changed from -5 to 0. Now PT offers +5 CTL advantage over MC (15 vs 10) at the cost of +2 STA and worse counters. Clear identity: "high accuracy balanced attack for control builds."

#### 3. Charger Stamina Rebalance (50 → 60)
**File:** `src/engine/archetypes.ts`
- **Problem:** Charger had the lowest stat total (280 vs 300 for Duelist/Tactician). With STA 50, going Fast+CoupFort drained to 25 after pass 1, making the Charger nearly useless by pass 3. The "wins fast or fades" identity was too punishing — it was just "fades."
- **Fix:** STA 50 → 60 (total 280 → 290). Charger can now sustain 3 aggressive passes before exhaustion. Still fades in long matches but has a realistic window to force an unseat.

#### 4. Breaker Stat Rebalance (GRD 50→55, STA 50→60)
**File:** `src/engine/archetypes.ts`
- **Problem:** Breaker had the same 280 stat total as Charger but without the Charger's peak momentum. Couldn't survive long enough to actually "break" anything.
- **Fix:** GRD 50→55, STA 50→60 (total 280 → 295). Higher guard lets the Breaker survive melee, higher stamina lets them sustain pressure. Better differentiates from Charger: Charger = burst damage, Breaker = sustained pressure.

#### 5. AI Stance Triangle Fix (Was Completely Inverted!)
**File:** `src/ai/basic-ai.ts`
- **Problem:** The AI's stance triangle heuristic was picking the LOSING stance every time:
  - vs Defensive → picked Balanced (wrong, should be Aggressive)
  - vs Aggressive → picked Defensive (wrong, should be Balanced)
  - vs Balanced → picked Aggressive (wrong, should be Defensive)
- **Fix:** Corrected to match the actual counter table: Agg > Def > Bal > Agg. Fixed in both `pickJoustAttack()` and `pickMeleeAttack()`.
- **Impact:** AI now makes strategically sound stance choices instead of consistently picking into disadvantage.

### Test Updates
All 157 tests updated and passing. Key changes:
- Pass 1/2/3 worked examples updated for Charger STA 60 (fatigue thresholds, effective stats, end stamina)
- Match creation test updated for Charger initial STA 60
- Stamina tracking test updated for new drain values
- Pass 3 direction changed: Charger now WINS pass 3 (less fatigue = stronger late game)

## Archetype Stat Totals (Post-Rebalance)
```
charger:    70/45/55/60/60 = 290  (was 280)
technician: 50/70/55/60/55 = 290
bulwark:    55/55/75/45/65 = 295
tactician:  55/65/50/75/55 = 300
breaker:    65/60/55/55/60 = 295  (was 280)
duelist:    60/60/60/60/60 = 300
```
Gap narrowed from 280-300 (7% spread) to 290-300 (3.3% spread).

## Joust Counter Table (Post-Fix)
```
coupFort:       beats [portDeLance]                    beatenBy [coupEnPassant, courseDeLance]   (1/2)
brisDeGarde:    beats [portDeLance, coupDePointe]      beatenBy [courseDeLance]                  (2/1)
courseDeLance:  beats [coupFort, brisDeGarde]          beatenBy [portDeLance]                    (2/1)
coupDePointe:   beats [portDeLance]                    beatenBy [brisDeGarde, coupEnPassant]     (1/2)
portDeLance:    beats [courseDeLance, coupEnPassant]   beatenBy [coupFort, brisDeGarde, coupDeP] (2/3)
coupEnPassant:  beats [coupFort, coupDePointe]         beatenBy [portDeLance]                    (2/1)
```

## Melee Counter Table (Unchanged except PT stats)
```
overhandCleave:   beats [guardHigh, riposteStep]       beatenBy [measuredCut, precisionThrust]   (2/2)
feintBreak:       beats [precisionThrust]              beatenBy [riposteStep]                    (1/1)
measuredCut:      beats [overhandCleave, riposteStep]  beatenBy [guardHigh]                      (2/1)
precisionThrust:  beats [overhandCleave]               beatenBy [feintBreak, riposteStep]        (1/2) [GRD 0, was -5]
guardHigh:        beats [measuredCut]                  beatenBy [overhandCleave]                 (1/1)
riposteStep:      beats [feintBreak, precisionThrust]  beatenBy [overhandCleave, measuredCut]    (2/2)
```

## Analysis Notes (Reviewed but Not Changed)

### Formulas — All Sound
- Impact formula weights: MOM (0.6 effective) > CTL (0.5) > GRD (0.3) > INIT (0.2)
- Unseat threshold `20 + defGRD/10 + defSTA/20` — properly high, requires dominant pass
- Soft cap, fatigue, guard fatigue — all well-calibrated
- Counter scaling with CTL — good, rewards skill investment

### Speeds — Balanced
- Slow: +15 accuracy advantage, +5 STA, easy shifts
- Standard: neutral, +5 accuracy from INIT, moderate shifts
- Fast: +15 MOM advantage, -5 STA, hard shifts, best INIT
- Each has clear use cases per archetype

### Caparisons — Appropriate Power Levels
- All 6 effects reviewed, power scales with rarity
- Pennant of Haste (+2 INIT on pass 1) is weakest but appropriately uncommon-tier
- Balance config values don't need changes

### Remaining Design Consideration
- **Breaker identity**: "Guard shatter" fantasy isn't mechanically supported. Consider a future unique mechanic (e.g., anti-defensive counter bonus, guard reduction on hit). Currently Breaker is differentiated from Charger by higher CTL (60 vs 45) enabling shifts + sustained pressure, which is functional but not flashy.

## Files Modified
- `src/engine/attacks.ts` — counter table + PT guard fix
- `src/engine/archetypes.ts` — Charger/Breaker stat rebalance
- `src/ai/basic-ai.ts` — stance triangle correction
- `src/engine/calculator.test.ts` — updated worked examples
- `src/engine/match.test.ts` — updated stamina/direction expectations
