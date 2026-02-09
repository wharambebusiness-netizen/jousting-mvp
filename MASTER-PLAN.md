# Jousting MVP — Master Plan

> Generated: 2026-02-09 (S32)
> Status: ACTIONABLE — execute phases in order
> Game engine: FEATURE COMPLETE (699/699 tests passing)
> MVP readiness: ~90% — balance fix + polish needed before launch

---

## Phase Overview

```
Phase 1: Orchestrator Prep     [~4h]   ← Model switching + stale data fixes
Phase 2: Balance Fix           [~8h]   ← Technician fix + test cascade + validation
Phase 3: Overnight Run #2      [~10h]  ← Automated: 7 agents, v5 orchestrator
Phase 4: UI Polish             [~6h]   ← CSS migration + readability + rarity borders
Phase 5: Design Audits         [~4h]   ← Archetype fun, variant impact, new player UX
Phase 6: Launch Prep           [~2h]   ← Deploy to GitHub Pages, manual QA
Phase 7: Gigaverse Integration [~20h]  ← Post-launch, separate initiative
```

**Critical path**: Phase 1 → Phase 2 → Phase 3 → Phase 6 (launch)
**Parallel work**: Phases 4 and 5 can run during/after Phase 3 via overnight agents

---

## Phase 1: Orchestrator Prep (~4 hours)

Enhance the overnight orchestrator before Run #2 so it has cost visibility and smarter model escalation. These are the 4 actions from the 3-agent review (S32).

### Action 1.1: Fix stale test count in test.md (5 min)

- **File**: `.claude/commands/test.md` line 7
- **Change**: Replace `calculator (116), caparison (11), gigling-gear (48), player-gear (46), match (69), playtest (80) = 370 total` with `calculator (194), phase-resolution (38), gigling-gear (48), player-gear (46), match (89), playtest (128), gear-variants (156) = 699 total (verify by running tests)`

### Action 1.2: Remove hardcoded test count from consistency check (30 min)

- **File**: `orchestrator/consistency-check.mjs` lines 43-52
- **Change**: Remove the hardcoded `699` check entirely. Tests are run every round — the consistency check should focus on archetype stats and balance constants (lines 54-69), which are the things that drift silently. The hardcoded count will false-alarm every time QA adds tests.

### Action 1.3: Add cost tracking to overnight report (1-2 hours)

- **File**: `orchestrator/orchestrator.mjs`
- **Locations**:
  - `runAgent()` line 643 (`proc.on('close')`): Parse stderr for Claude CLI cost/token output
  - Near line 893: Add `costLog` accumulator `{ agentId → { totalCost, inputTokens, outputTokens, rounds } }`
  - `generateOvernightReport()` line 1155: Add `## Cost Summary` section with per-agent cost table
- **Fallback**: If stderr doesn't expose cost data, estimate from model pricing x elapsed time

### Action 1.4: Extend model escalation with guardrails (1-2 hours)

- **File**: `orchestrator/orchestrator.mjs` → `handleModelEscalation()` line 1104
  - **(a)** sonnet→opus escalation after 2 consecutive failures (mirror existing haiku→sonnet)
  - **(b)** `maxModel` field per agent — cap how far an agent can escalate
  - **(c)** De-escalation on success — save `_originalModel`, restore after successful round
- **File**: `orchestrator/missions/overnight.json`
  - producer: `"maxModel": "haiku"` (never escalate)
  - designer: `"maxModel": "haiku"` (never escalate)
  - polish: `"maxModel": "sonnet"` (cap at sonnet)
  - reviewer: `"maxModel": "sonnet"` (stay at sonnet)
  - balance-tuner, qa, ui-dev: `"maxModel": "opus"` (allow full chain)

**Exit criteria**: All changes committed, `npx vitest run` still 699/699 passing.

---

## Phase 2: Balance Fix (~8 hours)

Fix the one known balance issue: Technician underperformance at 43-47% across all tiers. This is a dependency chain (BL-031 → BL-033 → BL-034 → BL-035).

### Action 2.1: Apply Technician MOM change (BL-031) — 1 hour

- **File**: `src/engine/archetypes.ts`
- **Change**: Technician momentum 61→64 (or whatever value the balance analyst recommends; current backlog says +3)
- **Validate**: Run `npx tsx src/tools/simulate.ts bare` and `npx tsx src/tools/simulate.ts giga`
- **Note**: BL-031 is currently `deferred` in backlog — undefer it first
- **Expected outcome**: Technician +2-3pp improvement at all tiers

### Action 2.2: Fix test cascade (BL-033) — 4-6 hours

- **Expected breakage**: ~5-8 test assertions in calculator.test.ts and match.test.ts
  - Worked examples with Technician MOM values
  - Impact score calculations (MOM is a multiplier in impact formula)
  - Possibly gear-variants.test.ts deterministic cycling tests
- **Process**: Run `npx vitest run`, identify all failures, recalculate correct values, update assertions
- **Exit criteria**: All 699+ tests passing

### Action 2.3: Full balance validation sweep (BL-034) — 2 hours

- **Run simulations**: bare, uncommon, rare, epic, giga (5 tiers) + uncommon aggressive/defensive
- **Verify**:
  - Technician ≥47% at bare, ≥48% at giga
  - No archetype >58% at any tier (dominance threshold)
  - No archetype <40% at any tier (weakness threshold)
  - Charger and Bulwark win rates not significantly degraded
- **Output**: `orchestrator/analysis/balance-tuner-round-1.md`

### Action 2.4: Update CLAUDE.md + review (BL-030 + BL-035) — 1 hour

- Update archetype stats section with new Technician MOM
- Update test count if it changed
- Document the balance change in gotchas/changelog
- Verify all CLAUDE.md data matches source files

**Exit criteria**: All tests passing, Technician balanced, CLAUDE.md current, committed.

---

## Phase 3: Overnight Run #2 (~10 hours, automated)

Launch the v5 orchestrator with the improved 7-agent team. This runs unattended overnight.

### Pre-launch checklist

- [ ] Phase 1 changes committed (cost tracking, model escalation)
- [ ] Phase 2 changes committed (Technician fix, tests passing)
- [ ] `npx vitest run` shows all tests passing
- [ ] `overnight.json` has `maxModel` fields set per agent
- [ ] Git working tree is clean

### Launch command

```powershell
powershell -ExecutionPolicy Bypass -File orchestrator\run-overnight.ps1
```

### What the agents will do

| Agent | Model | Focus |
|-------|-------|-------|
| producer | haiku | Generate 3-5 new backlog tasks per round |
| balance-tuner | sonnet | Run sims, make 1 small tuning change per round |
| qa | sonnet | Write 5-10 new tests per round for untested areas |
| polish | haiku | Improve 1 UI element's CSS per round |
| reviewer | sonnet | Code review + CLAUDE.md maintenance |
| ui-dev | sonnet | Migrate inline styles, improve UX |
| designer | haiku | Write design analysis reports |

### Expected outcomes

- Test count grows (QA adding coverage)
- Balance improves (tuner iterating on edge cases)
- CSS cleanup progresses (polish + ui-dev coordinating)
- Design insights documented (designer audits)
- Cost data collected for the first time (Action 1.3)

### Morning review

1. Read `orchestrator/overnight-report.md` — especially the new **Cost Summary** section
2. Check `orchestrator/analysis/` for balance and design reports
3. Read agent handoffs in `orchestrator/handoffs/`
4. Run `npx vitest run` to confirm all tests still pass
5. Commit overnight changes

---

## Phase 4: UI Polish (~6 hours)

Can run during Phase 3 (overnight agents handle some of this) or after.

### Action 4.1: CSS migration — inline styles to classes (BL-036) — 3-4 hours

41 inline styles across 8 components. CSS class replacements already exist in App.css. Priority order:

| Component | Inline Styles | Example Migration |
|-----------|--------------|-------------------|
| MatchSummary.tsx | 10+ | `style={{color:'#4A8A2A'}}` → `className="text-uncommon"` |
| PassResult.tsx | 6+ | `style={{marginTop:'16px'}}` → `className="mt-4"` |
| LoadoutScreen.tsx | 5+ | `style={{fontSize:'0.8rem'}}` → `className="text-small"` |
| MeleeResult.tsx | 4+ | Similar color/spacing migrations |
| SetupScreen.tsx | 3+ | Difficulty selector styling |
| helpers.tsx | 3+ | Stat bar styling |
| AIThinkingPanel.tsx | 3+ | Panel layout |
| MeleeTransition.tsx | 2+ | Transition animations |

**Target**: Migrate at least 15 of the highest-impact inline styles.

### Action 4.2: Combat result readability (BL-037) — 2 hours

- Add clear "Player X wins this pass!" indicator at top of PassResult
- Highlight winning score in bold/color accent
- Show impact score difference prominently
- Make counter results more visible (key learning mechanic)

### Action 4.3: Gear rarity borders (BL-038) — 1 hour

- Add `gear-item--${rarity}` class to LoadoutScreen gear items
- CSS rules already exist in App.css (`.gear-item--uncommon` through `.gear-item--giga`)
- Just wire up the className in JSX

**Exit criteria**: Cleaner JSX, better visual feedback, all tests passing.

---

## Phase 5: Design Audits (~4 hours)

Game designer analysis to inform post-launch iteration. No code changes — just reports.

### Audit 5.1: Archetype fun factor (BL-039) — 2 hours

- Does each archetype have a clear identity players can feel?
- Are there "power fantasy" moments? (Charger devastating lance charge, Technician precision outmaneuver)
- Which archetype is least fun even if balanced? Why?
- Actionable proposals for improvement

### Audit 5.2: Gear variant impact (BL-040) — 1 hour

- Do aggressive/balanced/defensive variants create meaningful choices?
- Can players feel the difference between full-aggressive and full-defensive loadouts?
- Are there interesting variant combinations (aggressive lance + defensive armor)?
- Should variants interact with archetype selection?

### Audit 5.3: New player experience (BL-041) — 1 hour

- Walk through first-match experience: setup → loadout → joust → melee → end
- Are stat labels clear? (MOM/CTL/GRD/INIT/STA)
- Is gear selection overwhelming for new players?
- Can players learn the counter system from the UI?
- 3+ clarity improvements ranked by impact

**Output**: `orchestrator/analysis/design-round-{1,2,3}.md`

---

## Phase 6: Launch Prep (~2 hours)

### Action 6.1: Pre-deploy verification — 30 min

- `npx vitest run` — all tests passing
- `npx tsc --noEmit` — no TypeScript errors
- `npm run build` — clean build, check dist/ output
- Manual smoke test: play 1 full match (setup → joust → melee → summary)

### Action 6.2: Deploy to GitHub Pages — 30 min

- `npm run deploy` (builds + pushes to gh-pages branch)
- Verify deployed site loads and game is playable
- Check mobile responsiveness (480px breakpoint)

### Action 6.3: Post-deploy sanity check — 30 min

- Play 1 match as each archetype class (6 quick matches)
- Verify AI opponent works at each difficulty
- Check gear selection UI at different rarities
- Confirm no console errors in production build

### Action 6.4: Tag release — 15 min

- `git tag v1.0.0-mvp` on the deployed commit
- Update MEMORY.md with launch status

**Exit criteria**: Game is live, playable, and tagged.

---

## Phase 7: Gigaverse Integration (~20 hours, post-launch)

Separate initiative. Memory files with research already exist:
- `memory/gigaverse-overview.md` — Game loops, factions, NFTs, ROMs, energy
- `memory/gigaverse-api.md` — API endpoints and authentication
- `memory/gigaverse-combat-gear.md` — Gear mapping reference
- `memory/gigaverse-giglings.md` — Pet system integration
- `memory/gigaverse-play-repo.md` — Play environment setup
- `memory/gigaverse-integration-notes.md` — Technical notes

### Integration roadmap (rough)

| Step | What | Effort |
|------|------|--------|
| 7.1 | Read API docs, authenticate with testnet | 2-3h |
| 7.2 | Map Gigaverse archetype/gigling IDs → engine archetypes | 3-4h |
| 7.3 | Map Gigaverse item IDs → engine gear slots/stats | 4-5h |
| 7.4 | Async wrapper: fetch player data → createMatch() | 3-4h |
| 7.5 | Post-match reward hook (call Gigaverse economy) | 3-4h |
| 7.6 | User auth (Abstract blockchain wallet) | 3-4h |
| 7.7 | End-to-end testnet validation | 2-3h |

**Prerequisite**: MVP must be stable and deployed first.

---

## Summary: What's Done vs What Remains

### Done (S1-S32)
- Game engine: 100% complete (all phases, math, AI)
- Test suite: 699/699 passing (7 suites, comprehensive coverage)
- UI: 15 components, 10-screen state machine, 875-line CSS design system
- Gear system: 12 slots, 3 variants, 7 rarities, all tested
- AI opponent: 3 difficulties, pattern tracking, reasoning
- Orchestrator v5: 7 phases, 7-agent team, model tiering, resilience
- Build/deploy: Vite config, GitHub Pages ready
- Zero TODO/FIXME comments in production code

### Remains (Phases 1-6 for MVP launch)
- Phase 1: Orchestrator prep (cost tracking, model escalation) — ~4h
- Phase 2: Balance fix (Technician MOM, test cascade) — ~8h
- Phase 3: Overnight Run #2 (automated, unattended) — ~10h
- Phase 4: UI polish (CSS migration, readability) — ~6h
- Phase 5: Design audits (analysis only) — ~4h
- Phase 6: Deploy + verify — ~2h
- **Total human-directed effort: ~24h** (Phase 3 is automated)

### Post-MVP
- Phase 7: Gigaverse integration — ~20h (separate initiative)
- Gear durability/repair system — TBD
- CI/CD pipeline (GitHub Actions) — ~3h
- Accessibility audit (WCAG 2.1 AA) — ~3h

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `orchestrator/PLAN-model-switching-and-skills.md` | S32 model switching plan (4 actions) |
| `orchestrator/orchestrator.mjs` | Main orchestrator (1285 lines) |
| `orchestrator/missions/overnight.json` | 7-agent mission config |
| `orchestrator/backlog.json` | 11 active tasks with dependency chains |
| `orchestrator/run-overnight.ps1` | Overnight restart loop |
| `src/engine/archetypes.ts` | Archetype stats (balance target) |
| `src/engine/balance-config.ts` | ALL tuning constants |
| `src/tools/simulate.ts` | Balance simulation CLI |
| `.claude/commands/test.md` | Test runner command (stale count to fix) |
| `CLAUDE.md` | Project reference (update after balance changes) |
