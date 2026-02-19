# Session 109 Handoff — Phase 4: General-Purpose Agent Roster

## What S109 Did

### Phase 3 Complete — Handoff API + UI + Model Routing

All 7 tasks from `docs/handoff-s108.md` implemented and tested:

1. **Handoff API** (orchestrator routes): `generateHandoffDoc()` helper + 3 endpoints:
   - `POST /:id/handoff` — generate handoff doc without restart
   - `GET /:id/handoffs` — list previous handoff files
   - `POST /:id/handoff-restart` — generate handoff → kill → respawn with context
2. **WS bridge**: `handoff:generated` + `handoff:restart` added (26 total bridged events)
3. **CLI parsing**: `--model` and `--handoff-file=` parsed in orchestrator.mjs
4. **Model routing integration**: `resolveAgentModel()` wired into `loadMission()` with `MODEL_OVERRIDE`
5. **Terminal UI**: Handoff + History buttons in status bar, `handoffInstance()` with 5-step ANSI progress, `showHandoffHistory()` dropdown, WS `handoff:*` subscriptions
6. **Project-to-terminal**: `checkPendingProject()` reads sessionStorage, pre-fills dialog, `submitNewInstance()` includes projectDir
7. **CSS section 42**: handoff-progress, step states, btn--accent, handoff-history dropdown

**Tests**: 1678 passing across 27 suites (+21 new: 12 model-routing + 9 handoff API)
**Commit**: `f036406`

## What S110 Should Do

### Phase 4A: Core Builder Roles (8 new role templates)

See `docs/multi-orchestrator-plan.md` Phase 4 "Session A" for full details.

#### 1. Create 8 New Role Templates in `orchestrator/roles/`

Follow the existing template structure. Check any existing role file for the pattern (e.g., `orchestrator/roles/engine-dev.md` or `orchestrator/roles/ui-dev.md`).

New code-writing roles:
- **`backend-dev.md`** — Server-side: routes, middleware, services, models, DB queries, auth
- **`full-stack-dev.md`** — Cross-cutting features spanning frontend and backend end-to-end
- **`database-dev.md`** — Schema, migrations, query optimization, ORM models, seed data
- **`docs-writer.md`** — Technical documentation only (never application code)
- **`debugger.md`** — Bug reproduction, root cause analysis, strategic logging, targeted fixes
- **`refactorer.md`** — Large-scale code modernization, dependency upgrades, pattern changes

New analysis/coordination roles:
- **`integration-tester.md`** — E2E and integration tests (supertest, Playwright, cross-module)
- **`dependency-manager.md`** — Package auditing, version bumps, vulnerability remediation

Each template needs:
- Identity section (role name, description, capabilities)
- Rules section (what to do, what not to do)
- File ownership patterns (glob patterns for owned files)
- Task format (how tasks are described to this agent)
- Handoff format (what the agent produces)
- Common-rules injection (shared orchestrator rules)
- 5-10 example task descriptions

#### 2. Update Orchestrator Role Sets

In `orchestrator/orchestrator.mjs`, find `CODE_AGENT_ROLES` and `COORD_AGENT_ROLES` sets (search for these identifiers). Add new roles to the appropriate set:

- **CODE_AGENT_ROLES**: `backend-dev`, `full-stack-dev`, `database-dev`, `debugger`, `refactorer`, `integration-tester`
- **COORD_AGENT_ROLES**: `docs-writer`, `dependency-manager`

#### 3. Update Spawn System

In `orchestrator/spawn-system.mjs`, find the allowed spawn list and add new roles where appropriate.

#### 4. Update Model Routing Map

In `orchestrator/model-routing.mjs`, verify `ROLE_MODEL_MAP` already has entries for new roles. It does — S107 already added: `backend-dev: sonnet`, `full-stack-dev: sonnet`, `database-dev: sonnet`, `docs-writer: haiku`, `debugger: opus`, `refactorer: opus`, `integration-tester: sonnet`, `dependency-manager: haiku`. Just verify they're still correct.

#### 5. Tests

- Role registry loads all new roles (`RoleRegistry` in `orchestrator/role-registry.mjs`)
- RoleRegistry metadata is correct for each role
- Existing orchestrator tests still pass

### Phase 4B (if time): Mission Templates

6 general-purpose mission configs in `orchestrator/missions/`:
- `web-app.json` — ~10 agents (full-stack-dev, backend-dev, ui-dev, css-artist, qa-engineer, integration-tester, docs-writer, producer, tech-lead, self-reviewer)
- `api-service.json` — ~8 agents (backend-dev, database-dev, qa-engineer, integration-tester, security-auditor, docs-writer, producer, tech-lead)
- `library.json` — ~7 agents (engine-dev, test-generator, docs-writer, qa-engineer, performance-analyst, producer, tech-lead)
- `bugfix-sprint.json` — ~6 agents (debugger x2, qa-engineer, integration-tester, producer, self-reviewer)
- `refactor.json` — ~6 agents (refactorer, qa-engineer, test-generator, architect, tech-lead, producer)
- `full-team.json` — ~13 agents (all the things, maxConcurrency: 4)

Composition rules:
- Every mission needs: producer + tech-lead + self-reviewer minimum
- Budget defaults: 6 agents = $10, 10 agents = $20, 13 agents = $30
- Model defaults come from ROLE_MODEL_MAP (haiku for coordination, sonnet for code, opus for critical)

## Key Files Reference

| File | Purpose |
|------|---------|
| `orchestrator/roles/*.md` | Role template files (existing + 8 new) |
| `orchestrator/role-registry.mjs` | Loads and validates role templates |
| `orchestrator/orchestrator.mjs` | `CODE_AGENT_ROLES` / `COORD_AGENT_ROLES` sets, `loadMission()` |
| `orchestrator/model-routing.mjs` | `ROLE_MODEL_MAP`, `resolveAgentModel()` |
| `orchestrator/spawn-system.mjs` | Dynamic agent spawning allowed list |
| `orchestrator/missions/*.json` | Mission config files |
| `docs/multi-orchestrator-plan.md` | Full Phase 4 spec |

## Current Architecture State

- **1678 tests** across 27 suites — ALL PASSING
- **Phase 0**: Factory patterns, EventBus, lockfile — DONE
- **Phase 1**: Process pool, multi-instance routes, worker IPC — DONE
- **Phase 2**: Multi-terminal UI with xterm.js — DONE
- **Phase 3**: Handoff API, terminal handoff UI, model routing, CLI parsing — DONE
- **Phase 4**: General-purpose agent roster — TODO (this session)
- **Phase 5+**: Skill pool, capability-based assignment (future)

## What NOT to Do
- Don't modify Phase 1/2/3 code (process pool, routes, terminal UI, handoff API — all stable)
- Don't break the 1678 existing tests
- Don't touch the game engine or React frontend
- Don't start Phase 5 until Phase 4 is tested
- Don't rename existing roles that are already used in missions — add new ones alongside
