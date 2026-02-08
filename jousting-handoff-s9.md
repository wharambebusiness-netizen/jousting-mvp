# Jousting MVP — Session 9 Handoff

## Working Style
- User wants full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Generate handoff at session end

## Session 9 Summary
**Focus:** Completed both S8 TODO tasks — (1) probed ~150 API paths outside `/api/game/*`, (2) extracted all endpoints from frontend JS bundles. Major discovery: official Gigaverse-Games/play GitHub repo with authoritative AI agent API documentation. Updated all memory files.

### Major Discovery: Gigaverse-Games/play Repository

The Gigaverse frontend HTML contains a `<meta>` tag pointing to `https://github.com/Gigaverse-Games/play` — an **official AI agent skill package** published by the Gigaverse team. This is the authoritative API reference, superseding the community SDK.

**Key contents:**
- `SKILL.md` — Full agent documentation with play modes, quick start, combat guide
- `references/api.md` — Complete API reference with endpoint map, auth flow, dungeon actions
- `references/enemies.md` — All 42+ enemies with HP/Shield stats
- `references/leveling.md` — Skill system, stat allocation strategies
- `references/onboarding.md` — Account creation + onboarding flow
- 9 reference files total + 3 setup scripts

**Implications for jousting:**
- Same SIWE auth system would work for jousting API
- actionToken pattern could inspire match sequencing
- No gigling/mount endpoints in play repo (confirms greenfield)
- Official support for AI agents is first-class

### Endpoint Discovery Results

**Public endpoints grew from 5 → 16 (11 new):**

| # | Endpoint | Source |
|---|----------|--------|
| 1 | `GET /api/account/{address}` | S8 |
| 2 | `GET /api/factions/player/{address}` | S8 |
| 3 | `GET /api/indexer/player/gameitems/{address}` | S8 |
| 4 | `GET /api/offchain/skills/progress/{noobId}` | S8 |
| 5 | `GET /api/offchain/recipes` | S8 |
| 6 | `GET /api/offchain/player/energy/{address}` | **S9 NEW** |
| 7 | `GET /api/gigajuice/player/{address}` | **S9 NEW** |
| 8 | `GET /api/importexport/balances/{address}` | **S9 NEW** |
| 9 | `GET /api/indexer/gameitems` | **S9 NEW** |
| 10 | `GET /api/offchain/skills` | **S9 NEW** |
| 11 | `GET /api/offchain/static` | **S9 NEW** |
| 12 | `GET /api/factions/summary` | **S9 NEW** |
| 13 | `GET /api/offchain/gameitems` | **S9 NEW** |
| 14 | `GET /api/redeem/all` | **S9 NEW** |
| 15 | `GET /api/random/all` | **S9 NEW** |
| 16 | `GET /api/random/player` | **S9 NEW** |

**Total API paths mapped: 42 unique** (from JS bundle extraction + official docs + probing)

**Newly confirmed DEAD (SDK was wrong):**
- `GET /api/roms/player/{address}` → 404 (SDK-referenced, does not exist)
- `GET /api/indexer/enemies` → 404 (SDK-referenced, use `/api/offchain/static` instead)
- `POST /api/offchain/skills/upgrade` → 404 (was 405 in S8, now fully removed)

**New auth-gated endpoints found:**
- `/api/user/me`, `/api/items/balances`, `/api/redeem/cooldown`, `/api/redeem/history`
- `/api/indexer/usernameAvailable/{name}`, `/api/user/discord`

**Factions namespace (400 = real, need params):**
- `/api/factions/all`, `/api/factions/list`, `/api/factions/leaderboard`
- `/api/factions/stats`, `/api/factions/conquest`, `/api/conquest/leaderboard`

**POST-only (405 on GET):** `/api/user/auth`, `/api/analytics/event`, `/api/user/consent`

### Architecture Insight: Two-Consumer Split

The Gigaverse frontend has a clean split between two API consumers:

1. **Next.js frontend** — handles auth, payments (Stripe), Discord linking, redeem system, random system, analytics, admin
2. **Unity WebGL game** (build 386) — handles ALL gameplay: dungeon runs, combat, skills, factions, inventory, energy
   - Gets JWT via JavaScript bridge (`JavascriptBridge.ReceiveUserData`)
   - Game endpoints invisible in JS bundles — only discoverable via play repo

### What Integration Data We Have (No Auth Needed)

| Need | Endpoint | Data |
|------|----------|------|
| Player identity | `GET /api/account/{address}` | Account, hero (noob), level |
| Player faction | `GET /api/factions/player/{address}` | Faction affiliation |
| Player gear/items | `GET /api/indexer/player/gameitems/{address}` | All game items owned |
| Player skills | `GET /api/offchain/skills/progress/{noobId}` | All 8 combat skill levels |
| Skill definitions | `GET /api/offchain/skills` | Full skill tree structure |
| All game items | `GET /api/offchain/gameitems` | Item definitions |
| Static game data | `GET /api/offchain/static` | Enemies, items, checkpoints |
| Player energy | `GET /api/offchain/player/energy/{address}` | Energy state |
| Juice status | `GET /api/gigajuice/player/{address}` | Premium subscription |
| Faction overview | `GET /api/factions/summary` | All factions + populations |
| Crafting data | `GET /api/offchain/recipes` | Full recipe database |
| Item balances | `GET /api/importexport/balances/{address}` | Resource balances |

### Memory Files Updated

| File | Change |
|------|--------|
| MEMORY.md | Updated: 16 public endpoints, 42 total paths, play repo reference, stale SDK note |
| gigaverse-api.md | **Full rewrite**: all 42 endpoints categorized by status, official docs as primary source |
| gigaverse-play-repo.md | **NEW**: complete reference for official AI agent skill package |
| gigaverse-overview.md | Unchanged |
| gigaverse-combat-gear.md | Unchanged |
| gigaverse-integration-notes.md | Unchanged |
| gigaverse-giglings.md | Unchanged (gigling endpoints still unverifiable) |

### Project State (unchanged from S8)
- **65 tests passing** (57 calculator + 8 match)
- **Build:** 238KB JS / 71KB gzip
- **GitHub:** https://github.com/wharambebusiness-netizen/jousting-mvp
- **Live:** https://wharambebusiness-netizen.github.io/jousting-mvp/
- **Balance config** in `balance-config.ts` — all tuning constants in one file
- **UI:** 11 components, App.tsx has 9-screen state machine
- Handoff chain: S5 → S6 → S7 → S8 → **S9**

### Gotchas Carried Forward
- All previous gotchas from S8 still apply
- **SDK v0.0.9 is stale** — `/api/roms/player` and `/api/indexer/enemies` return 404
- **Use official play repo** as primary API reference, not community SDK
- **`/api/offchain/static` replaces `/api/indexer/enemies`** for enemy data
- **`/api/game/account/{address}` is NOT the same as `/api/account/{address}`** — both exist, different scopes
- **actionToken system** has ~5s anti-spam window; if stuck, resync via `/game/dungeon/state`

### What Should Come Next
1. **Gigling gear design** — define gear slots (Barding, Saddle, Chanfron, Caparison), base stats, rarity tiers
2. **Stat mapping** — gigling traits/gear → jousting MOM/AGI/END; character skills → melee stats
3. **API integration layer** — TypeScript service to fetch player data from public endpoints
4. **Optional: authenticated probing** — with a Bearer token, verify `/api/game/*` routes (especially giglings)
5. **Optional: save play repo reference files locally** — `references/leveling.md`, `references/skills-inventory.md`, etc. for offline use
