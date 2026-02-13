---
name: code-review
description: AI-powered code review for recent changes or specific files
allowed-tools: Read, Glob, Grep, Bash
model: sonnet
context: fork
agent: general-purpose
---

Perform a thorough code review of the specified files or recent changes.

## Input

If `$ARGUMENTS` is provided, review those specific files or paths.
If no arguments, review uncommitted changes via `git diff` and `git diff --cached`.

## Review Checklist

### Critical (BLOCK)
- [ ] Security vulnerabilities (injection, XSS, hardcoded secrets, unsafe eval)
- [ ] Data loss risks (missing error handling on destructive operations)
- [ ] Type safety violations (unsafe `as` casts, `any` types, missing null checks)
- [ ] Race conditions or shared mutable state issues

### Important (WARN)
- [ ] Missing error handling at system boundaries
- [ ] Functions over 60 lines
- [ ] Magic numbers not in config/constants
- [ ] Duplicated code that should be abstracted
- [ ] Missing or incorrect TypeScript types
- [ ] Unused imports or dead code

### Style (INFO)
- [ ] Naming conventions (camelCase for functions, PascalCase for types/components)
- [ ] Consistent formatting
- [ ] Clear variable names that convey intent

### Architecture
- [ ] Engine files have zero UI/AI imports (portability constraint)
- [ ] All tuning constants in balance-config.ts or similar config file
- [ ] No hardcoded paths or environment assumptions

## Output Format

For each file reviewed:
```
## file/path.ts
- BLOCK: [description] (line X)
- WARN: [description] (line Y)
- INFO: [description] (line Z)
```

End with a summary: X blocks, Y warnings, Z info items. Recommend approve/request-changes.
