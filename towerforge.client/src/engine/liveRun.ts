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
//  Pure functions — no store imports.
// ============================================================

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
    out.Tier = raw.CurrentTier;
    out.Wave = raw.CurrentWave;
    out.BattleDate = raw.ExportedAt;
    out.IsTournament = false;
    return out;
}
