# AI Reasoning Agent — Handoff

## META
- status: not-started
- files-modified: none
- tests-passing: true
- notes-for-others: none

## Round: 0 (initial)

## Your Mission
Create a dedicated "AI Thinking" panel that shows the AI's decision-making process — speed weights, attack scores, shift evaluation, and caparison reasoning — instead of burying it in the combat log.

## IMPORTANT: You are BLOCKED until ai-engine agent finishes
The ai-engine agent is modifying basic-ai.ts (adding difficulty params, changing function signatures, adding speed-attack synergy). You MUST wait for those changes to land before adding reasoning exports on top.

**Check the task board (orchestrator/task-board.md) first.** If ai-engine status is not "complete", write your handoff noting you're still blocked and stop.

## Project Context
- Jousting minigame MVP: Vite + React + TypeScript
- Project root: jousting-mvp/
- 222 tests passing. Run with: `npx vitest run` from jousting-mvp/
- Engine is pure TS in src/engine/. UI is React in src/ui/. AI in src/ai/

## What to Implement (once unblocked)

### 1. Add Reasoning Data to AI Functions (basic-ai.ts)
Modify the internal AI functions to collect and return reasoning alongside decisions:

For speed selection, return:
```typescript
interface SpeedReasoning {
  weights: { slow: number; standard: number; fast: number };
  staminaRatio: number;
  archetypeBias: string;
  chosen: SpeedType;
}
```

For attack selection, return:
```typescript
interface AttackReasoning {
  scores: { attackName: string; score: number; factors: string[] }[];
  chosen: string;
  speedSynergy?: string; // e.g. "Fast → Aggressive boost"
}
```

For shift evaluation:
```typescript
interface ShiftReasoning {
  canShift: boolean;
  currentCounterStatus: string;
  bestAlternative?: { attack: string; score: number };
  decision: string;
}
```

Export a combined `AIReasoning` type and return it from `aiPickJoustChoice` and `aiPickMeleeAttack`.

### 2. Create AIThinkingPanel Component (new file: src/ui/AIThinkingPanel.tsx)
A collapsible panel showing AI reasoning:
- Collapsed by default (like the combat log)
- Shows speed weights as a mini bar chart or percentage breakdown
- Shows attack scores ranked with factors listed
- Shows shift decision rationale
- Styled to match the medieval theme

### 3. Wire into App.tsx
Add AIThinkingPanel to pass-result and melee-result screens:
- Store latest AI reasoning in state
- Pass to AIThinkingPanel component
- Position below the result breakdown, above the Continue button

**App.tsx is SHARED** — check task board before editing.

### 4. Update AI Reasoning for Caparison
Show why the AI picked its caparison in the AIThinkingPanel on the first pass-result screen. The `aiPickCaparison` already returns a reason string.

## Files You Own
- src/ui/AIThinkingPanel.tsx (NEW — create this)
- src/ui/CombatLog.tsx (can extend if needed)

## Files You Must Coordinate On
- src/ai/basic-ai.ts — ai-engine owns this first, you modify AFTER they're done
- src/App.tsx — SHARED file, check task board
- src/engine/types.ts — ai-engine owns this, coordinate additions

## Stretch Goals (after primary milestone)
When the AI Thinking panel is working, set status to "complete" and work on these:

### S1. Match Replay / Decision History
- Add a "Match Replay" section to the end screen showing all AI decisions across the match
- For each pass: what the AI picked, why, what the weights were
- Collapsible accordion UI, one section per pass/melee round
- Reuse the AIThinkingPanel component in a list layout

### S2. Strategy Tips for Player
- Based on the AI's analysis of the player's patterns, show tips:
  - "You've been picking Fast 4 out of 5 passes — try mixing it up!"
  - "Aggressive attacks work best with Fast speed for the MOM bonus"
  - "Your opponent's Bulwark is weak to stamina drain — use expensive attacks early"
- Show on the end screen as "AI Coach" section

### S3. Difficulty Feedback
- On the end screen, suggest difficulty adjustment:
  - Player won easily → "Try Hard difficulty for a challenge!"
  - Player lost badly → "Try Easy difficulty to learn the ropes"
- Base on score differential and round count

When ALL stretch goals are done, set status to "all-done".

## Rules
1. Check task board FIRST — if ai-engine isn't done, STOP and write handoff (set status to "blocked")
2. Run `npx vitest run` after changes
3. Don't break existing AI behavior — reasoning is added alongside, not replacing
4. Write updated handoff to THIS FILE with ## META section
5. Mark status as "complete" when primary task is fully done, then work on stretch goals
6. Do NOT run git commands — the orchestrator handles commits
7. Do NOT edit the task board — it is auto-generated
8. For App.tsx changes: note them in your handoff under "Deferred App.tsx Changes"

## Previous Work
None yet — this is the first round.
