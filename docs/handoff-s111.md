# Session 111 Handoff — Phase 5B: Skill Selection + Agent Integration

## What S111 Did

### Phase 5A Complete — Skill Registry + Manifests

1. **Skill Manifest Schema** (`operator/skills/schema/skill.schema.json`):
   - JSON Schema defining all manifest fields: id, name, version, description, shortDescription, category, tags, triggerExamples, parameters, requires, conflicts, enhancedBy, sideEffects, idempotent, requiresConfirmation, handler, model, estimatedDurationMs
   - Valid categories: git, code, research, audit, testing, deployment, analysis
   - IDs must be kebab-case, versions semver, tags lowercase kebab

2. **17 Skill Manifests** (`operator/skills/manifests/`):
   - `git/`: git-status, git-commit, git-push
   - `code/`: file-read, test-runner, lint
   - `research/`: web-search, codebase-search, project-detect
   - `audit/`: accessibility-audit, security-scan, performance-audit, dependency-audit, test-coverage-audit, code-review, agent-report, orchestrator-status
   - All 9 existing `.claude/skills/` converted to new manifest format

3. **Skill Registry** (`operator/skills/registry.mjs`):
   - `SkillRegistry` class: load from disk, validate, index by id/tags/category
   - `validateManifest()`: schema validation with detailed error messages
   - Search: by category, tags (union), keyword (substring in name+desc+short+triggers), sideEffects, idempotent, and combinations
   - Helpers: getWriteSkills, getReadOnlySkills, getConfirmationRequired, getDependencies, getConflicts, getEnhancements
   - `createSkillRegistry()` convenience factory

4. **Skill Resolver** (`operator/skills/resolver.mjs`):
   - `resolveSkillSet(ids, registry)`: dependency walk (depth-first), conflict detection, enhancement suggestions
   - `checkCompatibility(id, currentSet, registry)`: can a skill be added without conflicts?
   - `topologicalSort(ids, registry)`: sort by dependency order (deps first)

5. **Skill Selector** (`operator/skills/selector.mjs`):
   - `selectSkills(query, registry, options)`: two-stage pipeline
     - Stage 1: category detection from keywords + coarse filter
     - Stage 2: token-based scoring (name 30, tags 25, triggers 20, desc 10, short 5, category bonus 10)
   - Options: maxResults, minScore, readOnly (penalize side-effects), preferCheap, preferredCategory
   - `AGENT_PROFILES`: 6 preset skill sets (code-writer, reviewer, deployer, researcher, auditor, tester)
   - `selectProfileSkills(name, registry, {includeOptional})`: get profile skills

**Tests**: 158 new tests in `operator/__tests__/skills.test.mjs` — 1904 total across 29 suites

## What S112 Should Do

### Phase 5B: Skill Selection + Agent Integration

See `docs/multi-orchestrator-plan.md` Phase 5 "S111" section.

#### 1. `discover_skills` Meta-Tool

Create a tool that agents can call mid-task to request additional skills:
- Agent writes a skill request with context
- Orchestrator evaluates via selectSkills()
- Approved skills are added to the agent's active set
- Wire into orchestrator.mjs agent runner

#### 2. Per-Turn Skill Re-evaluation

- After each agent turn, check which skills were actually used
- Remove unused skills (reduce context/cost)
- Add skills that were discovered as needed
- Track usage in agent-tracking.mjs

#### 3. Wire Profiles to Role Registry

- Map role-registry roles to AGENT_PROFILES (or auto-detect from role metadata)
- Agent config generation should include skill set based on profile
- Update `buildAgentConfig()` in role-registry.mjs to include skills

#### 4. Usage Analytics

- Track which skills are called per task type
- Store in registry or separate analytics file
- Surface in analytics dashboard

#### 5. Tests

- End-to-end: role → profile → skills → agent config
- Mid-task discovery flow
- Usage analytics tracking
- Per-turn re-evaluation logic

## Key Files Reference

| File | Purpose |
|------|---------|
| `operator/skills/registry.mjs` | SkillRegistry class — load, validate, search, index |
| `operator/skills/selector.mjs` | selectSkills (2-stage), AGENT_PROFILES, selectProfileSkills |
| `operator/skills/resolver.mjs` | resolveSkillSet, checkCompatibility, topologicalSort |
| `operator/skills/schema/skill.schema.json` | Manifest JSON Schema |
| `operator/skills/manifests/` | 17 skill manifests in 4 subdirs |
| `operator/__tests__/skills.test.mjs` | 158 tests for skill system |

## Architecture State

- **1904 tests** across 29 suites — ALL PASSING
- **Phase 0-4**: DONE (factory patterns → general-purpose roster)
- **Phase 5A**: DONE (skill registry, selector, resolver, 17 manifests)
- **Phase 5B**: TODO (agent integration, discover_skills, per-turn eval, analytics)
- **Phase 6+**: Inter-orchestrator coordination (future)

## What NOT to Do
- Don't modify Phase 1-4 code unless wiring skills into existing flows
- Don't break the 1904 existing tests
- Don't touch the game engine or React frontend
- Don't start Phase 6 until Phase 5B is tested
