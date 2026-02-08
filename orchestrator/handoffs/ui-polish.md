# UI Polish Agent — Handoff

## META
- status: not-started
- files-modified: none
- tests-passing: true
- notes-for-others: none

## Round: 0 (initial)

## Your Mission
Add visual flair to caparison trigger notifications. Currently they show as plain text badges. Make them visually pop with icons, animations, and color-coded effects.

## Project Context
- Jousting minigame MVP: Vite + React + TypeScript
- Project root: jousting-mvp/
- 222 tests passing. Run with: `npx vitest run` from jousting-mvp/
- Engine is pure TS in src/engine/. UI is React in src/ui/. AI in src/ai/

## What to Implement

### 1. Icons per Caparison Effect
Add a unique icon/emoji to each caparison in `src/ui/helpers.tsx`:
- pennant_of_haste → lightning bolt / speed icon
- woven_shieldcloth → shield icon
- thunderweave → thunder/storm icon
- irongrip_drape → grip/fist icon
- stormcloak → wind/cyclone icon
- banner_of_the_giga → banner/flag icon

Update the `CaparisonBadge` component to show the icon alongside the text.

### 2. Enhanced Trigger Animations
In `src/App.css`, enhance the `.cap-trigger` and `.cap-badge--triggered` styles:
- Slide-in animation for trigger notification rows (currently just appear)
- Glow effect matching the rarity color when triggered
- Pulse or flash animation on the badge itself
- Make the trigger section more visually prominent

### 3. Rarity-Colored Trigger Backgrounds
Color-code the `.cap-trigger` notification background by rarity:
- Uncommon (green tint), Rare (blue tint), Epic (purple tint)
- Legendary (gold tint), Relic (red tint), Giga (rainbow/gradient)

## Files You Own (safe to edit freely)
- src/ui/helpers.tsx — CaparisonBadge component, icon mapping
- src/ui/PassResult.tsx — Joust pass result screen (has trigger display)
- src/ui/MeleeResult.tsx — Melee result screen (has trigger display)
- src/App.css — All styles including .cap-badge, .cap-trigger classes

## Files You Must NOT Edit
- src/ai/basic-ai.ts (owned by ai-engine)
- src/engine/types.ts (owned by ai-engine)
- src/App.tsx (SHARED — check task board before editing)

## Current State of Relevant Code

### helpers.tsx CaparisonBadge (line 55-69)
```tsx
export function CaparisonBadge({ effect, triggered }: {
  effect?: CaparisonEffect;
  triggered?: boolean;
}) {
  if (!effect) return null;
  const short = CAP_SHORT[effect.id] ?? effect.name;
  return (
    <span className={`cap-badge cap-badge--${effect.rarity}${triggered ? ' cap-badge--triggered' : ''}`}
      title={`${effect.name}: ${effect.description}`}>
      {short}
    </span>
  );
}
```

### App.css trigger styles (line 266-304)
- `.cap-badge` — base badge style
- `.cap-badge--triggered` — has a simple 0.6s pulse animation
- `.cap-triggers` — container for trigger notifications
- `.cap-trigger` — individual trigger notification row
- `.cap-trigger--p1` / `--p2` — player-colored left borders

### CSS Variables Available (index.css)
- Rarity colors: `--rarity-uncommon` through `--rarity-giga`
- Rarity backgrounds: `--rarity-uncommon-bg` through `--rarity-giga-bg`
- Player colors: `--p1`, `--p2`
- Gold accents: `--gold`, `--gold-dark`, `--gold-light`

## Rules
1. Run `npx vitest run` after changes to ensure tests still pass
2. Write your updated handoff to THIS FILE when you're done or stopping
3. Include the ## META section at the top with your status
4. Do NOT run git commands — the orchestrator handles commits
5. Do NOT edit the task board — it is auto-generated
6. For App.tsx changes: note them in your handoff under "Deferred App.tsx Changes"

## Previous Work
None yet — this is the first round.
