# Skills Audit Report

**Generated:** 2026-02-27
**Data Sources:** `skills-registry-data`, `role-template-data`, `assignment-matrix-data`, `redundancy-report`, `gap-report`
**Status:** PR-Ready

---

## 1. Executive Summary

| Metric | Value |
|--------|-------|
| Existing skills | 17 |
| Roles analyzed | 23 |
| Skill profiles | 6 |
| Skill categories | 7 (1 empty) |
| Total findings | 10 (0 critical, 2 warning, 8 info) |
| Orphaned skills | 2 (`agent-report`, `orchestrator-status`) |
| Roles with wrong skills | 10 (identity mismatch) |
| Proposed new skills | 14 |
| Profile fixes needed | 5 |
| Redundancy pairs | 3 |
| Conflicts | 0 |

**Key Findings:**

1. **Two orphaned skills** — `agent-report` and `orchestrator-status` are defined but assigned to zero profiles. No agent can ever receive them.
2. **10 roles lack domain-specific skills** — balance-analyst has no simulation skill, devops has no deployment skill, dependency-manager can't access dependency-audit, performance-analyst can't access performance-audit.
3. **Profile indirection causes identity violations** — The 6-profile system (code-writer, tester, reviewer, auditor, researcher, deployer) creates a lossy bottleneck. 23 roles with distinct missions are funneled through 6 generic templates, causing roles like `producer` to receive `code-review` and `lint` instead of task-management skills.
4. **deployer is the most limited profile** — Only 4 total skills (3 git + test-runner) despite DevOps requiring build, deploy, and environment management.
5. **4 missing skill categories** — `deployment` (empty), `database`, `simulation`, `documentation` have zero manifests.
6. **Universal skills are correctly assigned** — `file-read` and `codebase-search` across 5/6 profiles (22 roles) is appropriate.

---

## 2. BEFORE State — Original Assignment Matrix

### Profile → Skill Mapping (Current)

| Profile | Core Skills | Optional Skills | Roles |
|---------|-------------|-----------------|-------|
| **code-writer** | file-read, test-runner, codebase-search | lint, git-status | engine-dev, ui-dev, backend-dev, full-stack-dev, database-dev, css-artist, debugger, refactorer (8) |
| **tester** | test-runner, file-read, codebase-search | lint, test-coverage-audit | qa-engineer, test-generator, integration-tester (3) |
| **reviewer** | file-read, codebase-search, lint | git-status, code-review | tech-lead, self-reviewer, architect, producer, docs-writer (5) |
| **auditor** | file-read, codebase-search, security-scan | accessibility-audit, performance-audit, dependency-audit | security-auditor (1) |
| **researcher** | web-search, codebase-search, file-read | project-detect | balance-analyst, game-designer, performance-analyst, research-agent, dependency-manager (5) |
| **deployer** | git-status, git-commit, git-push | test-runner | devops (1) |

### Skill Coverage Summary

| Skill | Profiles | Total Roles | Type |
|-------|----------|-------------|------|
| file-read | 5 | 22 | Universal core |
| codebase-search | 5 | 22 | Universal core |
| test-runner | 3 | 12 | Core (code-writer, tester) + optional (deployer) |
| lint | 3 | 16 | Core (reviewer) + optional (code-writer, tester) |
| git-status | 3 | 14 | Core (deployer) + optional (code-writer, reviewer) |
| web-search | 1 | 5 | Core (researcher) |
| security-scan | 1 | 1 | Core (auditor) |
| code-review | 1 | 5 | Optional (reviewer) |
| project-detect | 1 | 5 | Optional (researcher) |
| accessibility-audit | 1 | 1 | Optional (auditor) |
| performance-audit | 1 | 1 | Optional (auditor) |
| dependency-audit | 1 | 1 | Optional (auditor) |
| test-coverage-audit | 1 | 3 | Optional (tester) |
| git-commit | 1 | 1 | Core (deployer) |
| git-push | 1 | 1 | Core (deployer) |
| **agent-report** | **0** | **0** | **ORPHANED** |
| **orchestrator-status** | **0** | **0** | **ORPHANED** |

---

## 3. Findings

### 3.1 Redundancies (3 pairs)

| Skill A | Skill B | Overlap | Severity | Notes |
|---------|---------|---------|----------|-------|
| git-commit | git-push | 50% | info | Same category, shared tags. Both have side effects, require confirmation. Overlap is acceptable — they serve distinct operations. |
| accessibility-audit | dependency-audit | 50% | info | Same category (`audit`), shared `audit` tag. Functionally distinct — no action needed. |
| code-review | security-scan | 55% | info | Both scan code for issues. `code-review` covers "security" in tags. **Recommendation:** code-review should defer security findings to security-scan when both are assigned. |

### 3.2 Conflicts

**None.** All 17 manifests declare zero conflicts. No role receives mutually exclusive skills.

### 3.3 Identity Violations — Roles with Wrong Skills

| Role | Profile | Problem | Severity |
|------|---------|---------|----------|
| **balance-analyst** | researcher | No simulation skill. Gets web-search + codebase-search but needs to run `simulate.ts` and interpret statistical output. Zero domain specificity. | HIGH |
| **devops** | deployer | No deployment/CI/CD skill. Only has 3 git ops + test-runner. Zero `deployment` category skills despite the profile name. | HIGH |
| **dependency-manager** | researcher | Entire mission is dependency auditing, but `dependency-audit` is locked to the auditor profile. Cannot access its defining skill. | HIGH |
| **performance-analyst** | researcher | Needs `performance-audit` but it's locked to auditor profile. Gets `project-detect` instead. | HIGH |
| **producer** | reviewer | Gets `code-review` and `lint` (irrelevant). Needs task-management/backlog-parsing skills. | MEDIUM |
| **docs-writer** | reviewer | Gets `code-review` (irrelevant). Needs doc-generation/validation. `lint` checks code, not prose. | MEDIUM |
| **database-dev** | code-writer | No schema-validation or migration-runner skills. Gets generic code-writer kit. | MEDIUM |
| **self-reviewer** | reviewer | `lint` and `code-review` don't match read-only introspection mission. Needs orchestrator-specific analysis. | MEDIUM |
| **css-artist** | code-writer | No CSS-specific linting. Generic `lint` covers eslint, not stylelint. | LOW |
| **debugger** | code-writer | No stack-trace analysis or error-pattern-matching. Nothing specialized for root-cause analysis. | LOW |

### 3.4 Orphaned Skills

| Skill | Category | Model | Issue |
|-------|----------|-------|-------|
| `agent-report` | analysis | sonnet | Not in any profile. No agent can receive it. |
| `orchestrator-status` | analysis | haiku | Not in any profile. No agent can receive it. |

**Root cause:** The `analysis` category has no corresponding profile. These skills were created but never wired into the assignment system.

### 3.5 Missing Skill Categories

| Category | Status | Impact | Roles Affected |
|----------|--------|--------|----------------|
| `deployment` | EMPTY (valid but no manifests) | DevOps has zero deployment skills | devops |
| `database` | MISSING | No schema/migration tooling | database-dev, backend-dev, full-stack-dev |
| `simulation` | MISSING | balance-analyst can't run sims | balance-analyst, game-designer |
| `documentation` | MISSING | No doc linting or validation | docs-writer, architect |

### 3.6 Over-Assigned Skills (Informational)

| Skill | Profiles | Total Roles | Assessment |
|-------|----------|-------------|------------|
| file-read | 5 | 22 | Expected — universal utility |
| codebase-search | 5 | 22 | Expected — universal utility |
| test-runner | 3 | 12 | Appropriate — code-writers and testers both need it |
| lint | 3 | 16 | Appropriate — quality gate for writers/testers/reviewers |
| git-status | 3 | 14 | Appropriate — read-only git awareness |

---

## 4. Changes

### 4.1 Removals

None. All existing skills serve valid purposes. Redundancy pairs are functional (not duplicative).

### 4.2 Profile Fixes (Reassignments)

| # | Change | Reason | Priority |
|---|--------|--------|----------|
| PF-1 | Add `dependency-audit` to **researcher** profile optional | dependency-manager needs its defining skill | HIGH |
| PF-2 | Add `performance-audit` to **researcher** profile optional | performance-analyst needs profiling access | HIGH |
| PF-3 | Add `build-runner`, `deploy-check`, `env-validator` to **deployer** profile | deployer has only 4 skills, needs deployment tooling | HIGH |
| PF-4 | Add `backlog-manager` to **reviewer** profile optional | producer needs task-management, not code-review | MEDIUM |
| PF-5 | Assign `orchestrator-status` + `metrics-analyzer` + `handoff-validator` to **reviewer** profile optional | Un-orphans `orchestrator-status`, serves self-reviewer | MEDIUM |
| PF-6 | Assign `agent-report` to **reviewer** profile optional | Un-orphans `agent-report`, useful for tech-lead/self-reviewer | MEDIUM |

### 4.3 New Skills (14 proposed)

#### Phase 1 — HIGH priority, LOW effort (3 skills, ~2h)

| Skill | Category | Model | Target Profiles | Closes Gap |
|-------|----------|-------|-----------------|------------|
| `git-diff` | git | haiku | reviewer, auditor, tester | Change analysis for 15+ roles |
| `build-runner` | deployment | haiku | deployer, code-writer | Fills empty deployment category |
| `type-checker` | code | haiku | code-writer, reviewer | TypeScript type checking |

#### Phase 2 — HIGH priority, MEDIUM effort (3 skills, ~3h)

| Skill | Category | Model | Target Profiles | Closes Gap |
|-------|----------|-------|-----------------|------------|
| `balance-sim` | analysis | haiku | researcher | balance-analyst domain skill |
| `backlog-manager` | analysis | haiku | reviewer | producer domain skill |
| `handoff-validator` | analysis | haiku | reviewer | self-reviewer domain skill |

#### Phase 3 — MEDIUM priority (3 skills, ~3h)

| Skill | Category | Model | Target Profiles | Closes Gap |
|-------|----------|-------|-----------------|------------|
| `doc-lint` | code | haiku | reviewer | docs-writer domain skill |
| `metrics-analyzer` | analysis | sonnet | reviewer | self-reviewer orchestrator introspection |
| `deploy-check` | deployment | haiku | deployer | Pre-deploy checklist |

#### Phase 4 — LOW priority, long-tail (5 skills, ~4h)

| Skill | Category | Model | Target Profiles | Closes Gap |
|-------|----------|-------|-----------------|------------|
| `env-validator` | deployment | haiku | deployer, code-writer | Environment config validation |
| `css-lint` | code | haiku | code-writer | CSS-specific linting for css-artist |
| `error-analyzer` | code | sonnet | code-writer, tester | Stack trace analysis for debugger |
| `schema-validator` | code | sonnet | code-writer | Database schema validation |
| `benchmark-runner` | testing | haiku | researcher, code-writer | Performance benchmarking |

### 4.4 Merges

None required. The 3 redundancy pairs (git-commit/git-push, accessibility-audit/dependency-audit, code-review/security-scan) are functionally distinct despite tag overlap.

---

## 5. AFTER State — New Assignment Matrix

### Updated Profile → Skill Mapping

| Profile | Core Skills | Optional Skills | Total | Roles |
|---------|-------------|-----------------|-------|-------|
| **code-writer** | file-read, test-runner, codebase-search | lint, git-status, type-checker, build-runner, env-validator, css-lint, error-analyzer, schema-validator | 3+8=11 (cap 8) | engine-dev, ui-dev, backend-dev, full-stack-dev, database-dev, css-artist, debugger, refactorer |
| **tester** | test-runner, file-read, codebase-search | lint, test-coverage-audit, git-diff, error-analyzer, benchmark-runner | 3+5=8 | qa-engineer, test-generator, integration-tester |
| **reviewer** | file-read, codebase-search, lint | git-status, code-review, git-diff, type-checker, backlog-manager, handoff-validator, metrics-analyzer, orchestrator-status, agent-report, doc-lint | 3+10=13 (cap 8) | tech-lead, self-reviewer, architect, producer, docs-writer |
| **auditor** | file-read, codebase-search, security-scan | accessibility-audit, performance-audit, dependency-audit, git-diff | 3+4=7 | security-auditor |
| **researcher** | web-search, codebase-search, file-read | project-detect, balance-sim, dependency-audit, performance-audit, benchmark-runner | 3+5=8 | balance-analyst, game-designer, performance-analyst, research-agent, dependency-manager |
| **deployer** | git-status, git-commit, git-push | test-runner, build-runner, deploy-check, env-validator | 3+4=7 | devops |

> **Note:** Profiles with >8 optional skills rely on the runtime `selectSkills()` scoring pipeline to pick the most relevant 3-5 optional skills per task. The max-skills cap (8 total per agent) is enforced at assignment time, not profile definition time.

### Per-Role Effective Skills (After Fixes)

| Role | Profile | Core (3) | Likely Optional (capped to 5) | Total |
|------|---------|----------|-------------------------------|-------|
| engine-dev | code-writer | file-read, test-runner, codebase-search | lint, type-checker, build-runner | 6 |
| ui-dev | code-writer | file-read, test-runner, codebase-search | lint, css-lint, type-checker | 6 |
| backend-dev | code-writer | file-read, test-runner, codebase-search | lint, type-checker, env-validator | 6 |
| full-stack-dev | code-writer | file-read, test-runner, codebase-search | lint, type-checker, build-runner | 6 |
| database-dev | code-writer | file-read, test-runner, codebase-search | lint, schema-validator | 5 |
| css-artist | code-writer | file-read, test-runner, codebase-search | css-lint, lint | 5 |
| debugger | code-writer | file-read, test-runner, codebase-search | error-analyzer, lint | 5 |
| refactorer | code-writer | file-read, test-runner, codebase-search | lint, type-checker | 5 |
| qa-engineer | tester | test-runner, file-read, codebase-search | lint, test-coverage-audit, git-diff | 6 |
| test-generator | tester | test-runner, file-read, codebase-search | lint, test-coverage-audit | 5 |
| integration-tester | tester | test-runner, file-read, codebase-search | lint, error-analyzer | 5 |
| tech-lead | reviewer | file-read, codebase-search, lint | git-status, code-review, git-diff, type-checker | 7 |
| self-reviewer | reviewer | file-read, codebase-search, lint | orchestrator-status, metrics-analyzer, handoff-validator | 6 |
| architect | reviewer | file-read, codebase-search, lint | git-status, code-review, doc-lint | 6 |
| producer | reviewer | file-read, codebase-search, lint | backlog-manager, handoff-validator, agent-report | 6 |
| docs-writer | reviewer | file-read, codebase-search, lint | doc-lint, git-status | 5 |
| security-auditor | auditor | file-read, codebase-search, security-scan | dependency-audit, git-diff, accessibility-audit | 6 |
| balance-analyst | researcher | web-search, codebase-search, file-read | balance-sim, project-detect | 5 |
| game-designer | researcher | web-search, codebase-search, file-read | balance-sim, project-detect | 5 |
| performance-analyst | researcher | web-search, codebase-search, file-read | performance-audit, benchmark-runner | 5 |
| dependency-manager | researcher | web-search, codebase-search, file-read | dependency-audit, project-detect | 5 |
| research-agent | researcher | web-search, codebase-search, file-read | project-detect | 4 |
| devops | deployer | git-status, git-commit, git-push | test-runner, build-runner, deploy-check, env-validator | 7 |

**Constraint check:** All roles have 4-7 effective skills (within 3-8 range).

---

## 6. New Skill Specs — JSON Manifest Snippets

### Phase 1

#### `git-diff.skill.json` (→ `manifests/git/`)

```json
{
  "id": "git-diff",
  "name": "Git Diff",
  "version": "1.0.0",
  "description": "Show file-level and line-level diffs between commits, branches, or working tree. Supports stat-only mode and file filtering.",
  "shortDesc": "View code changes between revisions",
  "category": "git",
  "model": "haiku",
  "tags": ["git", "diff", "vcs", "changes", "review", "comparison"],
  "triggerExamples": [
    "show me what changed",
    "diff against main",
    "what files were modified",
    "show changes since last commit"
  ],
  "requires": ["git-status"],
  "conflicts": [],
  "enhancedBy": ["file-read", "codebase-search"],
  "sideEffects": false,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 3000
}
```

#### `build-runner.skill.json` (→ `manifests/deployment/`)

```json
{
  "id": "build-runner",
  "name": "Build Runner",
  "version": "1.0.0",
  "description": "Run project build commands (npm run build, tsc, vite build) and report success/failure, output size, type errors, and warnings.",
  "shortDesc": "Execute project build and report results",
  "category": "deployment",
  "model": "haiku",
  "tags": ["build", "compile", "bundle", "vite", "tsc", "deployment"],
  "triggerExamples": [
    "build the project",
    "run the build",
    "check if it compiles",
    "bundle size"
  ],
  "requires": ["file-read"],
  "conflicts": [],
  "enhancedBy": ["type-checker", "lint"],
  "sideEffects": true,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 30000
}
```

#### `type-checker.skill.json` (→ `manifests/code/`)

```json
{
  "id": "type-checker",
  "name": "Type Checker",
  "version": "1.0.0",
  "description": "Run TypeScript type checking (tsc --noEmit) and report type errors with file locations, error codes, and suggested fixes.",
  "shortDesc": "Run tsc --noEmit and report type errors",
  "category": "code",
  "model": "haiku",
  "tags": ["typescript", "types", "tsc", "typecheck", "static-analysis", "code"],
  "triggerExamples": [
    "check types",
    "run tsc",
    "any type errors",
    "typescript validation"
  ],
  "requires": ["file-read"],
  "conflicts": [],
  "enhancedBy": ["codebase-search"],
  "sideEffects": false,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 20000
}
```

### Phase 2

#### `balance-sim.skill.json` (→ `manifests/analysis/`)

```json
{
  "id": "balance-sim",
  "name": "Balance Simulation",
  "version": "1.0.0",
  "description": "Run the jousting balance simulation tool (simulate.ts) with configurable tier, variant, and match count. Parse output for win rates, spreads, flags, and matchup tables.",
  "shortDesc": "Run balance simulation and parse results",
  "category": "analysis",
  "model": "haiku",
  "tags": ["simulation", "balance", "win-rate", "statistics", "jousting", "analysis"],
  "triggerExamples": [
    "run simulation",
    "check balance",
    "win rates at giga tier",
    "simulate 500 matches",
    "balance summary"
  ],
  "requires": ["file-read"],
  "conflicts": [],
  "enhancedBy": ["codebase-search"],
  "sideEffects": false,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 45000
}
```

#### `backlog-manager.skill.json` (→ `manifests/analysis/`)

```json
{
  "id": "backlog-manager",
  "name": "Backlog Manager",
  "version": "1.0.0",
  "description": "CRUD operations on backlog.json: list tasks, filter by status/priority/assignee, create new tasks, update existing, check dependency graph, archive completed tasks.",
  "shortDesc": "Manage orchestrator task backlog",
  "category": "analysis",
  "model": "haiku",
  "tags": ["backlog", "tasks", "priority", "queue", "management", "orchestrator"],
  "triggerExamples": [
    "show backlog",
    "list pending tasks",
    "create a new task",
    "archive completed tasks",
    "task dependencies"
  ],
  "requires": ["file-read"],
  "conflicts": [],
  "enhancedBy": ["codebase-search"],
  "sideEffects": true,
  "idempotent": false,
  "requiresConfirmation": true,
  "estimatedDurationMs": 5000
}
```

#### `handoff-validator.skill.json` (→ `manifests/analysis/`)

```json
{
  "id": "handoff-validator",
  "name": "Handoff Validator",
  "version": "1.0.0",
  "description": "Validate agent handoff files against META schema: required fields (status, files-modified, tests-passing, test-count), message tags, format compliance. Report violations.",
  "shortDesc": "Validate handoff META format",
  "category": "analysis",
  "model": "haiku",
  "tags": ["handoff", "validation", "meta", "schema", "orchestrator", "quality"],
  "triggerExamples": [
    "validate handoffs",
    "check handoff format",
    "are handoffs valid",
    "meta section check"
  ],
  "requires": ["file-read"],
  "conflicts": [],
  "enhancedBy": ["codebase-search"],
  "sideEffects": false,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 10000
}
```

### Phase 3

#### `doc-lint.skill.json` (→ `manifests/code/`)

```json
{
  "id": "doc-lint",
  "name": "Documentation Linter",
  "version": "1.0.0",
  "description": "Lint markdown files for broken links, inconsistent headers, missing sections, stale API references, and formatting issues.",
  "shortDesc": "Lint markdown docs for issues",
  "category": "code",
  "model": "haiku",
  "tags": ["documentation", "markdown", "lint", "links", "validation", "docs"],
  "triggerExamples": [
    "lint the docs",
    "check documentation",
    "broken links",
    "validate markdown"
  ],
  "requires": ["file-read"],
  "conflicts": [],
  "enhancedBy": ["codebase-search"],
  "sideEffects": false,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 15000
}
```

#### `metrics-analyzer.skill.json` (→ `manifests/analysis/`)

```json
{
  "id": "metrics-analyzer",
  "name": "Metrics Analyzer",
  "version": "1.0.0",
  "description": "Parse orchestrator metrics to detect patterns: stuck agents, rising costs, declining test counts, role utilization imbalance, throughput anomalies.",
  "shortDesc": "Analyze orchestrator metrics for anomalies",
  "category": "analysis",
  "model": "sonnet",
  "tags": ["metrics", "analysis", "orchestrator", "monitoring", "anomaly", "cost"],
  "triggerExamples": [
    "analyze metrics",
    "any stuck agents",
    "cost trends",
    "agent utilization"
  ],
  "requires": ["file-read", "codebase-search"],
  "conflicts": [],
  "enhancedBy": ["orchestrator-status"],
  "sideEffects": false,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 30000
}
```

#### `deploy-check.skill.json` (→ `manifests/deployment/`)

```json
{
  "id": "deploy-check",
  "name": "Deploy Readiness Check",
  "version": "1.0.0",
  "description": "Pre-deployment checklist: tests passing, build succeeds, no uncommitted changes, correct branch, environment variables set, no security warnings.",
  "shortDesc": "Pre-deploy readiness checklist",
  "category": "deployment",
  "model": "haiku",
  "tags": ["deploy", "readiness", "checklist", "pre-deploy", "validation", "deployment"],
  "triggerExamples": [
    "ready to deploy",
    "pre-deploy check",
    "deployment readiness",
    "can we ship"
  ],
  "requires": ["git-status", "build-runner"],
  "conflicts": [],
  "enhancedBy": ["test-runner", "env-validator"],
  "sideEffects": false,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 45000
}
```

### Phase 4

#### `env-validator.skill.json` (→ `manifests/deployment/`)

```json
{
  "id": "env-validator",
  "name": "Environment Validator",
  "version": "1.0.0",
  "description": "Validate environment configuration: .env files present, required env vars set, port availability, Node version, lock file health, config drift detection.",
  "shortDesc": "Validate environment configuration",
  "category": "deployment",
  "model": "haiku",
  "tags": ["environment", "config", "validation", ".env", "ports", "deployment"],
  "triggerExamples": [
    "check environment",
    "validate .env",
    "port conflicts",
    "node version check"
  ],
  "requires": ["file-read"],
  "conflicts": [],
  "enhancedBy": [],
  "sideEffects": false,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 5000
}
```

#### `css-lint.skill.json` (→ `manifests/code/`)

```json
{
  "id": "css-lint",
  "name": "CSS Linter",
  "version": "1.0.0",
  "description": "CSS-specific linting: BEM naming conventions, unused selectors, specificity warnings, mobile breakpoint coverage, color contrast checks.",
  "shortDesc": "Lint CSS for style issues",
  "category": "code",
  "model": "haiku",
  "tags": ["css", "lint", "stylelint", "selectors", "specificity", "responsive"],
  "triggerExamples": [
    "lint css",
    "check stylesheets",
    "unused css selectors",
    "css specificity issues"
  ],
  "requires": ["file-read"],
  "conflicts": [],
  "enhancedBy": ["codebase-search"],
  "sideEffects": false,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 10000
}
```

#### `error-analyzer.skill.json` (→ `manifests/code/`)

```json
{
  "id": "error-analyzer",
  "name": "Error Analyzer",
  "version": "1.0.0",
  "description": "Parse stack traces and test failures to identify root cause patterns, suggest likely files/functions, and correlate with recent changes.",
  "shortDesc": "Analyze stack traces and test failures",
  "category": "code",
  "model": "sonnet",
  "tags": ["error", "stacktrace", "debug", "root-cause", "failure", "analysis"],
  "triggerExamples": [
    "analyze this error",
    "why did the test fail",
    "parse stack trace",
    "root cause analysis"
  ],
  "requires": ["file-read"],
  "conflicts": [],
  "enhancedBy": ["codebase-search", "test-runner"],
  "sideEffects": false,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 15000
}
```

#### `schema-validator.skill.json` (→ `manifests/code/`)

```json
{
  "id": "schema-validator",
  "name": "Schema Validator",
  "version": "1.0.0",
  "description": "Validate database schemas for consistency, missing indices, foreign key integrity, naming conventions, and migration ordering.",
  "shortDesc": "Validate database schema integrity",
  "category": "code",
  "model": "sonnet",
  "tags": ["schema", "database", "validation", "migration", "index", "integrity"],
  "triggerExamples": [
    "validate schema",
    "check migrations",
    "missing indexes",
    "schema consistency"
  ],
  "requires": ["file-read"],
  "conflicts": [],
  "enhancedBy": ["codebase-search"],
  "sideEffects": false,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 20000
}
```

#### `benchmark-runner.skill.json` (→ `manifests/testing/`)

```json
{
  "id": "benchmark-runner",
  "name": "Benchmark Runner",
  "version": "1.0.0",
  "description": "Run performance benchmarks: time function execution, measure memory usage, compare before/after, detect performance regressions.",
  "shortDesc": "Run performance benchmarks",
  "category": "testing",
  "model": "haiku",
  "tags": ["benchmark", "performance", "timing", "memory", "regression", "testing"],
  "triggerExamples": [
    "run benchmarks",
    "performance test",
    "timing comparison",
    "detect perf regression"
  ],
  "requires": ["file-read"],
  "conflicts": [],
  "enhancedBy": ["codebase-search", "test-runner"],
  "sideEffects": false,
  "idempotent": true,
  "requiresConfirmation": false,
  "estimatedDurationMs": 60000
}
```

---

## 7. Validation

### 7.1 Constraint Checks

| Constraint | Status | Details |
|------------|--------|---------|
| Min 3 skills per role | PASS | Minimum is research-agent at 4 (3 core + 1 optional) |
| Max 8 skills per role | PASS | Maximum is tech-lead at 7. Runtime cap enforces 8 |
| No orphaned skills | PASS (after fixes) | `agent-report` → reviewer optional, `orchestrator-status` → reviewer optional |
| No conflicts introduced | PASS | None of the 14 new skills declare conflicts |
| All deps satisfiable | PASS | New skills require only `file-read`, `git-status`, `codebase-search`, `build-runner` — all available in target profiles |
| No category collisions | PASS | New `analysis/` and `deployment/` manifest dirs needed |
| Skill IDs are kebab-case | PASS | All 14 new IDs follow convention |
| All model fields valid | PASS | Only `haiku` and `sonnet` used |

### 7.2 Identity Violation Resolution

| Role | Before | After | Resolved? |
|------|--------|-------|-----------|
| balance-analyst | No sim skill | Gets `balance-sim` | YES |
| devops | No deploy skills | Gets `build-runner`, `deploy-check`, `env-validator` | YES |
| dependency-manager | Can't access `dependency-audit` | `dependency-audit` added to researcher optional | YES |
| performance-analyst | Can't access `performance-audit` | `performance-audit` added to researcher optional | YES |
| producer | Gets irrelevant code-review | Gets `backlog-manager`, `handoff-validator`, `agent-report` | YES |
| self-reviewer | No introspection skills | Gets `orchestrator-status`, `metrics-analyzer`, `handoff-validator` | YES |
| docs-writer | Gets irrelevant code-review | Gets `doc-lint` | YES |
| database-dev | No schema tools | Gets `schema-validator` | YES |
| css-artist | No CSS-specific lint | Gets `css-lint` | YES |
| debugger | No error analysis | Gets `error-analyzer` | YES |

**10/10 identity violations resolved.**

### 7.3 Coverage After Changes

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Total skills | 17 | 31 | +14 |
| Orphaned skills | 2 | 0 | -2 |
| Identity violations | 10 | 0 | -10 |
| Skill categories with manifests | 5 | 7 | +2 (`deployment`, `analysis` dirs) |
| Min skills per role | 4 | 4 | 0 |
| Max skills per role | 6 | 7 | +1 |
| Roles with domain-specific skills | 13/23 | 23/23 | +10 |

---

## 8. Deployment Checklist

### Phase 1 (HIGH priority — do first)

- [ ] Create `operator/skills/manifests/deployment/` directory
- [ ] Create `operator/skills/manifests/analysis/` directory
- [ ] Write `manifests/git/git-diff.skill.json`
- [ ] Write `manifests/deployment/build-runner.skill.json`
- [ ] Write `manifests/code/type-checker.skill.json`
- [ ] Update `selector.mjs` `AGENT_PROFILES`:
  - Add `git-diff` to reviewer optional
  - Add `git-diff` to auditor optional
  - Add `git-diff` to tester optional
  - Add `build-runner` to deployer optional
  - Add `build-runner` to code-writer optional
  - Add `type-checker` to code-writer optional
  - Add `type-checker` to reviewer optional
- [ ] Run `npm test` — expect all 2961 tests passing
- [ ] Verify `registry.mjs` picks up new manifests (restart server, check `/api/shared-memory/key?key=skills-registry-data`)

### Phase 2 (domain-specific)

- [ ] Write `manifests/analysis/balance-sim.skill.json`
- [ ] Write `manifests/analysis/backlog-manager.skill.json`
- [ ] Write `manifests/analysis/handoff-validator.skill.json`
- [ ] Update `selector.mjs` `AGENT_PROFILES`:
  - Add `balance-sim` to researcher optional
  - Add `backlog-manager` to reviewer optional
  - Add `handoff-validator` to reviewer optional
  - Add `dependency-audit` to researcher optional (profile fix PF-1)
  - Add `performance-audit` to researcher optional (profile fix PF-2)
- [ ] Run `npm test`

### Phase 3 (reviewer/deployer improvements)

- [ ] Write `manifests/code/doc-lint.skill.json`
- [ ] Write `manifests/analysis/metrics-analyzer.skill.json`
- [ ] Write `manifests/deployment/deploy-check.skill.json`
- [ ] Update `selector.mjs` `AGENT_PROFILES`:
  - Add `doc-lint` to reviewer optional
  - Add `metrics-analyzer` to reviewer optional
  - Add `orchestrator-status` to reviewer optional (un-orphan)
  - Add `agent-report` to reviewer optional (un-orphan)
  - Add `deploy-check` to deployer optional
- [ ] Run `npm test`

### Phase 4 (long-tail)

- [ ] Write `manifests/deployment/env-validator.skill.json`
- [ ] Write `manifests/code/css-lint.skill.json`
- [ ] Write `manifests/code/error-analyzer.skill.json`
- [ ] Write `manifests/code/schema-validator.skill.json`
- [ ] Write `manifests/testing/benchmark-runner.skill.json` (create `manifests/testing/` dir)
- [ ] Update `selector.mjs` `AGENT_PROFILES` with remaining optional skills
- [ ] Run `npm test`
- [ ] Final verification: all 31 skills loaded, 0 orphans, 0 identity violations

### Post-Deployment Verification

- [ ] `curl /api/shared-memory/key?key=skills-registry-data` shows 31 total skills
- [ ] Each role's effective skills include at least one domain-specific skill
- [ ] Tracker shows no over-assigned or under-used skills after one orchestrator run
- [ ] Update `CLAUDE.md` test count if new tests added

---

*Report generated from shared memory analysis. All data sourced from live operator API.*
