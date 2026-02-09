# CSS Artist — Handoff

## META
- status: complete
- files-modified: src/App.css
- tests-passing: true (589/589)
- notes-for-others: Variant toggle CSS colors work but are partially overridden by inline styles in LoadoutScreen.tsx:199. UI dev should remove the `style={...}` prop on variant-toggle buttons to let CSS handle colors via stance tokens.
- completed-tasks: BL-007, BL-008

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

## What's Left

### Next Priority (Round 3)
1. **Melee transition screen polish** — the interstitial could use better entrance animation
2. **Winner banner refinement** — victory/defeat/draw visual distinction improvements
3. **Gear item rarity-aware styling** — gear items could show rarity color in their border

### Deferred App.tsx Changes
- **Remove inline styles on variant toggle**: LoadoutScreen.tsx line 199 — remove `style={current === v ? { borderColor: VARIANT_COLORS[v], color: VARIANT_COLORS[v] } : undefined}` to let CSS stance tokens control colors fully.
- **VARIANT_COLORS constant** can then be removed from LoadoutScreen.tsx (lines 57-61).

## Issues
- Variant toggle inline styles in LoadoutScreen.tsx partially override CSS stance token colors. CSS works correctly underneath; removing inline styles is a UI dev task.
- Giga rarity uses `--rarity-legendary-bg` for selected state because `--rarity-giga-bg` is a gradient value. Pre-existing.

## File Ownership
- `src/App.css`
- `src/index.css`
