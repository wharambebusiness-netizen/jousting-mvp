# AI Engine Agent — Handoff

## META
- status: all-done
- files-modified: src/ai/basic-ai.ts, src/engine/balance-config.ts
- tests-passing: true
- notes-for-others: basic-ai.ts signatures finalized with optional history/commentary params, ai-reasoning can proceed. New exports: OpponentHistory class, generateCommentary(), aiPickJoustChoiceWithCommentary(), aiPickMeleeAttackWithCommentary(), AIJoustResult, AIMeleeResult interfaces. All existing signatures remain backwards-compatible (new params are optional).

## Round: 1

## What Was Done

### Primary Milestone (tasks 1-6)
Tasks 1-5 were already implemented from a previous session:
1. **Percentage-based stamina thresholds** — `staRatio = sta / arch.stamina` used throughout (0.25 emergency, 0.50 low, 0.65 mild, 0.35 melee)
2. **Speed-attack synergy** — Speed passed to `pickJoustAttack()`, Fast boosts Aggressive +2, Slow boosts Defensive +2, Standard boosts Balanced +1
3. **AIDifficulty type** — `'easy' | 'medium' | 'hard'` in types.ts
4. **Difficulty parameter** — All exported AI functions accept optional `difficulty` param (default 'medium')
5. **Difficulty selector UI** — SetupScreen.tsx has Easy/Medium/Hard buttons with difficulty passed via onStart callback
6. **App.tsx wiring** — See "Deferred App.tsx Changes" below

### Stretch Goal S1: Archetype-Specific AI Personality (already done)
- `ARCHETYPE_PERSONALITY` record with speedMods, stancePrefs, shiftAffinity, meleeAggression per archetype
- Applied in pickSpeed() and pickMeleeAttack()

### Stretch Goal S2: Opponent Pattern Tracking (NEW this round)
- Added `OpponentHistory` class (exported) with:
  - `recordSpeed(speed)` / `recordAttack(attackId)` — stores last N choices (configurable via `BALANCE.aiPattern.historyLength`, default 3)
  - `predictedSpeed()` / `predictedAttackId()` — returns most frequent choice if it appears >= 2 times in history
  - `reset()` — clears history
- Pattern exploitation active on hard difficulty only:
  - `pickSpeed()` counters predicted opponent speed (Fast→Slow, Slow→Fast, Standard→Standard) with `BALANCE.aiPattern.patternWeight` bonus (+3)
  - `pickJoustAttack()` and `pickMeleeAttack()` boost attacks that counter the predicted opponent attack
- Added `BALANCE.aiPattern` config to balance-config.ts: `{ patternWeight: 3, historyLength: 3 }`

### Stretch Goal S3: AI Commentary Strings (NEW this round)
- Added `ARCHETYPE_COMMENTARY` — flavor text per archetype for: lowStamina, highMomentum, aggressive, defensive, patternRead
- Added `generateCommentary(archId, staRatio, chosenStance, patternDetected): string` — exported, context-sensitive
- Added `aiPickJoustChoiceWithCommentary()` — returns `{ choice: PassChoice, commentary: string }`
- Added `aiPickMeleeAttackWithCommentary()` — returns `{ attack: Attack, commentary: string }`
- Commentary priorities: pattern detection > low stamina > high momentum + aggressive > aggressive > defensive > empty string

## Deferred App.tsx Changes
App.tsx needs these changes to wire difficulty through to AI calls:

1. **handleStart** (line 55): Change signature from `(p1: Archetype, p2: Archetype)` to `(p1: Archetype, p2: Archetype, difficulty: AIDifficulty)`. Store difficulty in state: `const [difficulty, setDifficulty] = useState<AIDifficulty>('medium');` and set it in handleStart.
2. **handleLoadoutConfirm** (line 67): Change `aiPickCaparison(p2Archetype)` to `aiPickCaparison(p2Archetype, difficulty)`.
3. **handleAttackSelect** (line 94): Change `aiPickJoustChoice(match!.player2, lastP2Attack, attack)` to `aiPickJoustChoice(match!.player2, lastP2Attack, attack, difficulty)`.
4. **handleMeleeAttack** (line 134): Change `aiPickMeleeAttack(match!.player2, lastP2Attack)` to `aiPickMeleeAttack(match!.player2, lastP2Attack, difficulty)`.
5. **Optional (for commentary/pattern tracking)**: Create `OpponentHistory` instance, pass to AI calls, record opponent choices after each pass/melee round. Display commentary in combat log.

Import needed: `import type { AIDifficulty } from './engine/types';`

## What's Left
Nothing — all primary and stretch goals are complete.

## Issues
None. All 295 tests passing.
