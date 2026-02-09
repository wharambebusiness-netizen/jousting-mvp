## META
- status: all-done
- files-modified: src/ai/basic-ai.ts, src/ui/AIThinkingPanel.tsx, src/ui/AIEndScreenPanels.tsx, src/App.css
- tests-passing: true
- notes-for-others: New exports from basic-ai.ts: `AIReasoning`, `SpeedReasoning`, `AttackReasoning`, `AttackScoreEntry`, `ShiftReasoning` types, plus `aiPickJoustChoiceWithReasoning()` and `aiPickMeleeAttackWithReasoning()` functions. Three new UI components ready: AIThinkingPanel (mid-game), DifficultyFeedback + StrategyTips + MatchReplay (end screen). All need wiring into App.tsx — see Deferred App.tsx Changes below. All existing AI signatures remain backwards-compatible.

## Round: 2

## What Was Done

### Primary Milestone: AI Thinking Panel

#### 1. Reasoning Interfaces (basic-ai.ts)
Added full reasoning type hierarchy:
- `SpeedReasoning` — weights for slow/standard/fast, stamina ratio, archetype bias, chosen speed, wasRandom flag
- `AttackScoreEntry` — per-attack: name, id, score, factor breakdown strings
- `AttackReasoning` — sorted score list, chosen name, speed synergy note, wasRandom flag
- `ShiftReasoning` — canShift bool, current counter status, best alternative, decision text
- `AIReasoning` — combined: speed, attack, shift (optional), caparison (optional), commentary

#### 2. Reasoning-Aware Internal Functions (basic-ai.ts)
Refactored all three internal AI functions to have `*WithReasoning` variants that collect reasoning data while making decisions:
- `pickSpeedWithReasoning()` — tracks all weight modifications with bias descriptions
- `pickJoustAttackWithReasoning()` — tracks per-attack score factors (affinity, synergy, counter, stamina, pattern)
- `evaluateShiftWithReasoning()` — tracks eligibility, counter status, alternatives, decision rationale
- `pickMeleeAttackWithReasoning()` — same factor tracking as joust

Original `pickSpeed`, `pickJoustAttack`, `evaluateShift`, `pickMeleeAttack` are preserved as thin wrappers — zero behavior change for existing callers.

#### 3. New Public API Functions (basic-ai.ts)
- `aiPickJoustChoiceWithReasoning()` — returns `{ choice: PassChoice; reasoning: AIReasoning }`
- `aiPickMeleeAttackWithReasoning()` — returns `{ attack: Attack; reasoning: AIReasoning }`

#### 4. AIThinkingPanel Component (src/ui/AIThinkingPanel.tsx)
Collapsible panel with:
- AI commentary quote (italic, gold left-border)
- Speed weights as horizontal bar chart with percentage labels
- Attack scores ranked by score, with factor breakdowns, chosen attack highlighted
- Shift decision section with can-shift status, counter status, alternatives, decision
- Caparison reasoning display
- "Random pick!" indicator when AI was forced random by difficulty

### Stretch Goals

#### S1: Match Replay / Decision History (src/ui/AIEndScreenPanels.tsx)
`MatchReplay` component — accordion showing all AI decisions across the match:
- One collapsible row per pass/melee round
- Summary shows speed + chosen attack
- Expanded view shows speed weights, top 3 attacks with scores, shift decision, commentary
- Accepts `reasoningHistory: AIReasoning[]` prop (App.tsx should accumulate these)

#### S2: Strategy Tips (src/ui/AIEndScreenPanels.tsx)
`StrategyTips` component — analyzes player's match patterns and gives advice:
- Detects repeated speed choices (>70% same speed)
- Detects stance pattern repetition
- Suggests speed-attack synergies (Fast+Agg, Slow+Def)
- Warns about low stamina management
- Encourages shifting if player never shifted
- Encourages counter play if player never landed counters

#### S3: Difficulty Feedback (src/ui/AIEndScreenPanels.tsx)
`DifficultyFeedback` component — suggests difficulty adjustment:
- Commanding victory → suggest Hard
- Solid win → suggest considering harder difficulty
- Narrow win → current difficulty is good
- Tough defeat → suggest Easy
- Close loss → encourage strategy adjustment
- Considers score differential, unseat events, round count

#### CSS Styles (src/App.css)
Full styling for all four new components:
- AIThinkingPanel: collapsible toggle, bar charts, attack list, shift info
- DifficultyFeedback: centered coach panel with gold heading
- StrategyTips: bulleted list with sword-cross list markers
- MatchReplay: accordion with expand/collapse, highlighted chosen attacks
- All responsive-ready

## Deferred App.tsx Changes

The following changes need to be made to App.tsx to wire everything into the game flow:

### 1. Imports
```tsx
import { AIThinkingPanel } from './ui/AIThinkingPanel';
import { DifficultyFeedback, StrategyTips, MatchReplay } from './ui/AIEndScreenPanels';
import { aiPickJoustChoiceWithReasoning, aiPickMeleeAttackWithReasoning, aiPickCaparison } from './ai/basic-ai';
import type { AIReasoning } from './ai/basic-ai';
```

### 2. Add state
```tsx
const [aiReasoning, setAiReasoning] = useState<AIReasoning | null>(null);
const [reasoningHistory, setReasoningHistory] = useState<AIReasoning[]>([]);
```

### 3. In `handleAttackSelect`, replace `aiPickJoustChoice` with reasoning version
```tsx
const { choice: ai, reasoning } = aiPickJoustChoiceWithReasoning(match!.player2, lastP2Attack, attack);
setAiChoice(ai);
setAiReasoning(reasoning);
setReasoningHistory(prev => [...prev, reasoning]);
```

### 4. In `handleMeleeAttack`, replace `aiPickMeleeAttack` with reasoning version
```tsx
const { attack: aiAttack, reasoning } = aiPickMeleeAttackWithReasoning(match!.player2, lastP2Attack);
setAiReasoning(reasoning);
setReasoningHistory(prev => [...prev, reasoning]);
```

### 5. Add AIThinkingPanel to pass-result and melee-result screens
```tsx
{screen === 'pass-result' && match && lastPassResult && (
  <>
    <PassResultScreen match={match} result={lastPassResult} onContinue={handlePassContinue} />
    {aiReasoning && <AIThinkingPanel reasoning={aiReasoning} />}
  </>
)}

{screen === 'melee-result' && match && lastMeleeResult && (
  <>
    <MeleeResultScreen match={match} result={lastMeleeResult} onContinue={handleMeleeContinue} />
    {aiReasoning && <AIThinkingPanel reasoning={aiReasoning} isMelee />}
  </>
)}
```

### 6. Add end-screen panels (inside MatchSummary area, before "New Match" button)
```tsx
{screen === 'end' && match && (
  <>
    <MatchSummary match={match} p1Loadout={p1Loadout} p2Loadout={p2Loadout} onRematch={handleRematch} />
    <DifficultyFeedback match={match} />
    <StrategyTips match={match} />
    <MatchReplay match={match} reasoningHistory={reasoningHistory} />
  </>
)}
```

### 7. Clear state on rematch
```tsx
setAiReasoning(null);
setReasoningHistory([]);
```

## What's Left
Nothing — all primary and stretch goals are implemented.

## Issues
None. All 327 tests passing. TypeScript compiles clean.
