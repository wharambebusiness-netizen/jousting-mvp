# Jousting MVP — Session 21 Handoff

> Generated: 2026-02-08
> Context: Continued from S20. This session built orchestrator v3 infrastructure and ran the breaker mechanic mission.

---

## Session Summary

### Phase 1: Orchestrator v3 Infrastructure (manual)

Built comprehensive agent infrastructure improvements:

1. **CLAUDE.md** — Project context file auto-loaded by all Claude sessions (agents + interactive). Contains architecture, stat pipeline, gear system, gotchas, API signatures, balance state.

2. **5 Slash Command Skills** (`.claude/commands/`):
   - `/simulate` — Run balance simulation with any rarity mode
   - `/test` — Run full test suite + TypeScript check
   - `/handoff` — Generate session handoff document
   - `/orchestrate` — Configure and launch multi-agent runs
   - `/deploy` — Build and deploy to gh-pages

3. **4 Role Templates** (`orchestrator/roles/`):
   - `engine-dev.md` — Pure TS engine guidelines
   - `test-writer.md` — Test-only rules (never modify engine)
   - `balance-analyst.md` — Simulation-driven tuning constraints
   - `ui-dev.md` — React UI development patterns

4. **Mission Config System** — Orchestrator upgraded to v3:
   - Load agents from JSON: `node orchestrator.mjs missions/X.json`
   - Auto-generate initial handoff files from mission tasks
   - Role templates appended to agent prompts
   - CLAUDE.md-aware prompts (~50% shorter than v2)
   - Backward compatible (still works without mission arg)

5. **Breaker Mechanic Mission Config** (`orchestrator/missions/breaker-mechanic.json`):
   - 3 agents: breaker-mechanic (engine-dev), breaker-tests (test-writer), breaker-balance (balance-analyst)
   - Dependency chain: mechanic → tests + balance

6. **Updated orchestrator README**, settings.local.json (added permissions), memory files

### Phase 2: Breaker Mechanic Mission (orchestrator v3, 22.7 min)

First v3 orchestrator run. 3 agents, 3 rounds, 0 errors:

| Round | Agents | Time | Work |
|-------|--------|------|------|
| 1 | breaker-mechanic | 4.3 min | Guard penetration in both phases |
| 2 | breaker-mechanic + breaker-tests + breaker-balance (3 parallel) | 5.8 min | Stretch goals + 61 tests + simulation |
| 3 | breaker-balance | 12.5 min | Full rarity sweep + tuning |

**Engine changes:**
- `calcImpactScore()` — Optional 4th param `guardPenetration` (default 0, backward compatible)
- `phase-joust.ts` — Detects Breaker via `archetype.id`, applies penetration to impact
- `phase-melee.ts` — Same penetration in melee
- `balance-config.ts` — `breakerGuardPenetration: 0.20`
- `archetypes.ts` — Breaker MOM 65→62, Bulwark STA 65→62 / INIT 50→53
- Combat logs show: `"Breaker P1: guard penetration 20% — opponent effective guard 65.00 → 52.00"`

**Tests: 370 → 431 (+61)**
- 11 unit tests (calcImpactScore penetration math)
- 24 phase resolution tests (joust + melee + non-Breaker verification + edge cases)
- 26 property-based + integration tests (all matchups, all rarities, performance)

**Balance finding:**
Bulwark bare dominance (66%) is structurally GRD-driven — locked by test assertions on `guardImpactCoeff`. Fixing requires test modernization or new mechanics (guard degradation).

---

## Current State

### Test Suite: 431 passing (6 suites)
```
calculator.test.ts    116 tests
caparison.test.ts      35 tests (was 11, +24 phase resolution tests)
gigling-gear.test.ts   48 tests
player-gear.test.ts    46 tests
match.test.ts          69 tests
playtest.test.ts      117 tests (was 80, +26 property-based + 11 mechanic tests)
```

### TypeScript: 0 errors

### Deployed: NOT YET (breaker mechanic + v3 infrastructure not deployed)

---

## Architecture Changes (from S20)

### New: Guard Penetration Mechanic
```
Breaker archetype ignores 20% of opponent guard during impact calculation.
Detection: archetype.id === 'breaker'
Applies to: calcImpactScore() in both joust and melee phases
Does NOT apply to: unseat threshold (guard still provides full unseat protection)
Configurable: BALANCE.breakerGuardPenetration in balance-config.ts
```

### New: Orchestrator v3
```
orchestrator/
  orchestrator.mjs     v3: mission configs, role templates, CLAUDE.md-aware prompts
  missions/*.json      Agent team definitions (agents, deps, file ownership, tasks)
  roles/*.md           Reusable agent behavior templates (4 roles)
  README.md            Updated for v3

.claude/commands/      5 slash command skills
CLAUDE.md              Project context (auto-loaded)
```

### Stat Pipeline (updated)
```
Base archetype stats (MOM/CTL/GRD/INIT/STA)
  → applyGiglingLoadout (steed gear + rarity bonus)
  → applyPlayerLoadout (player gear, NO rarity bonus)
  → softCap(knee=100, K=50) on MOM/CTL/GRD/INIT (NOT stamina)
  → computeEffectiveStats (speed + attack deltas)
  → fatigueFactor(currentStamina, maxStamina)
  → calcImpactScore (with guardPenetration if Breaker)  ← NEW
  → Combat resolution
```

---

## Balance State

### Bare (no gear)
```
             WinRate
bulwark:     ~66%      ← still dominant (GRD-driven, test-locked)
duelist:     ~58%
tactician:   ~56%
breaker:     ~50%      ← improved from 39% (guard penetration working)
technician:  ~39%
charger:     ~34%
```

### Key Constants
- breakerGuardPenetration: 0.20 (was 0.35, tuned down to prevent Breaker giga dominance)
- guardImpactCoeff: 0.2 (unchanged, test-locked)
- guardUnseatDivisor: 15 (unchanged)
- Breaker MOM: 62 (was 65)
- Bulwark STA: 62 (was 65), INIT: 53 (was 50)

---

## Files Modified This Session

### By me (manual, pre-orchestrator):
- `CLAUDE.md` — NEW: Project context
- `.claude/commands/simulate.md` — NEW: Balance simulation skill
- `.claude/commands/test.md` — NEW: Test suite skill
- `.claude/commands/handoff.md` — NEW: Handoff generation skill
- `.claude/commands/orchestrate.md` — NEW: Orchestrator launch skill
- `.claude/commands/deploy.md` — NEW: Deploy skill
- `.claude/settings.local.json` — Added permissions
- `orchestrator/orchestrator.mjs` — v3: mission configs, roles, CLAUDE.md prompts
- `orchestrator/README.md` — Updated for v3
- `orchestrator/roles/engine-dev.md` — NEW: Engine developer role
- `orchestrator/roles/test-writer.md` — NEW: Test writer role
- `orchestrator/roles/balance-analyst.md` — NEW: Balance analyst role
- `orchestrator/roles/ui-dev.md` — NEW: UI developer role
- `orchestrator/missions/breaker-mechanic.json` — NEW: Breaker mission config

### By orchestrator agents:
- `src/engine/balance-config.ts` — breakerGuardPenetration: 0.20
- `src/engine/calculator.ts` — calcImpactScore 4th param guardPenetration
- `src/engine/phase-joust.ts` — Breaker detection + penetration in joust
- `src/engine/phase-melee.ts` — Breaker detection + penetration in melee
- `src/engine/archetypes.ts` — Breaker MOM 65→62, Bulwark STA 65→62 / INIT 50→53
- `src/engine/calculator.test.ts` — 11 new tests (guard penetration unit)
- `src/engine/caparison.test.ts` — 24 new tests (phase resolution)
- `src/engine/playtest.test.ts` — 26 new tests (property-based + integration)
- `orchestrator/handoffs/breaker-*.md` — 3 agent handoffs
- `orchestrator/analysis/breaker-balance-round-*.md` — Balance reports

---

## Known Issues / TODO

### Priority 1: Deploy
- Breaker mechanic + v3 infrastructure not yet deployed to gh-pages
- Run `/deploy` or `npm run deploy`

### Priority 2: Bulwark Dominance (66% bare)
- Structurally GRD-driven — `guardImpactCoeff: 0.2` is test-locked (~7 assertions)
- Options: (a) modernize tests to use `BALANCE.*` refs, then reduce to 0.15
- Options: (b) add guard degradation mechanic (guard weakens over consecutive passes)

### Priority 3: Charger/Technician Weakness (34-39% bare)
- Stats are test-locked — need test modernization first
- Charger could benefit from MOM scaling mechanic (advantage grows over passes)

### No Known Bugs
- All 431 tests pass
- TypeScript clean
- Orchestrator v3 runs correctly with mission configs

---

## Git State
- Branch: master
- 3 commits ahead of origin/master (orchestrator auto-backups from breaker run)
- Plus uncommitted: overnight-report.md, this handoff
- gh-pages: stale (S20 deploy, missing breaker mechanic)

---

## Key API Signatures (updated)

```typescript
// Guard penetration — NEW optional 4th param
calcImpactScore(
  effMom: number,
  accuracy: number,
  opponentEffGuard: number,
  guardPenetration: number = 0  // 0-1, Breaker passes BALANCE.breakerGuardPenetration
): number

// Everything else unchanged from S20
createMatch(arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?): MatchState
resolveJoustPass(p1, p2, p1Choice, p2Choice, passNum, p1Stam, p2Stam, cumScore1, cumScore2): PassResult
resolveMeleeRoundFn(p1, p2, p1Attack, p2Attack, roundNum, p1Stam, p2Stam): MeleeRoundResult
```

---

## Orchestrator v3 Reference

```bash
# Launch with mission config (recommended)
node orchestrator/orchestrator.mjs orchestrator/missions/breaker-mechanic.json

# Launch with default agents (backward compatible)
node orchestrator/orchestrator.mjs

# Create new mission: see orchestrator/missions/breaker-mechanic.json as template
# Available roles: engine-dev, test-writer, balance-analyst, ui-dev
```

Mission config format: see `orchestrator/README.md` for full docs.
