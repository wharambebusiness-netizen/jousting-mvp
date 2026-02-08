Run the jousting balance simulation tool and analyze results.

Usage: /simulate [mode]
Modes: bare, uncommon, rare, epic, legendary, relic, giga, mixed
Default: bare (if no argument provided)

Steps:
1. Run: `npx tsx src/tools/simulate.ts $ARGUMENTS`
2. Analyze the output:
   - Overall win rates by archetype
   - Identify dominant archetypes (>60%) and weak ones (<40%)
   - Check win rate spread (healthy targets: <15pp with giga gear, <25pp bare)
   - Note any matchup skews (>70% one-sided)
3. Compare to known baseline:
   - Bare: Bulwark ~67.8%, Charger ~35.7%, spread 32.7pp
   - Giga: Bulwark ~57.0%, Charger ~42.6%, spread 14.4pp
4. If balance issues found, provide specific actionable recommendations
5. Reference balance-config.ts for tunable constants

Key balance constants: guardImpactCoeff (0.2), guardUnseatDivisor (15), softCap knee (100) / K (50).
