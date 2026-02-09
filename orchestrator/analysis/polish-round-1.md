# Visual Polish Report — Round 1

## Focus: Rarity Card Styling + Variant Toggles + Accessibility

### Changes Made

#### 1. Rarity Card Hover Glow (BL-007)
**Before:** All rarity cards shared the generic `.card--selectable:hover` effect (gold border, generic shadow). No visual distinction between tiers on hover.

**After:** Each rarity tier gets a tier-colored glow on hover, with intensity scaling up the rarity ladder:
- **Uncommon** (green): subtle 8px glow, 0.3 opacity
- **Rare** (blue): subtle 8px glow, 0.3 opacity
- **Epic** (purple): medium 10px glow, 0.35 opacity
- **Legendary** (gold): strong 12px glow, 0.4 opacity
- **Relic** (red): strong 12px glow, 0.4 opacity
- **Giga** (gold): intense 14px glow, 0.5 opacity

The progressive glow intensity creates a natural visual hierarchy — higher rarity = more impressive hover feedback.

#### 2. Rarity Card Selected Glow
**Before:** Selected cards had `0 0 0 2px {color}` ring + generic `0 3px 12px var(--shadow)`.

**After:** Selected cards now use tier-colored glow instead of generic shadow:
- Ring retained: `0 0 0 2px {rarity-color}`
- Shadow replaced: `0 0 {10-16}px rgba({color}, {0.25-0.45})`
- Glow radius scales with rarity (10px uncommon → 16px giga)

Text readability is preserved since backgrounds remain the same light tints (e.g., `--rarity-uncommon-bg: #e0f0d6`).

#### 3. Variant Toggle Active States
**Before:** Active variant toggle buttons had `font-weight: 700`, `background: parchment-dark`, `border-width: 2px`. The only color distinction came from inline styles in LoadoutScreen.tsx using non-standard `var(--mom)` / `var(--ctl)` / `var(--grd)` tokens.

**After:** Added CSS rules using proper stance design tokens:
- **Aggressive**: red bg (`--stance-agg-bg`), red border/text (`--stance-agg`)
- **Balanced**: gold bg (`--stance-bal-bg`), gold border/text (`--stance-bal`)
- **Defensive**: blue bg (`--stance-def-bg`), blue border/text (`--stance-def`)

**Note:** The inline styles on LoadoutScreen.tsx line 199 override `borderColor` and `color`. A deferred App.tsx change (removing that inline style) would let the CSS take full effect. The current result is still improved since `background` is now CSS-controlled and was previously just `parchment-dark` for all variants.

#### 4. Accessibility: prefers-reduced-motion
**Before:** No reduced-motion support whatsoever. Users with vestibular disorders would see all animations.

**After:** Added `@media (prefers-reduced-motion: reduce)` blocks in both `App.css` and `index.css`:
- **Disabled animations:** screen fade-in, victory/defeat entrance, timeline pips, score pop, pass pip pulse, stamina critical pulse
- **Disabled transitions:** card hover, stat bar fills, stamina bar fills, gear item hover, variant toggle buttons, AI thinking bars

### Files Modified
- `src/App.css` — rarity hover/selected glow, variant toggle colors, reduced-motion
- `src/index.css` — reduced-motion for base animations

### Remaining Issues
1. **Variant toggle inline styles** — LoadoutScreen.tsx line 199 uses inline `borderColor`/`color` that override CSS. Needs deferred App.tsx change.
2. **Giga gradient background** — `--rarity-giga-bg` is a `linear-gradient()` stored in a CSS variable, which won't work as `background-color`. The selected state uses `--rarity-legendary-bg` as a workaround. This is pre-existing.
3. **Touch target size** — Variant toggle buttons at 0.65rem / 2px padding are below 44px touch target. Could be addressed in a future round via mobile breakpoint.
