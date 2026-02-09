# CSS Artist — Handoff

## META
- status: all-done
- files-modified: src/App.css, src/index.css, src/ui/LoadoutScreen.tsx
- tests-passing: true (605/605)
- notes-for-others: BL-016 complete — inline styles removed from LoadoutScreen.tsx variant toggles, CSS stance tokens now fully control colors. Two remaining inline styles in LoadoutScreen.tsx:374 and MeleeTransition.tsx:41 are minor cleanup items for UI dev.
- completed-tasks: BL-007, BL-008, BL-016

## What Was Done

### Round 1: Rarity Card Polish + Variant Toggles + Accessibility

**1. Rarity Card Hover Glow (BL-007)**
Added per-tier colored glow on hover for all 6 rarity tiers. Glow intensity scales with rarity (8px/0.3 for uncommon to 14px/0.5 for giga). Each card now gives immediate visual feedback about its power tier on hover.

**2. Rarity Card Selected Glow**
Replaced generic shadow with tier-colored glow on selected state. Ring + colored glow instead of ring + generic shadow. Radius scales 10px-16px with rarity.

**3. Variant Toggle Active States**
Added stance-colored backgrounds for active variant buttons (aggressive=red, balanced=gold, defensive=blue).

**4. prefers-reduced-motion Support**
Added comprehensive `@media (prefers-reduced-motion: reduce)` blocks in both App.css and index.css.

### Round 2: Variant Toggle UX + Combat Polish + Archetype Cards

**1. Variant Toggle UX Overhaul (BL-008)**
- Pill group container with parchment background for segmented-control look
- Consistent min-width sizing across all variant buttons
- Per-variant tinted hover preview using stance tokens
- Enhanced active state with subtle box-shadow depth
- Smooth 200ms transitions on all color/background properties
- Mobile: larger touch targets (36x32px), wrapping quick-set buttons

**2. Combat Result Animations**
- Outcome badges get `badge-appear` entrance animation (scale pop)
- Critical hits get `crit-glow` pulse animation (red shadow throb)
- Unseat announcement gets `unseat-entrance` animation with persistent red shadow

**3. Archetype Card Hover Enhancement**
- Cards lift 3px on hover with stronger shadow for depth
- Dedicated transitions for transform, box-shadow, border-color

**4. Reduced Motion Updates**
All new animations and transitions added to the prefers-reduced-motion block.

### Round 3: BL-016 + Melee/Winner Polish + btn--outline

**1. Inline Style Removal (BL-016)**
Removed `VARIANT_COLORS` constant and inline `style={...}` from variant toggle buttons in LoadoutScreen.tsx. CSS stance tokens now fully control all variant toggle colors without inline style interference.

**2. Melee Transition Entrance Animation**
Added dramatic two-part entrance: container scales vertically with red shadow bloom, sword icon slams down with rotation (delayed 0.15s for sequential feel).

**3. Winner Banner Polish**
- Victory: added gold glow box-shadow for warmer celebration feel
- Draw: added `draw-entrance` animation (scale-up from 0.95) — previously had no animation while victory/defeat both did

**4. `btn--outline` Definition**
Added missing `.btn--outline` modifier (transparent bg, lighter border, subdued text, gold-accented hover). Used by quick-set variant buttons that previously had no visual distinction from regular buttons.

**5. Reduced Motion Updates**
All round 3 animations added to the prefers-reduced-motion block.

## What's Left

### Deferred JSX Changes (for UI dev)
- **Gear item rarity borders**: Need `gear-item--${rarity}` class added to `.gear-item` divs in LoadoutScreen.tsx (rarity is available in parent scope but not passed to individual items). CSS rules ready to be written once class is added.
- **MeleeTransition.tsx:41**: Inline `style={{ marginTop: 8 }}` should use `mt-8` utility class.
- **LoadoutScreen.tsx:374**: Inline `style={{ fontSize: '0.8rem', color: 'var(--ink-faint)' }}` should be a CSS class.

## Issues
- Giga rarity uses `--rarity-legendary-bg` for selected state because `--rarity-giga-bg` is a gradient value. Pre-existing.

## File Ownership
- `src/App.css`
- `src/index.css`
