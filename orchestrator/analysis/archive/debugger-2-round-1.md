# Debugger Beta — Round 1 Analysis

## Investigation Summary

No bug backlog items available (BL-079/BL-080/BL-083 are balance-tuner/QA tasks, not bugs). QA confirmed "Zero bugs found." Performed two investigations:

1. **Worktree Test Discovery Bug** (environmental, not src/ code)
2. **Proactive src/ Code Audit** (latent issues only, no active bugs)

---

## Finding 1: Vitest Worktree Test Discovery Bug

### Symptoms
- 5 test suites fail with `SyntaxError: Invalid or unexpected token`
- 471 tests can't load (role-registry: 67, process-pool: 65, server: 174, views: 165) + 3 integration tests fail
- Only 1895 of 2366 expected tests run
- Affects: `orchestrator/role-registry.test.mjs`, `operator/__tests__/process-pool.test.mjs`, `operator/__tests__/server.test.mjs`, `operator/__tests__/views.test.mjs`, `operator/__tests__/coordination-integration.test.mjs` (partial)

### Root Cause
Vitest's test file glob pattern discovers duplicate `.test.mjs` files inside `orchestrator/.worktrees/*/` subdirectories. These worktree copies of test files fail because:
- Worktree directories have no `node_modules`
- Import paths (e.g., `./role-registry.mjs`, `../server.mjs`) resolve relative to the worktree copy's location, where the imported modules don't exist
- Vite's module transform step fails on unresolvable imports, producing `SyntaxError`

### Evidence
- From main repo: `npx vitest run orchestrator/role-registry.test.mjs` → 5 matches (1 pass + 4 worktree copies fail)
- `node --check` passes on all source files (valid JS syntax)
- Direct `node --input-type=module` import succeeds for all modules
- `npx vitest run src/` → all 908 tests pass (src/ has no worktree copies)

### Recommended Fix
Add to `vite.config.ts` (or add vitest config):
```ts
export default defineConfig({
  // ...
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.worktrees/**',  // <-- exclude worktree copies
    ],
  },
})
```

### Impact
- Not a code bug — environmental/config issue
- Does not affect gameplay, engine correctness, or deployed code
- Only affects test suite reliability reporting

---

## Finding 2: src/ Code Audit — Latent Issues

All 908 src/ tests pass. No actively manifesting bugs found. Identified latent defensive gaps:

### Medium Severity (Latent)
1. **`fatigueFactor` division-by-zero guard** (`calculator.ts:32-37`): If `maxStamina=0` and `currentStamina<0`, would produce `-Infinity`. Currently mitigated by all archetypes having positive stamina (55-65) and stamina floored at 0 elsewhere. Already documented in CLAUDE.md as a known gotcha.

### Low Severity (Latent)
2. **`weightedRandom` empty array** (`basic-ai.ts:32-40`): Returns `undefined` on empty array (masked by return type `T`). Currently safe because always called with non-empty attack/speed lists.
3. **`pickRandom` empty array** (`basic-ai.ts:42-44`): Same pattern as above.
4. **AI `staRatio` division** (`basic-ai.ts` multiple locations): `sta / arch.stamina` would produce `Infinity`/`NaN` if archetype stamina were 0. Currently safe.
5. **`rollInRange` min>max** (`gear-utils.ts:17-19`): Would produce unexpected values. Currently safe because all config ranges are well-formed.

### Informational
6. **"Post-attack fatigue" misleading comment** (`phase-joust.ts:209-211`): Comment says "Post-attack" but computes from pre-attack stamina. Appears intentional (fatigue at time of combat resolution), but comment is misleading.
7. **Deprecated `resolvePass` still exported** (`calculator.ts:248-428`): Known issue, documented in CLAUDE.md.

### Assessment
The engine code is well-written with consistent defensive patterns. All identified issues are **latent** — they would only manifest under conditions that can't occur with current game data (zero-stamina archetypes, empty attack lists). No fix warranted unless the game expands to allow custom archetypes with arbitrary stats.
