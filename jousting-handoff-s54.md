# Session 54 Handoff — Instructions for Next Claude

## Quick Start

```bash
cd jousting-mvp
npm test                    # 908 tests, 8 suites, all passing
node -c orchestrator/orchestrator.mjs  # Syntax check orchestrator (4172 lines)
```

Read these files first:
1. `CLAUDE.md` — project reference (229 lines), architecture, API, gotchas
2. This handoff — current state and next steps

## Current State

### Codebase
- **Branch**: master, clean working tree
- **Tests**: 908/908 passing across 8 suites
- **Engine**: Pure TypeScript, zero UI imports, portable to Unity C#
- **Stack**: Vite + React + TypeScript

### Balance — ALL ZERO FLAGS
All tiers and all gear variants have zero balance flags. This is a historic milestone.

**High-precision validation (N=500, balanced variant):**
| Tier | Spread | Flags | Top | Bottom |
|------|--------|-------|-----|--------|
| Bare | 5.8pp | 0 | technician 53.0% | breaker 47.2% |
| Epic | 4.5pp | 0 | charger 53.0% | tactician 48.5% |
| Giga | 3.8pp | 0 | duelist 51.6% | bulwark 47.8% |

### Current Archetype Stats
```
             MOM  CTL  GRD  INIT  STA  Total
charger:      75   55   50    55   65  = 300
technician:   64   70   55    59   55  = 303
bulwark:      58   52   64    53   62  = 289
tactician:    55   65   50    75   55  = 300
breaker:      62   60   55    55   62  = 294
duelist:      60   60   60    60   60  = 300
```

### Orchestrator v16 (4172 lines)
Fully featured multi-agent development system. All 7 known bottlenecks addressed.

Key features (cumulative):
- **v16 NEW: Session continuity** — `--session-id` on first run, `--resume` on subsequent rounds
- **v16 NEW: Delta prompts** — returning agents get compact "what changed" prompt (skip role template, shared rules)
- **v16 NEW: Inline handoff injection** — pre-read handoff into prompt, eliminates Read tool calls
- **v16 NEW: Session invalidation** — auto-invalidate on revert, mission transition, resume failure
- **v16 NEW: Session metrics** — overnight report tracks fresh/resumed/invalidated per agent
- Streaming agent pool with adaptive timeouts
- Priority-based scheduling (P1 fast-path)
- Task decomposition with subtask support
- Live progress dashboard (ANSI terminal)
- Pipelined sims, parallel Phase B, incremental testing
- Smart per-agent revert, model escalation, experiment logging
- Dynamic concurrency, agent effectiveness tracking, quality reports

### Simulation Tools
- **simulate.ts** (837 lines): Balance sim CLI with `--json`, `--matches N`, `--override`, `--summary`, `--tiers`
- **param-search.ts** (686 lines): Parameter optimization with sweep/descent strategies, noise floor estimation
- Both support archetype stat overrides (`--override archetype.breaker.stamina=65`)

## What Was Done in S54

### Orchestrator v16: Agent Session Continuity (+185 lines, 3987→4172)

**The Problem**: The last remaining known bottleneck — "full context reload." Each agent was a fresh CLI process every round, re-reading CLAUDE.md, role templates, shared rules, source files, handoff files, etc. from scratch. This wasted tokens and time, and agents lost all codebase understanding between rounds.

**The Solution**: Claude CLI supports `--session-id <uuid>` to establish a named session and `--resume <sessionId>` to continue it. We now:

1. **First run**: Generate a UUID, pass `--session-id <uuid>` to establish the session. Agent gets the full prompt with role template, shared rules, handoff format instructions, etc.

2. **Subsequent runs**: Pass `--resume <sessionId>` to continue the conversation. Agent retains full context from all prior rounds (CLAUDE.md, codebase reads, prior work, decisions). Gets a compact delta prompt with only:
   - Round number and last-run info
   - Changelog entries since last round (via `getChangelogSinceRound()`)
   - Current handoff content (inline)
   - New backlog tasks
   - Balance/param context (for relevant roles)
   - **Skips**: role template, shared rules, handoff format instructions, READ FIRST section

3. **Session invalidation**: Sessions are invalidated (agent gets fresh session next round) when:
   - Agent's files are reverted (stale context)
   - Mission transitions (different agents/context)
   - Resume fails quickly (<30s + non-zero exit code)

**Specific Changes**:
- `import { randomUUID } from 'crypto'` — for session ID generation
- `agentSessions` map — tracks `{ sessionId, lastRound, resumeCount, freshCount, invalidations }` per agent
- `readHandoffContent(agentId)` — reads handoff file for inline injection
- `getChangelogSinceRound(sinceRound)` — extracts changelog entries since a round
- `invalidateAgentSession(agentId, reason)` — clears session with logging
- `invalidateRevertedSessions(revertedAgents)` — batch invalidation after smart revert
- Modified `runAgent()`:
  - Checks `agentSessions[agent.id]` for existing session
  - Builds delta prompt (resume) or full prompt (fresh) with inline handoff
  - Adds `--session-id <uuid>` or `--resume <sessionId>` to CLI args
  - Tracks session mode in logs: `session=resume` or `session=fresh`
  - Updates session on success, invalidates on resume failure
- Modified `smartRevert()` area: calls `invalidateRevertedSessions()` after revert
- Modified `resetAgentTracking()`: clears all sessions on mission transition
- New "Session Continuity (v16)" section in overnight report
- Version strings: v15 → v16 (header, banner, report)
- CLAUDE.md: version references updated to v16

**Expected Benefits**:
- **Token savings**: ~30-50% smaller prompts for returning agents (no role template, shared rules, handoff format)
- **Time savings**: Agents skip 1-3 file Read tool calls on startup (~15-30s per agent per round)
- **Quality improvement**: Agents retain codebase understanding, prior decisions, and work context across rounds
- **Overnight run impact**: With 5 active agents × 19 resumed rounds = ~95 resumed agent-rounds, each saving ~3000 tokens input + 15s startup = ~285K tokens + 24 minutes saved per overnight run

## Key Files

| File | Purpose |
|------|---------|
| `orchestrator/orchestrator.mjs` | Multi-agent orchestrator (v16, 4172 lines) |
| `src/engine/archetypes.ts` | 6 archetype definitions |
| `src/engine/balance-config.ts` | ALL tuning constants |
| `src/engine/calculator.ts` | Core math (softCap, fatigue, impact, guard, unseat) |
| `src/engine/phase-joust.ts` | Joust pass resolution |
| `src/engine/phase-melee.ts` | Melee round resolution |
| `src/engine/match.ts` | State machine (createMatch, submitJoustPass, submitMeleeRound) |
| `src/tools/simulate.ts` | Balance simulation CLI |
| `src/tools/param-search.ts` | Parameter search framework |
| `orchestrator/backlog.json` | Dynamic task queue |
| `orchestrator/missions/*.json` | Mission configs |
| `orchestrator/roles/*.md` | 8 agent role templates |
| `CLAUDE.md` | Project reference doc |

## Potential Next Steps

1. **Run overnight autonomous session** — exercise v16 session continuity with a real multi-agent run. Use `powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1`. The session metrics in the overnight report will show how many rounds used resume vs fresh.

2. **Full cross-phase agent pool** — eliminate the Phase A/B barrier entirely. Currently Phase A (code agents) must complete before Phase B (coordination agents) can start. A unified agent pool would let faster coordination agents start sooner. This is the last major architectural optimization.

3. **Run archetype-tuning search** — `npx tsx src/tools/param-search.ts orchestrator/search-configs/archetype-tuning.json` to systematically optimize archetype stats further.

4. **Variant-specific balance tuning** — aggressive/defensive variants are 3-7pp spread. Could tighten them with variant-aware param search.

5. **UI polish / new game features** — the engine and orchestrator are mature; could shift focus to gameplay.

6. **Gigaverse integration** — currently tabled, but engine is ready.

## Critical Gotchas

- Counter table: Agg>Def>Bal>Agg; Port de Lance beats Coup en Passant
- `resolvePass()` in calculator.ts is **@deprecated** — use `resolveJoustPass()` from phase-joust.ts
- `fatigueFactor()` requires maxStamina as 2nd arg
- `createMatch()` takes 6 args: arch1, arch2, steedLoadout1?, steedLoadout2?, playerLoadout1?, playerLoadout2?
- `applyPlayerLoadout` does NOT add rarity bonus (mount-only feature)
- Breaker detection via `archetype.id` in phase-joust.ts and phase-melee.ts
- Balanced gear variant must match legacy GEAR_SLOT_STATS exactly
- softCap knee=100, K=55; at Giga only Bulwark GRD crosses knee
- Uncommon rarity bonus = 2 (not 1)
- Param search noise: at N=200, score noise ≈ ±0.84. Use baselineRuns≥3 and ignore deltas < noiseFloor
- **v16 session continuity**: agents may have stale context if their session is NOT invalidated after external changes. Invalidation happens automatically on revert and mission transition.

## User Preferences

- Full autonomy — make decisions, don't ask for approval
- Full permissions — no pausing for confirmations
- Generate handoff at ~60k tokens
- Prefer agents for heavy lifting to save main context window
- Never reference v3.4 or v4.0 spec — v4.1 is canonical
- Gigaverse integration is TABLED unless explicitly asked
