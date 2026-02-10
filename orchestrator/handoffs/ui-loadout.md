# UI & Loadout Agent — Handoff (Round 3)

## META
- status: all-done
- files-modified: src/ui/MatchSummary.tsx, src/ui/MeleeResult.tsx, src/ui/SetupScreen.tsx, src/App.css
- tests-passing: true
- test-count: 908
- completed-tasks: stat abbreviation bugfix, P1/P2→archetype name replacement, archetype hint cards
- notes-for-others: @quality-review: Fixed a real bug in MatchSummary LoadoutMini — stat abbreviations used `.slice(0,3).toUpperCase()` which produced wrong labels (control→CON instead of CTL, guard→GUA instead of GRD, initiative→INI instead of INIT). Now uses proper STAT_ABBR mapping. Also replaced all P1/P2 labels across MatchSummary and MeleeResult with "You"/"Opp" + archetype names for readability. Added archetype hint cards (strengths + gameplay tip) to SetupScreen for new player onboarding (addresses MEMORY.md P1 gap). @all: No engine files modified. No App.tsx changes needed.

---

## What Was Done

### 1. Stat Abbreviation Bug Fix (MatchSummary.tsx:13-15, 250-251, 265-266)
- **Bug**: `LoadoutMini` used `gear.primaryStat.stat.slice(0, 3).toUpperCase()` to abbreviate stats
- **Result**: `control` → "CON" (wrong, should be CTL), `guard` → "GUA" (wrong, should be GRD), `initiative` → "INI" (wrong, should be INIT)
- **Fix**: Added `STAT_ABBR` mapping (`{momentum: 'MOM', control: 'CTL', guard: 'GRD', initiative: 'INIT', stamina: 'STA'}`) and used it with fallback: `STAT_ABBR[stat] ?? stat`
- All 4 instances in LoadoutMini (2 steed + 2 player) fixed

### 2. P1/P2 → Archetype Names (MatchSummary.tsx, MeleeResult.tsx)
- **MatchSummary.tsx**: Table headers changed from "P1 Attack" / "P2 Attack" → "You ({archName})" / "Opp ({archName})"
- **MatchSummary.tsx**: Result column changed from "P1" / "P2" → "You" / "Opp"
- **MatchSummary.tsx**: Timeline pip tooltips updated with archetype names
- **MatchSummary.tsx**: Melee legend changed from "P1: N, P2: N" → "You ({name}): N, Opp ({name}): N"
- **MeleeResult.tsx**: Win counters changed from "P1 Wins" / "P2 Wins" → "You ({name})" / "Opp ({name})"

### 3. Archetype Hint Cards (SetupScreen.tsx:18-25, App.css:104-107)
- Added `ARCHETYPE_HINTS` data with `strengths` and `tip` per archetype
- Displayed below stat bars on both player selection (step 1) and opponent selection (step 2) cards
- CSS: gold-colored strength text, italic gameplay tip, separated by border-top
- Addresses MEMORY.md "New Player Onboarding Gaps" P1 priority (stat/archetype clarity)

---

## What's Left

Nothing. All primary and stretch goals complete. Marking all-done.

---

## Issues

None. All 908 tests passing. No engine files modified.
