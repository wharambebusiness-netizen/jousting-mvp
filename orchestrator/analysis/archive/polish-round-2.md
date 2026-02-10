# CSS Artist — Round 2 Visual Analysis

## Changes Made

### 1. Variant Toggle UX Overhaul (BL-008)

**Before:** Flat, unstyled buttons with minimal active state; inline styles from LoadoutScreen.tsx partially overriding CSS colors with wrong color mapping (aggressive=momentum red, balanced=control blue, defensive=guard green — mismatched from stance tokens).

**After:**
- **Pill group container**: Added `background: var(--parchment-dark)` + `border-radius: 4px` + `padding: 2px` to give the toggle group a contained, segmented-control appearance
- **Consistent sizing**: `min-width: 28px` on all buttons ensures equal-width pill segments
- **Stance-colored hover states**: Each variant type now shows a tinted hover preview (`--stance-agg-bg` for aggressive, `--stance-bal-bg` for balanced, `--stance-def-bg` for defensive) before clicking
- **Enhanced active state**: Active button gets `box-shadow: 0 1px 3px var(--shadow)` for depth, plus stance-colored background/border/text using design tokens
- **Smooth 200ms transitions** on background, border-color, color, and box-shadow for polished feel
- **Mobile touch targets**: Variant buttons grow to `min-width: 36px; min-height: 32px` at 480px breakpoint, exceeding the 28px minimum tap target for comfortable mobile interaction
- **Quick-set buttons**: Added consistent font-size and padding; they now wrap and stack on mobile

**Note:** The inline styles on LoadoutScreen.tsx still override `borderColor` and `color` on active buttons. The CSS stance tokens are still applied as the base; inline styles partially layer over them. For full CSS control, UI dev should remove the `style={...}` prop (see Deferred App.tsx Changes in handoff).

### 2. Combat Result Polish

**Outcome Badges:**
- Added `badge-appear` entrance animation (0.3s scale pop from 0.7 → 1.1 → 1.0)
- Critical hits get an additional `crit-glow` pulse animation (red glow 8px → 16px) and permanent shadow
- Provides clear visual hierarchy: Draw (plain) < Hit (gold) < Critical (red + glow)

**Unseat Announcement:**
- Added `unseat-entrance` animation (0.5s scale + opacity + shadow reveal)
- Added persistent red shadow (`box-shadow: 0 4px 12px rgba(139, 37, 0, 0.3)`) for weight
- Added letter-spacing for dramatic emphasis
- Largest gameplay event now has matching visual gravitas

### 3. Archetype Card Hover Effects

**Before:** Only the base `.card--selectable:hover` applied (background color change, gold border, generic shadow)

**After:** Archetype cards additionally get:
- `translateY(-3px)` lift on hover for a card-lift effect
- Stronger shadow: `0 6px 16px var(--shadow)` for depth
- Dedicated transition: `transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease`
- Combined with existing card hover styles for a more interactive feel during archetype selection

### 4. Reduced Motion Support

All new animations and transitions added to the `@media (prefers-reduced-motion: reduce)` block:
- `outcome-badge`, `outcome-badge--critical`, `pass-result__unseat`: `animation: none`
- `archetype-card`: `transition: none`

## Remaining Issues

1. **Inline styles on variant toggles**: LoadoutScreen.tsx line 199 still applies `style={{ borderColor, color }}` on active buttons. The VARIANT_COLORS mapping uses wrong semantic colors (mom/ctl/grd) instead of stance tokens. UI dev should remove this inline style to let CSS stance tokens control fully.

2. **Giga rarity selected state**: Still uses `--rarity-legendary-bg` because `--rarity-giga-bg` is a gradient value that can't be used as `background` in selected state. Pre-existing, no regression.

## Tests

589/589 passing. CSS changes do not affect test suite.
