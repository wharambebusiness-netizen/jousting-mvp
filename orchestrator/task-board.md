# Jousting MVP — Shared Task Board

> This file is shared between all agents. Read it FIRST before doing any work.
> Update your section when you make progress. Other agents read this to stay coordinated.

## File Ownership
| File | Owner | Status |
|------|-------|--------|
| src/ui/helpers.tsx | ui-polish | available |
| src/ui/PassResult.tsx | ui-polish | available |
| src/ui/MeleeResult.tsx | ui-polish | available |
| src/App.css | ui-polish | available |
| src/ai/basic-ai.ts | ai-engine | available |
| src/engine/types.ts | ai-engine | available |
| src/engine/balance-config.ts | ai-engine | available |
| src/ui/SetupScreen.tsx | ai-engine | available |
| src/ui/AIThinkingPanel.tsx | ai-reasoning | available |
| src/App.tsx | SHARED | available |
| src/ui/CombatLog.tsx | ai-reasoning | available |

## SHARED FILE PROTOCOL (App.tsx)
When you need to edit App.tsx:
1. Check this board — is another agent currently editing it?
2. If "in-use by [agent]", SKIP App.tsx changes and note them in your handoff
3. If "available", mark it "in-use by [your-id]" before editing
4. After editing, mark it "available" again

Current App.tsx status: **available**

---

## Agent: ui-polish
**Task**: Add caparison trigger icons/emoji per effect type. Enhance trigger animations with glow, slide-in CSS. Make triggers visually pop.
**Status**: not-started
**Files touched**: (none yet)
**Notes**: Independent of other agents. Can run anytime.

## Agent: ai-engine
**Task**: 1) Convert absolute STA thresholds in basic-ai.ts to percentage-based (sta/archetype.stamina). 2) Pass chosen speed to attack picker for MOM/GRD synergy. 3) Add AIDifficulty type (easy=40/60, medium=70/30, hard=90/10) to types.ts. 4) Add difficulty param to all AI functions. 5) Add difficulty selector to SetupScreen.tsx. 6) Run tests after each change.
**Status**: not-started
**Depends on**: nothing
**Files touched**: (none yet)
**Notes**: ai-reasoning agent DEPENDS on this completing first (needs the new AI function signatures).

## Agent: ai-reasoning
**Task**: 1) Add reasoning data exports to basic-ai.ts (speed weights, attack scores, shift evaluation). 2) Create AIThinkingPanel.tsx component. 3) Wire into App.tsx as collapsible section. 4) Show on pass-result and melee-result screens.
**Status**: blocked (waiting for ai-engine to finish basic-ai.ts changes)
**Depends on**: ai-engine
**Files touched**: (none yet)
**Notes**: Must wait for ai-engine to finish modifying basic-ai.ts and types.ts signatures first.

---

## Completion Checklist
- [ ] ui-polish: complete
- [ ] ai-engine: complete
- [ ] ai-reasoning: complete
- [ ] All tests passing
- [ ] Final integration verified
