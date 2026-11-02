// ============================================================
//  TowerForge Companion — The run in progress
//  The game's …ThisRound counters, under the names a finished run has, so a run
//  still going reads like any other (coin lines, blocked damage, kills).
//
//  Only 38 of a run's 148 fields share a name with their counter. The rest are
//  mapped below by what they say, and checked on the owner's export of
//  2026-11-01 (T18 W3141 in progress, a finished T18 W2775 beside it): kills by
//  source add up to all the enemies in both, and the coin, kill and damage
//  shares line up. The file doesn't say whether the run is a tournament.
//  The run's levels and perks sit in their own fields (liveUpgrades, livePerks).
//  Pure functions — no store imports.
// ============================================================

import { PERKS, WS_STATS } from '../constants/gameData';
import { GAME_PERKS } from '../constants/gameExportMaps';

// After a week the run the file showed has surely ended.
export const LIVE_RUN_MAX_AGE_MS = 7 * 86400000;

const SUFFIX = 'ThisRound';

// A finished run's field → its counter, without "ThisRound".
const RENAMES: Record<string, string> = {
    GameTime: 'GameplayTime',
    InterestEarned: 'CashEarnedFromInterest',
    RerollShardsEarned: 'RerollCurrencyEarned',
    DamageTakenWhileBerserked: 'DamageTakenWhileBerskerActive',
    DamageGainFromBerserk: 'DamageGainedFromBerserker',
    ProjectilesDamage: 'DamageByProjectiles',
    ProjectilesCount: 'ProjectilesFired',
    ThornDamage: 'DamageByThorn',
    OrbDamage: 'DamageByOrbs',
    LandMineDamage: 'DamageByDroppedLandMine',
    LandMinesSpawned: 'DroppedLandMinesSpawned',
    RendArmorDamage: 'DamageByRenderArmor',
    DeathRayDamage: 'DamageByDeathRay',
    SmartMissileDamage: 'TotalDamageBySmartMissiles',
    InnerLandMineDamage: 'TotalDamageByInnerLandMines',
    ChainLightningDamage: 'TotalDamageByChainLightning',
    DeathWaveDamage: 'TotalDamageByDeathWave',
    SwampDamage: 'TotalDamageBySwamp',
    BlackHoleDamage: 'TotalDamageByBlackHole',
    TaggedByDeathwave: 'TotalEnemiesTaggedByDeathwave',
    DestroyedInSpotlight: 'EnemiesDestroyedInSpotlight',
    DestroyedInGoldenTower: 'EnemiesDestroyedInGoldenTower',
    DestroyedInAmplifyBot: 'EnemiesDestroyedInAmplifyBot',
    DestroyedInGoldenBot: 'EnemiesDestroyedInGoldenBot',
    DestroyedInBlackhole: 'EnemiesDestroyedInBlackhole',
    DestroyedInOrbs: 'EnemiesDestroyedInOrbs',
    CoinsFromDeathWave: 'DeathWaveCoins',
    CoinsFromGoldenTower: 'GoldenTowerCoins',
    CoinsFromGoldenTowerPlus: 'GoldenTowerPlusCoins',
    CashFromGoldenTower: 'GoldenTowerCash',
    CoinsFromBlackHole: 'BlackHoleCoins',
    CoinsFromSpotlight: 'SpotlightCoins',
    CoinsFromOrbs: 'OrbCoins',
    CoinsFromCoinUpgrade: 'CoinsBonusUpgradeCoins',
    CoinsFromCoinBonuses: 'CoinsBonusTotalCoins',
    CoinsFromCritCoin: 'CritCoinCoins',
    TotalEnemies: 'TotalEnemiesDestroyed',
    TotalBasic: 'TotalEnemiesDestroyedNormal',
    TotalFast: 'TotalEnemiesDestroyedFast',
    TotalTank: 'TotalEnemiesDestroyedTank',
    TotalRanged: 'TotalEnemiesDestroyedRanged',
    TotalBoss: 'TotalEnemiesDestroyedBoss',
    TotalProtector: 'TotalEnemiesDestroyedProtector',
    TotalElites: 'TotalEnemiesDestroyedElites',
    TotalVampires: 'TotalEnemiesDestroyedVampires',
    TotalRays: 'TotalEnemiesDestroyedRays',
    TotalScatters: 'TotalEnemiesDestroyedScatters',
    TotalSaboteurs: 'TotalEnemiesDestroyedSaboteurs',
    TotalCommanders: 'TotalEnemiesDestroyedCommanders',
    TotalOvercharges: 'TotalEnemiesDestroyedOvercharges',
    DestroyedByOrbs: 'EnemiesDestroyedByOrbs',
    DestroyedByThorns: 'EnemiesDestroyedByThorn',
    DestroyedByDeathRay: 'EnemiesDestroyedByDeathRay',
    DestroyedByLandMine: 'EnemiesDestroyedByDroppedLandMine',
    DestroyedByProjectiles: 'EnemiesDestroyedByProjectiles',
    DestroyedByChainLightning: 'EnemiesDestroyedByChainLightning',
    DestroyedBySmartMissiles: 'EnemiesDestroyedBySmartMissiles',
    DestroyedByDeathWave: 'EnemiesDestroyedByDeathWave',
    DestroyedByInnerLandMines: 'EnemiesDestroyedByInnerLandMines',
    DestroyedByPoisonSwamp: 'EnemiesDestroyedByPoisonSwamp',
    DestroyedByBlackHole: 'EnemiesDestroyedByBlackHole',
    DestroyedByFlameBot: 'EnemiesDestroyedByFlameBot',
    DestroyedByDeathPenalty: 'EnemiesDestroyedByDeathPenalty',
    DestroyedByOther: 'EnemiesDestroyedByOther',
    FlameBotDamage: 'TotalDamageByBot',
    ThunderBotStuns: 'TotalStunsByBot',
    GoldenBotCoinsEarned: 'TotalCoinsByBot',
    GuardianDamage: 'TotalDamageByGuardian',
    GuardianSummoned: 'TotalSummonedByGuardian',
    GuardianCoinsStolen: 'TotalCoinsStolenByGuardian',
    GuardianCoinsFetched: 'TotalCoinsFetchedByGuardian',
    GuardianCatches: 'TotalCatchesByGuardian',
    GuardianGems: 'TotalGemsByGuardian',
    GuardianMedals: 'TotalMedalsByGuardian',
    GuardianRerollShards: 'TotalRerollShardsByGuardian',
    GuardianCannonShards: 'TotalCannonShardsByGuardian',
    GuardianArmorShards: 'TotalArmorShardsByGuardian',
    GuardianGeneratorShards: 'TotalGeneratorShardsByGuardian',
    GuardianCoreShards: 'TotalCoreShardsByGuardian',
    GuardianCommonModules: 'TotalCommonModulesByGuardian',
    GuardianRareModules: 'TotalRareModulesByGuardian',
};

// The run in progress as a BattleHistory entry; null when there's none (the
// counters are only filled while RoundActiveBool is true, TTG).
export function liveBattle(raw: Record<string, unknown>): Record<string, unknown> | null {
    if (raw.RoundActiveBool !== true) return null;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(raw)) {
        if (!key.endsWith(SUFFIX)) continue;
        // A finished run keeps these two families' suffix in its own names.
        if (key.startsWith('EnemiesHitBy') || key === 'HealthFromDeathWaveThisRound') out[key] = v;
        else out[key.slice(0, -SUFFIX.length)] = v;
    }
    for (const [field, counter] of Object.entries(RENAMES)) out[field] = raw[counter + SUFFIX];
    // 0 with no run going, 1892 / 1900 at T18 W3141: these two are the run's too.
    out.AttackLevelSkips = raw.EnemyAttackLevelSkips;
    out.HealthLevelSkips = raw.EnemyHealthLevelSkips;
    out.Tier = raw.CurrentTier;
    out.Wave = raw.CurrentWave;
    out.BattleDate = raw.ExportedAt;
    out.IsTournament = false;
    return out;
}

// In a run, these hold the workshop's level plus what the run added: at T18
// W3141 the difference is exactly that run's free upgrades, and with no run
// going they equal the workshop's (owner's exports, 2026-11-01). Same order as
// WS_STATS.
const IN_RUN_FIELDS: [string, string, string][] = [
    ['attack', 'UpgradeLevel', 'UpgradeWorkshopLevel'],
    ['defense', 'UpgradeDefenseLevel', 'UpgradeWorkshopDefenseLevel'],
    ['utility', 'UpgradeUtilityLevel', 'UpgradeWorkshopUtilityLevel'],
];

export interface LiveUpgrade {
    stat: string;
    from: number;   // the workshop's level
    to: number;     // the run's
}

// The stats the run has raised.
export function liveUpgrades(raw: Record<string, unknown>): LiveUpgrade[] {
    return IN_RUN_FIELDS.flatMap(([section, inRun, workshop]) => {
        const [run, ws] = [raw[inRun], raw[workshop]];
        if (!Array.isArray(run) || !Array.isArray(ws)) return [];
        return (WS_STATS[section] ?? []).flatMap(([stat], i) => {
            const [from, to] = [ws[i], run[i]];
            return typeof from === 'number' && typeof to === 'number' && to > from ? [{ stat, from, to }] : [];
        });
    });
}

// Perks with no site perk, though the number is known (game-export-format.md).
const OTHER_PERKS: Record<number, string> = { 10: 'Perk Wave Requirement', 12: 'Max Game Speed' };

export interface LivePerks {
    named: { name: string; count: number }[];   // in the order first picked
    unnamed: number;                            // picks on numbers not known yet
}

// The picks so far, by the names the site knows. 12 standard perk numbers are
// only known once an Auto Pick list is seen.
export function livePerks(raw: Record<string, unknown>): LivePerks | null {
    if (!Array.isArray(raw.PerksPicked)) return null;
    const counts = new Map<string, number>();
    let unnamed = 0;
    for (const pick of raw.PerksPicked as unknown[]) {
        const n = (pick as { Perk?: unknown } | null)?.Perk;
        const id = typeof n === 'number' ? GAME_PERKS[n] : undefined;
        const name = typeof n === 'number' ? OTHER_PERKS[n] ?? PERKS.find(p => p.id === id)?.name : undefined;
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
        else unnamed++;
    }
    return { named: [...counts].map(([name, count]) => ({ name, count })), unnamed };
}
