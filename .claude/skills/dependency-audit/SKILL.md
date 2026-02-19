---
name: dependency-audit
description: Review package health, outdated deps, vulnerabilities, and frontend dep constraint
allowed-tools: Read, Glob, Grep, Bash
model: sonnet
context: fork
agent: general-purpose
---

Perform a dependency audit of the jousting-mvp project.

## Steps

### 1. Read package.json
- List all runtime dependencies with versions
- List all devDependencies with versions
- Check for any unnecessary or unused dependencies

### 2. Check for Outdated Packages
- Compare current versions against latest available
- Flag any packages more than 1 major version behind
- Note any packages with known end-of-life dates
- Key packages to check: express, ws, vitest, vite, typescript, react, @anthropic-ai/claude-agent-sdk

### 3. Vulnerability Check
- Run `npm audit` if available
- Read package-lock.json for transitive dependency issues
- Check for known CVEs in current versions
- Flag any high/critical severity findings

### 4. Zero-Frontend-Dependency Constraint
- Verify that the operator UI uses NO npm frontend packages
- Check that Pico CSS and HTMX are loaded via CDN only (check HTML files for script/link tags)
- Ensure no frontend build step exists for the operator
- Verify app.js and style.css are vanilla (no transpilation needed)

### 5. Dependency Minimization
- Are there dependencies that could be replaced with built-in Node.js modules?
- Are there dev dependencies that are no longer used?
- Check for duplicate functionality between dependencies

### 6. Lock File Health
- Does package-lock.json exist and is it in sync with package.json?
- Are there integrity hash mismatches?
- Check for any deprecated package warnings in the lock file

## Output Format

```
DEPENDENCY AUDIT
================
Category: CRITICAL / HIGH / MEDIUM / LOW / INFO

Runtime Dependencies (N total):
  [package@version] — status (current/outdated/vulnerable)

Dev Dependencies (N total):
  [package@version] — status

[CRITICAL] description
  Impact: what's at risk
  Fix: how to remediate

Frontend Constraint: PASS/FAIL
  [details]
```

End with summary: N issues by severity, recommended actions.
