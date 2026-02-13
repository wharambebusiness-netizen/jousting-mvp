---
name: project-detect
description: Auto-detect project type, language, framework, and configure orchestrator settings
allowed-tools: Read, Glob, Grep, Bash
model: haiku
context: fork
agent: Explore
---

Analyze the current project and detect its technology stack, structure, and tooling.

## Detection Steps

### 1. Package Manager & Language
- `package.json` → Node.js/TypeScript (check for `typescript` dep)
- `Cargo.toml` → Rust
- `pyproject.toml` / `setup.py` / `requirements.txt` → Python
- `go.mod` → Go
- `pom.xml` / `build.gradle` → Java/Kotlin
- `Gemfile` → Ruby
- `*.csproj` / `*.sln` → C#/.NET

### 2. Framework Detection
- React: `react` in package.json dependencies
- Vue: `vue` in dependencies
- Angular: `@angular/core` in dependencies
- Next.js: `next` in dependencies
- Express: `express` in dependencies
- FastAPI: `fastapi` in requirements
- Django: `django` in requirements
- Vite: `vite` in devDependencies

### 3. Test Runner
- Vitest: `vitest` in devDeps → `npx vitest run`
- Jest: `jest` in devDeps → `npx jest`
- Mocha: `mocha` in devDeps → `npx mocha`
- pytest: `pytest` in requirements → `pytest`
- cargo test: Cargo.toml → `cargo test`
- go test: go.mod → `go test ./...`

### 4. Build System
- Vite: `vite.config.*` → `npm run build`
- Webpack: `webpack.config.*` → `npm run build`
- Cargo: `Cargo.toml` → `cargo build`
- Go: `go.mod` → `go build`

### 5. Linter & Type Checker
- ESLint: `.eslintrc*` or `eslint.config.*` → `npx eslint .`
- Prettier: `.prettierrc*` → `npx prettier --check .`
- TypeScript: `tsconfig.json` → `npx tsc --noEmit`
- Ruff: `ruff` in requirements → `ruff check .`
- Clippy: Cargo.toml → `cargo clippy`

### 6. Project Structure
- Source directories (src/, lib/, app/)
- Test directories (test/, tests/, __tests__/, *.test.*, *.spec.*)
- Config files (env, CI/CD, Docker)
- Entry points (main.*, index.*, App.*)

## Output Format

```json
{
  "language": "typescript",
  "framework": "react",
  "buildTool": "vite",
  "packageManager": "npm",
  "testRunner": { "command": "npx vitest run", "tool": "vitest" },
  "linter": { "command": "npx eslint .", "tool": "eslint" },
  "typeChecker": { "command": "npx tsc --noEmit", "tool": "typescript" },
  "buildCommand": "npm run build",
  "sourceDir": "src/",
  "testDir": "src/",
  "testPattern": "*.test.ts",
  "entryPoint": "src/main.tsx",
  "structure": {
    "engine": "src/engine/",
    "ui": "src/ui/",
    "ai": "src/ai/",
    "tools": "src/tools/"
  }
}
```
