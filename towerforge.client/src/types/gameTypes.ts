// ============================================================
//  TowerForge Companion — Game Type Definitions
//  All interfaces and types used across state, engine, and UI.
//  No logic lives here — pure type contracts only.
// ============================================================

import type { BattleReport } from '../engine/battleReport';
import type { Career, IncomePoint } from '../engine/career';

// ── Currencies ────────────────────────────────────────────────
export interface Currencies {
    coins: number;
    gems: number;
    stones: number;
    medals: number;
    cells: number;
    keys: number;
    tokens: number;
    bits: number;
    // Module currencies, shown on the Modules page like the game's
    // (ModuleRerollCurrency, Module<Type>Shards). Absent in older saves.
    rerollShards?: number;
    cannonShards?: number;
    armorShards?: number;
    generatorShards?: number;
    coreShards?: number;
    // Each one earned in total, spent and saved together (the export's
    // Module…Lifetime). Absent in older saves and for hand-entered accounts.
    rerollShardsLifetime?: number;
    cannonShardsLifetime?: number;
    armorShardsLifetime?: number;
    generatorShardsLifetime?: number;
    coreShardsLifetime?: number;
}

// ── Build Types ───────────────────────────────────────────────
export type BuildType = 'Glass Cannon' | 'eHP' | 'Hybrid' | 'Farming';
export type League = 'Copper' | 'Silver' | 'Gold' | 'Platinum' | 'Champion' | 'Legend' | 'Mythic' | '';
export type UWAbbr = 'CL' | 'SM' | 'DW' | 'CF' | 'ILM' | 'GT' | 'PS' | 'BH' | 'SL';
export type TabName =
    | 'profile' | 'perks' | 'tiers' | 'workshop'
    | 'labs' | 'cards' | 'uw' | 'puws' | 'relics'
    | 'bots' | 'modules' | 'guardian' | 'optimizer' | 'enemies' | 'runcoins' | 'runlength' | 'whatif' | 'tournament' | 'creators' | 'share' | 'account'
    | 'ai' | 'tourneyhistory' | 'importguide' | 'vault' | 'career';

// ── Workshop Types ────────────────────────────────────────────
export type WSCategory = 'attack' | 'defense' | 'utility';

export interface WSPreset {
    attack: number[];
    defense: number[];
    utility: number[];
}

export interface EnhCategoryData {
    [category: string]: number[];   // level per enhancement index
}

export interface EnhOwnedData {
    [category: string]: boolean[];  // owned flag per enhancement index
}

export interface EnhData {
    d: EnhCategoryData;  // levels (shared by presets without their own entry in p)
    u: EnhOwnedData;     // owned flags (account-wide)
    // Per-preset levels — the game keeps enhancement levels per workshop
    // preset. Present once a game export has been imported; read through
    // enhForPreset() rather than using d directly.
    p?: { [presetIdx: number]: EnhCategoryData };
}

// ── Profile ───────────────────────────────────────────────────
export interface Profile {
    name: string;
    league: League;
    build: BuildType | '';
    presets: 2 | 5;
    wall: boolean;
    highestTier: number;
    completedTier: number;
    currentLeague?: League;   // league you're in now (the file's LeagueID, 29.1.3+); `league` is the highest reached
    excludedUWs?: string[];   // UW abbrs the optimizer should not suggest upgrades for
    excludedWorkshop?: string[];   // workshop stats it should not suggest ("attack|Range" — kept low on purpose)
    presetNames?: string[];   // custom preset names (from the game import or typed in); blank = default
    // Workshop groups bought, per section (the export's Upgrade…TierUnlocked;
    // constants/gameData WS_UNLOCK_GROUPS). Absent = not known: everything open.
    wsUnlocked?: WsUnlocked;
    // Lab boosts (Labs tab): lab slots owned (the export's LabsUnlocked + 1),
    // and what the player typed over the cells an hour and hours a day in a
    // run read from their runs. Absent = from the runs / the import.
    labSlots?: number;
    cellsPerHour?: number;
    runHoursPerDay?: number;
}

export interface WsUnlocked {
    attack: number;
    defense: number;
    utility: number;
}

// ── Perks ─────────────────────────────────────────────────────
export interface PerkData {
    banned: string[];   // array of banned perk IDs
}

// ── Tiers ─────────────────────────────────────────────────────
export interface TierWaves {
    [tier: number]: number;   // tier number → highest wave reached
}

// ── Labs ──────────────────────────────────────────────────────
export interface LabData {
    [labName: string]: number;   // lab name → current level
}

// ── Cards ─────────────────────────────────────────────────────
export interface CardEntry {
    s: number;    // star level (0–7)
    m: number;    // in-game mastery level 0–9 (only applies when mu = true; value = CARD_MASTERY_VALS[name][m])
    mu?: boolean; // mastery unlocked — false/undefined = no mastery bonus (×1)
}

export interface CardData {
    data: { [cardName: string]: CardEntry };
    slots: number;                           // total active card slots (1–28)
    presets: { [presetIdx: number]: string[] }; // preset index → active card names
}

// ── Ultimate Weapons ──────────────────────────────────────────
export interface UWStat {
    own: boolean;
    sv: [number, number, number];  // stat values [stat0, stat1, stat2]
    upOwn: boolean;
    upLvl: number;
}

export interface UWData {
    data: { [abbr in UWAbbr]?: UWStat };
    stones: number;
}

// ── Relics ────────────────────────────────────────────────────
export interface RelicData {
    [relicKey: string]: number;
}

// ── Bots ──────────────────────────────────────────────────────
export interface BotLevels {
    medals: number[];   // medal upgrade levels per stat (0 = Lv 0 base)
    plusLv: number;     // Bot+ ability level (0 = the unlock value), when Bot+ is unlocked
    // Bots and Bot+ unlock per preset in game (each bot preset row's Unlocked /
    // PlusUnlocked). Absent: the bot's account-wide flags (older saves).
    owned?: boolean;
    plusOwned?: boolean;
}

export interface BotEntry extends BotLevels {
    owned?: boolean;    // bot unlocked (account-wide) — when owned, every stat sits at least at Lv 0
    plusOwned?: boolean; // Bot+ unlocked (account-wide); older saves: any plusLv > 0
    // In game each bot preset keeps its own medal and Bot+ levels. A preset
    // that was never edited uses medals / plusLv above.
    presets?: { [presetIdx: number]: BotLevels };
}

export interface BotData {
    [botName: string]: BotEntry;
}

// Which bots are active in each preset — same shape as CardData.presets.
// A preset with no entry has never been edited and means "all owned bots".
export interface BotLoadouts {
    [presetIdx: number]: string[];
}

// ── Modules ───────────────────────────────────────────────────
export type ModuleType = 'cannon' | 'armor' | 'generator' | 'core';
export type ModuleRarity =
    | 'C' | 'R' | 'Rp'
    | 'E' | 'Ep'
    | 'L' | 'Lp'
    | 'M' | 'Mp'
    | 'A' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5';

export interface SubSlot {
    effect: string;
    rar: string;
    val: string;
}

export interface ModuleEntry {
    id: string;
    name: string;
    type: ModuleType;
    rarity: ModuleRarity;
    subs: SubSlot[];
    // Main-effect ×value read straight off the module card (cannon = Tower
    // Damage, core = Ultimate Weapon Damage). 0/undefined = not entered.
    // NOTE: level lives on the loadout SLOT (slotLevels), not the module —
    // levels stay with the slot when you swap modules in/out.
    mainMult?: number;
}

export interface LoadoutSlots {
    cannon: { main: string; assist: string };
    armor: { main: string; assist: string };
    generator: { main: string; assist: string };
    core: { main: string; assist: string };
}

export interface Loadout {
    id: string;
    name: string;
    slots: LoadoutSlots;
}

export type AssistType = 'cannon' | 'armor' | 'generator' | 'core';

export interface AssistEntry {
    rarity: 'locked' | 'Epic' | 'Legendary' | 'Mythic' | 'Ancestral';
    multEff: number;   // assist multiplier effect %, 0-130
    subEff: number;    // assist substat effect %, 0-100
}

export interface AssistData {
    [type: string]: AssistEntry;
}

// Account-wide module slot levels. Level belongs to the slot position
// (cannon/armor/generator/core × main/assist), shared across all loadouts —
// not to the individual module, since levels transfer when modules are swapped.
export interface SlotPositionLevels {
    main: number;
    assist: number;
}
export type SlotLevels = Record<ModuleType, SlotPositionLevels>;

export interface ModuleState {
    library: ModuleEntry[];
    loadouts: Loadout[];
    activeLoadout?: string;   // id of the equipped loadout (the one the calculators use); default = first
    // Site preset → the loadout it uses, from the game's Global Presets. Absent
    // = one equipped loadout whatever the preset (entered by hand, or the game's
    // presets don't tell modules apart).
    loadoutFor?: string[];
    assistData: AssistData;
    slotLevels: SlotLevels;
}

// ── Engine — Module Bonuses ───────────────────────────────────
export interface UWBonus {
    dur?: number;
    cd?: number;
    slow?: number;
    dmg?: number;
    qty?: number;
    bonus?: number;
    angle?: number;
    size?: number;
    dmgm?: number;
    chance?: number;
}

export type UniqueTier = 'Epic' | 'Legendary' | 'Mythic' | 'Ancestral';

// One equipped module's unique effect at the tier it runs at: a primary
// module at its own rarity, an assist at the slot's unlocked tier.
export interface ActiveUnique {
    name: string;
    type: ModuleType;
    slot: 'main' | 'assist';
    tier: UniqueTier;
    value: number;
}

// How often things happen in the player's runs (from the Battle Report),
// for effects that depend on it. Defaults stand in without a report.
export interface RunRates {
    source: 'report' | 'default';
    waveSec: number;            // game seconds per wave
    killsPerSec: number;        // every enemy killed
    bossFleetPerSec: number;    // bosses + fleet enemies (Commander / Saboteur / Overcharge)
    elitePerSec: number;        // Vampire / Ray / Scatter
    packagesPerSec: number;     // recovery packages
    pkgChanceAtRun: number;     // package chance % behind packagesPerSec (0 = unknown)
    cashDigits: number;         // log10 of cash during the run
    clHitsPerEnemy: number;     // Chain Lightning hits per enemy
    poisonedShare: number;      // share of enemies hit by Poison Swamp
    bhShare: number;            // share of kills inside a Black Hole
    orbHitsPerEnemy: number;    // orb hits per enemy
}

export interface ModBonuses {
    uwBonus: { [abbr in UWAbbr]?: UWBonus };
    stUWMult: number;
    perks: PerkBonuses;
    uniques: Record<string, number>;   // unique module → its value at the tier it runs at
    activeUniques: ActiveUnique[];
    subs: Record<string, number>;      // sub-effect → total over equipped modules (assist at
                                       // substat efficiency), in the card's units (10 = +10%)
    run: RunRates;
}

// ── Engine — Perk Bonuses ─────────────────────────────────────
export interface PerkBonuses {
    totalDmgMult: number;
    atkSpdMult: number;
    clDmgMult: number;
    slBonusMult: number;
    dwExtraWave: number;
    smExtraQty: number;
    bhExtraDur: number;
    cfExtraDur: number;
    ilmExtraQty: number;
    gtBonusMult: number;
    psRadMult: number;
    enemySpdMult: number;
    toDmgMult: number;
}

// ── Engine — Card Mastery Bonuses ─────────────────────────────
export interface CardMasteryBonuses {
    dmgMastMult: number;
    atkMastMult: number;
    critMastAdd: number;
    stMastCDRedux: number;
    rangeMastMult: number;
    slowMastMult: number;
}

// ── Engine — TTT Data ─────────────────────────────────────────
export interface TTTData {
    ttt: number;
    range: number;
    cappedSlow: number;
    cfPathMult: number;
    cfUptime: number;
}

// ── Optimizer ─────────────────────────────────────────────────
// 'stones' is a panel-only pseudo-category — it represents the merged
// UW/UW+/Mastery/Assist stone path. Individual OptCandidate.category
// values stay as 'uw'/'uwp'/'mast'/'assist' for badge display.
export type OptCategory =
    | 'uw' | 'uwp' | 'mast' | 'assist' | 'botplus' | 'stones'
    | 'workshop' | 'labs' | 'cards' | 'enhancements' | 'bots' | 'modules' | 'guardian';

// What a cost is paid in.
export type OptCurrency = 'stones' | 'coins' | 'research' | 'medals' | 'shards' | 'gems' | 'bits';

export interface OptCandidate {
    category: OptCategory;
    label: string;
    subLabel: string;
    fromLv: number;
    toLv: number;
    cost: number;
    costType: OptCurrency;
    costKnown?: boolean;   // false/omitted for coin/research rows where `cost` is only a level proxy
    scorePct: number;   // eDPS delta %
    scorePerCost: number;   // eDPS delta % per stone/coin
    // Labs: coins and hours of research for the level(s), after the player's
    // discount and lab speed (when the lab catalog has them).
    coins?: number;
    hours?: number;
    // Glass Cannon waves mode: Enemy Health Level Skip points the step adds
    // (counted in scorePct as the damage they're worth).
    skipPoints?: number;
    // "Coins and push" goal: the step's gain in coins per hour and in the
    // push score (flat damage for Glass Cannon, survival otherwise), in %.
    coinsPct?: number;
    pushPct?: number;
    // Which bot stat, module slot, card or Event Shop trade the row is.
    ref?: string[];
    alts?: OptAlt[];
}

export interface OptAlt {
    label: string;
    cost: number;
    scorePct: number;
}

// ── Full App State (root shape for the store) ─────────────────
export interface AppState {
    activeTab: TabName;
    activePreset: number;   // 0–4

    profile: Profile;
    perkData: PerkData;
    tierWaves: TierWaves;
    wsData: WSPreset[];  // wsData[presetIdx]
    enhData: EnhData;
    labData: LabData;
    cardData: CardData;
    uwData: UWData;
    relicData: RelicData;
    botData: BotData;
    botLoadouts: BotLoadouts;
    moduleState: ModuleState;
    battleReportText: string;   // last pasted in-game Battle Report (Farming calibration)
    currencies: Currencies;
    importedBattles: BattleReport[];   // BattleHistory from the last game data import
    battleReportChoice: number;        // which report calibrates the optimizer: -1 = pasted, else importedBattles index
    guardianData: GuardianData;
    labsRunning: LabRunning[];    // labs being researched at the last import (29.1.3+ exports)
    labProgress: LabProgress;     // labs whose next level is under way or part done, at the last import
    dissonanceWaves: DissonanceWaves;   // best Dissonant Run wave per tier on each track
    career: Career | null;        // lifetime totals, yearly recap, per-tier bests, research history, at the last import
    incomeLog: IncomePoint[];     // the game's earned totals at each import, oldest first (engine/career.ts)
    tourneyLog: TourneyLog;       // each tournament run's battle conditions, as the player ticked them
    tourneyRecords: TourneyRecord[];   // every tournament played (TournamentRecords, 29.1.3+), oldest first
    vaultLevels: Record<string, number>;   // Vault upgrade levels by the game's vault id (Vault.UpgradesLevel); "g<group>" = 1 for an unlocked section (constants/vaultData.ts)
}

// A tournament run's league and battle conditions (HeatKey names from
// constants/tournamentData), as the player ticked them — the game's
// export doesn't record them. Keyed by the run (battleReport runKey).
export interface TourneyLogEntry {
    league: League;
    conditions: string[];
}
export type TourneyLog = Record<string, TourneyLogEntry>;

// One tournament from the game's TournamentRecords (29.1.3+).
export interface TourneyRecord {
    number: number;    // TournamentNumber
    date: number;      // ms, the tournament day (00:00 UTC)
    league: League;
    wave: number;
    rank: number;      // 0 = not placed yet
}

// Dissonant Boosts: the best Dissonant Run wave on each track, indexed by tier
// number (engine/dissonance.ts).
export type DissonanceTrack = 'attack' | 'defense' | 'utility' | 'uw';
export type DissonanceWaves = Record<DissonanceTrack, number[]>;

// How far a lab's next level has got (ResearchPercentComplete). Tied to that
// level: once the lab's level changes, by an edit or an Optimizer step, the
// next level is charged in full.
export interface LabLevelProgress {
    toLevel: number;     // the level under way
    done: number;        // the share of its research time done, 0–1
    running?: boolean;   // being researched right now, so its coins are paid
}
export type LabProgress = Record<string, LabLevelProgress>;

// A lab being researched when the game exported (LabActiveBool / LabResearchInt,
// ResearchCompleteDate; the speed-up as of the export).
export interface LabRunning {
    lab: string | null;        // site lab name; null when the game number isn't mapped
    labIndex: number;          // the game's lab number
    doneAt: number | null;     // ms, UTC
    speedUp: number;           // speed-up multiplier (0 = none)
    speedUpLeftSec: number;    // seconds of speed-up left at export
    exportedAt: number | null; // ms, UTC
    toLevel?: number;          // the level being researched (ResearchLevel + 1; older saves: absent)
}

// ── Guardian ──────────────────────────────────────────────────
// Chips by the game's save index (constants/guardianData.ts CHIPS).
export interface GuardianPreset {
    name: string;
    extraSlots: number;      // chip slots bought beyond the first (0–2)
    chips: number[];         // chip in each slot, by save index (-1 = empty)
    levels: number[];        // 3 stat levels per chip, by save index (27)
}

export interface GuardianData {
    unlocked: boolean;
    chipsOwned: boolean[];   // by save index
    skinsOwned: number;      // each owned skin: +0.6% coins
    presets: GuardianPreset[];   // the game's Guardian presets
    presetFor: number[];     // site preset i → Guardian preset (the game's global preset)
    inGuild?: boolean;       // InGuild at export (29.1.3+); the Guardian only fights in a guild
}