---
name: security-scan
description: Scan codebase for security vulnerabilities, secrets, and dependency issues
allowed-tools: Read, Glob, Grep, Bash
model: sonnet
context: fork
agent: general-purpose
---

Perform a security audit of the codebase.

## Scan Areas

### 1. Secret Detection
Search for patterns that indicate hardcoded secrets:
- API keys, tokens, passwords in source files
- `.env` files committed to repo
- Private keys or certificates
- Connection strings with credentials
- Patterns: `password\s*=`, `api[_-]?key\s*=`, `secret\s*=`, `token\s*=`, `Bearer\s+[A-Za-z0-9]`

### 2. Dependency Vulnerabilities
- Read `package.json` and `package-lock.json` — check for known vulnerable versions
- Run `npm audit` if available
- Flag dependencies with no recent updates (>2 years)
- Check for typosquatting (similar names to popular packages)

### 3. Code Vulnerabilities (OWASP Top 10)
- **Injection**: `eval()`, `Function()`, template literals in SQL/shell, `innerHTML`, `dangerouslySetInnerHTML`
- **XSS**: Unsanitized user input rendered in HTML
- **Path Traversal**: User input in file paths without sanitization
- **Command Injection**: User input in `exec()`, `spawn()`, `execSync()`
- **Prototype Pollution**: `Object.assign` with user-controlled input
- **ReDoS**: Regular expressions vulnerable to catastrophic backtracking

### 4. Configuration Security
- CORS settings (overly permissive `*`)
- CSP headers missing
- Debug mode enabled in production
- Verbose error messages exposing internals

## Output Format

```
SECURITY SCAN RESULTS
=====================
Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO

[CRITICAL] description — file:line
  Impact: what could happen
  Fix: how to remediate

[HIGH] ...
```

End with summary counts by severity and overall risk assessment.
