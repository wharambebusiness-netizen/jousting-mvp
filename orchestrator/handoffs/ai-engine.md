# AI Engine Agent — Handoff

## META
- status: not-started
- files-modified: none
- tests-passing: true
- notes-for-others: none

## Round: 0 (initial)

## Your Mission
Improve the AI decision-making engine with percentage-based stamina thresholds, speed-attack synergy awareness, and configurable difficulty levels.

## Project Context
- Jousting minigame MVP: Vite + React + TypeScript
- Project root: jousting-mvp/
- 222 tests passing. Run with: `npx vitest run` from jousting-mvp/
- Engine is pure TS in src/engine/. UI is React in src/ui/. AI in src/ai/

## What to Implement

### 1. Percentage-Based Stamina Thresholds (basic-ai.ts)
Current code uses absolute STA values:
- `if (sta <= 15)` (line 58) — emergency slow
- `if (sta < 30)` (line 72) — lean slow
- `if (sta < 40)` (line 73) — slight slow pressure
- `if (sta < 30 && atk.deltaStamina < -15)` (line 108) — penalize expensive attacks
- `if (sta < 20 && atk.deltaStamina < -10)` (line 109) — penalize attacks more
- `if (sta < 20 && atk.deltaStamina < -12)` (line 218) — melee stamina check

Problem: Bulwark at 30 STA has 46% remaining (65 max), but Charger at 30 STA has 50% (60 max). Same threshold triggers differently per archetype.

Fix: Use `sta / arch.stamina` ratio instead:
- Emergency: `staRatio <= 0.25` (was sta <= 15)
- Low pressure: `staRatio < 0.50` (was sta < 30)
- Mild pressure: `staRatio < 0.65` (was sta < 40)

The archetype is available via `state.archetype.stamina`.

### 2. Speed-Attack Synergy (basic-ai.ts)
Currently `pickSpeed()` and `pickJoustAttack()` are independent — AI doesn't boost Coup Fort when picking Fast despite strong MOM synergy.

Fix: Pass the chosen speed to `pickJoustAttack()`:
- If Fast → boost Aggressive attack scores (+2) since MOM is boosted
- If Slow → boost Defensive attack scores (+2) since CTL/GRD are favored
- If Standard → slight boost to Balanced attacks (+1)

Similar for melee: if archetype has high MOM remaining, favor aggressive.

### 3. AIDifficulty Type (types.ts)
Add to types.ts:
```typescript
export type AIDifficulty = 'easy' | 'medium' | 'hard';
```

### 4. Difficulty Parameter (basic-ai.ts)
Add difficulty param to all exported AI functions:
- `aiPickJoustChoice(state, opponentLastAttack?, opponentRevealedAttack?, difficulty?)`
- `aiPickMeleeAttack(state, opponentLastAttack?, difficulty?)`
- `aiPickCaparison(archetype, difficulty?)`

Difficulty controls the optimal/random ratio:
- easy: 40% optimal, 60% random
- medium: 70% optimal, 30% random (current default)
- hard: 90% optimal, 10% random

Replace all `Math.random() < 0.3` checks with a difficulty-based threshold.
Keep `medium` as default for backwards compatibility.

### 5. Difficulty Selector UI (SetupScreen.tsx)
Add a difficulty selector to the setup screen (3 buttons: Easy / Medium / Hard).
Default to Medium. Pass selected difficulty up through onStart callback.

### 6. Wire Through App.tsx
Add `difficulty` state variable. Pass it through to AI calls in handleAttackSelect, handleMeleeAttack, handleLoadoutConfirm.

**IMPORTANT**: App.tsx is a SHARED file. Check the task board before editing it.

## Files You Own
- src/ai/basic-ai.ts — All AI logic
- src/engine/types.ts — Type definitions
- src/engine/balance-config.ts — If difficulty ratios belong there
- src/ui/SetupScreen.tsx — Setup screen UI

## Files You Must Coordinate On
- src/App.tsx — SHARED. Check task board first.

## Key Code Locations

### basic-ai.ts pickSpeed() (line 53-84)
- Absolute thresholds at lines 58, 72, 73
- 70/30 ratio at line 76

### basic-ai.ts pickJoustAttack() (line 90-135)
- No speed awareness
- 70/30 ratio at line 130

### basic-ai.ts pickMeleeAttack() (line 201-240)
- Absolute threshold at line 218
- 70/30 ratio at line 235

### basic-ai.ts exported functions (line 274-307)
- aiPickCaparison, aiPickJoustChoice, aiPickMeleeAttack

### Archetype stamina values (for reference)
- charger: 60, technician: 55, bulwark: 65, tactician: 55, breaker: 60, duelist: 60

## Rules
1. Run `npx vitest run` after each change — must keep 222+ tests passing
2. Maintain backwards compatibility — difficulty param defaults to 'medium'
3. Write your updated handoff to THIS FILE when done or stopping
4. Include the ## META section at the top — when done with basic-ai.ts, set notes-for-others to "basic-ai.ts signatures finalized, ai-reasoning can proceed"
5. Mark status as "complete" when ALL sub-tasks are done
6. Do NOT run git commands — the orchestrator handles commits
7. Do NOT edit the task board — it is auto-generated
8. For App.tsx changes: note them in your handoff under "Deferred App.tsx Changes"

## Previous Work
None yet — this is the first round.
