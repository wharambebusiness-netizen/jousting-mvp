# Jousting MVP — Session 10 Handoff

## Working Style
- User wants full autonomy — make decisions, don't ask for approval
- Full permissions granted — no pausing for confirmations
- Generate handoff at session end

## Session 10 Summary
**Focus:** Gigling trait system deep-dive — discovered public NFT metadata endpoint, sampled trait distributions, searched for hatch rate probability tables. Session ran out of context once (continued), then user requested early handoff before hatch rate search completed.

### Major Discovery: Public Gigling Metadata Endpoint

Used Abstract RPC (`https://api.mainnet.abs.xyz`, chain 2741) to call `tokenURI(1)` on the gigling contract (`0xd320831c876190c7ef79376ffcc889756f038e04`), function selector `0xc87b56dd`. Decoded hex response revealed:

**`GET https://gigaverse.io/api/pets/metadatav2/{tokenId}`** — PUBLIC, no auth needed!

Returns standard ERC-721 metadata with traits:
```json
{
  "name": "Gigaverse Gigling #1",
  "description": "...",
  "image": "https://gigaverse.io/api/pets/metadatav2/1/image",
  "attributes": [
    {"trait_type": "State", "value": "Pet"},       // "Egg" during hatch, "Pet" after
    {"trait_type": "Rarity", "value": 2},           // Numeric CID (1-6 observed)
    {"trait_type": "Faction", "value": "Archon"},   // String name
    {"trait_type": "Gender", "value": "Male"},      // "Male" or "Female"
    {"trait_type": "Pet Type", "value": "Steed"}    // Species
  ]
}
```

**Key observations:**
- During hatching: `State = "Egg"`, `Rarity = 0-100` (quality percentage)
- After hatching: `State = "Pet"`, `Rarity = 1-6` (discrete CID tier)
- No CID 0 observed in 80 hatched pets sampled
- Rarity CID mapping (needs confirmation): 1=Common?, 2=Uncommon?, 3=Rare?, 4=Epic?, 5=Legendary?, 6=Relic? (no Giga observed — CID 7?)

### Gigling Trait Sampling (200 IDs, 80 hatched — BIASED toward early minters)

**Rarity distribution (biased sample — early IDs over-represent whales):**
| CID | Count | % |
|-----|-------|---|
| 1 | 2 | 3% |
| 2 | 18 | 23% |
| 3 | 19 | 24% |
| 4 | 31 | 39% |
| 5 | 7 | 9% |
| 6 | 3 | 4% |

**Gender:** ~89% Male, ~11% Female
**Faction:** Factionless 25%, 7 main factions 8-14% each, Gigus ~1%

**User flagged these numbers as unreliable** — early IDs are biased. The actual rates depend on hatch quality, which varies per player.

### Hatch Rate Table Search (INCOMPLETE)

User says quality-to-rarity-tier probability tables exist "in the game files." Searched:

**`/api/offchain/static` hatchery config — NO rate tables found.** Contains only:
```json
{
  "maxPetsInHatchery": 300,
  "maxProgress": 100,
  "maxRarity": 100,
  "comfortConfig": {"minValue": 0, "maxValue": 5, "increment": 1},
  "temperatureConfig": {"minValue": 0, "maxValue": 100, "increment": 10},
  "eggspediteItems": [
    {"id": 584, "quality": 10},
    {"id": 585, "quality": 30},
    {"id": 586, "quality": 50},
    {"id": 587, "quality": 70},
    {"id": 589, "quality": 90}
  ]
}
```

**Hatchery recipes found** in `/api/offchain/recipes` — entries Recipe#Hatchery#500001-500006 (materials for hatching).

**NOT yet searched:**
1. Frontend JS bundles for "hatch"/"rarity"/"rate"/"probability" strings
2. Unity WebGL build at `builds.gigaverse.io/develop/versions/run-386/` (framework JS, data files)
3. Auth-gated `/api/game/hatchery` endpoint (may return rate table when authenticated)

### Memory Files Updated This Session

| File | Change |
|------|--------|
| MEMORY.md | Updated: 16 public endpoints, 42 total paths, play repo, Gigus faction, S10 probing results |
| gigaverse-api.md | **Full rewrite S9/S10**: all 42 endpoints, response shapes, TypeScript data models |
| gigaverse-play-repo.md | **Created S9/S10**: official AI agent skill package reference |
| gigaverse-giglings.md | Updated: confirmed 7 rarity tiers, Gigus as 8th faction, factionless as 9th |
| jousting-handoff-s9.md | Created (covers S9 work carried into this session) |

### Project State (unchanged from S9)
- **65 tests passing** (57 calculator + 8 match)
- **Build:** 238KB JS / 71KB gzip
- **GitHub:** https://github.com/wharambebusiness-netizen/jousting-mvp
- **Live:** https://wharambebusiness-netizen.github.io/jousting-mvp/
- **Balance config** in `balance-config.ts` — all tuning constants in one file
- **UI:** 11 components, App.tsx has 9-screen state machine
- Handoff chain: S5 → S6 → S7 → S8 → S9 → **S10**

### Gotchas Carried Forward
- All previous gotchas from S9 still apply
- **Abstract RPC:** `https://api.mainnet.abs.xyz` (NOT api.abs.xyz or rpc.abs.xyz)
- **tokenURI selector:** `0xc87b56dd` + zero-padded tokenId
- **Gigling metadata endpoint is PUBLIC** — no auth needed for `/api/pets/metadatav2/{id}`
- **Rarity CID mapping unconfirmed** — CIDs 1-6 observed, need to confirm which tier name each maps to
- **Eggspeditor items** set quality floors: IDs 584/585/586/587/589 → 10/30/50/70/90%
- **Early gigling IDs are biased** — don't use them for population statistics
- **Windows gotcha:** Node can't use `/dev/stdin`; save curl output to `$TEMP/file.json` first, then parse
- **Windows gotcha:** `%TEMP%` doesn't expand in bash; use `$TEMP` instead

### What Should Come Next
1. **Find hatch rate probability tables** — search Unity WebGL build JS/data files and frontend JS bundles for quality→rarity probability mapping. User confirms these exist "in the game files"
2. **Update gigaverse-giglings.md** with metadata endpoint discovery, confirmed trait structure, and hatch rates once found
3. **Confirm rarity CID→tier mapping** — sample a few known-rarity giglings or find the mapping in game files
4. **Gigling gear design** — define gear slots (Barding, Saddle, Chanfron, Caparison), base stats, rarity tiers
5. **Stat mapping** — gigling traits/gear → jousting MOM/AGI/END; character skills → melee stats
6. **API integration layer** — TypeScript service to fetch player data from public endpoints
7. **Optional: authenticated probing** — with a Bearer token, verify `/api/game/*` routes (especially giglings)
