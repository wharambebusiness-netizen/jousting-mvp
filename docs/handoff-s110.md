# Session 110 Handoff — Phase 5: Skill Pool System

## What S110 Did

### Phase 4 Complete — General-Purpose Agent Roster

All tasks from `docs/handoff-s109.md` Phase 4A and 4B implemented and tested:

1. **8 New Role Templates** (`orchestrator/roles/`):
   - Code roles: `backend-dev.md`, `full-stack-dev.md`, `database-dev.md`, `debugger.md`, `refactorer.md`, `integration-tester.md`
   - Coordination roles: `docs-writer.md`, `dependency-manager.md`
   - Each follows existing template pattern: identity, each-round instructions, example tasks, restrictions, file ownership, standards

2. **Role Classification Updates**:
   - `CODE_AGENT_ROLES` in orchestrator.mjs: expanded 6→12 (added all 6 code roles)
   - `COORD_AGENT_ROLES` in orchestrator.mjs: expanded 3→5 (added docs-writer, dependency-manager)
   - `SPAWN_CONSTRAINTS.blockedRoles` in spawn-system.mjs: expanded 3→5 (added docs-writer, dependency-manager)
   - `ROLE_DEFAULTS` in role-registry.mjs: expanded 14→22 entries (all 8 new roles with metadata)

3. **Model Routing**: Already had entries for all 8 roles from S107 — verified correct

4. **6 Mission Templates** (`orchestrator/missions/`):
   - `web-app.json` — 10 agents: full-stack, backend, UI, CSS, QA, integration, docs, producer, tech-lead, self-reviewer
   - `api-service.json` — 8 agents: backend, database, QA, integration, security, docs, producer, tech-lead
   - `library.json` — 7 agents: engine-dev, test-gen, docs, QA, perf, producer, tech-lead
   - `bugfix-sprint.json` — 6 agents: debugger ×2, QA, integration, producer, self-reviewer
   - `refactor.json` — 6 agents: refactorer, QA, test-gen, architect, tech-lead, producer
   - `full-team.json` — 13 agents: all major roles, maxConcurrency: 4

5. **Tests**: 67 new role-registry tests + 1 expanded model-routing test = 68 net new
   - `role-registry.test.mjs` (NEW): template loading, ROLE_DEFAULTS metadata, category grouping, heuristic classification, buildAgentConfig, content validation
   - `model-routing.test.mjs`: added comprehensive ROLE_MODEL_MAP coverage

**Tests**: 1746 passing across 28 suites (+68 new)
**Commit**: TBD

## What S111 Should Do

### Phase 5A: Skill Registry + Manifests

See `docs/multi-orchestrator-plan.md` Phase 5 "S110" for full details.

#### 1. Create Skill Directory Structure

```
operator/skills/
  registry.mjs      — Load, index, search, get
  selector.mjs      — Two-stage selection pipeline
  resolver.mjs      — Dependency resolution, conflict checking
  schema/
    skill.schema.json
  manifests/
    git/
      git-status.skill.json
      git-commit.skill.json
      git-push.skill.json
    code/
      file-read.skill.json
      test-runner.skill.json
      lint.skill.json
    research/
      web-search.skill.json
      codebase-search.skill.json
```

#### 2. Skill Manifest Format

JSON files with:
- id, name, version, description, shortDescription
- triggerExamples (5-10 phrases), tags, category
- parameters (JSON Schema), requires, conflicts, enhancedBy
- sideEffects, idempotent, requiresConfirmation
- handler module path

#### 3. Skill Registry Module

- Load manifests from disk at startup
- In-memory Map, shared across orchestrators
- Search by tags, category, keyword
- Get by ID

#### 4. Migrate Existing `.claude/skills/`

Convert existing audit skills to new manifest format.

#### 5. Tests

- Registry loading, manifest validation
- Search by tag, category
- Dependency resolution
- Conflict checking

### Phase 5B (if time): Skill Selection + Agent Profiles

See `docs/multi-orchestrator-plan.md` Phase 5 "S111".

## Key Files Reference

| File | Purpose |
|------|---------|
| `orchestrator/roles/*.md` | 23 role template files |
| `orchestrator/role-registry.mjs` | Loads and validates role templates |
| `orchestrator/role-registry.test.mjs` | 67 tests for role registry |
| `orchestrator/orchestrator.mjs` | `CODE_AGENT_ROLES` (12) / `COORD_AGENT_ROLES` (5) |
| `orchestrator/model-routing.mjs` | `ROLE_MODEL_MAP` (20 roles across 3 tiers) |
| `orchestrator/model-routing.test.mjs` | 13 tests for model routing |
| `orchestrator/spawn-system.mjs` | `blockedRoles` (5 blocked from spawning) |
| `orchestrator/missions/*.json` | 9 mission configs (3 original + 6 new) |
| `docs/multi-orchestrator-plan.md` | Full Phase 5 spec |

## Current Architecture State

- **1746 tests** across 28 suites — ALL PASSING
- **Phase 0**: Factory patterns, EventBus, lockfile — DONE
- **Phase 1**: Process pool, multi-instance routes, worker IPC — DONE
- **Phase 2**: Multi-terminal UI with xterm.js — DONE
- **Phase 3**: Handoff API, terminal handoff UI, model routing, CLI parsing — DONE
- **Phase 4**: General-purpose agent roster (23 roles, 9 missions) — DONE
- **Phase 5**: Skill pool system — TODO (next session)
- **Phase 6+**: Inter-orchestrator coordination (future)

## What NOT to Do
- Don't modify Phase 1-4 code (process pool, routes, terminal UI, handoff API, role templates — all stable)
- Don't break the 1746 existing tests
- Don't touch the game engine or React frontend
- Don't start Phase 6 until Phase 5 is tested
- Don't rename existing roles that are already used in missions
