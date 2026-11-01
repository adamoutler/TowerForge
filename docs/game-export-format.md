# The Tower — Game Data Export (`tool_export.json`)

Reference for the official data export from The Tower (TTG), as read by
TowerForge's **Import Game Data** button (`towerforge.client/src/engine/gameExport.ts`).
Written from a fresh test account (game version 1245, `DataVersion` 30), so almost
every value was 0. Anything marked 🔜 or ❓ needs a real, played account to confirm.

**Status key**

| | Meaning |
|---|---|
| ✅ | Imported now |
| 🔜 | Usable — the field is clear, but which array position is which stat must be confirmed with a real export before it can overwrite what players entered |
| 📊 | Lifetime/record stat — readable, not used by the site yet |
| ⚪ | Not needed by the site (settings, cosmetics) |
| ❓ | Not sure what it is or how to read it — question for the player |

Arrays of 0/false values in the test file can't reveal their order, so "index = …"
notes below are the expected layout, not yet verified.

---

## The file's format, and PDFs

The export is pretty-printed JSON: ~29,000 lines, none longer than ~63
characters (a real account, 600 KB). Some players end up with it as a **PDF**
(their phone printed it or "saved as PDF"). Import accepts PDFs too
(`engine/pdfImport.ts`), after a warning that it might not work:

- pdf.js (loaded only for PDFs) reads the text one line at a time;
- headers / footers printing adds to every page (date, file path + "3/448",
  Chrome's "Pretty-print" label) are dropped: lines near a page's top or
  bottom that aren't a JSON line and start the same way at the same height on
  at least half the pages — a real JSON line is never dropped;
- the lines are joined and parsed; if that fails (a line wrapped mid-value),
  they're joined without breaks and parsed again.

Checked on Chrome's and Edge's "Save as PDF" of a full real export (448 pages,
with and without headers): identical data back, in ~0.5–0.8 s. A minified copy
printed with wrapped lines also imports; the only loss was spaces where a line
wrapped ("Preset 1" → "Preset1", treated as a default name). A file named
`.json` that's really a PDF is detected by its `%PDF` start.

---

## File info

| Field | Status | Notes |
|---|---|---|
| `VersionNumber` | ✅ | Game build (1245). Kept with the import. |
| `DataVersion` | ✅ | Save-format version (30). If this changes, the layout may have changed. |
| `PlayTime` | 📊 | Total play time in seconds (63 on the test account). |
| `GameStartedDate` | 📊 | Account creation date (UTC). |

## Export format 1 (game 29.1.3)

From TTG's change notes for 29.1.3 and their test export (build 1253,
`DataVersion` 31, a fresh account — values are 0 / false, so array orders
can't be checked from it). The importer reads that file as before; the new
fields are below. Dates are now always UTC with exactly 3 decimals
(`2026-10-19T14:02:11.123Z`; before, 0–3); `Date.parse` reads both.
29.1.3 also adds Settings → External Tools Export (export by hand, or
automatically every time the game saves — the site's Auto import reads
those through TowerForge Link, see towerforge-link.md).

**A real 29.1.3 export (2026-10-21):** the owner's account, build 1253,
`DataVersion` 31, read through TowerForge Link. Imports without errors.
What it showed is in the rows below ("owner's export").

| Field | Status | Notes |
|---|---|---|
| `ExportVersion` | ✅ | 1. TTG bumps it when a field is renamed, removed or changes meaning — not for additions. Import warns when a file's version is above the one the site was written for (`SUPPORTED_EXPORT_VERSION` in gameExport.ts). |
| `ExportedAt` | ✅ | When the file was written (UTC). The import message says how long ago; the lab speed-up time left is as of this. |
| `LeagueID` | ✅ (assumed) | The league you're in now (`HighestLeague` is the best reached). Read with the `HighestLeague` numbers, 0 Copper … 6 Mythic — the code's assumption. Owner's export: 6 (Mythic), the same number as the Mythic tournaments in its `TournamentRecords`. Kept as `profile.currentLeague`; the Tournament page starts on it. |
| `TournamentRecords[]` | ✅ | Every tournament played: `TournamentNumber`, `Date` (00:00 UTC of the tournament day), `LeagueID`, `Wave`, `Rank`. Owner's export: 223 (from #34 in 2024). #309 (2026-10-17) W135 rank 19 matches the best tournament run in the battle history that day (W135). **Rank** is the placement in the 30-player bracket (1 = top): all 222 finished ones are 2–29, never above 30, and within a league a higher wave goes with a better rank (Mythic: correlation −0.78). Rank 0 = not placed yet: only the newest (#310, 2026-10-21, W1 while the history already had a W95 run that day) — filled in when the tournament ends (the code's reading). Kept across imports and synced (`tourneyRecords`); shown on Tournaments → History, read by Ask AI. |
| `InGuild` | ✅ | Not in the save: the game fills it from live guild state when exporting, and it's false if guild data hasn't loaded yet (TTG). Kept as `guardianData.inGuild`; false shows a note on the Guardian tab — the Guardian only fights while you're in a guild (wiki: Guardian, Guilds). The models don't switch the Guardian off on it, because of the not-loaded case. |
| `FlameBotPresets`, `ThunderBotPresets`, `GoldenBotPresets`, `AmplifyBotPresets`, `BotBotPresets` (5 rows each) | ✅ | One row per bot preset: `Unlocked`, `Active`, `Levels[4]`, `SelectedLevels[4]`, `PlusUnlocked`, `PlusLevel`. Site preset i reads row `GlobalPresets[i].BotsIndex`. `Levels` are in save order [secondary, range, cooldown, primary]; the game shows [primary, cooldown, secondary, range] — e.g. Flame Bot [Damage Reduction, Cooldown, Damage, Range] (TheTowerSDK `remapBotLevelsFromGameSaveOrder`, checked there on a real save). Each stat takes the higher of `Levels` and `SelectedLevels`, like the SDK; 0 = the base value, as on the Bots tab; clamped to the site's max. A bot is owned when any row has it unlocked, and runs in a preset when that row is `Active`. Owner's export: all 5 bots, different levels per preset (e.g. Golden Bot [19, 15, 30, 20] in three presets, 0 in the others). **Checked on the owner's Bots screen (2026-10-22, GC Farm = bot preset 0):** only Golden Bot and Bot Bot unlocked there ("UNLOCK BOT 600" on Thunder and Amplify), exactly as the rows' `Unlocked` say — **bots unlock per bot preset**, so the site keeps `owned` / `plusOwned` per preset (`BotLevels`), and a bot runs only where it's unlocked and `Active`. The levels match the screen: Golden Bot 39.5 s (Lv 19 + 10 s Duration lab), 50 s Max (Lv 15 − 25 s Cooldown lab), ×8.00 Max (Lv 30), 80 m Max (Lv 20); Bot Bot 39.0 s, 50 s, ×2.00 Max (Lv 19), 80 m Max (Lv 20). The site's Bot Bot Bonus (30 levels from ×1.05 at Lv 1) and Range (Amplify's 18 levels) were wrong: TheTowerSDK's tables are ×1.05 + 0.05/level to Lv 19, and 20 m + 2 m/level to Lv 20 — every other bot stat matched it. Range = table + Bot Range relics (12 m) + the Vault's Bot Range (8 m, below). The GC Farm screen shows no Bot+ — Bot+ needs all five bots unlocked in the preset (the code's reading); a row's `PlusUnlocked` counts only where the bot is unlocked. |
| `PlusUnlocked`, `PlusLevel` | ✅ | Bot+ per bot preset (2026-10-19). `PlusLevel` is the level of the bot's one Bot+ ability, 0 = its unlock value (Wild Fire ×1.5, Titan Shock 5%, Bonus Cells ×1.25, Echoing Shot 3, Maximum Power ×1.25) — TheTowerSDK `readUserBotDataRow` reads it as the row's `plusLevel`, and `clampBotPlusStatLevel` puts it on Bot+ stat 0, the only one, between 0 and the ability's max (20 / 20 / 25 / 9 / 20 for Flame, Thunder, Golden, Amplify, Bot Bot; SDK and wiki bot pages agree). Site preset i reads the same row as the medal levels; the level is clamped to the max and counts only where that row has `PlusUnlocked` (else 0). Bot+ is unlocked when any of the bot's rows has it, account-wide like owning the bot. Importing replaces the Bot+ levels entered before, and the old site's extra Bot+ stats kept after the four medal levels are dropped. Still to check on a real 29.1.3 export that has Bot+. |
| `SynchronicityPresets[5]` (`SynchronicityBots[5]` each), `BotPresetName[5]`, `CurrentBotPreset`, `FlameBotLevelCooldownSelected` (and Thunder, Golden, Amplify, Bot Bot) | ❓ | Synchronicity slots per bot preset (null on the test account), bot preset names, and the cooldown level picked per bot (0) — not used yet. |
| `LabActiveBool[5]`, `LabResearchInt[5]`, `LabSpeedUpSpeed[5]`, `LabSpeedUpRemainingSeconds[5]`, `ResearchCompleteDate[260]` | ✅ | Labs being researched, per lab slot: running or not, the game's lab number (`GAME_LABS`), the speed-up multiplier and its time left as of `ExportedAt` (TTG). `ResearchCompleteDate` is read by lab number (260 entries like `ResearchLevel`; unused = year 1). Owner's export and Labs screen (2026-10-21): 5 labs running, numbers 241, 234, 237, 236 (Dissonant Echo-UW, Assist Module Bonus - Cannon / Core / Generator) and 169 = **Enemy Balance Mastery** (card mastery labs start at 160, `MASTERY_LAB_START`). **`ResearchLevel` doesn't count the level being researched** (Cannon stored 19 while the screen says Lv.20; Core 20 → 21, Generator 22 → 23, Mastery 5 → 6). **`ResearchCompleteDate` is the finish at normal speed**: the screenshot came 37m21s after the export (each speed-up timer 37m21s lower) and the ×6 labs' timers were 6 × 37m21s lower, the ×5 lab's 5 × — to within 7 s. So the real finish is earlier by what the speed-up saves (`engine/labTimer.ts`, anchors in labTimer.test.ts). Shown at the top of the Labs tab ("Researching") with the time left. Whether `ResearchLevel` already counts a lab that's running isn't known, so the level being researched isn't shown. `LabSpeedUpEndTime` is left out by TTG (deprecated). |
| `DisableAdsUnlockedBool`, `StarterPackUnlockedBool`, `EpicPackUnlockedBool` | ⚪ | Pack bonuses that are on (not purchase history). |
| `MenuUnlocked`, `ProfileBannerUnlocked`, `TrackAvailable[12]` | ⚪ | Cosmetics. |
| `ModulePity` (140 on the test account), `ModuleRarePity`, `CannonSubstatBans` (and Armor, Generator, Core), `CannonAutoRerollSubstats` (…), `AssistModulesAvailable` | 🔜 | Module pull pity, substat bans and auto-reroll picks. |
| `UpgradesLockedFreeUpgrades`, `UpgradesDefenseLockedFreeUpgrades`, `UpgradesUtilityLockedFreeUpgrades` | 🔜 | Workshop stats locked out of in-run free upgrades — for the run simulator. |
| `TierPreset`, `TournamentPreset`, `DissonantPreset` | ❓ | Battle presets for tier runs, tournaments and Dissonance. All 5 on the test account, which has 6 global presets — probably a 0-based global preset (the 6th), unconfirmed. All 5 on the owner's export too. |
| `UpgradeLevel[4]` (workshop Range) | ✅ | 0 on the owner's export (build 1250 on 2026-10-17 and 1253 on 2026-10-21), and Range is 0 in every workshop preset; `RangeLevelSelected` 0 too. Rend Armor Chance / Mult (`UpgradeLevel[15]`, `[16]`) went from 299 to 0 between those two exports. Both are the owner's setup (confirmed 2026-10-21), so the import is right; the Optimizer still offers Range 0 → 30 as a cheap pick. |
| `RangeLevelSelected`, `ShockwaveSizeLevelSelected`, `SwampRangeLevelSelected`, `InnerOrbDistance`, `SavedInnerOrbDistance`, `WorkshopOrbDistance`, `SavedWorkshopOrbDistance`, `SpotlightSmartMissilesOff`, `PoisonSwampStunOff`, `NukeAutomateToggle`, `DeathRayInstantKillToggle`, `SpawnAcceleratorToggle`, `EnergyShieldRestrictionToggle`, `DemonModeAutomateToggle`, `MissileBarrageAutomateToggle`, `DamageAdjustmentLog` | 🔜 | Sliders and toggles. `DamageAdjustmentLog` is the damage-cap slider: percent = 10^(value − max) (TTG); 37 on the test account. |
| `LastGuildSeason` | ⚪ | 11 on the test account. |
| `RoundActiveBool`, `CurrentWave`, `PerksPicked`, `RoundTime`, `HighestWaveReachedThisRound`, 138 `…ThisRound` counters | 🔜 | The run in progress. Only filled while `RoundActiveBool` is true — all 0 otherwise, so check it first (TTG). Named like `BattleHistory` plus `ThisRound` (`CoinsEarnedThisRound` = `CoinsEarned`). Cooldowns, ability state and seeds aren't exported. A later step: a live view / the run simulator. |

**Removed in 29.1.3:** `BotsLevel`, `BotsUnlocked`, `BotsActive`,
`SynchronicityBots`, `BotsUnlockedPresets`, `BotsLevelPresets`,
`BotsActivePresets` — always 0 since v28 moved bots into presets; the site
never read them.

---

## Currencies

| Field | Status | Notes |
|---|---|---|
| `Coins`, `Gems`, `Stones`, `Medals`, `Cells`, `Keys`, `Tokens`, `Bits` | ✅ | Shown and editable in the currency bar. |
| `ModuleCannonShards`, `ModuleArmorShards`, `ModuleGeneratorShards`, `ModuleCoreShards` | ✅ | Each type's module shards — imported (2026-10-22) and shown on the Modules page, like the row on the game's Modules screen (cannon circle, armor square, generator triangle, core diamond). Owner's export 8,597 / 114,026 / 8,856 / 6,559 against a later screen 510 / 115,500 / 818 / 716, after levelling the cannon, generator and core slots two levels each. |
| `ModuleRerollCurrency`, `ModuleTickets` | ✅ / 📊 | Reroll Shards — imported and shown first in that row (owner: 23,507,946 in the export, 24,065,485 on the later screen). Module tickets not used. |
| `CurrencyEarnedThisCycle`, `CurrencySpentThisCycle` | ❓ | `{ Currencies: { coin, gem, … } }` totals "this cycle". TheTowerSDK calls the cycle fields a legacy event cycle; how long a cycle lasts isn't known. Two owner's exports 4 days apart (2026-10-17 and 10-21): no reset between them; gems, stones, tokens and keys grew exactly as their `Total…Earned` did, while medals, cells, bits and coins grew more than theirs, so the `Total…` counters leave some sources out. Not used yet. |

## Tier progress

| Field | Status | Notes |
|---|---|---|
| `CurrentTier` | 📊 | Tier currently selected. |
| `HighestWaveThisTier[40]` | ✅ | Highest wave per tier; **index = tier number** (index 0 unused). Fills the Tiers tab, highest tier unlocked and highest tier completed. |
| `RoundsStartedThisTier[40]` | ✅ | Runs started per tier (used to find the highest tier played). |
| `HighestCoinsEarnedThisTier[40]`, `HighestCellsEarnedThisTier[40]` | 📊 | Best coins/cells in a run, per tier. |
| `HighestWavePerTierThisCycle[40]` | ❓ | Highest wave per tier "this cycle". |
| `HighestLeague` | ✅ | Highest tournament league reached: 0 Copper, 1 Silver, 2 Gold, 3 Platinum, 4 Champion, 5 Legend, 6 Mythic (confirmed: a Mythic player has 6). Sets the profile league. |

- **Highest tier unlocked** = the highest tier played (wave > 0 or a run
  started), or one past the highest completed tier, up to Tier 24.
- **Highest tier completed** = the highest tier whose best wave unlocks the
  next: wave 100, or wave 300 from Tier 15 (Tiers 16–24 need 300 on the tier
  before — Fandom "Tiers" page). A real account (best waves T1 7,827 … T22 528,
  T23 197) imports as unlocked 23, completed 22.
- Labs, cards and assist slots unlock at "Tier X, Wave Y" milestones; the
  site checks them against the best wave on that tier (`milestoneReached` in
  `engine/statHelpers.ts`), since completing a tier doesn't mean its later
  milestones are reached (e.g. Extra Black Hole needs Tier 5 wave 500).

## Workshop

| Field | Status | Notes |
|---|---|---|
| `UpgradeWorkshopLevel[20]`, `UpgradeWorkshopDefenseLevel[20]`, `UpgradeWorkshopUtilityLevel[20]` | ✅ | Workshop levels of the loaded workshop preset, same order as the site's `WS_STATS` (17/18/13 used of 20). Confirmed on a real account: every maxed stat sits exactly at its max. Read for the loaded preset in case it has unsaved changes. |
| `PresetUpgradeWorkshopLevel[100]` (+ Defense, Utility) | ✅ | 5 workshop presets × 20 stats. Site preset i ← the workshop preset of `GlobalPresets[i]`. |
| `CurrentWorkshopPreset`, `WorkshopPresetName[5]` | ✅ | Loaded workshop preset (used). Any upgrades in workshop presets 3–5 set the profile to 5 presets; any Wall Health sets Wall Unlocked. Preset names: site preset i takes its global preset's name if the player set one, else that preset's workshop name; repeats stay on the default. |
| `UpgradeTierUnlocked[20]` (+ Defense, Utility), `Upgrade…TierEverUnlocked[20]` | ✅ | The workshop groups bought with coins: `[k]` = group k + 1 (`WS_UNLOCK_GROUPS` in constants/gameData — the wiki's unlock order: attack Range+Damage/Meter, Multishot, Rapid Fire, Bounce Shot, Super Critical, Rend Armor; defense Defense %+Absolute, Thorn, Lifesteal, Knockback, Orbs, Shockwave, Land Mines, Death Defy, Wall; utility Cash, Coins, Free Upgrades, Interest, Recovery Packages, Enemy Level Skip). Imported as the profile's `wsUnlocked` (a count per section); the Optimizer offers only open stats (engine/unlocks.ts). **Checked on two accounts (2026-10-26):** the owner's maxed one has 6 / 9 / 6 flags on — every group — and Rend Armor at 299; a new one (Tier 1, best wave 26) has 1 / 1 / 2 and levels only in groups it has (Defense Absolute 2, Coins/Kill 1, Coins/Wave 2). `…EverUnlocked` matched the live flags on both. |
| `UpgradeLevel[20]`, `UpgradeDefenseLevel[20]`, `UpgradeUtilityLevel[20]` | ❓ | Probably the in-run (cash) upgrade levels of the current/last run. |
| `AttackBuyMultiplier`, `DefenseBuyMultiplier`, `UtilityBuyMultiplier`, `WorkshopBuyMultiplier`, `EnhancementBuyMultiplier` | ⚪ | Buy ×1/×10/max settings. |

## Enhancements

| Field | Status | Notes |
|---|---|---|
| `EnhancementLevel[20]`, `EnhancementDefenseLevel[20]`, `EnhancementUtilityLevel[20]` | ✅ | Enhancement levels in the wiki's order — attack: Damage, Rend Armor, Critical Factor, Damage/Meter, Super Crit Mult, Attack Speed; defense: Health, Health Regen, Wall Health, Land Mine Damage, Defense Absolute, Orb Size; utility: same as the site. Remapped by `ENH_GAME_ORDER`. |
| `EnhancementTierUnlocked[20]` (+ Defense, Utility) | ✅ | `[k]` = the game's enhancement k + 1 is bought (the first one is free). |
| `PresetEnhancementLevel[100]` (+ Defense, Utility) | ✅ | Enhancement levels are per workshop preset (5 × 20). Stored per site preset in `enhData.p`. |

## Labs

| Field | Status | Notes |
|---|---|---|
| `ResearchLevel[260]` | ✅ | Level of every lab by the game's lab number (in-game screens show the *next* level, so the file holds one less). Numbers come in blocks; labs added later got numbers further down, so the on-screen order only holds within a block. Mapped in `GAME_LABS` / `GAME_LAB_GROUPS` (constants/gameExportMaps.ts) and confirmed against a real account's in-game screens for every research category. Labs with equal levels were told apart by `ResearchPercentComplete` (a green timer in game = partial progress). Two groups share numbers in an unknown order and import only when all members agree: 132/133/150/151 (Reroll Daily Missions, Workshop Enhancement, Light Speed Shots, Unmerge Module) and 134/193/199 (Common Drop Chance, Garlic Thorns, Battle Condition Reduction). 160–189 are the card mastery labs (see Cards). 242 = Overcharge Enemy Health, 252 = Global Presets. Numbers still unknown (level 0 on that account): ILM Chrono Jump, Enhancement Defense Discount, the battle-condition resistances, Ray/Vampire/Scatter and the other new enemy labs, Cells / Area of Effect mastery labs. |
| `ResearchPercentComplete[260]` | ✅ | How much of the level being researched is done, 0–1, kept when a lab is stopped (38 labs part-done on the owner's export). **Checked 2026-10-31 on the owner's 2026-10-21 export:** on the 4 running labs with a table time, time left at normal speed ÷ (the level's table minutes × (1 − percent)) is 11.9135–11.9137 s a minute on all 4: one lab speed, ×5.0363, against the ×5.0362 the Labs Speed lab and Lab Speed relic give (anchor in upgradeCosts.test.ts). So it's the fraction done, and the table times and lab speed hold; TheTowerSDK reads it the same way (`save/labs/remaining.js`). A stopped lab can only be assumed to work like a running one. Imported as `labProgress`, tied to that level, by lab name: the Optimizer, What If, Lab boosts and Ask AI charge only the time left. Stopping a lab refunds its coins and restarting it buys it again (owner, 2026-10-31), so a stopped level keeps its price and a running one's coins are paid; the Optimizer ranks labs by time, so this only shows in the price. Labs sharing a number (`GAME_LAB_GROUPS`) and mastery labs aren't included. |
| Primary module efficiency labs | 🔜 | One per module type (Cannon, Armor, Generator, Core), unlocked at T23 W500, +1% primary-module efficiency per level (100% → 130%). Added to the site as `Primary-<Type> Mult`; their lab numbers aren't known yet, so the import keeps what the player enters. Probably at the end of `ResearchLevel` once an account has them. |
| `ResearchesComplete`, `TotalCoinsSpentOnResearch` | 📊 | Lifetime lab stats. |
| `LabsUnlocked` | ✅ | Lab slots bought with gems, not counting the free first one: **lab slots = `LabsUnlocked` + 1**. Checked 2026-10-28 on two accounts: the owner's 4 with all 5 `LabActiveBool` running, a newer account's 2 with 3 running (slots 4–5 off); a brand-new account has 0 before its Labs open (T1 W30). Imported as `profile.labSlots` (Labs page → Lab boosts). |
| `LabLevel[5]` | ❓ | All 0 on both accounts. Not used: whether the Labs are open comes from the best wave on Tier 1 (the W30 milestone). |
| `CompletedLabs[]` | 📊 | Research history: `{dateCompleted, labNumber, level}`, one row per lab level finished. Owner's export: 2,132 rows from 2024-10 on, against `ResearchesComplete` 3,076, so older levels aren't kept. All 129 lab numbers in it have names in `GAME_LABS`. Not used yet. |

## Cards

| Field | Status | Notes |
|---|---|---|
| `CardLevel[40]` | ✅ | Star level by the game's card number (`GAME_CARDS`). Confirmed on a real account: its 13 green-star (mastered) cards and 21 equipped cards match `CardMasteryUnlocked` / `CardActive` exactly. The in-game inventory sorts by rarity, then card number. Cells = 37; Area of Effect is one of 35/36/38/39 (unconfirmed). Unowned numbers read 1. |
| `CardCount[40]` | ⚪ | Copies owned toward the next star. |
| `CardUnlocked[40]`, `CardMasteryUnlocked[40]` | ✅ | Owned / mastery unlocked. Mastery level is the card's mastery lab: `ResearchLevel[160 + k]` for the k-th of the original 30 cards in card-number order (Cells' lab isn't in that run). |
| `CardActive[40]` | ✅ | Equipped right now — used for the loaded card preset. |
| `SlotsUnlocked` | ✅ | Card slots **bought with gems** — the Vault's Additional Card Slot (vault id 1200, up to 6) comes on top. Owner's export (2026-10-25): 21 + Vault level 4 = 25, the 25 cards `CardActive` has on. The import's card slots are the sum (max 28: 22 + 6). |
| `SlotPresetCardInt[140]`, `SlotPresetCardAssignedBool[140]` | ✅ | 5 card presets × 28 slots → card number in each slot. Site preset i ← the card preset of `GlobalPresets[i]`. |
| `CurrentPreset`, `PresetName[5]` | ✅ / ⚪ | Loaded card preset (used). Card preset names aren't used — the site's presets are named after the workshop presets. |
| `BattleStartSlotCardInt[140]`, `BattleStartSlotCardAssignedBool[140]` | ❓ | Cards at the start of the current battle? |
| `CardsBoughtTotal` | 📊 | |

## Ultimate Weapons

| Field | Status | Notes |
|---|---|---|
| `UltimateWeaponsSystemUnlocked` | 🔜 | |
| `UltimateWeaponUnlocked[9]` | ✅ | Order CL, SM, DW, CF, ILM, GT, PS, BH, SL (same as the site). |
| `UltimateWeaponLevel[27]` | ✅ | Grouped by UW (CL×3, SM×3, …), stats in the site's order, 0-based (site level = game + 1). Confirmed: CL Quantity, CF Slow/Cooldown, GT Cooldown, BH Cooldown and SL Quantity land exactly on their max. |
| `UltimateWeaponSelectedLevel[27]` | ❓ | The level chosen to use, if lower than owned? |
| `UltimateWeaponPlusUnlocked[9]`, `UltimateWeaponPlusLevel[9]` | ✅ | UW+ owned and level (0-based, same as the site). |
| `UltimateWeaponOn[9]`, `UltimateWeaponPlusOn[9]` | ⚪ | On/off toggles. |
| `UltimateWeaponUnlockedIndex` | ❓ | −1 on the test account. |

## Perks

| Field | Status | Notes |
|---|---|---|
| `BannedPerksIndex[8]` | ✅ / 🔜 | Banned perks by perk number in ban order (−1 = empty slot), mapped by `GAME_PERKS`. 0–14 standard, 20–28 UW, 40–49 trade-off. Confirmed from in-game Ban Perks and Auto Pick screens: 3 = All Coin Bonuses, 5 = Interest, 10 = Perk Wave Requirement, 12 = Max Game Speed, 14 = Defense Absolute; 21 PS, 24 GT, 25 CL, 27 BH, 28 SL; 40, 41, 43, 49. UW and trade-off perks follow the wiki's order at every confirmed number, so the rest of those groups use it. Standard perks don't follow the wiki, so the other standard numbers stay unmapped (bans on those keep what the player entered) until the rest of the Auto Pick list is seen. |
| `FirstPerkIndex`, `FirstTradeOffPerkIndex` | ⚪ | First-perk choices (10 = Perk Wave Requirement, confirmed). |
| `AutoPickPerk`, `AutoPickOrder[34]` | ⚪ | Auto-pick setting and ranking — same order as the in-game Auto Pick list (used to confirm perk numbers). |
| `PerkLevel[50]`, `PerksPickedCount` | ❓ | Perks picked in the current run? |

## Bots

| Field | Status | Notes |
|---|---|---|
| `…BotPresets` (29.1.3+) | ✅ | Bot levels and which bots run, per preset — see [Export format 1](#export-format-1-game-29113). |
| `BotsUnlocked[4]`, `BotsActive[4]`, `BotsLevel[16]` | ⚪ | Old bot system — all empty on a real account that owns Golden Bot and Bot Bot. Removed in 29.1.3. |
| `CurrentBotPreset`, `BotsUnlockedPresets[12]`, `BotsActivePresets[12]`, `BotsLevelPresets[48]` | ⚪ | Old bot presets — empty. The preset lists were removed in 29.1.3. |
| `SynchronicityUnlocked`, `SynchronicityLevel`, `SynchronicityBots[5]` | ❓ | Not Bot+: Synchronicity is its own v29 bot feature — 1,500 stones to unlock, then `SynchronicityLevel` + 2 slots, each holding a bot by its number 0 Flame … 4 Bot Bot (TheTowerSDK `readBotSynchronicityFromSaveRoot`). Not used yet. |

## Modules

Confirmed against 27 real module cards (all the uniques on one account, including 4 primary and 4 assist): every effect, rarity, main ×value and assist-scaled value matches. Tables: `GAME_MODULES`, `GAME_MODULE_RARITY`, `GAME_MODULE_EFFECT_ORDER` (constants/gameExportMaps.ts).

| Field | Status | Notes |
|---|---|---|
| `ModuleInventory[]` | ✅ | Every module not equipped: `{Guid, InfoIndex, CurrentRarity, Level (0 — levels live on slots), MaxLevelReached, Effects[8], EffectLocked[8] (reroll locks), …}`. |
| `InfoIndex` | ✅ | Which module it is — the same number for every player (see *Identifying modules* below). Blocks of 10 per type (cannon 1–10, armor 11–20, generator 21–30, core 31–40): 3–6 are the generic modules (no unique effect — skipped), 7–10 the original uniques, then newer uniques in waves from 41. All 27 uniques seen are named; 49 and 52 haven't appeared yet. |
| `CurrentRarity` | ✅ | 10 = Ancestral (max Lv 200), 11–15 = Ancestral ★1–★5 (max 220–300); below that the wiki's order (2 Rare … 9 Mythic+). |
| `Effects[8]` | ✅ / 🔜 | Effect codes count up from 1 through every (effect, rarity) pair: cannon 1–80, armor 81–154, generator 155–216, core 217–326 — workshop order for cannon/armor/generator, UW order (CL, SM, DW, CF, ILM, GT, PS, BH, SL) for core, one code per rarity the effect can roll. Effects added later are appended: Max Recovery Epic = 328 (327 unconfirmed). Generator 197–204 = Interest/Wave (Epic 197, confirmed) then Recovery Amount. Still unconfirmed: core 297–304 (Poison Swamp Duration / Cooldown). Every slot is pre-rolled (6 for Legendary/Ancestral, 7 at ★1, 8 at ★5); slots 4, 5, 6 and 8 unlock at levels 101, 141, 161 and 241 by `MaxLevelReached`, the rest are always shown. Code 300 shows up only in still-locked slots. |
| `ModuleEquipped[4]` | ✅ | Primary modules: cannon, armor, generator, core. |
| `AssistModuleSlots[4]` | ✅ | Per `Type` (0–3): `Unlocked`, `EquippedModule`, `Level` (assist slot level), `UniqueEffectEfficiencyLevel` (0 Epic … 3 Ancestral), `MainEffectEfficiencyLevel`, `SubstatEfficiencyLevel`. Efficiency % = 1 + stone level + the Assist Module lab (e.g. cannon substats 1 + 7 + 9 = 17%). |
| `SlotLevels[4]` | ✅ | Primary slot levels. A module can't exceed its rarity's max level (Ancestral at a Lv 202 slot shows 200/200). |
| `ModulePresets[5]`, `CurrentModulePreset` | ✅ | `PresetName`, `PrimaryModuleGuids[4]`, `AssistModuleGuids[4]`. Imported as loadouts, the equipped set first (the calculators read loadout 0). |
| `ModuleCannonShardsLifetime` (+ Armor, Generator, Core), `ModuleRerollCurrencyLifetime` | ✅ | Each currency earned in total — spent and saved together (TheTowerSDK's lifetime reader calls the reroll one "Dice Earned"). Imported as `…ShardsLifetime` in the currencies and shown on the Modules page ("Shards earned in total": earned, saved now, spent = earned − saved). Owner's export (2026-10-28): each well above what's held plus `SlotShardsSpent` (Cannon 797,308 earned, 8,948 held, 462,080 on slot levels), as a total of everything earned should be. |
| `SlotShardsSpent[4]`, `SlotCoinsSpent[4]` | 📊 | Shards and coins spent on module slot levels, `[cannon, armor, generator, core]` — checked on the owner's export: Cannon spent 9,800 more than Generator, one level apart (217 vs 216), and level 217 costs 14,000 shards less the Module Shard Cost lab's 30%. Not the whole slot spending: about 40% of what the slot levels cost (perhaps only since v29 moved levels onto slots — assumption). Not used. |
| `TotalGemsSpentOnModules`, `Common/Rare/EpicModulesObtained`, `TotalModulesShattered`, `TotalMergesDone` | 📊 | |

Main effect: ×value = base[rarity] + Σ level gains × (1 + 4% per Ancestral star). Checked: Ancestral armor L200 ×16.24; ★5 cannon L217 ×23.37, generator L216 ×2.476, core L216 ×29.86. Assist main = 1 + (×value at the assist level − 1) × Mult Efficiency.

### Identifying modules

- **InfoIndex** says *which* module it is. It's the same number for every player, so it's what the import maps (`GAME_MODULES`).
- **Guid** identifies one particular copy. It's random and different for every player; it's only used to link presets and equipped slots to that copy.

**How each one was identified:** a module card lists its effects top to bottom in slot order, and that matches the decoded `Effects[]` codes slot by slot. With 6–8 effects per card (rarity and effect each), a match is unambiguous. The effect-code range also gives the type, and the card's unique-effect text matches the wiki's value for that rarity.

| InfoIndex | Module | Type | Guid on the tested account |
|---|---|---|---|
| 7 | Havoc Bringer | Cannon | 7fea6381-a855-4838-b927-d4e08c036d07 |
| 8 | Death Penalty | Cannon | 4315591e-d9cc-4964-98c6-04fbed42ddfb |
| 9 | Being Annihilator | Cannon | 1ca25429-7951-49a6-8ec0-90d530996c31 (assist) |
| 10 | Astral Deliverance | Cannon | 3b7bedd1-91f3-45c8-85f3-e7f9b7a9fe5c |
| 41 | Shrink Ray | Cannon | a6acf5d1-b9ee-4866-84ed-ce1a5839e18c |
| 45 | Amplifying Strike | Cannon | 9b1e4822-beef-4711-96ba-2c39f58541b3 (primary) |
| 51 | Gilded Sniper | Cannon | b07331e5-7c1b-4537-bae6-dea1d0b3d766 |
| 17 | Wormhole Redirector | Armor | 03bdb4fd-51c9-4edf-be40-df4cf1948478 |
| 18 | Negative Mass Projector | Armor | 28841fd9-99a3-4202-abf5-05d11cfbc93c |
| 19 | Space Displacer | Armor | 36bcb245-846a-4ad0-90e6-8a437427dce8 (assist) |
| 20 | Anti-Cube Portal | Armor | 7aa42217-4300-4861-be25-2c7cbc026d0a |
| 42 | Sharp Fortitude | Armor | 64828fe9-a734-4b7d-8492-3512f601493a |
| 46 | Orbital Augment | Armor | 9ec9f0fd-c9b4-4b20-b65b-6fc7a10531ca |
| 50 | Sentry Protocol | Armor | 6e2f3f67-e04a-40ee-9fc3-0b4d3d71b964 (primary) |
| 27 | Black Hole Digestor | Generator | a0f73479-9719-4b97-b747-a13fa74ae358 (primary) |
| 28 | Pulsar Harvester | Generator | 054bd74f-0e94-49b8-818d-2bff97eeed7c |
| 29 | Galaxy Compressor | Generator | d3763816-c739-4d3c-9274-6260ffe985d5 (assist) |
| 30 | Singularity Harness | Generator | 4d5fe55d-6c71-4f28-9600-b3f35ce2510b |
| 43 | Project Funding | Generator | 43616067-2134-4242-a717-2a11a5deffe8 |
| 47 | Restorative Bonus | Generator | 34238dcd-14dd-4422-b60d-ea0d40d97887 |
| 53 | Infinity Threshold | Generator | 89a7269b-61b6-4be4-988d-345ad885112a |
| 37 | Multiverse Nexus | Core | d8e2551f-c525-4c29-be13-4586c7b4a827 (primary) |
| 38 | Dimension Core | Core | d2c54b27-2d09-444f-9a9e-a192fc76f299 (assist); second copy a445eb18-381d-4ce2-9cd8-03bb8ba1ca04 |
| 39 | Harmony Conductor | Core | 4a9e1943-22ca-42de-9b22-c5eddf400581 |
| 40 | Om Chip | Core | 2c6f2efb-808d-4125-b308-9c0cda21b87f |
| 44 | Magnetic Hook | Core | ef30a03d-e6ea-4b0c-bc40-64ac2b0c3d84 |
| 48 | Primordial Collapse | Core | 18b3f2e6-ab0a-4ed2-b81e-56458c544b87 |

Infinity Threshold is newer than the wiki's module pages; its Legendary value (2000 levels) comes from the card, other rarities unknown.


## Relics

| Field | Status | Notes |
|---|---|---|
| `RelicsUnlocked[336]` | ✅ | **Imported (2026-10-22).** Each slot's relic and bonus from TheTowerSDK's save-index catalog (`RELIC_IMPORT_CATALOG`, 0.12.0 → `constants/relicCatalog.ts`, `npm run relic-catalog`): 321 relics, slots 0–320, each with the game's benefit type (0 Damage … 26 Bot Range, mapped to the Relics keys in the script). Checked on the owner's account: the 307 owned add up to the in-game ⓘ totals below for all 27 bonuses — Defense % 6, Cash 34 and Bot Range 12 m now, the noted 5 / 29 / 10 m plus the three newest relics (slot 318 Massive Abduction Cash 5%, 319 Genetic Modification Defense % 1%, 320 Alien Encounter Bot Range 2 m), owned since the totals were noted. Import replaces the Relics totals; owned slots the catalog doesn't know are counted and the message says so. Earlier notes: One entry per relic slot: 2 = owned, 0 = not (304 of the first 318 owned on a real account; 318–335 are empty). The slots are NOT in the wiki's numbered order — that account can't own T:XX, T:XXI or the 4th–6th birthday relics, yet the matching wiki positions are owned. The in-game relic grid (owned only, grouped by rarity) runs No Spoon, the T:I–T:V / Copper / Silver relics, birthdays 1–3, then events in the wiki's order, so the game numbers relics roughly in release order. Not owned on that account: 74, 80–82, 92–93, 188–189, 300–302, 305–306, 308. Validation target for any slot mapping — that account's in-game totals (Relics → ⓘ): Damage 124, Attack Speed 18, Crit Chance 16, Crit Factor 118, Damage/Meter 86, Super Crit Chance 6, Super Crit Factor 5, Rend Armor 2, Health 112, Health Regen 39, Defense % 5, Defense Absolute 76, Thorns 14, Knockback 33, Orb Speed 31, Wall Rebuild −2s, Cash 29, Coins 87, Free Attack 16, Free Defense 12, Free Utility 10, Recovery Amount 22, Enemy Attack Skip 2, Enemy Health Skip 2, Ultimate Damage 42, Lab Speed 69, Bot Range 10m. Some exceed the wiki's all-relic totals, so the wiki is missing newer relics. Until a slot table exists, players copy the ⓘ totals into the Relics tab. |
| `ProfileRelics[5]` | ⚪ | Relic slot numbers shown on the profile (4, 29, 85, 5, 1 on that account) — useful anchors for the relic order. |

## Vault, tech trees, guardian, dissonance

| Field | Status | Notes |
|---|---|---|
| `Vault` | ✅ | `UpgradesLevel` (vault id → level, a JSON object), `UnlockedGroups` (the sections unlocked), `HasViewedVault`, respec info. Imported as `vaultLevels` (levels by id, plus `g<group>` = 1 for each unlocked section) and shown on Upgrades → Vault (`constants/vaultData.ts`). IDs and groups from TheTowerSDK's v29 vault data (`data/generated/vault-v29.generated.js`, `save/vault/v29-progress.js`): Harmony 1000–2205, Power 1–680, Enemy 3000–6220 (enemy base + 0/10/20 for its three stats); groups 100–160 Harmony (Gameplay, Cards, UWs, Modules, Bots, Workshop, Guardian), 1000–1030 Power, 2000–2030 Enemy. Names, effects and key costs from the wiki's The_Vault page; the SDK's costs agree except Death Defy (SDK 20/40/80/140/220, wiki 10/20/40/70/110 — the SDK's is used, unconfirmed). **Checked on the owner's export (2026-10-25):** its 20 upgrade levels and 9 groups (100, 110–160, 1030, 2000) at these costs add up to `TotalKeysSpent` 810 exactly (`Keys` 5, `TotalKeysEarned` 815) — the costs of everything owned, the section unlock costs and the group numbers all hold (anchor in `engine/vault.test.ts`). **1810 = Bot Range**: the owner's 4 gives the 8 m between Range Lv 20 + relics (72 m) and the Bots screen's 80 m, so 2 m a level. **1200 = Additional Card Slot** (above). Wiki and SDK name two Enemy stats differently (Protector Mass / Radius, Ranged Range / Ranged Distance); the SDK's Radius is used for Protector. |
| `PowerNodesUnlocked[46]`, `PowerNodesLevel[46]`, `PowerNodesMaxLevel[46]`, `HarmonyNodesUnlocked[48]` | ⚪ | The Vault before v29's rework; TheTowerSDK notes they stay in the save but are empty since — the Vault is `Vault` above. |
| `GuardianUnlocked`, `GuardianChipUnlocked[10]`, `GuardianSlotsUnlocked`, `GuardianChipSlot[3]`, `GuardianChipLevel[30]`, `GuardianPresets[5]` (`PresetName`, `SlotsUnlocked`, `ChipSlot`, `ChipLevel`), `CurrentGuardianPreset`, `GuardianSkinUnlocked[25]`, `GlobalPresets[i].GuardiansIndex` | ✅ | The Guardian (Gear → Guardian, `parseGuardian`). Chips by save index from the game's asset table (TheTowerSDK `GUARDIANS_ASSET_TABLE`): 0 Bounty, 1 Catch, 2 Attack, 3 Scare, 4 Rush, 5 Ally, 6 Fetch, 7 Summon, 8 Scout (Catch, Scare, Rush unreleased); 3 levels per chip in the table's stat order (Ally: Recovery Amount, Max Recovery, Cooldown). `SlotsUnlocked` = slots bought beyond the first. **Checked on the owner's account (2026-10-19):** the unlocked chips are exactly the six released ones; every chip's levels fit only its own maximums, and two presets sit exactly at a chip's maxes (Scout 70/40/30, Ally 49/89/90); site presets 1–3 point at Guardian presets 0, 1, 3. The live fields equal the current preset's. |
| `GlobalPresets[6]`, `CurrentGlobalPreset` | ✅ / ❓ | Each global preset points at a workshop, card, bot, module and guardian preset; site preset i follows global preset i. `ModulesIndex` (read since 2026-10-31, `moduleState.loadoutFor`): on the owner's export it's 0, 1, 2 for the first three presets, and module preset "farm" sits with workshop preset "GC Farm". Rows all on one module preset don't tell presets apart, so what's equipped stays and modules don't follow the preset; a row on an empty module preset keeps what's equipped too. Equipping another loadout on the Modules page changes the active preset's link. `CurrentGlobalPreset` can be stale (0 on a real account whose loaded workshop/card presets match global preset 1), so it isn't used. |
| `DissonanceDamageBoost[25]`, `DissonanceHealthBoost[25]`, `DissonanceCoinBoost[25]`, `DissonanceUltDamageBoost[25]` | ✅ | The best Dissonant Run wave per tier on one track, indexed by tier number: Attack, Defense, Utility, UW; 0 = no run ("—" on the panel). Imported as `dissonanceWaves`, shown and editable on Tiers (`engine/dissonance.ts`, anchors in dissonance.test.ts). Boost = 1 + (top − 1) × (min(wave, 5000) ÷ 5000)^1.75, top ×5 (Utility ×3); Echo = (top − 1) × Echo % × the same share summed over every other tier; Total = Boost + Echo; Echo % = (lab level + 1) × 0.5%. The labs: 238 Utility, 239 Attack, 240 Defense, 241 UW. Formula from TheTowerSDK (`mechanics/effective-paths/ehp-model.js`), the Boost and tops also on the wiki's Dissonance page. **Checked on the owner's Dissonant Boosts panel (screens of 2026-10-31, all three views, T13–T17) against their export of 2026-11-01:** all 20 waves and all 59 boost cells match to 2 decimals (an export from 10 days earlier missed 18, on tiers above T17 that had moved since). **In tournaments only Echo counts**, not a tier's own boost (owner, 2026-11-01): 1 + Echo over every tier; that this includes the tier the tournament reports (23 on the owner's Mythic runs) is the code's reading. **The screens don't show** which stat each boost multiplies (tower damage, UW damage, kill coins, health: the SDK and TTG's v28 notes). |
| `DissonanceActive`, `DissonanceSelected` | ❓ | False and 3 on both owner's exports: probably a Dissonant Run in progress and the track last picked. Not used. |
| `EnemyAttackLevelSkips`, `EnemyHealthLevelSkips` | ❓ | Totals or current-run counts? |

## Profile, cosmetics, settings, milestones

| Field | Status | Notes |
|---|---|---|
| `UserName` | ✅ | Fills the player name. |
| `AvatarId`, `SelectedTower`, `SelectedBackground`, `SelectedProfileBanner`, `SelectedMenu`, `TowerUnlocked[100]`, `BackgroundUnlocked[100]`, `TotalSkinsBought` | ⚪ | Cosmetics. (Do owned skins add the coin "skin bonus"? ❓) |
| `TargetPriority`, `TargetPriorityList[10]`, `LifeSavingOrder[6]` | ⚪ | Settings. |
| `MilestonesPremiumUnlocked[8]`, `MilestonesRewardClaimed[575]`, `MilestonesRewardPremiumClaimed[575]` | ⚪ | Milestone rewards. |

## Lifetime stats 📊

`TotalDamageDealt`, `TotalEnemiesDestroyed`, `TotalCashEarned`, `TotalCoinsEarned` (+ `FromAdBonus`, `FromKills`, `FromWaves`, `FromMine`), `TotalGemsEarned`, `TotalGemsBought`, `TotalStonesEarned/Spent/Bought`, `TotalWavesCompleted`, `TotalUpgradesBought`, `TotalWorkshopUpgradesBought`, `TotalCoinsSpentWorkshop`, `TotalCashEarnedFromInterest`, `TotalCoinsSpent(Attack/Defense/Utility)Enhancements`, `TotalFree(Attack/Defense/Utility)Upgrades`, `TotalEnemiesDestroyedBy…` (orbs, death ray, thorns, land mines, projectiles, CL, SM, ILM, PS, BH, flame bot, death penalty, other), `TotalEnemiesDestroyed(Normal/Fast/Tank/Ranged/Boss/Protector)`, `TotalDamageBy…` (thorns, SM, land mines, DW, CL, swamp, BH, bot, guardian), `TotalDroppedLandMinesSpawned`, `TotalDeathDefyCount`, `TotalLifestealAbsorbed`, `TotalWavesSkipped`, `BlackHoleCoins`, `SpotlightCoins`, `TotalStunsByBot`, `TotalCoinsByBot`, `TotalCoinsByGuardian`, `TotalCatchesByGuardian`, `TotalMedals/Cells/Keys/Tokens/BitsEarned/Spent`.

`WrappedStats[]` — the yearly recap (tournaments, per-UW totals, deaths/kills by enemy type, battles, waves, missions, cards pulled).

## Battle history ✅

`BattleHistory` — the last runs, oldest first (5 before 29.1.3; 30 in the owner's 29.1.3 export), ~150 fields each (the same numbers as the in-game Battle Report). Times are in **seconds**. The optimizer can calibrate Farming and eHP from any of them instead of a pasted report (the newest non-tournament run is picked by default). Since 2026-10-17 the site **keeps runs across imports** (`mergeBattles` in engine/battleReport.ts; the newest 100) and stores every plain field of each run in `raw`, for the planned run simulator ([run-simulation.md](run-simulation.md)).

| Used field | For |
|---|---|
| `BattleDate`, `Tier`, `Wave`, `GameTime`, `RealTime`, `IsTournament` | Run summary, coins/hour, wave length |
| `CoinsEarned`, `CoinsEarnedWaveSkip`, `CoinsEarnedCPW`, `CoinsFromGoldenTowerPlus` (Golden Combo), `CoinsFromCritCoin`, `GuardianCoinsFetched` | Farming calibration |
| `TotalEnemies`, `DestroyedInGoldenTower`, `TaggedByDeathwave`, `DestroyedInSpotlight`, `DestroyedInGoldenBot`, `DestroyedInBlackhole`, `DestroyedInOrbs` | Share of kills each coin effect covers |
| `WavesSkipped`, `LargestGoldenCombo`, `RecoveryPackages`, `DestroyedByThorns` | Farming + eHP calibration |

Everything else in a battle (damage by source, damage taken/blocked, healing by source, enemy counts, guardian drops, per-source coins) is 📊 for now. `KilledBy` is the enemy type that ended the run (owner). TheTowerSDK's save order: 0 Basic, 1 Fast, 2 Tank, 3 Boss, 4 Ranged, 5 Protector, 6 Vampire, 7 Scatter, 8 Scatter split, 9 Ray, 10 Saboteur, 11 Commander, 12 Overcharge; −1/99/255 = no killer (the player ended the run — the in-game report shows Killed By blank). Owner's battle reports showed Ray (W8100), Tank (W8200), Vampire (W8500), Overcharge (W8501) and a blank (W5125); the Run Length page shows the decoded name next to each run — ❓ until it matches those. `DissonanceType` ❓: 0 on all 30 of the owner's runs, none of them Dissonant (the wave tables didn't move between the 10-17 and 10-21 exports), so its other values need a real Dissonant Run. `isDissonantRun` takes anything above 0 as one (the code's assumption) and leaves it out of calibration and run length: they play with a workshop tab off.

---

## What the site doesn't use yet (audit 2026-10-31)

Traced on the owner's 29.1.3 export by recording every field `parseGameExport` reads: **92 of the 437 top-level fields**. The rest: 135 `…ThisRound` (the run in progress), 76 lifetime `Total…`, and 134 others (settings, cosmetics, Dissonance, lab history…). Of a run's 148 `BattleHistory` fields about 55 are read by nothing; all are saved in `raw`, so using them needs no new import.

**Would make current answers more correct** (Dissonance, lab progress and `ModulesIndex` were first on this list, and are done; a Dissonant Run in an export would still confirm `DissonanceType`):

| Fields | What they'd fix | Still needed |
|---|---|---|
| `TournamentPreset`, `TierPreset`, `DissonantPreset` | Could pick the tournament build by itself | All 5 on both accounts: set one in game and export again |
| `CoinsFrom{DeathWave,GoldenTower,BlackHole,Spotlight,Orbs,CoinUpgrade,CoinBonuses}`, `GoldenBotCoinsEarned` | The game's own coins by source, to check or calibrate farming.ts. They overlap (over 100% in sum), so each looks like what that bonus added | What each one counts |
| `DefensePercentBlocked`, `DefenseAbsoluteBlocked`, `ChronoFieldBlocked` | Anchors for the eHP layers (ehp.ts reads only the later layers) | A comparison with the model |
| `EnemiesHitBy…` (Smart Missiles, Inner Land Mines, Black Hole, Chrono Field), `ThunderBotStuns` | UW hits from the run, as Chain Lightning and Poison Swamp already do; a start on the Thunder Bot gap | A comparison with the model |
| `UltimateWeaponSelectedLevel`, `UltimateWeaponOn`, `UltimateWeaponPlusOn`, `RangeLevelSelected`, `ShockwaveSizeLevelSelected`, `SwampRangeLevelSelected`, `DamageAdjustmentLog` | What's really in use when a player turned something down or off | UW values equal the owned levels on the owner's export: an account that turned one down |

**Would be new for players:** a live run view (`RoundActiveBool`, `…ThisRound`, `CurrentWave`, `PerksPicked`, with Auto import); real income per currency from one import to the next (`Currency…ThisCycle`, `Total…Earned`); career stats and a yearly recap (`Total…`, `PlayTime`, `GameStartedDate`, `WrappedStats`: 65 fields a year, deaths and kills by enemy type, tournaments, missions); research history (`CompletedLabs`); best coins and cells per tier (`HighestCoinsEarnedThisTier`, `HighestCellsEarnedThisTier`); kills by source and per-run records (`DestroyedBy…`, `HighestCPM`, `LargestWaveSkip`, `Most…`); in-run economy (`InterestEarned`, `FreeAttackUpgrades` and the other two, `CashFromGoldenTower`); module extras (`EffectLocked`, `RerollCounter`, `…SubstatBans`, `…AutoRerollSubstats`, `ModulePity`, `ModuleRarePity`, `ShardsSpent`); card copies toward the next star (`CardCount`); Synchronicity (`SynchronicityUnlocked`, `SynchronicityLevel`, `SynchronicityPresets`).

**Perks:** `AutoPickOrder` and `FirstPerkIndex` aren't read, and 12 standard perk numbers have no site perk (0, 1, 2, 4, 6–13). One Auto Pick screenshot would name them all, since `AutoPickOrder` holds the same list.

**No use to the site:** skins, backgrounds, menus, tracks, avatar, buy multipliers, pack flags, milestone rewards, the empty `PowerNodes…` / `HarmonyNodes…`, `BattleStartSlot…`.

## Open questions for the player

1. What is a "cycle" (`…ThisCycle` fields)?
2. ~~`HighestLeague`~~ — answered: 0 Copper … 6 Mythic.
3. ~~Bots~~ — added in 29.1.3 (`…BotPresets`); a real export imports cleanly (2026-10-21). Still to check against the game's screens: bot levels per preset and what `TierPreset` / `TournamentPreset` / `DissonantPreset` point at. (Lab timers, lab 169, Range / Rend Armor and tournament ranks: answered 2026-10-21, above.)
4. ~~`RelicsUnlocked`~~ — answered: TheTowerSDK's save-index catalog, checked against the in-game totals (2026-10-22).
5. ~~`Vault.UpgradesLevel` IDs~~ — answered: TheTowerSDK's v29 list, checked against the owner's TotalKeysSpent (2026-10-25). The old Power/Harmony node arrays are empty since v29.
6. `KilledBy` numbers — enemy type (owner); SDK order above, confirm with one known death.
7. `UltimateWeaponSelectedLevel`, `UpgradeTierUnlocked`, `UpgradeLevel` arrays, `PerkLevel`, `LabLevel[5]` — confirm what they hold.
8. Remaining lab numbers (see Labs), Area of Effect's card number, module `InfoIndex`/effect codes and relic numbers.
