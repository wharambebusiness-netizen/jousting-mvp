# Jousting MVP — Session 13 Handoff

## Working Style
- User wants full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Generate handoff at session end

## Session 13 Summary
**Focus:** Built the Gear UI (loadout selection screen), wired it into the App state machine, then rebalanced the entire gear/rarity system and unified the UI after user feedback.

### What Was Done

#### 1. LoadoutScreen.tsx — New Component
**File:** `src/ui/LoadoutScreen.tsx`

Full loadout selection screen with:
- **Rarity tier selector** — 3×2 grid of clickable cards (Uncommon → Giga), each showing "+N all stats"
- **Equipment section** (unified gear + caparison):
  - 3 stat gear pieces (Barding/Chanfron/Saddle) with primary/secondary stat badges
  - "Re-roll Stats" button (increments a seed for the LCG RNG)
  - Caparison sub-section with 7 selectable cards (None + 6 effects), each showing rarity badge + description
- **Stats Preview** — side-by-side base vs boosted stat bars with arrow indicator
- **"Enter the Lists!"** button → calls `onConfirm(loadout)`

Uses `createFullLoadout()` with a seeded LCG RNG for visual consistency. The loadout recomputes via `useMemo` when rarity, caparison choice, or seed changes.

#### 2. App.tsx — 10-Screen State Machine
**File:** `src/App.tsx`

- Added `'loadout'` to Screen type (now 10 screens)
- New state: `p1Archetype`, `p2Archetype` stored from setup
- Flow: setup → **loadout** → speed → attack → reveal → pass-result → melee-transition → melee → melee-result → end
- `handleStart()` now stores archetypes + transitions to loadout (no longer creates match)
- `handleLoadoutConfirm()` creates match with player loadout + AI loadout at same rarity tier
- AI loadout: `aiPickCaparison()` — 30% no cap, 70% random effect; gear rolled at player's rarity
- `handleRematch()` clears archetype state
- Header hidden on loadout screen (same as setup/end)

#### 3. Balance Rebalance — Rarity + Gear Ranges + Slot Mapping
**File:** `src/engine/balance-config.ts`, `src/engine/gigling-gear.ts`

**Problem:** Old curve was too steep (Uncommon +0, Giga +15 rarity + max 22 primary = 112 raw). Guard was double-covered by gear (barding primary + chanfron secondary).

**Changes:**

Rarity bonuses flattened:
| Tier | Old | New |
|---|---|---|
| Uncommon | 0 | 1 |
| Rare | 2 | 3 |
| Epic | 5 | 5 |
| Legendary | 8 | 7 |
| Relic | 12 | 10 |
| Giga | 15 | 13 |

Gear stat ranges compressed:
| Tier | Old Primary | New Primary | Old Secondary | New Secondary |
|---|---|---|---|---|
| Uncommon | [1,3] | [1,3] | [0,1] | [0,1] |
| Rare | [3,6] | [2,5] | [1,3] | [1,2] |
| Epic | [6,10] | [4,7] | [3,5] | [2,4] |
| Legendary | [10,14] | [6,10] | [5,7] | [3,5] |
| Relic | [14,18] | [8,12] | [7,10] | [4,7] |
| Giga | [18,22] | [10,15] | [10,13] | [6,9] |

Chanfron secondary changed: **guard → stamina**
- Old: guard was double-covered (barding P + chanfron S) — Bulwark got disproportionate scaling
- New: stamina is double-covered (barding S + chanfron S) — resource pool, doesn't scale damage
- Slot mapping now:
  - Barding: guard (P), stamina (S)
  - Chanfron: momentum (P), **stamina (S)** ← was guard
  - Saddle: control (P), initiative (S)

**Result:** Bulwark guard at Giga max = 75 + 13 + 15 = 103 → softCap → 100.9 (softCap is meaningful). Old was 125 → 116.7 (blew past it).

#### 4. CSS — Rarity Colors + Loadout Styles
**Files:** `src/index.css`, `src/App.css`

- 6 rarity color variables in `:root` (`--rarity-uncommon` through `--rarity-giga` + background variants)
- `.rarity-grid` / `.rarity-card` — 3×2 grid with rarity-colored borders and selection highlights
- `.gear-list` / `.gear-item` / `.gear-stat` — stat piece display with gold primary / parchment secondary badges
- `.caparison-label` — divider label inside Equipment section
- `.caparison-grid` / `.caparison-card` — 2-column grid with rarity-tinted selection borders
- `.rarity-badge` — inline rarity tier label
- `.stats-preview` — flex layout: base column → arrow → boosted column
- Mobile responsive: rarity grid 2-col, caparison 1-col, stats preview vertical

#### 5. Test Updates — 149 Tests Still Passing
**Files:** `src/engine/gigling-gear.test.ts`, `src/engine/caparison.test.ts`

Updated 14 tests across 2 files:
- All hardcoded rarity bonus values (0→1, 2→3, 8→7, 12→10, 15→13)
- `makeChanfron()` helper secondary: guard → stamina
- `sumGearStats` test: chanfron secondary now goes to stamina
- Soft cap interaction tests: new max values (103 instead of 125)
- Match integration tests: adjusted for new rarity bonuses
- Edge case "uncommon caparison" test: now expects +1 (not +0)
- Caparison integration tests: baseline matches use uncommon loadout (not bare) to isolate effect from rarity bonus

## Current Architecture

```
src/
├── engine/
│   ├── types.ts              — All types (enums, interfaces, gigling gear, CaparisonInput)
│   ├── balance-config.ts     — BALANCE const (REBALANCED this session)
│   ├── archetypes.ts         — 6 archetypes
│   ├── attacks.ts            — Speed data + Joust attacks (6) + Melee attacks (6)
│   ├── calculator.ts         — Pure math functions
│   ├── phase-joust.ts        — resolveJoustPass() with caparison hooks
│   ├── phase-melee.ts        — resolveMeleeRoundFn() with caparison hooks
│   ├── match.ts              — State machine with caparison tracking
│   ├── gigling-gear.ts       — Gear stat calc + caparison catalog + gear factory (SLOT FIX)
│   ├── calculator.test.ts    — 57 tests
│   ├── match.test.ts         — 8 tests
│   ├── gigling-gear.test.ts  — 46 tests (UPDATED)
│   └── caparison.test.ts     — 38 tests (UPDATED)
├── ai/
│   └── basic-ai.ts           — Heuristic AI for speed/attack/shift/melee
├── ui/
│   ├── LoadoutScreen.tsx      — NEW: gear loadout selection
│   ├── SetupScreen.tsx        — Archetype selection
│   ├── SpeedSelect.tsx        — Speed choice
│   ├── AttackSelect.tsx       — Joust + Melee attack selection
│   ├── RevealScreen.tsx       — Attack reveal + shift
│   ├── PassResult.tsx         — Joust pass result
│   ├── MeleeResult.tsx        — Melee round result
│   ├── MeleeTransition.tsx    — Joust→melee interstitial
│   ├── MatchSummary.tsx       — End screen
│   ├── CombatLog.tsx          — Expandable log viewer
│   └── helpers.tsx            — StatBar, StanceTag, Scoreboard, etc.
├── App.tsx                    — 10-screen state machine (UPDATED)
├── App.css                    — Component styles (UPDATED)
└── index.css                  — Theme + rarity colors (UPDATED)
```

### App Flow (10 screens)
```
setup → loadout → speed → attack → reveal → pass-result
                                              ├── (more passes) → speed
                                              ├── melee-transition → melee → melee-result
                                              │                              ├── (more rounds) → melee
                                              │                              └── end
                                              └── end (if unseat)
```

## What Needs to Be Done Next

### FIRST PRIORITY: System Logic Audit
Before building any new features, **thoroughly audit the entire system for logical consistency.** Read every engine file, trace the data flow, and check for:
- Inconsistencies between the spec (v4.1), balance-config values, and actual code behavior
- Edge cases that produce nonsensical results (e.g., negative stats, division by zero, uncapped values)
- Caparison effects that interact badly with each other or with edge-case archetypes
- Balance problems: are any archetypes/gear combos clearly dominant? Are any effects useless?
- Counter table correctness — verify every beats/beatenBy pair is symmetric and matches v4.1
- Stat flow: trace a full match from createMatch → joust passes → melee rounds → end, checking that stats are computed correctly at every step with gear + caparison applied
- Test coverage gaps — are there important paths that aren't tested?
- Any dead code, unused imports, or stale comments that reference old behavior

This is a **logic review and consistency check**, not a feature build. Fix anything broken, flag anything suspicious, document findings.

### After Audit: Feature Priorities

#### Priority 1: Caparison UI Display During Match
- Show active caparison effects in match UI (speed select, attack select, pass result)
- Highlight when effects trigger ("Thunderweave +4 MOM!" flash)
- Show opponent's caparison so player can strategize

#### Priority 2: Match Summary Improvements
- Show gear loadouts in end-of-match summary
- Display caparison effects that triggered during the match
- Show AI's loadout (currently hidden)

#### Priority 3: AI Opponent Enhancement
- AI currently picks random caparison + same-tier gear
- Could weight caparison choice by archetype (e.g., Charger prefers Thunderweave)
- Could have AI explain its gear choice in combat log

### Lower Priority
- Gear durability/repair system
- Gear crafting integration with Gigaverse economy
- Bearer token auth for live API probing
- Matchmaking / ELO system
- Show gear stat distribution breakdown in loadout screen
- Animate stat bar changes when switching rarity

## Key Design Decisions Made This Session

### Balance Philosophy
The rarity curve was flattened so that:
1. **Every tier gives something** (Uncommon +1, not +0)
2. **SoftCap stays meaningful** — only the very best stat on the best archetype at Giga tier barely crosses 100 (Bulwark guard = 103 → 100.9 effective)
3. **Step sizes are more linear** — old curve accelerated wildly at high tiers
4. **Guard is no longer privileged** — moved chanfron secondary to stamina so guard gets 1 gear source (not 2)

### Unified Equipment UI
Gear pieces and caparison are now in one "Equipment" section instead of two separate sections. This mirrors the conceptual model: all 4 items are part of the same loadout. A thin divider + "Caparison" label separates stat gear from effect gear.

### AI Loadout Generation
AI gets a random loadout at the player's chosen rarity tier:
- Same `giglingRarity` and `gearRarity` as player
- 70% chance of a random caparison effect, 30% no caparison
- Gear stats are fresh random rolls (not matching player's rolls)

This keeps fights fair (same tier) while adding variety (different gear rolls and effects).

## Gotchas for Next Session
- `LoadoutScreen` uses LCG RNG with seed state — if seed is 0, first value is always ~0.472 (mid-range rolls)
- Rarity bonus is now always ≥1, so the stats-preview arrow always shows "→"
- Chanfron secondary is **stamina** (not guard!) — any tests making chanfron gear by hand need `stat: 'stamina'`
- AI loadout is created in `App.tsx handleLoadoutConfirm()` — if you need to show it in UI, you'd need to store it in state
- The `rarityBonus > 0` check for the stats-preview note is always true now (uncommon = 1)
- `createCaparison` and `GEAR_SLOT_STATS` are imported but `createCaparison` is not used directly in LoadoutScreen (it's called internally by `createFullLoadout`)
- Caparison tests that compare "with cap vs without cap" now use baseline loadouts at same rarity to isolate the effect from the rarity bonus

## Test Summary
**149 tests passing** (57 calculator + 8 match + 46 gigling gear + 38 caparison)
**Build:** 248KB / 74KB gzip
**Deploy:** `npm run deploy` → gh-pages
