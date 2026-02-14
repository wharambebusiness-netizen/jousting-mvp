# Balance Reference

All balance data for the jousting engine. **Regenerate with:** `npx tsx src/tools/simulate.ts --summary balanced --matches 1000`

## Current Archetype Stats

```
             MOM  CTL  GRD  INIT  STA  Total
charger:      75   55   50    55   65  = 300
technician:   64   70   55    59   55  = 303
bulwark:      58   52   64    53   62  = 289
tactician:    55   65   50    75   55  = 300
breaker:      62   60   55    55   62  = 294
duelist:      60   60   60    60   60  = 300
```

Source: `src/engine/archetypes.ts`

## Balance Coefficients

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `softCapKnee` | 100 | Diminishing returns threshold |
| `softCapK` | 55 | Compression rate above knee |
| `guardImpactCoeff` | 0.12 | Guard's effect on reducing impact |
| `guardUnseatDivisor` | 18 | Guard's effect on unseat threshold |
| `guardFatigueFloor` | 0.3 | Minimum guard effectiveness at 0 stamina |
| `counterBaseBonus` | 4 | Base counter advantage |
| `counterCtlScaling` | 0.1 | CTL scaling on counter bonus |
| `breakerGuardPenetration` | 0.25 | Breaker ignores 25% of opponent guard |
| `unseatedImpactBoost` | 1.35 | Melee boost for joust loser (+35%) |
| `unseatedStaminaRecovery` | 12 | Stamina recovery for joust loser |
| `meleeWinsNeeded` | 4 | Wins required to take melee |
| `criticalWinsValue` | 2 | Wins awarded for critical hit |

Source: `src/engine/balance-config.ts`

## Win Rate Validation (S52)

**ALL TIERS AND VARIANTS: ZERO FLAGS**

### Bare Tier (N=1000, balanced variant)
| Rank | Archetype | Win% |
|------|-----------|------|
| 1 | Technician | 52.9% |
| 2 | Bulwark | 52.4% |
| 3 | Duelist | 50.4% |
| 4 | Tactician | 50.2% |
| 5 | Breaker | 48.2% |
| 6 | Charger | 45.9% |
Spread: 7.0pp (zero flags)

### Epic Tier (N=1000, balanced variant)
| Rank | Archetype | Win% |
|------|-----------|------|
| 1 | Charger | 53.0% |
| 2 | Breaker | 50.0% |
| 3 | Bulwark | 49.7% |
| 4 | Tactician | 49.2% |
| 5 | Technician | 49.2% |
| 6 | Duelist | 48.9% |
Spread: 4.1pp (zero flags)

### Giga Tier (N=1000, balanced variant)
| Rank | Archetype | Win% |
|------|-----------|------|
| 1 | Breaker | 51.6% |
| 2 | Technician | 51.2% |
| 3 | Tactician | 50.3% |
| 4 | Charger | 49.8% |
| 5 | Duelist | 49.1% |
| 6 | Bulwark | 48.0% |
Spread: 3.6pp (zero flags)

### Tier Progression
7.0pp (bare) → 4.1pp (epic) → 3.6pp (giga) — balance improves monotonically with tier.

### Variant Impact (S52, N=500)
| Variant | Tier | Spread | Flags | Top | Bottom |
|---------|------|--------|-------|-----|--------|
| Aggressive | Giga | 4.1pp | 0 | Bulwark (51.6%) | Technician (47.5%) |
| Defensive | Giga | 3.3pp | 0 | Breaker (52.3%) | Technician (49.0%) |
| Aggressive | Bare | 6.2pp | 0 | Technician (52.3%) | Charger (46.1%) |
| Defensive | Bare | 6.6pp | 0 | Technician (52.6%) | Charger (46.0%) |

All variants zero flags. Variant choice = 3+ rarity tiers of impact (NOT cosmetic).

## Simulation Tools

```bash
npx tsx src/tools/simulate.ts bare                            # Bare tier, balanced variant
npx tsx src/tools/simulate.ts epic aggressive                 # Epic tier, aggressive variant
npx tsx src/tools/simulate.ts giga --matches 500              # High-precision run
npx tsx src/tools/simulate.ts --summary balanced              # Multi-tier summary
npx tsx src/tools/simulate.ts bare --json                     # Structured JSON output
npx tsx src/tools/simulate.ts bare --override softCapK=60     # Test config changes
npx tsx src/tools/simulate.ts bare --override archetype.breaker.stamina=65  # Test stat changes
```

## Parameter Search

```bash
npx tsx src/tools/param-search.ts config.json              # Run search
npx tsx src/tools/param-search.ts config.json --dry-run    # Preview plan
npx tsx src/tools/param-search.ts config.json --with-summary  # Summary after search
```

Strategies: `sweep` (test all values independently), `descent` (iterative, keep best).
