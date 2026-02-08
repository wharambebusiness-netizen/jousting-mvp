# Jousting MVP

Jousting minigame web demo. Vite + React + TypeScript.
Engine is pure TS, zero UI imports (portable to Unity C#). Integrating with Gigaverse ecosystem.

## Quick Reference

```bash
npx vitest run                              # Run all tests (370 passing)
npx tsx src/tools/simulate.ts [bare|giga]   # Balance simulation (modes: bare|uncommon|rare|epic|legendary|relic|giga|mixed)
npm run dev                                 # Dev server
npm run deploy                              # Deploy to gh-pages
node orchestrator/orchestrator.mjs                              # Launch orchestrator (default agents)
node orchestrator/orchestrator.mjs orchestrator/missions/X.json  # Launch with mission config
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
src/tools/            simulate.ts CLI balance testing tool

orchestrator/         Multi-agent development system
  orchestrator.mjs    Main orchestration script
  missions/*.json     Mission configs (agent teams + file ownership)
  roles/*.md          Role templates (agent behavior guidelines)
  handoffs/*.md       Agent state files (structured META sections)
  analysis/*.md       Balance/quality reports
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
- Uncommon rarity bonus = 1 (not 0)
- AI has `WithReasoning` and `WithCommentary` function variants — originals unchanged for backwards compat

## Key API Signatures

```typescript
createMatch(arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?): MatchState
createFullLoadout(giglingRarity, gearRarity, rng?): GiglingLoadout
createFullPlayerLoadout(gearRarity, rng?): PlayerLoadout
applyGiglingLoadout(archetype, loadout?): Archetype   // adds rarity bonus
applyPlayerLoadout(archetype, loadout?): Archetype     // NO rarity bonus
resolveJoustPass(p1, p2, p1Choice, p2Choice, passNum, p1Stam, p2Stam, cumScore1, cumScore2): PassResult
resolveMeleeRoundFn(p1, p2, p1Attack, p2Attack, roundNum, p1Stam, p2Stam): MeleeRoundResult
aiPickJoustChoiceWithReasoning(player, lastAtk?, oppAtk?, difficulty?): { choice, reasoning }
aiPickMeleeAttackWithReasoning(player, lastAtk?, difficulty?): { attack, reasoning }
```

## Balance State

S22 balance pass: Charger CTL 50→55, Technician MOM 50→55, guardImpactCoeff 0.2→0.18.
Epic tier near-perfect (7.3pp spread). Bare spread 33pp→25pp. Giga spread 18pp→13pp.
Key constants in balance-config.ts: guardImpactCoeff 0.18, guardUnseatDivisor 15, softCap knee 100 / K 50.
Remaining: Charger still weak at bare (36%), Technician slightly below 45% across tiers.

## Orchestrator Rules (for orchestrated agents)

- Only edit files in your File Ownership list
- Do NOT run git commands (orchestrator handles commits)
- Do NOT edit orchestrator/task-board.md (auto-generated)
- Run `npx vitest run` before writing your final handoff
- For App.tsx changes: note them in handoff under "Deferred App.tsx Changes"
- Write META section at top of handoff with status/files-modified/tests-passing/notes-for-others

## Test Suite (370 tests, 6 suites)

```
calculator.test.ts    116 tests   Core math validation
caparison.test.ts      11 tests   Phase-resolution validation
gigling-gear.test.ts   48 tests   6-slot steed gear
player-gear.test.ts    46 tests   6-slot player gear
match.test.ts          69 tests   State machine + integration
playtest.test.ts       80 tests   Property-based + stress tests
```
