# Jousting MVP — Session 8 Handoff

## Working Style
- User wants full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Generate handoff at session end

## Session 8 Summary
**Focus:** Rigorous Gigaverse API re-verification — testing every endpoint directly at `https://gigaverse.io/api` (no SDK, no docs, no community sources). Major finding invalidates previous endpoint discovery under `/api/game/*`.

### Critical Discovery: Blanket Auth on /api/game/*

**The `/api/game/*` namespace has blanket auth middleware.** Every request to ANY path under `/api/game/` returns 401 `{"error":"No token provided"}` — including completely fake paths like `/api/game/zzz/yyy/xxx/www/vvv`. This means:

- **Our previous S7 claim of "33 live endpoints" is unreliable.** We cannot distinguish real from fake endpoints under `/api/game/*` without authentication.
- The 24 "auth-gated" endpoints we documented under `/api/game/*` (giglings, fishing, dungeon, market, conquest, etc.) may or may not actually exist — the 401 only proves the middleware fires, not that a route handler exists behind it.
- **Only endpoints OUTSIDE `/api/game/*` can be reliably discovered** without auth, because they return proper 404s for non-existent routes.

### Verified Public Endpoints (200, no auth needed)

These are the **only endpoints we can confirm with certainty exist**:

| # | Method | Endpoint | Response |
|---|--------|----------|----------|
| 1 | GET | `/api/account/{address}` | Full account: `accountEntity`, `usernames[]`, `noob`, `discordUser`, `checkpointProgress[]` |
| 2 | GET | `/api/factions/player/{address}` | Faction affiliation: `{"entities":[...]}` |
| 3 | GET | `/api/indexer/player/gameitems/{address}` | Game items owned: `{"entities":[...]}` |
| 4 | GET | `/api/offchain/skills/progress/{noobId}` | Skill levels: `SKILL_CID`, `LEVEL_CID`, `NOOB_TOKEN_CID` |
| 5 | GET | `/api/offchain/recipes` | Full crafting recipe DB (~238KB JSON) |

### Verified Dead/Changed Endpoints

| Endpoint | Previous Status | Current Status | Notes |
|----------|----------------|----------------|-------|
| GET `/api/leaderboards` | 401 (S7) | **404** | Removed or relocated |
| GET `/api/leaderboards/combat` | 401 (S7) | **404** | Removed or relocated |
| GET `/api/leaderboards/fishing` | 401 (S7) | **404** | Removed or relocated |
| POST `/api/offchain/skills/upgrade` | 401 (S7) | **405** | Method not allowed (may need PUT/PATCH now) |

### Blanket-401 Zone (cannot verify without auth)

Everything under `/api/game/*` returns 401 indiscriminately. These are paths we've *assumed* exist based on SDK source/docs, but cannot confirm without a Bearer token:

**From SDK source code (high confidence):**
- `/api/game/dungeon/action` (start_run, playMove, useItem)
- `/api/game/dungeon/state`
- `/api/game/dungeon/today`
- `/api/game/skill/levelup`

**From S7 probing (medium confidence — 401 is ambiguous):**
- Giglings: `/api/game/giglings`, `.../feed`, `.../hatch`, `/game/hatchery`, `/game/pets`, `/game/steed`
- Fishing: `/api/game/fishing/cast`, `.../reel`, `.../state`, `.../bait`
- Dungeon: `/api/game/dungeon/enter`, `.../action`, `.../exit`, `.../flee`
- Market: `/api/game/market`, `.../list`, `.../buy`
- Conquest: `/api/game/conquest`, `.../attack`
- Gear: `/api/game/equip`, `/api/game/repair`, `/api/game/craft`
- State: `/api/game/state` (GET+POST)

**From SDK source code (additional endpoints not yet probed):**
- GET `/api/user/me` — wallet + canEnterGame
- GET `/api/roms/player/{address}` — ROMs owned
- POST `/api/roms/factory/claim` — claim ROM production
- GET `/api/offchain/player/energy/{address}` — energy state
- GET `/api/gigajuice/player/{address}` — juice subscription
- GET `/api/importexport/balances/{address}` — item/resource balances
- GET `/api/indexer/gameitems` — all game item definitions
- GET `/api/indexer/enemies` — all enemy definitions
- GET `/api/offchain/skills` — global skill tree
- GET `/api/offchain/static` — master constants dump

### Incomplete Work

The session was interrupted before we could complete two important probing passes:

1. **Offchain/indexer/factions/account/top-level path probing** — We planned to probe ~120 paths outside `/api/game/*` (under `/api/offchain/*`, `/api/indexer/*`, `/api/factions/*`, `/api/account/*`, `/api/auth/*`, `/api/public/*`, etc.) to discover new public endpoints. This was NOT completed.

2. **Frontend JS bundle extraction** — We planned to fetch the Next.js frontend at `https://gigaverse.io`, find the JS bundles under `/_next/static/chunks/`, and grep them for all `/api/` path strings. This would reveal the actual endpoints the game client calls, bypassing the blanket-401 problem. This was NOT completed.

**Both of these should be the first priority in the next session to get a complete, reliable endpoint map.**

### What We Know For Sure (Integration-Relevant)

For our jousting integration, these public endpoints give us everything we need without auth:

| Need | Endpoint | Data |
|------|----------|------|
| Player identity | `GET /api/account/{address}` | Account, hero (noob), level, linked addresses |
| Player faction | `GET /api/factions/player/{address}` | Faction affiliation |
| Player gear/items | `GET /api/indexer/player/gameitems/{address}` | All game items owned |
| Player skills | `GET /api/offchain/skills/progress/{noobId}` | All 8 combat skill levels |
| Crafting data | `GET /api/offchain/recipes` | Full recipe database |

**Missing (requires auth):** Gigling data, equipped gear details, dungeon state, energy. For gigling integration specifically, we'll need auth to access `/api/game/giglings` (if it exists as a real route).

### Memory Files (all in `.claude/projects/.../memory/`)

| File | Status |
|------|--------|
| MEMORY.md | **NEEDS UPDATE** — must add blanket-401 finding, correct endpoint counts |
| gigaverse-api.md | **NEEDS UPDATE** — must add caveats about /api/game/* blanket auth |
| gigaverse-overview.md | Unchanged |
| gigaverse-combat-gear.md | Unchanged |
| gigaverse-integration-notes.md | Unchanged |
| gigaverse-giglings.md | Unchanged |

### Project State (unchanged from S7)
- **65 tests passing** (57 calculator + 8 match)
- **Build:** 238KB JS / 71KB gzip
- **GitHub:** https://github.com/wharambebusiness-netizen/jousting-mvp
- **Live:** https://wharambebusiness-netizen.github.io/jousting-mvp/
- **Balance config** in `balance-config.ts` — all tuning constants in one file
- **UI:** 11 components, App.tsx has 9-screen state machine
- Handoff chain: S5 → S6 → S7 → **S8**

### Gotchas Carried Forward
- All previous gotchas from S7 still apply
- **`/api/game/*` returns 401 for ALL paths** — cannot discover real endpoints without auth
- **Leaderboard endpoints are gone** (404) — removed since S7
- **`/api/offchain/skills/upgrade` returns 405** — method changed or removed
- Only 5 endpoints are confirmed public (200 without auth)
- SDK endpoint references are high-confidence but not verified against live API

### What Should Come Next
1. **Complete the offchain/indexer/top-level probing** — ~120 paths outside `/api/game/*` to find more public endpoints
2. **Extract endpoints from frontend JS bundles** — grep Next.js chunks for `/api/` paths to get the real endpoint map
3. **Get a Bearer token** for authenticated probing (user would need to provide this)
4. **Update memory files** with corrected API information
5. Then continue with: gigling gear design, stat mapping, API integration layer
