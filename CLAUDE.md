# Jousting MVP

Jousting minigame web demo. Vite + React + TypeScript.
Engine is pure TS, zero UI imports (portable to Unity C#).

**Current focus: Orchestrator improvement for automated balance tuning.**
Gigaverse integration is tabled — do not work on it unless explicitly asked.

## Quick Reference

```bash
npm test                                    # Run all tests (908 passing as of S46)
npx tsx src/tools/simulate.ts [tier] [variant]  # Balance simulation (tier: bare|uncommon|rare|epic|legendary|relic|giga|mixed; variant: aggressive|balanced|defensive)
npx tsx src/tools/simulate.ts bare --matches 500                   # High-precision sim (override default 200)
npx tsx src/tools/simulate.ts bare --json --override softCapK=60   # Sim with balance config overrides
npx tsx src/tools/param-search.ts <config.json>                    # Parameter search (sweep/descent)
npx tsx src/tools/param-search.ts <config.json> --dry-run          # Preview search plan
npx tsx src/tools/param-search.ts <config.json> --matches 500      # Override matches per matchup
npm run dev                                 # Dev server
npm run deploy                              # Deploy to gh-pages (currently disabled)
node orchestrator/orchestrator.mjs                              # Launch orchestrator (default agents)
node orchestrator/orchestrator.mjs orchestrator/missions/X.json  # Launch with mission config
powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1  # Overnight runner (restart loop)
```

## Architecture

```
src/engine/           Pure TS combat engine (no UI imports)
  types.ts            Core types: Archetype, MatchState, gear types, PassResult, etc.
  archetypes.ts       6 archetypes: charger, technician, bulwark, tactician, breaker, duelist
  attacks.ts          6 joust + 6 melee attacks, 3 speeds, counter tables
  calculator.ts       Core math: softCap, fatigue, impact, accuracy, guard, unseat
  phase-joust.ts      resolveJoustPass() — joust pass resolution
  phase-melee.ts      resolveMeleeRoundFn() — melee round resolution
  match.ts            State machine: createMatch(), submitJoustPass(), submitMeleeRound()
  gigling-gear.ts     6-slot steed gear system
  player-gear.ts      6-slot player gear system
  balance-config.ts   ALL tuning constants (single source of truth)

src/ui/               15 React components, App.tsx 10-screen state machine
src/ai/               AI opponent: difficulty levels, personality, pattern tracking, reasoning
src/tools/            simulate.ts CLI balance testing tool, param-search.ts parameter optimization

orchestrator/         Multi-agent development system (v5)
  orchestrator.mjs    Main orchestration script (backlog system, continuous agents)
  backlog.json        Dynamic task queue (producer writes, orchestrator injects into agents)
  missions/*.json     Mission configs (agent teams + file ownership)
  roles/*.md          9 role templates (professional agent briefs)
  search-configs/*.json  Parameter search configurations (quick-sweep, sensitivity-sweep, guard-tuning, unseated-tuning)
  handoffs/*.md       Agent state files (structured META sections)
  analysis/*.md       Balance/quality reports
  run-overnight.ps1   PowerShell restart loop for overnight runs
```

## Stat Pipeline

```
Base archetype stats (MOM/CTL/GRD/INIT/STA)
  -> applyGiglingLoadout (steed gear bonuses + flat rarity bonus to all stats)
  -> applyPlayerLoadout (player gear bonuses only, NO rarity bonus)
  -> softCap(knee=100, K=50) on MOM/CTL/GRD/INIT (NOT stamina)
  -> computeEffectiveStats (speed + attack deltas)
  -> fatigueFactor(currentStamina, maxStamina)
  -> Combat resolution (impact, accuracy, guard, unseat check)
```

## 12-Slot Gear System

**Steed** (6 slots): chamfron(MOM/GRD), barding(GRD/STA), saddle(CTL/INIT), stirrups(INIT/MOM), reins(CTL/STA), horseshoes(MOM/INIT)
**Player** (6 slots): helm(GRD/INIT), shield(GRD/STA), lance(MOM/CTL), armor(STA/GRD), gauntlets(CTL/INIT), melee_weapon(MOM/STA)

Caparison is cosmetic only — zero gameplay effects.

### Gear Variants

3 variants per slot: **aggressive**, **balanced** (=legacy defaults), **defensive**
- Same total stat budget (horizontal power), different primary/secondary allocation
- Balanced variant MUST match legacy GEAR_SLOT_STATS exactly
- Affinity field is informational only (no mechanical bonus)
- `createStatGear(slot, rarity, rng?, variant?)` — optional variant param
- `createFullLoadout(gigRarity, gearRarity, rng?, variant?)` — optional variant
- `createPlayerGear(slot, rarity, rng?, variant?)` — optional variant
- `createFullPlayerLoadout(gearRarity, rng?, variant?)` — optional variant

## Critical Gotchas

- Counter table: Agg>Def>Bal>Agg; Port de Lance beats Coup en Passant; Guard High beats Measured Cut
- `resolvePass()` in calculator.ts is **@deprecated** — use `resolveJoustPass()` from phase-joust.ts
- `fatigueFactor()` requires maxStamina as 2nd arg
- `applyPlayerLoadout` does NOT add rarity bonus (mount-only feature)
- `createMatch()` takes 6 args: arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?
- Guard coefficients + shift costs live in `balance-config.ts`, not hardcoded
- `softCap` knee=100; at Giga rarity only Bulwark GRD crosses it
- Precision Thrust: deltaGuard = 0
- `resolveCounters()` takes effective CTL; bonus = 4 + winnerCTL*0.1
- Guard partially fatigues via guardFatigueFloor (0.5)
- Uncommon rarity bonus = 2 (not 1)
- AI has `WithReasoning` and `WithCommentary` function variants — originals unchanged for backwards compat
- Breaker detection via `archetype.id` in phase-joust.ts and phase-melee.ts
- Unseated boost via `wasUnseated` flag on PlayerState
- Balanced variant must match legacy GEAR_SLOT_STATS
- AI rarity matching: App.tsx uses `steedLoadout.giglingRarity` for all AI gear

## Key API Signatures

```typescript
createMatch(arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?): MatchState
createFullLoadout(giglingRarity, gearRarity, rng?, variant?): GiglingLoadout
createFullPlayerLoadout(gearRarity, rng?, variant?): PlayerLoadout
applyGiglingLoadout(archetype, loadout?): Archetype   // adds rarity bonus
applyPlayerLoadout(archetype, loadout?): Archetype     // NO rarity bonus
resolveJoustPass(p1, p2, p1Choice, p2Choice, passNum, p1Stam, p2Stam, cumScore1, cumScore2): PassResult
resolveMeleeRoundFn(p1, p2, p1Attack, p2Attack, roundNum, p1Stam, p2Stam): MeleeRoundResult
aiPickJoustChoiceWithReasoning(player, lastAtk?, oppAtk?, difficulty?): { choice, reasoning }
aiPickMeleeAttackWithReasoning(player, lastAtk?, difficulty?): { attack, reasoning }
```

## Live Data (verify against source — may drift)

- **Test count**: run `npm test` (908 as of S46)
- **Archetype stats**: `src/engine/archetypes.ts`
- **Balance constants**: `src/engine/balance-config.ts`
- **Win rates**: run `npx tsx src/tools/simulate.ts [tier]` or see latest `orchestrator/analysis/balance-tuner-round-*.md`
- **Test breakdown**: run `npx vitest run` — 8 suites (calculator, phase-resolution, gigling-gear, player-gear, match, playtest, gear-variants, ai)

### Current Archetype Stats (Post-S35 Technician Buff)

```
             MOM  CTL  GRD  INIT  STA  Total  Notes
charger:      75   55   50    55   65  = 300   Raw impact specialist
technician:   64   70   55    59   55  = 303   MOM+6, INIT-1 (S35)
bulwark:      58   52   65    53   62  = 290   MOM+3, CTL-3 (S35 R6)
tactician:    55   65   50    75   55  = 300   Tempo control
breaker:      62   60   55    55   60  = 292   Guard penetration 0.25
duelist:      60   60   60    60   60  = 300   Balanced generalist
```

**Balance coefficients**: `breakerGuardPenetration: 0.25`, `guardImpactCoeff: 0.12`, `softCapK: 55`, `guardUnseatDivisor: 18`, `unseatedImpactBoost: 1.35`, `unseatedStaminaRecovery: 12`, `guardFatigueFloor: 0.3`

### Win Rate Validation (S46 — guardImpactCoeff 0.18→0.12)

**Bare Tier** (N=500, balanced variant):
- Bulwark: 55.4% | Tactician: 51.2% | Technician: 51.2% | Duelist: 50.6% | Charger: 46.5% | Breaker: 45.1%
- Spread: 10.3pp (1 flag: bulwark dominant)

**Epic Tier** (N=500, balanced variant):
- Charger: 53.8% | Technician: 50.1% | Tactician: 49.8% | Duelist: 49.5% | Bulwark: 49.1% | Breaker: 47.6%
- Spread: 6.2pp (zero flags)

**Giga Tier** (N=500, balanced variant) — NEAR-PERFECT:
- Charger: 51.4% | Technician: 50.6% | Tactician: 50.6% | Duelist: 50.3% | Breaker: 48.9% | Bulwark: 48.2%
- Spread: 3.2pp (zero flags, all archetypes 48.2-51.4%)

**Tier Progression**: 10.3pp (bare) → 6.2pp (epic) → 3.2pp (giga)
- Balance improves monotonically with tier
- Giga near-perfect (3.2pp, zero flags)
- Bare improved from 13.2pp to 10.3pp, flags reduced from 3 to 1

### Variant Impact (S46, N=300 per config)

**Giga Aggressive**: Spread 6.5pp, 0 flags. Bulwark top (52.8%), technician bottom (46.3%).
**Giga Defensive**: Spread 3.5pp, 0 flags. Breaker top (51.9%), duelist bottom (48.4%). Best giga variant.
**Bare Aggressive**: Spread 9.3pp, 2 flags (bulwark dominant 55.3%, bulwark-charger skew). Boundary flags within noise.
**Bare Defensive**: Spread 11.6pp, 2 flags (bulwark dominant 56.3%, breaker weak 44.7%).

**Variant choice = 3+ rarity tiers of impact** (NOT cosmetic). Matchup-level swings: ±10-15pp.

## Orchestrator v8

**Primary project focus**: Orchestrator throughput and efficiency — more tasks completed per run without sacrificing quality. Balance tuning runs come after the orchestrator is optimized.

### Backlog System
- `orchestrator/backlog.json` — dynamic task queue with `{id, role, priority, status, title, description}`
- Producer agent generates 3-5 tasks per round, other agents consume them
- Orchestrator injects matching backlog tasks into agent prompts before each run
- **v8: Tasks sorted by priority** when assigned (P1 first)
- Status flow: pending → assigned → completed

### Continuous Agents
- Agents with `type: "continuous"` never retire — skip the `all-done` exit check
- Work-gated: skip if no pending tasks and not due for periodic run
- **v8: Pre-flight checks** — coordination agents skipped when no new work from other agents; agents with 2+ empty rounds skipped when no new backlog

### Overnight Runner
- `orchestrator/run-overnight.ps1` — PowerShell restart loop with crash counter + exponential backoff
- Re-launches orchestrator if it crashes or exits early
- Params: `-MaxHours 10 -Mission "orchestrator\missions\overnight.json"`

### Execution Model
- **Two-phase rounds**: Phase A (code agents) → tests → Phase B (coordination agents see fresh state)
- **Model tiering**: per-agent `model` field; 3-tier escalation (haiku → sonnet → opus) with `maxModel` cap and de-escalation on success
- **Cost tracking**: per-agent cost in overnight report
- **Analysis rotation**: keeps last 5 rounds, archives older reports
- **v8: Multi-mission sequencing** — chain missions in order (e.g., balance → polish). See `missions/overnight-sequence.json`

### Resilience
- Pre-round git tags, **v8: smart per-agent revert** on test regression (reverts only the failing agent's files, preserves other agents' work)
- Crash counter with exponential backoff, pre-restart validation

### 8 Role Templates (`orchestrator/roles/`)
game-designer, producer, tech-lead, qa-engineer, css-artist, engine-dev, balance-analyst, ui-dev

## Orchestrator Rules (for orchestrated agents)

- Only edit files in your File Ownership list
- Do NOT run git commands (orchestrator handles commits)
- Do NOT edit orchestrator/task-board.md (auto-generated)
- Run `npx vitest run` before writing your final handoff
- For App.tsx changes: note them in handoff under "Deferred App.tsx Changes"
- Write META section at top of handoff with status/files-modified/tests-passing/notes-for-others

## Test Suite

8 test suites covering:
- **calculator** (202 tests) — Core math + guard penetration + fatigue + counter table exhaustive + softCap boundaries
- **phase-resolution** (66 tests) — Phase resolution + breaker edge cases + unseat timing + extreme fatigue
- **gigling-gear** (48 tests) — 6-slot steed gear
- **player-gear** (46 tests) — 6-slot player gear
- **match** (100 tests) — State machine + integration + joust/melee worked examples + carryover/unseated + gear pipeline
- **playtest** (128 tests) — Property-based + stress + balance config + gear boundaries
- **gear-variants** (223 tests) — Gear variant system + archetype x variant matchups + melee carryover + softCap interactions + rare/epic tier melee exhaustion + all 36 archetype melee matchups + legendary/relic tier
- **ai** (95 tests) — AI opponent validity, reasoning, patterns, edge cases

**Total: 908 tests** (as of S38). Run `npx vitest run` for current test counts (per-file counts drift).
